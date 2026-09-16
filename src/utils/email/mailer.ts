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
 *
 * What a caller DOES declare is the kind of email it is sending, because the
 * two transports are not interchangeable for every kind: Cloudflare Email
 * Service is for transactional mail only, by policy, so a campaign to the
 * waiting list must go through SES even on a Worker that has the binding.
 */

export type MailProvider = "cloudflare" | "ses";

/**
 * What kind of email a caller is sending. This is a policy question, not a
 * preference — it decides which transports are even allowed.
 *
 *   - `transactional` — a message one person's own action just earned them:
 *     the thank-you for an application, the recruiter's alert about it, the
 *     welcome for joining the list, a test send an operator addresses to
 *     themselves. Either transport may carry these.
 *   - `marketing` — one message sent to an audience because we decided to send
 *     it: the opening announcement, a discount. **SES only.** Cloudflare Email
 *     Service does not permit bulk or marketing sending, and quietly pushing
 *     campaigns through it would risk the transport every transactional email
 *     now depends on.
 */
export type MailKind = "transactional" | "marketing";

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

export const MARKETING_NEEDS_SES_MESSAGE =
	"Campaign sending needs AWS SES: Cloudflare Email Service is for transactional " +
	"email only. Set AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY on this Worker.";

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
 * Build the mailer for this Worker and this kind of email. Throws a message the
 * caller can log or show verbatim when nothing may carry it — one honest reason
 * rather than a silent no-op.
 */
export function createMailer(
	env: Record<string, unknown>,
	kind: MailKind = "transactional",
): Mailer {
	const ses = sesMailerFromEnv(env);
	if (kind === "marketing") {
		if (ses) return ses;
		throw new Error(MARKETING_NEEDS_SES_MESSAGE);
	}
	const binding = sendEmailBinding(env);
	if (binding) return cloudflareMailer(binding, ses);
	if (ses) return ses;
	throw new Error(NOT_CONFIGURED_MESSAGE);
}

/**
 * Whether a send of this kind could go out at all. Asks by building the mailer
 * the send path would build, so a dashboard that greys out a button can never
 * disagree with what pressing it would do.
 */
export function canSend(env: Record<string, unknown>, kind: MailKind): boolean {
	try {
		createMailer(env, kind);
		return true;
	} catch {
		return false;
	}
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
					...(params.replyTo ? { replyTo: params.replyTo } : {}),
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
