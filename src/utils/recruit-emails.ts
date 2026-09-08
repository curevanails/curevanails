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

import { env as workerEnv } from "cloudflare:workers";
import { ensureEmailSchema } from "./email-db";
import {
	listUnthankedApplications,
	markAckAttempt,
	markAckEmailSent,
	type UnthankedApplication,
} from "./recruit-db";
import { createSesClient, sesCredentialsFromEnv } from "./email/ses-client";
import {
	logSendSkipped,
	sendOne,
	type CampaignTemplate,
	type Recipient,
} from "./email/send-service";
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
	employmentType: string[];
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

/** The Handlebars bag both recruit templates render against. */
function templateVars(app: ApplicationSummary): Record<string, unknown> {
	return {
		candidate_name: `${app.firstName} ${app.lastName}`.trim() || "New applicant",
		first_name: app.firstName || "there",
		positions: app.positions.map(humanize).join(", "),
		phone: app.phone,
		email: app.email ?? "",
		current_status: humanize(app.currentStatus),
		background: humanize(app.background),
		employment_type: app.employmentType.map(humanize).join(", "),
		graduation_date: app.graduationDate ?? "",
		portfolio_link: app.portfolioLink ?? "",
		why_cureva: app.whyCureva ?? "",
		dashboard_url: ADMIN_DASHBOARD_URL,
	};
}

/**
 * Send the candidate their thank-you and stamp it. Shared by the send-on-submit
 * path and the catch-up below, so a candidate thanked late gets exactly the
 * email they would have got at the time. The stamp lands only once SES has
 * accepted the message, so the flag means "we really did thank them".
 */
async function sendAck(
	client: ReturnType<typeof createSesClient>,
	db: D1Database,
	template: CampaignTemplate,
	app: ApplicationSummary,
): Promise<void> {
	const recipient: Recipient = {
		id: app.id,
		email: app.email as string,
		name: app.firstName || null,
		unsubscribe_token: "",
	};
	// Stamped BEFORE the send, so a failure still counts as an attempt and the
	// scheduled catch-up backs off instead of hammering the same address.
	await markAckAttempt(db, app.id);
	await sendOne(client, db, {
		template,
		recipient,
		baseUrl: PUBLIC_SITE_URL,
		extraVars: templateVars(app),
	});
	await markAckEmailSent(db, app.id);
}

/** `positions` / `employment_type` are stored as JSON arrays; older rows hold a bare value. */
function parseStoredList(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr.map(String) : [];
	} catch {
		return [raw];
	}
}

function toSummary(row: UnthankedApplication): ApplicationSummary {
	return {
		id: row.id,
		firstName: row.first_name,
		lastName: row.last_name,
		email: row.email,
		phone: row.phone,
		positions: parseStoredList(row.positions),
		currentStatus: row.current_status,
		graduationDate: row.graduation_date,
		background: row.background,
		employmentType: parseStoredList(row.employment_type),
		portfolioLink: row.portfolio_link,
		whyCureva: row.why_cureva,
	};
}

export interface AckCatchUpResult {
	sent: number;
	failed: number;
	/** Set when nothing could be attempted at all. */
	blocked?: string;
}

/**
 * Send the thank-you to everyone still owed one.
 *
 * The send-on-submit path is best-effort by design, and its likeliest failure —
 * an SES account still in the sandbox, where every candidate address is
 * unverified — fails for EVERY candidate rather than the occasional one. This
 * is how those applicants are reached once that is fixed, instead of being
 * quietly written off. Safe to run repeatedly: the stamp is what makes a row
 * stop appearing, so a success is never sent twice.
 */
export interface AckCatchUpOptions {
	limit?: number;
	/**
	 * Skip candidates attempted within this many ms. The button passes 0 (send
	 * everyone now); the cron passes hours, so a failing address is tried a few
	 * times a day rather than every five minutes.
	 */
	retryAfterMs?: number;
}

/** The scheduled run's spacing between attempts at the same candidate. */
export const ACK_RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function sendPendingAcks(
	db: D1Database,
	env: Record<string, unknown>,
	{ limit = 50, retryAfterMs = 0 }: AckCatchUpOptions = {},
): Promise<AckCatchUpResult> {
	await ensureEmailSchema(db);

	let client: ReturnType<typeof createSesClient>;
	try {
		client = createSesClient(sesCredentialsFromEnv(env));
	} catch (err) {
		return { sent: 0, failed: 0, blocked: err instanceof Error ? err.message : "SES not configured" };
	}

	const template = await loadTemplate(db, "tpl-recruit-ack");
	if (!template) return { sent: 0, failed: 0, blocked: "The tpl-recruit-ack template is missing." };

	let sent = 0;
	let failed = 0;
	const cutoff = retryAfterMs > 0 ? new Date(Date.now() - retryAfterMs).toISOString() : undefined;
	for (const row of await listUnthankedApplications(db, limit, cutoff)) {
		try {
			await sendAck(client, db, template, toSummary(row));
			sent++;
		} catch (err) {
			// Logged to email_logs by sendOne; the row keeps its NULL stamp and
			// will be picked up again next time.
			console.error("recruit ack catch-up failed", row.id, err);
			failed++;
		}
	}
	return { sent, failed };
}

/**
 * Cron entry for the catch-up (src/worker.ts `scheduled`, admin Worker, every
 * five minutes). Reads its own bindings like runDueCampaigns does, and never
 * throws — a bad tick must not take the campaign runner down with it.
 *
 * The interval is what makes this cheap to run that often: it only ever
 * reaches for candidates nobody has tried in the last six hours, so while the
 * account is still in the SES sandbox each of them costs one failed log row
 * per six hours, not one per tick. The moment AWS grants production access,
 * the next tick after each candidate's window sends their email — no button,
 * no one remembering to press it.
 */
export async function retryPendingAcks(): Promise<void> {
	try {
		const db = workerEnv.DB as D1Database;
		const result = await sendPendingAcks(db, workerEnv as unknown as Record<string, unknown>, {
			retryAfterMs: ACK_RETRY_INTERVAL_MS,
		});
		if (result.sent || result.failed) console.log("recruit ack catch-up", result);
	} catch (err) {
		console.error("recruit ack catch-up crashed", err);
	}
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
	// already saved. Record why against the candidate's address, so a silently
	// unconfigured environment is visible in the dashboard instead of looking
	// like the feature was never built.
	let client: ReturnType<typeof createSesClient>;
	try {
		client = createSesClient(sesCredentialsFromEnv(env));
	} catch (err) {
		const reason = err instanceof Error ? err.message : "SES not configured";
		console.warn("recruit emails skipped — SES not configured", err);
		if (app.email) {
			await logSendSkipped(db, {
				templateId: "tpl-recruit-ack",
				recipientId: app.id,
				email: app.email,
				reason,
			});
		}
		return;
	}

	const vars = templateVars(app);

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
			try {
				await sendAck(client, db, ackTpl, app);
			} catch (err) {
				// The row keeps its NULL stamp, so the catch-up above can reach
				// this candidate later — a failure here is a delay, not a loss.
				console.error("recruit ack send failed", err);
			}
		}
	}
}
