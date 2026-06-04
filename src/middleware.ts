import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";

/**
 * Standalone-Worker routing.
 *
 * The `getready` Worker (getready.curevanails-tech.workers.dev) runs the same
 * codebase as the main site but with GETREADY_STANDALONE="true" set in
 * wrangler.getready.jsonc. When that flag is present we serve the /getready
 * page at the Worker root so visitors land straight on it.
 *
 * On the main `curevanails` Worker the flag is unset, so this is a no-op and
 * /getready is reachable at its normal path.
 *
 * Note: Astro v6 removed `Astro.locals.runtime.env`; read Worker vars via the
 * `cloudflare:workers` module instead.
 */
function isGetreadyStandalone(): boolean {
	// Reading the Worker env can throw inside EmDash's anonymous fast path,
	// where the Cloudflare adapter's removed `Astro.locals.runtime.env` getter
	// is what `cloudflare:workers`' `env` resolves to. A throw here must never
	// 500 the whole request, so fall back to "not standalone" (the main
	// `curevanails` Worker never sets this flag anyway).
	try {
		return (
			(env as { GETREADY_STANDALONE?: string }).GETREADY_STANDALONE === "true"
		);
	} catch {
		return false;
	}
}

export const onRequest = defineMiddleware((context, next) => {
	if (isGetreadyStandalone() && context.url.pathname === "/") {
		return context.rewrite("/getready");
	}

	return next();
});
