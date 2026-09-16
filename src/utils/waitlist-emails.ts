/**
 * Transactional waitlist email, sent (best-effort) after someone joins via
 * /api/waitlist:
 *
 *   `tpl-welcome` → the new subscriber, thanking them for joining.
 *
 * Mirrors `recruit-emails.ts`: the template is a DB system template rendered
 * with Handlebars and sent through the shared `sendOne` path, so every send is
 * logged to `email_logs` and shows up on the mail dashboard. Everything is
 * swallowed on error — the row is already saved and a failed or unconfigured
 * send must never affect the signup.
 *
 * Unlike the recruit acknowledgement, the waitlist row carries a real
 * `unsubscribe_token`, so the `{{unsubscribe_url}}` footer in the template
 * resolves to a working link.
 *
 * Because the send is best-effort, `retryPendingWelcomes` below is the safety
 * net: the admin Worker's cron re-sends anything the signup path could not
 * deliver, exactly as `recruit-emails.ts` does for candidate thank-yous.
 */

import { env as workerEnv } from "cloudflare:workers";
import { ensureEmailSchema } from "./email-db";
import { createMailer, type Mailer } from "./email/mailer";
import {
	logSendSkipped,
	sendOne,
	type CampaignTemplate,
	type Recipient,
} from "./email/send-service";
import {
	listUnwelcomedSubscribers,
	markWelcomeAttempt,
	markWelcomeEmailSent,
	type UnwelcomedSubscriber,
} from "./waitlist-db";

/** Public origin the unsubscribe link is built against. */
const PUBLIC_SITE_URL = "https://curevanails.com";

export interface WaitlistSubscriber {
	id: string;
	email: string;
	unsubscribeToken: string;
}

/**
 * Send one subscriber their welcome and stamp it. Shared by the send-on-signup
 * path and the catch-up below, so someone welcomed late gets exactly the email
 * they would have got at the time. The stamp lands only once the transport has
 * accepted the message, so the flag means "we really did welcome them".
 */
async function sendWelcome(
	mailer: Mailer,
	db: D1Database,
	template: CampaignTemplate,
	sub: WaitlistSubscriber,
): Promise<void> {
	// No name column on the waitlist — `sendOne` falls back to "there".
	const recipient: Recipient = {
		id: sub.id,
		email: sub.email,
		name: null,
		unsubscribe_token: sub.unsubscribeToken,
	};
	// Stamped BEFORE the send, so a failure still counts as an attempt and the
	// scheduled catch-up backs off instead of hammering the same address.
	await markWelcomeAttempt(db, sub.id);
	await sendOne(mailer, db, {
		template,
		recipient,
		baseUrl: PUBLIC_SITE_URL,
		extraVars: {},
	});
	await markWelcomeEmailSent(db, sub.id);
}

/**
 * Render + send the waitlist welcome email, then stamp `ack_email_sent_at` on
 * success. Never throws — the caller (/api/waitlist) has already persisted the
 * subscriber, so email is strictly a side effect.
 */
export async function sendWaitlistWelcome(
	db: D1Database,
	env: Record<string, unknown>,
	sub: WaitlistSubscriber,
): Promise<void> {
	// Anything that stops us before `sendOne` gets recorded as a failed log row —
	// `wrangler tail` can't see preview-version traffic, so console output alone
	// leaves an unconfigured environment undiagnosable.
	const skip = (reason: string) =>
		logSendSkipped(db, {
			templateId: "tpl-welcome",
			recipientId: sub.id,
			email: sub.email,
			reason,
		});

	try {
		await ensureEmailSchema(db);
	} catch (err) {
		console.error("waitlist welcome skipped — schema check failed", err);
		await skip(`schema check failed: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	// No transport (no `EMAIL` binding, no SES secrets) → nothing to send.
	let mailer: Mailer;
	try {
		mailer = createMailer(env);
	} catch (err) {
		console.warn("waitlist welcome skipped — email sending not configured", err);
		await skip(err instanceof Error ? err.message : "Email sending not configured");
		return;
	}

	const template = await db
		.prepare("SELECT id, subject, html, text FROM email_templates WHERE id = ?")
		.bind("tpl-welcome")
		.first<CampaignTemplate>();
	if (!template) {
		console.warn("waitlist welcome skipped — tpl-welcome missing");
		await skip("template tpl-welcome not found");
		return;
	}

	try {
		await sendWelcome(mailer, db, template, sub);
	} catch (err) {
		// `sendOne` normally flips its own log row to 'failed', but if that UPDATE
		// is itself what failed the row is stranded at 'queued' with no reason
		// recorded. Write the reason as its own row so the failure is never
		// invisible.
		console.error("waitlist welcome send failed", err);
		await skip(`send failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/** What one catch-up run did. `blocked` means it never got as far as sending. */
export interface WelcomeCatchUpResult {
	sent: number;
	failed: number;
	blocked?: string;
}

/**
 * The scheduled run's spacing between attempts at the same subscriber. Same
 * fifteen minutes as the recruit catch-up, and for the same reason: the cron
 * asks the transport whether it can reach anyone before trying, so this only
 * paces the occasional transient failure.
 */
export const WELCOME_RETRY_INTERVAL_MS = 15 * 60 * 1000;

/** Convert a DB row into the shape `sendWelcome` wants. */
function toSubscriber(row: UnwelcomedSubscriber): WaitlistSubscriber {
	return { id: row.id, email: row.email, unsubscribeToken: row.unsubscribe_token ?? "" };
}

export async function sendPendingWelcomes(
	db: D1Database,
	env: Record<string, unknown>,
	{ limit = 50, retryAfterMs = 0 }: { limit?: number; retryAfterMs?: number } = {},
): Promise<WelcomeCatchUpResult> {
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

	const template = await db
		.prepare("SELECT id, subject, html, text FROM email_templates WHERE id = ?")
		.bind("tpl-welcome")
		.first<CampaignTemplate>();
	if (!template) return { sent: 0, failed: 0, blocked: "The tpl-welcome template is missing." };

	let sent = 0;
	let failed = 0;
	const cutoff = retryAfterMs > 0 ? new Date(Date.now() - retryAfterMs).toISOString() : undefined;
	for (const row of await listUnwelcomedSubscribers(db, limit, cutoff)) {
		try {
			await sendWelcome(mailer, db, template, toSubscriber(row));
			sent++;
		} catch (err) {
			// Logged to email_logs by sendOne; the row keeps its NULL stamp and
			// will be picked up again next time.
			console.error("waitlist welcome catch-up failed", row.id, err);
			failed++;
		}
	}
	return { sent, failed };
}

/**
 * Cron entry for the catch-up (src/worker.ts `scheduled`, admin Worker, every
 * five minutes). Reads its own bindings like `retryPendingAcks` does, and never
 * throws — a bad tick must not take the campaign runner or the recruit catch-up
 * down with it.
 *
 * Cheap to run that often because it asks first: nothing owed means no
 * transport call at all, and a transport that cannot reach anyone (SES before
 * production access) sends nothing rather than writing a failed row per
 * subscriber per tick.
 */
export async function retryPendingWelcomes(): Promise<void> {
	try {
		const db = workerEnv.DB as D1Database;
		const env = workerEnv as unknown as Record<string, unknown>;

		// Nothing owed, nothing to do — and no transport call either.
		if ((await listUnwelcomedSubscribers(db, 1)).length === 0) return;

		let mailer: Mailer;
		try {
			mailer = createMailer(env);
		} catch {
			return; // unconfigured — the signup path already logged this
		}
		if ((await mailer.canReachAnyone()) === false) {
			console.log("waitlist welcome catch-up: SES still in sandbox, subscribers waiting");
			return;
		}

		const result = await sendPendingWelcomes(db, env, { retryAfterMs: WELCOME_RETRY_INTERVAL_MS });
		if (result.sent || result.failed) console.log("waitlist welcome catch-up", result);
	} catch (err) {
		console.error("waitlist welcome catch-up crashed", err);
	}
}
