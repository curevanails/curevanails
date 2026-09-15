import {
	GetAccountCommand,
	SESv2Client,
	SendEmailCommand,
	type MessageHeader,
} from "@aws-sdk/client-sesv2";
import { env } from "cloudflare:workers";
import { FROM_ADDRESS, unsubscribeHeaders, type SendParams } from "./sender";

/**
 * AWS SES (v2) transport — the fallback behind `mailer.ts`, used only by a
 * Worker that has no Cloudflare `EMAIL` binding. Region + credentials come from
 * Worker secrets, never hardcoded. The From address (`sender.ts`) must be a
 * **verified SES identity** or the send is rejected outright — it once was
 * `hello@cureva.vn`, a domain that was never verified.
 */

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

/**
 * Whether this account may send to unverified addresses — i.e. is out of the
 * SES sandbox. `null` when SES would not say (most likely the IAM policy lacks
 * ses:GetAccount), so a caller can fall back to simply trying rather than
 * treating "unknown" as "no".
 */
export async function isProductionAccessEnabled(client: SESv2Client): Promise<boolean | null> {
	try {
		const acct = await client.send(new GetAccountCommand({}));
		return typeof acct.ProductionAccessEnabled === "boolean" ? acct.ProductionAccessEnabled : null;
	} catch (err) {
		console.warn("ses: GetAccount unavailable, will attempt sends blind", err);
		return null;
	}
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

/**
 * Send one already-rendered email through SES. The suppression check happens
 * in `mailer.ts` before this is reached. Returns the SES MessageId.
 */
export async function sendViaSes(
	client: SESv2Client,
	params: SendParams,
): Promise<string | undefined> {
	const headers: MessageHeader[] = Object.entries(unsubscribeHeaders(params.unsubscribeUrl)).map(
		([Name, Value]) => ({ Name, Value }),
	);

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
