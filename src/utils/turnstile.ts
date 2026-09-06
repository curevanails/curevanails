/**
 * Cloudflare Turnstile verification for the public forms.
 *
 * The check runs INSIDE the endpoints (/api/recruit, /api/waitlist) rather
 * than in a separate gate Worker the browser calls first. That is the whole
 * point: a browser-side gate only guards the UI, and a bot that POSTs
 * straight at /api/recruit never sees it. Verifying on the same request that
 * writes to D1 is the only placement that actually costs a bot anything.
 *
 * THE COMPLETE PAIR IS THE SWITCH. Enforcement needs BOTH the secret and the
 * sitekey, and deliberately not either one alone: with a secret but no usable
 * sitekey the widget never renders, so no token could ever arrive and every
 * honest submission would be rejected — a half-finished setup would silently
 * close both public forms. Requiring the pair means protection turns on only
 * once a visitor can actually answer the challenge.
 *
 *   wrangler secret put TURNSTILE_SECRET_KEY
 *   wrangler.jsonc vars: { "TURNSTILE_SITE_KEY": "0x4AAA..." }
 */

import { env } from "cloudflare:workers";

const SITEVERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The field the Turnstile widget writes into the form. */
export const TURNSTILE_FIELD = "cf-turnstile-response";

function envStr(key: string): string {
	const v = (env as unknown as Record<string, unknown>)[key];
	return typeof v === "string" ? v.trim() : "";
}

/** Public sitekey — safe to render into HTML. Empty means "widget off". */
export function turnstileSiteKey(): string {
	return envStr("TURNSTILE_SITE_KEY");
}

export type TurnstileResult = { ok: true } | { ok: false; error: string };

/**
 * Verify a widget token against Cloudflare. `ip` should be CF-Connecting-IP.
 *
 * Network failure fails CLOSED: once the secret is configured, an unverifiable
 * submission is not waved through. The message is deliberately the same for a
 * missing token and a rejected one — a bot learns nothing from the difference.
 */
export async function verifyTurnstile(
	token: string,
	ip: string | null,
): Promise<TurnstileResult> {
	const secret = envStr("TURNSTILE_SECRET_KEY");
	const siteKey = turnstileSiteKey();
	if (!secret || !siteKey) {
		if (secret !== "" || siteKey !== "")
			console.error(
				`turnstile: half-configured (site key ${siteKey ? "set" : "MISSING"}, secret ${secret ? "set" : "MISSING"}) — submissions are NOT being verified`,
			);
		return { ok: true };
	}

	if (!token) return { ok: false, error: "Please complete the human check." };

	const body = new FormData();
	body.append("secret", secret);
	body.append("response", token);
	if (ip && ip !== "unknown") body.append("remoteip", ip);

	try {
		const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
		const data = (await res.json()) as {
			success?: boolean;
			"error-codes"?: string[];
		};
		if (data.success === true) return { ok: true };
		console.warn("turnstile: rejected", data["error-codes"] ?? []);
	} catch (err) {
		console.error("turnstile: siteverify unreachable", err);
	}
	return { ok: false, error: "Please complete the human check." };
}
