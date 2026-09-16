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
 * via Handlebars and sent through the shared `sendOne` path (whichever
 * transport `mailer.ts` picks), so each send is logged to `email_logs` and
 * shows up in the notify dashboard alongside campaign sends. Everything here
 * is swallowed on error — a failed or unconfigured email must never affect the
 * applicant's submission.
 */

import { env as workerEnv } from "cloudflare:workers";
import { ensureEmailSchema } from "./email-db";
import {
	listUnthankedApplications,
	markAckAttempt,
	markAckEmailSent,
	type UnthankedApplication,
} from "./recruit-db";
import { createMailer, type Mailer } from "./email/mailer";
import {
	logSendSkipped,
	sendOne,
	type CampaignTemplate,
	type Recipient,
} from "./email/send-service";
import { RECRUIT_NOTIFY_TO, getSetting, parseRecipients } from "./app-settings";
import { fmtSchedule } from "./email-format";

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
	/** ISO instant the application was saved. Shown to the recruiter, not the candidate. */
	appliedAt?: string | null;
}

/** Mountain Time, matching every other timestamp an operator reads. */
function appliedAtLabel(iso: string | null | undefined): string {
	if (!iso) return "";
	const ms = Date.parse(iso);
	return Number.isFinite(ms) ? fmtSchedule(ms) : "";
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
		// The alert template has an "Applied" row behind `{{#if applied_at}}`.
		// Nothing ever supplied it, so the row silently never rendered and the
		// recruiter could not see when an application arrived — which matters
		// most for the ones the catch-up thanks weeks later.
		applied_at: appliedAtLabel(app.appliedAt),
		dashboard_url: ADMIN_DASHBOARD_URL,
	};
}

/**
 * Send the candidate their thank-you and stamp it. Shared by the send-on-submit
 * path and the catch-up below, so a candidate thanked late gets exactly the
 * email they would have got at the time. The stamp lands only once the
 * transport has accepted the message, so the flag means "we really did thank them".
 */
async function sendAck(
	mailer: Mailer,
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
	await sendOne(mailer, db, {
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
		appliedAt: row.created_at,
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
	 * Skip candidates attempted within this many ms. The cron passes a short
	 * window so a transiently failing address is not hammered every tick.
	 */
	retryAfterMs?: number;
}

/**
 * The scheduled run's spacing between attempts at the same candidate.
 *
 * Short, because the sandbox is no longer what this guards against — the
 * cron asks SES whether the account is still sandboxed and simply does not
 * try while it is, so nothing is written to email_logs during that wait. What
 * remains is the occasional transient SES failure after approval, and for
 * that fifteen minutes is plenty of politeness and little enough delay.
 */
export const ACK_RETRY_INTERVAL_MS = 15 * 60 * 1000;

export async function sendPendingAcks(
	db: D1Database,
	env: Record<string, unknown>,
	{ limit = 50, retryAfterMs = 0 }: AckCatchUpOptions = {},
): Promise<AckCatchUpResult> {
	await ensureEmailSchema(db);

	let mailer: Mailer;
	try {
		mailer = createMailer(env);
	} catch (err) {
		return {
			sent: 0,
			failed: 0,
			blocked: err instanceof Error ? err.message : "Email sending not configured",
		};
	}

	const template = await loadTemplate(db, "tpl-recruit-ack");
	if (!template) return { sent: 0, failed: 0, blocked: "The tpl-recruit-ack template is missing." };

	let sent = 0;
	let failed = 0;
	const cutoff = retryAfterMs > 0 ? new Date(Date.now() - retryAfterMs).toISOString() : undefined;
	for (const row of await listUnthankedApplications(db, limit, cutoff)) {
		try {
			await sendAck(mailer, db, template, toSummary(row));
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
 * Cheap to run that often because it asks first: a transport that is behind a
 * sandbox (SES before production access) sends nothing and logs one line, and
 * the moment it can reach anyone — always, on Cloudflare Email Service — the
 * next tick, five minutes at most, sends every candidate their email. Nobody
 * presses anything; there is nothing to press.
 */
export async function retryPendingAcks(): Promise<void> {
	try {
		const db = workerEnv.DB as D1Database;
		const env = workerEnv as unknown as Record<string, unknown>;

		// Nothing owed, nothing to do — and no SES call either.
		if ((await listUnthankedApplications(db, 1)).length === 0) return;

		// Ask before trying. In a sandbox every candidate address is rejected,
		// so attempting would only write a failed row per candidate per tick and
		// tell us nothing we did not know. When the transport will not say, try anyway.
		let mailer: Mailer;
		try {
			mailer = createMailer(env);
		} catch {
			return; // unconfigured — the submit path already logged this
		}
		if ((await mailer.canReachAnyone()) === false) {
			console.log("recruit ack catch-up: SES still in sandbox, candidates waiting");
			return;
		}

		const result = await sendPendingAcks(db, env, { retryAfterMs: ACK_RETRY_INTERVAL_MS });
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

	// No transport (no `EMAIL` binding, no SES secrets) → nothing to send. The
	// application is already saved. Record why against the candidate's address,
	// so a silently unconfigured environment is visible in the dashboard instead
	// of looking like the feature was never built.
	let mailer: Mailer;
	try {
		mailer = createMailer(env);
	} catch (err) {
		const reason = err instanceof Error ? err.message : "Email sending not configured";
		console.warn("recruit emails skipped — email sending not configured", err);
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
				await sendOne(mailer, db, {
					template: alertTpl,
					recipient,
					baseUrl: ADMIN_DASHBOARD_URL,
					extraVars: vars,
					// The template's footer says "reply to reach the candidate", so
					// make that true. Without it Reply goes to the From address,
					// which is a send-only mailbox.
					...(app.email ? { replyTo: app.email } : {}),
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
				await sendAck(mailer, db, ackTpl, app);
			} catch (err) {
				// The row keeps its NULL stamp, so the catch-up above can reach
				// this candidate later — a failure here is a delay, not a loss.
				console.error("recruit ack send failed", err);
			}
		}
	}
}
