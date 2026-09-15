import { addSuppression, isSuppressed } from "./suppression";
import {
	createSesClient,
	isProductionAccessEnabled,
	sendViaSes,
	sesCredentialsFromEnv,
} from "./ses-client";
import { FROM_EMAIL, FROM_NAME, unsubscribeHeaders, type SendParams } from "./sender";

/**
 * The one place that decides HOW an email leaves this app.
 *
 * Two transports exist, and a Worker uses whichever it was deployed with:
 *
 *   - **Cloudflare Email Service** — the live one. The Worker carries a
 *     `send_email` binding named `EMAIL` (see `wrangler*.jsonc`) and sends
 *     through it: no credentials to manage, no sandbox, any recipient from the
 *     moment the domain is onboarded. Hard bounces and spam complaints are
 *     suppressed by Cloudflare itself and surface here as
 *     `E_RECIPIENT_SUPPRESSED`, which we mirror into our own suppression list.
 *   - **AWS SES** — the fallback, used when a Worker has no `EMAIL` binding
 *     but does have the AWS secrets, and — transitionally — when Cloudflare
 *     refuses the sender because the domain is not onboarded yet. Kept so the
 *     SNS webhook and the historical `email_logs` rows still make sense, and
 *     so neither removing the binding nor deploying it a day before the
 *     domain is onboarded leaves a Worker unable to send. While the AWS
 *     account is in its sandbox it can only reach verified addresses — which
 *     is why the Cloudflare transport exists.
 *
 * Everything above this module — templates, the send loop, `email_logs`, the
 * dashboard, the crons — talks to a `Mailer` and never learns which one it is.
 */

export type MailProvider = "cloudflare" | "ses";

export interface Mailer {
	readonly provider: MailProvider;
	/**
	 * Send one already-rendered email. Refuses an address on our suppression
	 * list before it reaches the transport. Returns the transport's message id
	 * (stored in `email_logs.ses_message_id`, whichever transport minted it).
	 */
	send(db: D1Database, params: SendParams): Promise<string | undefined>;
	/**
	 * Whether this transport may reach addresses it has never seen — i.e. it is
	 * not behind a sandbox. `null` when it cannot say. Cloudflare has no sandbox,
	 * so it is always `true` there; SES asks AWS.
	 */
	canReachAnyone(): Promise<boolean | null>;
}

export const NOT_CONFIGURED_MESSAGE =
	"Email sending not configured: give the Worker the `EMAIL` send_email binding " +
	"(Cloudflare Email Service) or set AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (SES).";

/** Duck-type the binding — wrangler injects an object whose `send` is a function. */
function sendEmailBinding(env: Record<string, unknown>): SendEmail | null {
	const b = env.EMAIL;
	return b && typeof b === "object" && typeof (b as { send?: unknown }).send === "function"
		? (b as SendEmail)
		: null;
}

/** Which transport `createMailer` would pick for this env, or null if neither is set up. */
export function detectMailProvider(env: Record<string, unknown>): MailProvider | null {
	if (sendEmailBinding(env)) return "cloudflare";
	try {
		sesCredentialsFromEnv(env);
		return "ses";
	} catch {
		return null;
	}
}

/**
 * Build the mailer for this Worker. Throws with `NOT_CONFIGURED_MESSAGE` when
 * neither transport is available, so every caller can log one honest reason.
 */
export function createMailer(env: Record<string, unknown>): Mailer {
	const binding = sendEmailBinding(env);
	const ses = sesMailerFromEnv(env);
	if (binding) return cloudflareMailer(binding, ses);
	if (ses) return ses;
	throw new Error(NOT_CONFIGURED_MESSAGE);
}

function sesMailerFromEnv(env: Record<string, unknown>): Mailer | null {
	try {
		return sesMailer(createSesClient(sesCredentialsFromEnv(env)));
	} catch {
		return null;
	}
}

async function refuseSuppressed(db: D1Database, to: string): Promise<void> {
	if (await isSuppressed(db, to)) throw new Error(`Email suppressed: ${to}`);
}

/** The shape of a Cloudflare Email Service failure: an Error with an `E_*` code. */
function cloudflareErrorCode(err: unknown): string | undefined {
	return err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
		? (err as { code: string }).code
		: undefined;
}

/**
 * The codes that mean "Cloudflare will not send from this domain (yet)" — it
 * is not onboarded for Email Sending. Every other code is about one message
 * and must surface as that message's failure.
 */
const SENDER_REFUSED = new Set(["E_SENDER_NOT_VERIFIED", "E_SENDER_DOMAIN_NOT_AVAILABLE"]);

/**
 * Remembered per isolate: once Cloudflare has refused the sender, go straight
 * to the fallback for a while rather than failing every message twice and
 * filling email_logs with the same refusal. It expires on its own, so the
 * moment the domain is onboarded the Worker switches back — no redeploy, no
 * flag to flip.
 */
let senderRefusedUntil = 0;
const SENDER_REFUSED_TTL_MS = 10 * 60 * 1000;

function cloudflareMailer(binding: SendEmail, fallback: Mailer | null): Mailer {
	const fallingBack = (): Mailer | null =>
		fallback && Date.now() < senderRefusedUntil ? fallback : null;

	return {
		provider: "cloudflare",
		async send(db, params) {
			const viaFallback = fallingBack();
			if (viaFallback) return viaFallback.send(db, params);

			await refuseSuppressed(db, params.to);
			const headers = unsubscribeHeaders(params.unsubscribeUrl);
			try {
				const result = await binding.send({
					from: { name: FROM_NAME, email: FROM_EMAIL },
					to: params.to,
					subject: params.subject,
					html: params.html,
					...(params.text ? { text: params.text } : {}),
					...(Object.keys(headers).length ? { headers } : {}),
				});
				return result.messageId;
			} catch (err) {
				const code = cloudflareErrorCode(err);
				// Cloudflare already refuses the address on its side; mirror that
				// into our list so the dashboard shows it and we stop trying.
				if (code === "E_RECIPIENT_SUPPRESSED") await suppressQuietly(db, params.to);
				// Domain not onboarded: not this message's fault. Use SES while it
				// is configured, so a deploy that lands before the onboarding does
				// not stop a single email that used to go out.
				if (code && SENDER_REFUSED.has(code) && fallback) {
					console.warn(
						`cloudflare email: sender refused (${code}); using the SES fallback for ${SENDER_REFUSED_TTL_MS / 60000} min`,
					);
					senderRefusedUntil = Date.now() + SENDER_REFUSED_TTL_MS;
					return fallback.send(db, params);
				}
				throw err;
			}
		},
		// No sandbox on Cloudflare — unless we are currently routing through
		// SES, in which case its answer is the honest one.
		canReachAnyone: async () => fallingBack()?.canReachAnyone() ?? true,
	};
}

function sesMailer(client: ReturnType<typeof createSesClient>): Mailer {
	return {
		provider: "ses",
		async send(db, params) {
			await refuseSuppressed(db, params.to);
			return sendViaSes(client, params);
		},
		canReachAnyone: () => isProductionAccessEnabled(client),
	};
}

async function suppressQuietly(db: D1Database, email: string): Promise<void> {
	try {
		await addSuppression(db, email, "bounce");
	} catch (err) {
		console.error("failed to mirror a Cloudflare suppression", err);
	}
}
