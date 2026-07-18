import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, resolveSessionSecret, verifySessionToken } from "./utils/admin-auth";

/**
 * Standalone-Worker routing + the recruit admin gate.
 *
 * Three Workers run this same codebase off different wrangler configs:
 *
 *  - `getready`    (GETREADY_STANDALONE="true") → serves /getready at its root.
 *  - `admin`       (ADMIN_STANDALONE="true")    → serves the recruit admin at /,
 *                                                  with CLEAN URLs (no /admin prefix).
 *  - `curevanails` (neither flag)               → public site; the admin still
 *                                                  resolves at /admin/* (gated).
 *
 * On the standalone `admin` Worker the whole thing IS the admin, so the pages —
 * which physically live at `src/pages/admin/*` — are exposed at the root:
 * `/`, `/talent`, `/waitlist`, `/file`, `/update`, `/login`, `/logout`. Legacy
 * `/admin/*` URLs 308-redirect to their clean equivalent.
 *
 * The email dashboard (folded in from the notify service, pages at
 * `src/pages/notify/*`) is served in-app on the admin surface — `/email` on the
 * admin Worker, `/admin/email` on the main Worker — under the SAME admin session,
 * so the operator never logs in twice. The `notify` Worker still serves the same
 * dashboard standalone at its own root, plus the public SNS webhook + unsubscribe.
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

/** The secret used to verify session cookies (SESSION_SECRET, else ADMIN_PASSWORD). */
function signingSecret(password: string): string {
	return resolveSessionSecret(password, workerVar("SESSION_SECRET"));
}

/**
 * Clean admin routes on the standalone admin Worker → the real `/admin/<seg>`
 * pages. `email` is handled separately (it has sub-pages and rewrites onto the
 * `/notify/*` dashboard folded in from the notify service — see emailTarget).
 */
const ADMIN_PAGES = new Set(["talent", "waitlist", "file", "update", "login", "logout"]);
/** These manage their own auth (no session cookie required). */
const ADMIN_PUBLIC = new Set(["login", "logout"]);

/** Email dashboard sub-pages (relative to the mount point). */
const EMAIL_SUBPAGES = new Set(["", "settings", "recruit-alerts"]);

/**
 * Map an email dashboard sub-path ("" | "settings" | "recruit-alerts") to the
 * physical `/notify/*` page that backs it, or null if it isn't a dashboard page.
 * The email dashboard is served in-app on the admin surface (admin Worker
 * `/email`, main Worker `/admin/email`) using the notify service's pages.
 */
function emailTarget(sub: string): string | null {
	if (!EMAIL_SUBPAGES.has(sub)) return null;
	return sub === "" ? "/notify" : `/notify/${sub}`;
}

export const onRequest = defineMiddleware(async (context, next) => {
	// Normalize a trailing slash so it can't flip a route between the admin gate
	// and a public exemption (Astro's default `trailingSlash: "ignore"` serves
	// both `/admin/login` and `/admin/login/`).
	const pathname = context.url.pathname.replace(/\/+$/, "") || "/";
	const password = workerVar("ADMIN_PASSWORD");

	// ===== Standalone notify Worker: email dashboard at CLEAN root URLs =====
	// Serves the email dashboard (`/`), settings, recruit-alerts, and the
	// `/api/email/*` + `/api/settings*` action endpoints — all gated by the
	// signed session cookie. Public: /login, /logout, /unsubscribe/*, and the
	// SNS `/api/webhooks/*` receiver. The pages physically live at
	// `src/pages/notify/*`; clean root URLs are rewritten onto them.
	if (isStandalone("NOTIFY_STANDALONE")) {
		const seg = pathname === "/" ? "" : pathname.slice(1);
		// Clean page routes that map to a physical `/notify/<seg>` page.
		const NOTIFY_PAGES = new Set(["settings", "recruit-alerts", "login", "logout"]);
		const isPageRoute = pathname === "/" || NOTIFY_PAGES.has(seg);
		// Paths that require a valid session (dashboard PII + send actions).
		const needsAuth =
			pathname === "/" ||
			pathname === "/settings" ||
			pathname === "/recruit-alerts" ||
			pathname.startsWith("/api/email/") ||
			pathname.startsWith("/api/settings");

		if (needsAuth) {
			if (!password) return new Response("Not found", { status: 404 });
			const token = context.cookies.get(SESSION_COOKIE)?.value;
			if (!(await verifySessionToken(token, signingSecret(password)))) {
				return context.redirect("/login", 302);
			}
		}

		// Clean URL → its underlying /notify/* page (forward rewrite; next(path)
		// does NOT re-run this middleware, so there is no rewrite loop).
		if (isPageRoute) {
			const target = (pathname === "/" ? "/notify" : `/notify/${seg}`) + context.url.search;
			return next(target);
		}

		// The recruit admin dashboard is NOT part of the notify service — hide it
		// here so notify.* never serves recruit PII (it lives on the admin Worker).
		if (pathname === "/admin" || pathname.startsWith("/admin/")) {
			return new Response("Not found", { status: 404 });
		}

		// API endpoints (/api/email/*, /api/webhooks/*), /unsubscribe/*, static
		// assets, 404s — serve unchanged.
		return next();
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

		// Email dashboard (folded in from the notify service) at clean `/email[/*]`,
		// gated by the admin session — so the operator never logs in twice.
		if (pathname === "/email" || pathname.startsWith("/email/")) {
			const sub = pathname === "/email" ? "" : pathname.slice("/email/".length);
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
		// admin-gated on this Worker too, not just on notify.*.
		if (pathname.startsWith("/api/email/") || pathname.startsWith("/api/settings")) {
			if (!password) return new Response("Not found", { status: 404 });
			const token = context.cookies.get(SESSION_COOKIE)?.value;
			if (!(await verifySessionToken(token, signingSecret(password)))) {
				return context.redirect("/login", 302);
			}
			return next();
		}

		// Any other path (blog, recruit form, static assets) — serve unchanged.
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
		// Email dashboard (folded in from the notify service) at `/admin/email[/*]`.
		if (pathname === "/admin/email" || pathname.startsWith("/admin/email/")) {
			const sub = pathname === "/admin/email" ? "" : pathname.slice("/admin/email/".length);
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
