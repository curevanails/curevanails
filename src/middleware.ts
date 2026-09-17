import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, resolveSessionSecret, verifySessionToken } from "./utils/admin-auth";

/**
 * Standalone-Worker routing + the admin gate.
 *
 * Three Workers run this same codebase off different wrangler configs:
 *
 *  - `getready`    (GETREADY_STANDALONE="true") → serves /getready at its root.
 *  - `admin`       (ADMIN_STANDALONE="true")    → the admin console at /, with
 *                                                  CLEAN URLs (no /admin prefix).
 *                                                  Also runs the campaign cron and
 *                                                  hosts the public email webhook
 *                                                  + unsubscribe page.
 *  - `curevanails` (neither flag)               → public site; the admin still
 *                                                  resolves at /admin/* (gated).
 *
 * The admin console holds recruit PII and can send email, so its pages — which
 * live at `src/pages/admin/*` (dashboard, recruit, waitlist) and
 * `src/pages/notify/*` (the email dashboard) — are all behind the signed-cookie
 * session. On the standalone `admin` Worker they are exposed at clean roots:
 * `/`, `/recruit`, `/waitlist`, `/mail[/*]`, `/login`, `/logout`. Legacy
 * `/admin/*` URLs 308-redirect to their clean equivalent.
 *
 * Email lives entirely on the admin surface (the standalone notify service was
 * retired): the dashboard under `/mail` (admin Worker) or `/admin/mail` (main
 * Worker) — one page per sidebar item, listed in EMAIL_SUBPAGES — with its
 * `/api/email/*` + `/api/settings` action endpoints admin-gated
 * on every Worker. The public halves — the SNS `/api/webhooks/*` receiver and the
 * token-based `/unsubscribe/*` page — stay open (each carries its own credential).
 * The physical dashboard pages live at `/notify/*`; direct requests there are
 * blocked, so the dashboard is only reachable via the gated `/mail` rewrite.
 *
 * Auth: verified with a dedicated `SESSION_SECRET` when set (falling back to
 * `ADMIN_PASSWORD`), so a captured cookie can't be used to brute-force the login
 * password offline. See src/utils/admin-auth.ts.
 *
 * Note: Astro v6 removed `Astro.locals.runtime.env`; read Worker vars via the
 * `cloudflare:workers` module instead. Reading the env can throw in some adapter
 * paths, so every access is wrapped — a throw here must never 500 the request.
 */
function workerVar(name: string): string | undefined {
	try {
		return (env as unknown as Record<string, string | undefined>)[name];
	} catch {
		return undefined;
	}
}

function isStandalone(flag: string): boolean {
	return workerVar(flag) === "true";
}

/**
 * The path every gate below compares against: percent-decoded, doubled
 * slashes collapsed, trailing slash dropped. Astro routes on the decoded form
 * (`decodeURI` + collapsed leading slashes), so a gate that looked at the raw
 * pathname could be slipped with `/%61dmin/recruit` or `//admin/recruit` and
 * still land on the real page. Cloudflare's edge normalises these today; this
 * keeps the gate honest without leaning on it. A malformed escape is left as
 * is — Astro answers it with a 400.
 */
function normalizePath(raw: string): string {
	let p = raw;
	try {
		p = decodeURIComponent(p);
	} catch {
		/* malformed escape — gate on the raw path */
	}
	return p.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
}

/** The secret used to verify session cookies (SESSION_SECRET, else ADMIN_PASSWORD). */
function signingSecret(password: string): string {
	return resolveSessionSecret(password, workerVar("SESSION_SECRET"));
}

/**
 * Clean admin routes on the standalone admin Worker → the real `/admin/<seg>`
 * pages. `mail` is handled separately (it has sub-pages and rewrites onto the
 * `/notify/*` email dashboard — see emailTarget).
 *
 * `recruit` is the applicant pipeline (`src/pages/admin/recruit.astro`). On this
 * Worker it shadows the public careers page of the same name, which is what we
 * want: the admin Worker is the console, not the marketing site.
 */
const ADMIN_PAGES = new Set(["recruit", "waitlist", "file", "update", "login", "logout"]);
/** These manage their own auth (no session cookie required). */
const ADMIN_PUBLIC = new Set(["login", "logout"]);

/**
 * Email dashboard sub-pages (relative to the mount point). One per sidebar
 * item — "" is Compose, the dashboard's home. See src/pages/notify/*.
 */
const EMAIL_SUBPAGES = new Set([
	"",
	"campaigns",
	"templates",
	"analytics",
	"activity",
	"suppressed",
	"recruit-alerts",
	"settings",
]);

/**
 * Map an email dashboard sub-path ("" | "campaigns" | "templates" | …) to the
 * physical `/notify/*` page that backs it, or null if it isn't a dashboard page.
 * The email dashboard is served in-app on the admin surface (admin Worker
 * `/mail`, main Worker `/admin/mail`) using these pages.
 */
function emailTarget(sub: string): string | null {
	if (!EMAIL_SUBPAGES.has(sub)) return null;
	return sub === "" ? "/notify" : `/notify/${sub}`;
}

export const onRequest = defineMiddleware(async (context, next) => {
	// `www` is an alias, not a second site. Both hostnames are custom domains on
	// the same Worker (wrangler.jsonc `routes`), so without a redirect every page
	// would exist at two URLs — two sets of cookies, and a canonical no search
	// engine can pick between.
	//
	// In production this branch does NOT run: the zone already carries an edge
	// Redirect Rule for `www`, and Cloudflare evaluates those before it reaches a
	// Worker, so a request to www.curevanails.com comes back as a 301 from the
	// edge and never gets here. (That rule was always there — it simply had
	// nothing to fire on, because the zone had no `www` DNS record until the
	// custom domain above created one.) This stays as the fallback for the day
	// that rule is edited or removed, and it is deliberately a 308, not the
	// edge's 301, so the method survives a form POST.
	const host = context.url.hostname;
	if (host.startsWith("www.")) {
		const canonical = new URL(context.url);
		canonical.hostname = host.slice(4);
		return context.redirect(canonical.toString(), 308);
	}

	// Decoded, collapsed, no trailing slash — so an encoded letter, a doubled
	// slash or a trailing slash can't flip a route between the admin gate and a
	// public exemption (Astro's default `trailingSlash: "ignore"` serves both
	// `/admin/login` and `/admin/login/`). See normalizePath.
	const pathname = normalizePath(context.url.pathname);
	const password = workerVar("ADMIN_PASSWORD");

	// ===== EmDash CMS: two doors that stay shut on every Worker =====
	// 1. First-run setup. Until an operator completes it, `/_emdash/admin` is an
	//    open registration form: whoever reaches it first becomes the sole CMS
	//    admin of the live site — free to publish pages on curevanails.com and
	//    to read the shared MEDIA bucket. Nobody has completed it in production,
	//    so the door is closed here and opened only on purpose: set the var
	//    `EMDASH_SETUP_OPEN="true"` in wrangler.jsonc, deploy, finish
	//    `/_emdash/admin/setup` yourself, remove the var, deploy again.
	if (
		(pathname.startsWith("/_emdash/api/setup") || pathname.startsWith("/_emdash/admin/setup")) &&
		workerVar("EMDASH_SETUP_OPEN") !== "true"
	) {
		return new Response("Not found", { status: 404 });
	}
	// 2. Applicant résumés. `/api/recruit` stores them in the same R2 bucket the
	//    CMS uses for media, and EmDash serves any object in that bucket, to
	//    anyone, from `/_emdash/api/media/file/<key>` — with a year-long public
	//    cache header. The one sanctioned way to a résumé is the session-gated
	//    `/admin/file`, so the `recruit/` prefix is unreachable through the CMS.
	if (/^\/_emdash\/api\/media\/file\/recruit(\/|$)/i.test(pathname)) {
		return new Response("Not found", { status: 404 });
	}

	// The physical email-dashboard pages live at `/notify/*` and are only meant to
	// be reached via the internal `/mail` rewrite (which bypasses this middleware).
	// Block any direct external request so the dashboard can never be hit ungated.
	if (pathname === "/notify" || pathname.startsWith("/notify/")) {
		return new Response("Not found", { status: 404 });
	}

	// ===== Standalone admin Worker: serve the admin at CLEAN root URLs =====
	if (isStandalone("ADMIN_STANDALONE")) {
		// Legacy `/admin/*` → clean equivalent (method + query preserved via 308).
		if (pathname === "/admin" || pathname.startsWith("/admin/")) {
			const clean =
				(pathname === "/admin" ? "/" : pathname.slice("/admin".length)) + context.url.search;
			return context.redirect(clean, 308);
		}

		// Clean admin routes → serve the underlying /admin/* page via a forward
		// rewrite (next(path) does NOT re-run this middleware, so no strip loop).
		const seg = pathname === "/" ? "" : pathname.slice(1);
		if (pathname === "/" || ADMIN_PAGES.has(seg)) {
			if (!password) return new Response("Not found", { status: 404 });

			const target = (pathname === "/" ? "/admin" : `/admin/${seg}`) + context.url.search;
			if (ADMIN_PUBLIC.has(seg)) return next(target); // login/logout self-manage auth

			const token = context.cookies.get(SESSION_COOKIE)?.value;
			if (!(await verifySessionToken(token, signingSecret(password)))) {
				return context.redirect("/login", 302);
			}
			return next(target);
		}

		// Email dashboard at clean `/mail[/*]`, gated by the admin session — so the
		// operator never logs in twice.
		if (pathname === "/mail" || pathname.startsWith("/mail/")) {
			const sub = pathname === "/mail" ? "" : pathname.slice("/mail/".length);
			const target = emailTarget(sub);
			if (target) {
				if (!password) return new Response("Not found", { status: 404 });
				const token = context.cookies.get(SESSION_COOKIE)?.value;
				if (!(await verifySessionToken(token, signingSecret(password)))) {
					return context.redirect("/login", 302);
				}
				return next(target + context.url.search);
			}
		}

		// Email action endpoints (send / templates / test / schedule / settings) —
		// admin-gated. The public webhook + unsubscribe fall through untouched.
		if (pathname.startsWith("/api/email/") || pathname.startsWith("/api/settings")) {
			if (!password) return new Response("Not found", { status: 404 });
			const token = context.cookies.get(SESSION_COOKIE)?.value;
			if (!(await verifySessionToken(token, signingSecret(password)))) {
				return context.redirect("/login", 302);
			}
			return next();
		}

		// Any other path (public unsubscribe, SNS webhook, static assets) — serve
		// unchanged.
		return next();
	}

	// ===== Non-standalone Workers (main site, getready): admin gate at /admin/* =====
	const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");
	if (isAdminArea) {
		if (!password) return new Response("Not found", { status: 404 });
		if (pathname === "/admin/login" || pathname === "/admin/logout") return next();
		const token = context.cookies.get(SESSION_COOKIE)?.value;
		if (!(await verifySessionToken(token, signingSecret(password)))) {
			return context.redirect("/admin/login", 302);
		}
		// Email dashboard at `/admin/mail[/*]`.
		if (pathname === "/admin/mail" || pathname.startsWith("/admin/mail/")) {
			const sub = pathname === "/admin/mail" ? "" : pathname.slice("/admin/mail/".length);
			const target = emailTarget(sub);
			if (target) return next(target + context.url.search);
		}
		return next();
	}

	// Email action endpoints on the main Worker — admin-gated (they live outside
	// /admin/*, so the gate above doesn't cover them).
	if (pathname.startsWith("/api/email/") || pathname.startsWith("/api/settings")) {
		if (!password) return new Response("Not found", { status: 404 });
		const token = context.cookies.get(SESSION_COOKIE)?.value;
		if (!(await verifySessionToken(token, signingSecret(password)))) {
			return context.redirect("/admin/login", 302);
		}
		return next();
	}

	if (isStandalone("GETREADY_STANDALONE") && pathname === "/") {
		return context.rewrite("/getready");
	}

	return next();
});
