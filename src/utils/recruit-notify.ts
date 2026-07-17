/**
 * "New job application" email alert.
 *
 * When a candidate submits /recruit/apply, /api/recruit calls
 * `notifyNewApplication` (best-effort — it never blocks or fails the submission).
 * It emails the address(es) configured in the shared `recruit_notify_to` setting
 * (managed from the notify dashboard) and records the outcome in
 * `recruit_notifications`, which that dashboard renders as a "Recruit alerts"
 * list. Because all CureVà Workers share one D1, both sides see the same rows.
 */

import {
	FROM_ADDRESS,
	createSesClient,
	sendEmail,
	sesCredentialsFromEnv,
} from "./email/ses-client";
import { RECRUIT_NOTIFY_TO, getSetting, parseRecipients } from "./app-settings";

/** Canonical admin dashboard (the standalone `admin` Worker serves it at root). */
const ADMIN_DASHBOARD_URL = "https://admin.curevanails.com";

export const RECRUIT_NOTIFICATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS recruit_notifications (
  id             TEXT PRIMARY KEY,
  created_at     INTEGER NOT NULL,
  application_id TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  recipients     TEXT,
  status         TEXT NOT NULL,        -- sent | failed | skipped
  error          TEXT,
  ses_message_id TEXT
)`;

export async function ensureRecruitNotificationsSchema(db: D1Database): Promise<void> {
	await db.prepare(RECRUIT_NOTIFICATIONS_SCHEMA).run();
}

export interface ApplicationSummary {
	id: string;
	firstName: string;
	lastName: string;
	email: string | null;
	phone: string;
	positions: string[];
	currentStatus: string;
	background: string;
	employmentType: string;
	portfolioLink: string | null;
	whyCureva: string | null;
	resumeFilename: string | null;
}

function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function humanize(v: string): string {
	return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildSubject(name: string, app: ApplicationSummary): string {
	const roles = app.positions.map(humanize).join(", ") || "—";
	return `New application — ${name} (${roles})`;
}

function buildHtml(name: string, app: ApplicationSummary): string {
	const rows: Array<[string, string]> = [
		["Name", name],
		["Phone", app.phone],
		["Email", app.email ?? "—"],
		["Positions", app.positions.map(humanize).join(", ") || "—"],
		["Current status", humanize(app.currentStatus)],
		["Background", humanize(app.background)],
		["Employment", humanize(app.employmentType)],
		["Portfolio", app.portfolioLink ?? "—"],
		["Resume", app.resumeFilename ?? "—"],
		["Why CureVà", app.whyCureva ?? "—"],
	];
	const cells = rows
		.map(
			([k, v]) =>
				`<tr><td style="padding:6px 14px 6px 0;color:#6b6455;font-size:13px;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 0;color:#241f17;font-size:14px">${esc(v)}</td></tr>`,
		)
		.join("");
	return `<!doctype html><html><body style="margin:0;background:#f6f1e8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="background:#fff;border-radius:16px;padding:28px 26px;border:1px solid #e7e0d3">
      <p style="margin:0 0 4px;color:#5e6247;font-size:13px;font-weight:600;letter-spacing:.02em;text-transform:uppercase">New career application</p>
      <h1 style="margin:0 0 18px;font-size:22px;color:#241f17">${esc(name)}</h1>
      <table style="border-collapse:collapse;width:100%">${cells}</table>
      <a href="${ADMIN_DASHBOARD_URL}" style="display:inline-block;margin-top:22px;background:#5e6247;color:#f6f1e8;text-decoration:none;padding:11px 22px;border-radius:999px;font-size:14px;font-weight:600">Open the admin dashboard</a>
    </div>
    <p style="text-align:center;color:#9a927f;font-size:12px;margin-top:16px">CureVà recruiting — automated alert</p>
  </div>
</body></html>`;
}

function buildText(name: string, app: ApplicationSummary): string {
	return [
		`New career application: ${name}`,
		`Phone: ${app.phone}`,
		`Email: ${app.email ?? "—"}`,
		`Positions: ${app.positions.map(humanize).join(", ") || "—"}`,
		`Current status: ${humanize(app.currentStatus)}`,
		`Background: ${humanize(app.background)}`,
		`Employment: ${humanize(app.employmentType)}`,
		`Portfolio: ${app.portfolioLink ?? "—"}`,
		`Resume: ${app.resumeFilename ?? "—"}`,
		`Why CureVà: ${app.whyCureva ?? "—"}`,
		``,
		`Admin: ${ADMIN_DASHBOARD_URL}`,
	].join("\n");
}

async function record(
	db: D1Database,
	row: {
		id: string;
		appId: string;
		name: string;
		recipients: string;
		status: "sent" | "failed" | "skipped";
		error: string | null;
		messageId: string | null;
	},
): Promise<void> {
	try {
		await ensureRecruitNotificationsSchema(db);
		await db
			.prepare(
				`INSERT INTO recruit_notifications
				 (id, created_at, application_id, candidate_name, recipients, status, error, ses_message_id)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				row.id,
				Date.now(),
				row.appId,
				row.name,
				row.recipients || null,
				row.status,
				row.error,
				row.messageId,
			)
			.run();
	} catch (err) {
		console.error("recruit_notifications insert failed", err);
	}
}

/**
 * Best-effort: email the configured recruiter address(es) about a new
 * application and log the outcome. Swallows all errors — a failed alert must
 * never affect the applicant's submission.
 */
export async function notifyNewApplication(
	db: D1Database,
	env: Record<string, unknown>,
	app: ApplicationSummary,
): Promise<void> {
	const name = `${app.firstName} ${app.lastName}`.trim() || "New applicant";
	const notifId = crypto.randomUUID();

	const recipients = parseRecipients(await getSetting(db, RECRUIT_NOTIFY_TO));
	if (recipients.length === 0) {
		await record(db, {
			id: notifId,
			appId: app.id,
			name,
			recipients: "",
			status: "skipped",
			error: "No recipient configured — set it in notify → Settings.",
			messageId: null,
		});
		return;
	}

	let client: ReturnType<typeof createSesClient>;
	try {
		client = createSesClient(sesCredentialsFromEnv(env));
	} catch (err) {
		await record(db, {
			id: notifId,
			appId: app.id,
			name,
			recipients: recipients.join(", "),
			status: "failed",
			error: err instanceof Error ? err.message : "SES not configured.",
			messageId: null,
		});
		return;
	}

	const subject = buildSubject(name, app);
	const html = buildHtml(name, app);
	const text = buildText(name, app);

	let anySent = false;
	let messageId: string | null = null;
	let firstError: string | null = null;
	for (const to of recipients) {
		try {
			const id = await sendEmail(client, db, { to, subject, html, text, logId: notifId });
			anySent = true;
			messageId = id ?? messageId;
		} catch (err) {
			firstError = firstError ?? (err instanceof Error ? err.message : String(err));
		}
	}

	await record(db, {
		id: notifId,
		appId: app.id,
		name,
		recipients: recipients.join(", "),
		status: anySent ? "sent" : "failed",
		error: anySent ? null : firstError,
		messageId,
	});
}

// FROM_ADDRESS re-exported for callers/tests that want to assert the sender.
export { FROM_ADDRESS };
