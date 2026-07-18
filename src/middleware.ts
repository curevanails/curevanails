import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, verifySessionToken } from "./utils/admin-auth";

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
 * `/admin/*` URLs 308-redirect to their clean equivalent, and the old in-app
 * email section redirects to the standalone notify service.
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

/** Email management moved to the standalone notify service. */
const NOTIFY_URL = "https://notify.curevanails.com/";

/**
 * Clean admin routes on the standalone admin Worker → the real `/admin/<seg>`
 * pages. `email` is intentionally absent (it redirects to the notify service).
 */
const ADMIN_PAGES = new Set(["talent", "waitlist", "file", "update", "login", "logout"]);
/** These manage their own auth (no session cookie required). */
const ADMIN_PUBLIC = new Set(["login", "logout"]);

/** Any spelling of the retired in-app email section. */
function isEmailPath(p: string): boolean {
	return (
		p === "/email" ||
		p.startsWith("/email/") ||
		p === "/admin/email" ||
		p.startsWith("/admin/email/")
	);
}

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;
	const password = workerVar("ADMIN_PASSWORD");

	// Email management moved to the notify service — redirect on every Worker.
	if (isEmailPath(pathname)) {
		return Response.redirect(NOTIFY_URL, 302);
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
			if (!(await verifySessionToken(token, password))) {
				return context.redirect("/login", 302);
			}
			return next(target);
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
		if (!(await verifySessionToken(token, password))) {
			return context.redirect("/admin/login", 302);
		}
		return next();
	}

	if (isStandalone("GETREADY_STANDALONE") && pathname === "/") {
		return context.rewrite("/getready");
	}

	return next();
});
