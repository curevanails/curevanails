import type { APIRoute } from "astro";
// The version-H homepage, exactly as the design build produced it. Astro skips
// files whose name starts with "_", so the document sits beside this route
// without becoming one of its own.
import html from "./_preview-index.html?raw";

/**
 * /preview-index — the homepage design, at a URL you can open before launch.
 *
 * The site root 302s to /coming-soon until the studio opens (see
 * src/pages/index.astro), so the homepage has no address. This is that
 * address, and it serves the version-H landing page built in the `cureva-ui`
 * design repo (`dist/public/version-h/index.html`, the page previewed at
 * cureva-preview.curevanails-tech.workers.dev/version-h/).
 *
 * The document is byte-for-byte the design build except for one rewrite: its
 * images were `../img/*.webp`, relative to `/version-h/`, and here they are
 * `/img/*.webp` — all 28 already ship in this site's `public/img`. It carries
 * its own `noindex, nofollow`, and robots.txt disallows the path: an
 * unlaunched homepage must not compete with /coming-soon for the brand's name.
 *
 * It is served FROM THE WORKER rather than dropped in `public/`, because the
 * asset handler redirects `/preview-index` to `/preview-index/` and the URL
 * people are given should be the one that answers.
 *
 * When the design is ported into Astro pages, this route and the HTML beside
 * it go together.
 */
export const prerender = false;

export const GET: APIRoute = () =>
	new Response(html, {
		headers: {
			"content-type": "text/html; charset=utf-8",
			// A preview of unreleased work: never cached at the edge, never indexed.
			"cache-control": "no-store",
			"x-robots-tag": "noindex, nofollow",
		},
	});
