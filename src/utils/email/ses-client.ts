import { SESv2Client, SendEmailCommand, type MessageHeader } from "@aws-sdk/client-sesv2";
import { env } from "cloudflare:workers";
import { isSuppressed } from "./suppression";

/**
 * AWS SES (v2) sending. Region + credentials come from Worker secrets — never
 * hardcoded. The From address is fixed to the verified CureVà identity.
 */

export const FROM_ADDRESS = "CureVà <hello@cureva.vn>";

/**
 * SES Configuration Set, from the `SES_CONFIGURATION_SET` var. Optional, and
 * empty by default: SES rejects the whole send with "Configuration set <x> does
 * not exist" when the name doesn't resolve, so hardcoding one meant a set that
 * was never created in AWS blocked *every* email.
 *
 * Set it once the set exists in SES. It is what makes SES publish
 * delivery/bounce/complaint events to SNS, so `/api/webhooks/ses` — and the
 * automatic suppression of bounced addresses that depends on it — only work
 * while this is configured.
 */
export const CONFIGURATION_SET =
	(env as unknown as { SES_CONFIGURATION_SET?: string }).SES_CONFIGURATION_SET?.trim() ??
	"";

/**
 * Absolute public origin, used as the last-resort base for unsubscribe links
 * (email body + the `List-Unsubscribe` header) when neither `PUBLIC_SITE_URL`
 * nor a request origin is available — e.g. cron-triggered scheduled campaigns.
 * A `List-Unsubscribe` header MUST be an absolute URL, so this can't be blank.
 */
export const DEFAULT_PUBLIC_URL = "https://admin.curevanails.com";

export interface SesCredentials {
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
}

/** Pull SES credentials from the Worker env, throwing if anything is missing. */
export function sesCredentialsFromEnv(env: Record<string, unknown>): SesCredentials {
	const region = typeof env.AWS_REGION === "string" ? env.AWS_REGION : "";
	const accessKeyId =
		typeof env.AWS_ACCESS_KEY_ID === "string" ? env.AWS_ACCESS_KEY_ID : "";
	const secretAccessKey =
		typeof env.AWS_SECRET_ACCESS_KEY === "string" ? env.AWS_SECRET_ACCESS_KEY : "";
	if (!region || !accessKeyId || !secretAccessKey) {
		throw new Error(
			"SES credentials missing: set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.",
		);
	}
	return { region, accessKeyId, secretAccessKey };
}

export function createSesClient(creds: SesCredentials): SESv2Client {
	return new SESv2Client({
		region: creds.region,
		credentials: {
			accessKeyId: creds.accessKeyId,
			secretAccessKey: creds.secretAccessKey,
		},
	});
}

export interface SendParams {
	to: string;
	subject: string;
	html: string;
	text?: string;
	/** email_logs.id, surfaced to SES events via the `log_id` tag. */
	logId: string;
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
 * one-click unsubscribe. Returns [] unless `url` is an absolute http(s) URL,
 * since an invalid header is worse than none.
 */
function unsubscribeHeaders(url: string | undefined): MessageHeader[] {
	if (!url || !/^https?:\/\//i.test(url)) return [];
	return [
		{ Name: "List-Unsubscribe", Value: `<${url}>` },
		{ Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
	];
}

/**
 * Send one already-rendered email. Performs the mandatory pre-send suppression
 * check against the DB, then dispatches via SES. Returns the SES MessageId.
 */
export async function sendEmail(
	client: SESv2Client,
	db: D1Database,
	params: SendParams,
): Promise<string | undefined> {
	if (await isSuppressed(db, params.to)) {
		throw new Error(`Email suppressed: ${params.to}`);
	}

	const headers = unsubscribeHeaders(params.unsubscribeUrl);

	const result = await client.send(
		new SendEmailCommand({
			FromEmailAddress: FROM_ADDRESS,
			Destination: { ToAddresses: [params.to] },
			Content: {
				Simple: {
					Subject: { Data: params.subject },
					Body: {
						Html: { Data: params.html },
						...(params.text ? { Text: { Data: params.text } } : {}),
					},
					...(headers.length ? { Headers: headers } : {}),
				},
			},
			...(CONFIGURATION_SET ? { ConfigurationSetName: CONFIGURATION_SET } : {}),
			EmailTags: [{ Name: "log_id", Value: params.logId }],
		}),
	);

	return result.MessageId;
}
