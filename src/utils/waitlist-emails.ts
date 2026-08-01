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
 */

import { ensureEmailSchema } from "./email-db";
import { createSesClient, sesCredentialsFromEnv } from "./email/ses-client";
import { sendOne, type CampaignTemplate, type Recipient } from "./email/send-service";
import { markWelcomeEmailSent } from "./waitlist-db";

/** Public origin the unsubscribe link is built against. */
const PUBLIC_SITE_URL = "https://curevanails.com";

export interface WaitlistSubscriber {
	id: string;
	email: string;
	unsubscribeToken: string;
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
	await ensureEmailSchema(db);

	// SES not configured (secrets unset) → nothing to send. Log it so an
	// unconfigured environment is visible in `wrangler tail` rather than silent.
	let client: ReturnType<typeof createSesClient>;
	try {
		client = createSesClient(sesCredentialsFromEnv(env));
	} catch (err) {
		console.warn("waitlist welcome skipped — SES not configured", err);
		return;
	}

	const template = await db
		.prepare("SELECT id, subject, html, text FROM email_templates WHERE id = ?")
		.bind("tpl-welcome")
		.first<CampaignTemplate>();
	if (!template) {
		console.warn("waitlist welcome skipped — tpl-welcome missing");
		return;
	}

	// No name column on the waitlist — `sendOne` falls back to "there".
	const recipient: Recipient = {
		id: sub.id,
		email: sub.email,
		name: null,
		unsubscribe_token: sub.unsubscribeToken,
	};

	try {
		await sendOne(client, db, {
			template,
			recipient,
			baseUrl: PUBLIC_SITE_URL,
			extraVars: {},
		});
		// Only stamped once SES accepted the message.
		await markWelcomeEmailSent(db, sub.id);
	} catch (err) {
		console.error("waitlist welcome send failed", err);
	}
}
