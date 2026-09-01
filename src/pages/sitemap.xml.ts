import type { APIRoute } from "astro";
import { getEmDashCollection } from "emdash";

/**
 * The sitemap.
 *
 * EmDash serves a /sitemap.xml of its own, but it is an EMPTY
 * <sitemapindex> — it lists no URLs at all, so nothing on this site was
 * being offered to a crawler. This route replaces it with the real thing.
 *
 * Only canonical, indexable URLs belong here. A sitemap that lists a page
 * which canonicals elsewhere, or one that is noindex, sends a crawler two
 * contradictory instructions — so /waitlist, /getready (both canonical to
 * /coming-soon) and /early-access (noindex) are deliberately absent, as are
 * the admin, API and unsubscribe routes.
 */
export const prerender = false;

const ORIGIN = "https://curevanails.com";

/** Static routes, with a hint of how often each actually changes. */
const STATIC: Array<{ path: string; changefreq: string; priority: string }> = [
	{ path: "/coming-soon", changefreq: "weekly", priority: "1.0" },
	{ path: "/recruit", changefreq: "weekly", priority: "0.9" },
	{ path: "/recruit/apply", changefreq: "monthly", priority: "0.8" },
	{ path: "/posts", changefreq: "weekly", priority: "0.6" },
	{ path: "/search", changefreq: "yearly", priority: "0.2" },
];

function url(loc: string, lastmod: string | null, changefreq: string, priority: string) {
	return [
		"  <url>",
		`    <loc>${ORIGIN}${loc}</loc>`,
		lastmod ? `    <lastmod>${lastmod}</lastmod>` : "",
		`    <changefreq>${changefreq}</changefreq>`,
		`    <priority>${priority}</priority>`,
		"  </url>",
	]
		.filter(Boolean)
		.join("\n");
}

/** ISO date only — a sitemap wants a date, not a timestamp with a zone. */
function day(value: unknown): string | null {
	if (typeof value !== "string" && !(value instanceof Date)) return null;
	const d = new Date(value as string);
	return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export const GET: APIRoute = async () => {
	const entries: string[] = STATIC.map((s) => url(s.path, null, s.changefreq, s.priority));

	// Content from the CMS. If a collection is empty or unavailable the
	// sitemap is still valid — a partial sitemap beats a 500.
	try {
		const { entries: posts } = await getEmDashCollection("posts");
		for (const post of posts) {
			entries.push(
				url(
					`/posts/${post.id}`,
					day((post.data as Record<string, unknown>).updatedAt ?? (post.data as Record<string, unknown>).publishedAt),
					"monthly",
					"0.7",
				),
			);
		}
	} catch {
		/* collection unavailable — skip rather than fail the sitemap */
	}

	try {
		const { entries: pages } = await getEmDashCollection("pages");
		for (const page of pages) {
			const data = page.data as Record<string, unknown>;
			entries.push(
				url(`/pages/${(data.slug as string) || page.id}`, day(data.updatedAt), "monthly", "0.5"),
			);
		}
	} catch {
		/* as above */
	}

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;

	return new Response(body, {
		headers: {
			"content-type": "application/xml; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
};
