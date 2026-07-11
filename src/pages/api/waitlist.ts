import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
	ensureWaitlistSchema,
	newUnsubscribeToken,
	normalizeEmail,
	normalizePhone,
} from "../../utils/waitlist-db";
import { rateLimit } from "../../utils/rate-limit";

// Server-rendered endpoint — never prerender.
export const prerender = false;

/**
 * Waitlist capture for the CureVà "getready" pre-launch site.
 *
 * Accepts a JSON (or form-encoded) POST with `email` (required) and `phone`
 * (optional — the getready landing form is email-only per the July 2026
 * landing-page doc, while /early-access and /waitlist still send both).
 * Upserts a row into the D1 `waitlist` table (deduped by normalized email).
 * Capture-only: no discount code is generated yet — see
 * `src/utils/waitlist-db.ts`.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_ALLOWED_RE = /^[\d\s()+.\-]+$/;
const MAX_SOURCE_LEN = 60;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function digitsOnly(s: string): string {
	return s.replace(/\D/g, "");
}

/** Read `email`, `phone`, `source` from a JSON body or a form POST. */
async function readFields(
	request: Request,
): Promise<{ email: string; phone: string; source: string }> {
	const contentType = request.headers.get("content-type") ?? "";
	let email = "";
	let phone = "";
	let source = "";

	if (contentType.includes("application/json")) {
		const body = (await request.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		email = typeof body.email === "string" ? body.email : "";
		phone = typeof body.phone === "string" ? body.phone : "";
		source = typeof body.source === "string" ? body.source : "";
	} else {
		const form = await request.formData();
		const get = (k: string) => {
			const v = form.get(k);
			return typeof v === "string" ? v : "";
		};
		email = get("email");
		phone = get("phone");
		source = get("source");
	}

	return { email: email.trim(), phone: phone.trim(), source: source.trim() };
}

export const POST: APIRoute = async ({ request }) => {
	const db = env.DB as D1Database;

	// Rate-limit the public form by client IP (5 signups / 10 min / IP).
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const kv = (env as unknown as { SESSION?: KVNamespace }).SESSION;
	const limit = await rateLimit(kv, `waitlist:${ip}`, 5, 600);
	if (!limit.ok) {
		return json(
			{ ok: false, error: "Too many signups from this network. Please try again later." },
			429,
		);
	}

	let email: string;
	let phone: string;
	let source: string;
	try {
		({ email, phone, source } = await readFields(request));
	} catch {
		return json({ ok: false, error: "Could not read the submission." }, 400);
	}

	// --- Validate (same rules as the recruit form) ---
	const errors: Record<string, string> = {};

	if (!email) errors.email = "Email address is required.";
	else if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";

	// Phone is optional; validate only when provided.
	if (phone) {
		if (/[A-Za-z]/.test(phone) || !PHONE_ALLOWED_RE.test(phone))
			errors.phone = "Phone number can't contain letters.";
		else if (digitsOnly(phone).length < 10 || digitsOnly(phone).length > 15)
			errors.phone = "Enter a valid phone number (at least 10 digits).";
	}

	if (Object.keys(errors).length > 0) {
		return json({ ok: false, errors }, 400);
	}

	const emailNorm = normalizeEmail(email);
	const phoneNorm = normalizePhone(phone);
	const cleanSource = (source || "getready").slice(0, MAX_SOURCE_LEN);

	// --- Persist to D1 (idempotent on email) ---
	try {
		await ensureWaitlistSchema(db);

		// Check first so we can honestly tell the user whether they were already
		// on the list. (An upsert's `changes` count can't distinguish a fresh
		// insert from a no-op update, so we don't rely on it.)
		const existing = await db
			.prepare("SELECT id FROM waitlist WHERE email_norm = ?")
			.bind(emailNorm)
			.first<{ id: string }>();

		if (existing) {
			// Already joined — refresh phone/source, keep the original join time.
			// An email-only signup must not blank out a phone we already have.
			if (phone) {
				await db
					.prepare(
						"UPDATE waitlist SET phone = ?, phone_norm = ?, source = ? WHERE email_norm = ?",
					)
					.bind(phone, phoneNorm, cleanSource, emailNorm)
					.run();
			} else {
				await db
					.prepare("UPDATE waitlist SET source = ? WHERE email_norm = ?")
					.bind(cleanSource, emailNorm)
					.run();
			}
			return json({ ok: true, alreadyJoined: true });
		}

		await db
			.prepare(
				`INSERT INTO waitlist (id, created_at, email, phone, email_norm, phone_norm, source, unsubscribe_token)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				crypto.randomUUID(),
				new Date().toISOString(),
				email,
				phone,
				emailNorm,
				phoneNorm,
				cleanSource,
				newUnsubscribeToken(),
			)
			.run();

		return json({ ok: true, alreadyJoined: false });
	} catch (err) {
		console.error("waitlist insert failed", err);
		return json({ ok: false, error: "Failed to save your spot." }, 500);
	}
};
