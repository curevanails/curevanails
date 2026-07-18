/**
 * Transactional recruit emails, sent (best-effort) after a candidate submits
 * /recruit/apply:
 *
 *   1. `tpl-recruit-alert` → the recruiter address(es) in the `recruit_notify_to`
 *      setting (managed on the notify dashboard).
 *   2. `tpl-recruit-ack`   → the candidate, confirming we received their
 *      application (only when they supplied an email — it's optional).
 *
 * Both are DB "system templates" (see email-db.ts `SYSTEM_TEMPLATES`) rendered
 * via Handlebars and sent through the shared `sendOne` path, so each send is
 * logged to `email_logs` and shows up in the notify dashboard alongside
 * campaign sends. Everything here is swallowed on error — a failed or
 * unconfigured email must never affect the applicant's submission.
 */

import { ensureEmailSchema } from "./email-db";
import { createSesClient, sesCredentialsFromEnv } from "./email/ses-client";
import { sendOne, type CampaignTemplate, type Recipient } from "./email/send-service";
import { RECRUIT_NOTIFY_TO, getSetting, parseRecipients } from "./app-settings";

/** Canonical admin dashboard (the standalone `admin` Worker serves it at root). */
const ADMIN_DASHBOARD_URL = "https://admin.curevanails.com";
/** Public origin used for the candidate email (no unsubscribe link is used). */
const PUBLIC_SITE_URL = "https://curevanails.com";

export interface ApplicationSummary {
	id: string;
	firstName: string;
	lastName: string;
	email: string | null;
	phone: string;
	positions: string[];
	currentStatus: string;
	graduationDate: string | null;
	background: string;
	employmentType: string;
	portfolioLink: string | null;
	whyCureva: string | null;
}

function humanize(v: string): string {
	return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function loadTemplate(db: D1Database, id: string): Promise<CampaignTemplate | null> {
	return db
		.prepare("SELECT id, subject, html, text FROM email_templates WHERE id = ?")
		.bind(id)
		.first<CampaignTemplate>();
}

/**
 * Render + send the recruit emails. Never throws — the caller (/api/recruit) has
 * already persisted the application, so email is strictly a side effect.
 */
export async function sendRecruitEmails(
	db: D1Database,
	env: Record<string, unknown>,
	app: ApplicationSummary,
): Promise<void> {
	// Ensure the system templates exist before we try to load them.
	await ensureEmailSchema(db);

	// SES not configured (secrets unset) → nothing to send. The application is
	// already saved; skip quietly.
	let client: ReturnType<typeof createSesClient>;
	try {
		client = createSesClient(sesCredentialsFromEnv(env));
	} catch {
		return;
	}

	const candidateName = `${app.firstName} ${app.lastName}`.trim() || "New applicant";
	const vars: Record<string, unknown> = {
		candidate_name: candidateName,
		first_name: app.firstName || "there",
		positions: app.positions.map(humanize).join(", "),
		phone: app.phone,
		email: app.email ?? "",
		current_status: humanize(app.currentStatus),
		background: humanize(app.background),
		employment_type: humanize(app.employmentType),
		graduation_date: app.graduationDate ?? "",
		portfolio_link: app.portfolioLink ?? "",
		why_cureva: app.whyCureva ?? "",
		dashboard_url: ADMIN_DASHBOARD_URL,
	};

	// 1) Recruiter alert(s).
	const alertTpl = await loadTemplate(db, "tpl-recruit-alert");
	if (alertTpl) {
		for (const to of parseRecipients(await getSetting(db, RECRUIT_NOTIFY_TO))) {
			const recipient: Recipient = { id: app.id, email: to, name: null, unsubscribe_token: "" };
			try {
				await sendOne(client, db, {
					template: alertTpl,
					recipient,
					baseUrl: ADMIN_DASHBOARD_URL,
					extraVars: vars,
				});
			} catch (err) {
				console.error("recruit alert send failed", err);
			}
		}
	}

	// 2) Candidate acknowledgement (only if they gave an email).
	if (app.email) {
		const ackTpl = await loadTemplate(db, "tpl-recruit-ack");
		if (ackTpl) {
			const recipient: Recipient = {
				id: app.id,
				email: app.email,
				name: app.firstName || null,
				unsubscribe_token: "",
			};
			try {
				await sendOne(client, db, {
					template: ackTpl,
					recipient,
					baseUrl: PUBLIC_SITE_URL,
					extraVars: vars,
				});
			} catch (err) {
				console.error("recruit ack send failed", err);
			}
		}
	}
}
