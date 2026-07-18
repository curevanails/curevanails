import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, resolveSessionSecret, verifySessionToken } from "./utils/admin-auth";

/**
 * Standalone-Worker routing + the recruit admin gate.
 *
 * Two Workers run this same codebase off different wrangler configs:
 *
 *  - `getready`  (GETREADY_STANDALONE="true")  → serves /getready at its root.
 *  - `admin`     (ADMIN_STANDALONE="true")     → serves the recruit admin at /.
 *
 * On the main `curevanails` Worker neither flag is set, so the root rewrites are
 * no-ops and /getready is reachable at its normal path.
 *
 * Note: Astro v6 removed `Astro.locals.runtime.env`; read Worker vars via the
 * `cloudflare:workers` module instead. Reading the env can throw inside
 * EmDash's anonymous fast path (where the adapter's removed
 * `Astro.locals.runtime.env` getter is what `env` resolves to), so every
 * access is wrapped in try/catch and falls back to "not set". A throw here must
 * never 500 the whole request.
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
 * The admin area exposes applicant PII (names, phones, emails, license
 * numbers, uploaded documents), so it is gated on EVERY Worker — including the
 * main site, where `/admin` also resolves because the codebase is shared.
 *
 * Auth is form-based: `/admin/login` and `/admin/logout` are public; every
 * other admin path requires a valid session cookie, and unauthenticated
 * requests are redirected to the login form. Credentials come from secrets set
 * with `wrangler secret put`:
 *   ADMIN_PASSWORD  (required — if unset, the admin area returns 404 and is
 *                    effectively disabled, so the main site never leaks it)
 *   ADMIN_USERNAME  (optional — defaults to "admin")
 */
export const onRequest = defineMiddleware(async (context, next) => {
	// Normalize the path before matching so a trailing slash can't flip a route
	// between the admin gate and a public exemption (Astro's default
	// `trailingSlash: "ignore"` serves both `/admin/login` and `/admin/login/`).
	const path = context.url.pathname.replace(/\/+$/, "") || "/";
	const adminStandalone = isStandalone("ADMIN_STANDALONE");
	const isAdminArea =
		path === "/admin" ||
		path.startsWith("/admin/") ||
		(adminStandalone && path === "/");

	if (isAdminArea) {
		const password = workerVar("ADMIN_PASSWORD");
		// No password configured → pretend the admin area doesn't exist.
		if (!password) {
			return new Response("Not found", { status: 404 });
		}

		// The login form and logout endpoint manage their own auth.
		if (path === "/admin/login" || path === "/admin/logout") {
			return next();
		}

		// Sign/verify with a dedicated SESSION_SECRET when configured (falls back
		// to ADMIN_PASSWORD) so a leaked cookie can't be used to brute-force the
		// login password offline. See src/utils/admin-auth.ts.
		const signingSecret = resolveSessionSecret(password, workerVar("SESSION_SECRET"));
		const token = context.cookies.get(SESSION_COOKIE)?.value;
		const authed = await verifySessionToken(token, signingSecret);
		if (!authed) {
			return context.redirect("/admin/login", 302);
		}

		// On the admin Worker the root serves the dashboard.
		if (adminStandalone && path === "/") return context.rewrite("/admin");
		return next();
	}

	if (isStandalone("GETREADY_STANDALONE") && path === "/") {
		return context.rewrite("/getready");
	}

	return next();
});
