import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { rateLimit } from "../../utils/rate-limit";
import {
	ensureTalentSchema,
	isTalentRole,
} from "../../utils/talent-db";
import { normalizeEmail } from "../../utils/waitlist-db";

// Server-rendered endpoint — never prerender.
export const prerender = false;

/**
 * "Join Our Talent List" capture for the CureVà careers page (/recruit).
 *
 * Accepts a JSON POST with `name`, `email`, `role` (required) plus optional
 * `portfolio` and `about`, and upserts a row into the D1 `talent_list` table
 * (deduped by normalized email — re-submitting refreshes the details and
 * keeps the original join time). The full hiring form at /recruit/apply
 * writes to `job_applications` instead.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_NAME_LEN = 120;
const MAX_PORTFOLIO_LEN = 200;
const MAX_ABOUT_LEN = 2000;
const MAX_SOURCE_LEN = 60;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export const POST: APIRoute = async ({ request }) => {
	const db = env.DB as D1Database;

	// Rate-limit the public form by client IP (5 signups / 10 min / IP).
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const kv = (env as unknown as { SESSION?: KVNamespace }).SESSION;
	const limit = await rateLimit(kv, `talent:${ip}`, 5, 600);
	if (!limit.ok) {
		return json(
			{ ok: false, error: "Too many signups from this network. Please try again later." },
			429,
		);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ ok: false, error: "Expected a JSON body." }, 400);
	}

	const str = (k: string) =>
		typeof body[k] === "string" ? (body[k] as string).trim() : "";

	const name = str("name");
	const email = str("email");
	const role = str("role");
	const portfolio = str("portfolio");
	const about = str("about");
	const source = (str("source") || "recruit").slice(0, MAX_SOURCE_LEN);

	// --- Validate ---
	const errors: Record<string, string> = {};

	if (!name) errors.name = "Name is required.";
	else if (name.length > MAX_NAME_LEN) errors.name = "Name is too long.";

	if (!email) errors.email = "Email address is required.";
	else if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";

	if (!isTalentRole(role)) errors.role = "Select a role.";

	if (portfolio.length > MAX_PORTFOLIO_LEN)
		errors.portfolio = "Portfolio link is too long.";

	if (about.length > MAX_ABOUT_LEN)
		errors.about = "Please keep it under 2,000 characters.";

	if (Object.keys(errors).length > 0) {
		return json({ ok: false, errors }, 400);
	}

	const emailNorm = normalizeEmail(email);

	// --- Persist to D1 (idempotent on email) ---
	try {
		await ensureTalentSchema(db);

		const existing = await db
			.prepare("SELECT id FROM talent_list WHERE email_norm = ?")
			.bind(emailNorm)
			.first<{ id: string }>();

		if (existing) {
			// Already on the list — refresh the details, keep the join time and
			// any staff-managed status/notes.
			await db
				.prepare(
					`UPDATE talent_list
					 SET name = ?, email = ?, role = ?, portfolio = ?, about = ?, source = ?
					 WHERE email_norm = ?`,
				)
				.bind(
					name,
					email,
					role,
					portfolio || null,
					about || null,
					source,
					emailNorm,
				)
				.run();
			return json({ ok: true, alreadyJoined: true });
		}

		await db
			.prepare(
				`INSERT INTO talent_list (id, created_at, name, email, email_norm, role, portfolio, about, source)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				crypto.randomUUID(),
				new Date().toISOString(),
				name,
				email,
				emailNorm,
				role,
				portfolio || null,
				about || null,
				source,
			)
			.run();

		return json({ ok: true, alreadyJoined: false });
	} catch (err) {
		console.error("talent insert failed", err);
		return json({ ok: false, error: "Failed to save your details." }, 500);
	}
};
