/**
 * The sender identity and the per-message contract every transport honours.
 * Kept apart from the transports so `mailer.ts` (which picks one) and
 * `ses-client.ts` (one of them) can both import it without importing each other.
 */

/** Display name on every email. */
export const FROM_NAME = "CureVà";
/**
 * The mailbox every email is sent from. Its domain must be onboarded on the
 * transport in use — `curevanails.com` is onboarded on Cloudflare Email
 * Service and verified in AWS SES — or the send is rejected outright.
 */
export const FROM_EMAIL = "hello@curevanails.com";
/** RFC 5322 display form, for transports that take one string. */
export const FROM_ADDRESS = `${FROM_NAME} <${FROM_EMAIL}>`;

/**
 * Absolute public origin, used as the last-resort base for unsubscribe links
 * (email body + the `List-Unsubscribe` header) when neither `PUBLIC_SITE_URL`
 * nor a request origin is available — e.g. cron-triggered scheduled campaigns.
 * A `List-Unsubscribe` header MUST be an absolute URL, so this can't be blank.
 */
export const DEFAULT_PUBLIC_URL = "https://admin.curevanails.com";

export interface SendParams {
	to: string;
	subject: string;
	html: string;
	text?: string;
	/** email_logs.id — SES surfaces it to its events as the `log_id` tag. */
	logId: string;
	/**
	 * Where a reply should go, when that is not us. The recruiter alert sets it
	 * to the candidate, because its footer tells staff to reply to reach them —
	 * and without this, Reply goes to the From address, which has no mailbox.
	 */
	replyTo?: string;
	/**
	 * Per-recipient opt-out URL. When set (and absolute), it becomes the
	 * `List-Unsubscribe` header plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
	 * giving the recipient the native one-click Unsubscribe button in Gmail /
	 * Apple Mail (RFC 8058) — which Gmail & Yahoo require of bulk senders.
	 */
	unsubscribeUrl?: string;
}

/**
 * The `List-Unsubscribe` / `List-Unsubscribe-Post` header pair for RFC 8058
 * one-click unsubscribe. Empty unless `url` is an absolute http(s) URL, since
 * an invalid header is worse than none.
 */
export function unsubscribeHeaders(url: string | undefined): Record<string, string> {
	if (!url || !/^https?:\/\//i.test(url)) return {};
	return {
		"List-Unsubscribe": `<${url}>`,
		"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
	};
}
