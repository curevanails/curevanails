import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
	ensureApplicationsSchema,
	isApplicationStatus,
} from "../../utils/recruit-db";
import {
	ensureWaitlistSchema,
	isWaitlistStatus,
} from "../../utils/waitlist-db";

// Server-rendered endpoint — never prerender. Gated by the admin auth in
// src/middleware.ts (it lives under /admin).
export const prerender = false;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/**
 * Updates the staff-managed fields (status, notes) on either a recruit
 * application or a waitlist entry, selected by the optional `entity` field:
 *
 *   POST /admin/update
 *     { "id": "...", "status"?: "...", "notes"?: "..." }                  // application (default)
 *     { "entity": "waitlist", "id": "...", "status"?: "...", "notes"?: "..." }
 */
export const POST: APIRoute = async ({ request }) => {
	const db = env.DB as D1Database;

	let body: {
		entity?: unknown;
		id?: unknown;
		status?: unknown;
		notes?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: "Expected JSON body." }, 400);
	}

	const id = body.id;
	if (typeof id !== "string" || !id) {
		return json({ ok: false, error: "id is required." }, 400);
	}

	const isWaitlist = body.entity === "waitlist";
	const table = isWaitlist ? "waitlist" : "job_applications";
	const validStatus = isWaitlist ? isWaitlistStatus : isApplicationStatus;

	if (isWaitlist) await ensureWaitlistSchema(db);
	else await ensureApplicationsSchema(db);

	try {
		if (body.status !== undefined) {
			if (!validStatus(body.status)) {
				return json({ ok: false, error: "Invalid status." }, 400);
			}
			await db
				.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`)
				.bind(body.status, id)
				.run();
		}

		if (body.notes !== undefined) {
			const notes =
				typeof body.notes === "string" ? body.notes.slice(0, 4000) : "";
			await db
				.prepare(`UPDATE ${table} SET notes = ? WHERE id = ?`)
				.bind(notes.length > 0 ? notes : null, id)
				.run();
		}
	} catch (err) {
		console.error("admin update failed", err);
		return json({ ok: false, error: "Update failed." }, 500);
	}

	return json({ ok: true });
};
