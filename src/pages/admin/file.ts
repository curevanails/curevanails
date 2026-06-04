import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

// Server-rendered endpoint — never prerender.
export const prerender = false;

/**
 * Streams a recruit upload (resume / DOPL license photo) out of the R2 `MEDIA`
 * bucket for the admin dashboard.
 *
 * Access is gated by the Basic-Auth check in `src/middleware.ts`, which guards
 * everything under `/admin`. We additionally constrain the key to the
 * `recruit/` prefix so this can only ever serve application uploads, never
 * arbitrary bucket objects.
 *
 *   GET /admin/file?key=recruit/<id>/resume/<uuid>-<name>
 */
export const GET: APIRoute = async ({ url }) => {
	const key = url.searchParams.get("key") || "";

	if (!key.startsWith("recruit/") || key.includes("..")) {
		return new Response("Forbidden", { status: 403 });
	}

	const bucket = env.MEDIA as R2Bucket;
	const object = await bucket.get(key);
	if (!object) {
		return new Response("Not found", { status: 404 });
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("etag", object.httpEtag);
	headers.set(
		"content-type",
		object.httpMetadata?.contentType || "application/octet-stream",
	);
	// Force a download with the original filename when we can recover it.
	const filename = key.split("/").pop() || "download";
	headers.set("content-disposition", `attachment; filename="${filename}"`);

	return new Response(object.body, { headers });
};
