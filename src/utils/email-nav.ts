import { env } from "cloudflare:workers";

/**
 * Navigation links for the email dashboard, resolved to wherever it is mounted
 * on the current Worker. The same physical pages (`src/pages/notify/*`) render
 * on three surfaces, so their internal links must adapt:
 *
 *  - notify Worker (`NOTIFY_STANDALONE`) → served at the root → base "".
 *  - admin Worker (`ADMIN_STANDALONE`)   → served at "/email".
 *  - main Worker (neither flag)          → served at "/admin/email".
 *
 * Sign-out targets the admin surface the dashboard is served on (the notify and
 * admin Workers expose it at `/logout`; the main Worker at `/admin/logout`).
 * See src/middleware.ts for the matching rewrites.
 */
function workerVar(name: string): string | undefined {
	try {
		return (env as unknown as Record<string, string | undefined>)[name];
	} catch {
		return undefined;
	}
}

export interface EmailNav {
	/** Mount prefix: "" | "/email" | "/admin/email". */
	base: string;
	/** Dashboard home link. */
	home: string;
	/** Settings page link. */
	settings: string;
	/** Recruit-alerts page link. */
	recruitAlerts: string;
	/** Sign-out link. */
	logout: string;
}

export function emailNav(): EmailNav {
	const notify = workerVar("NOTIFY_STANDALONE") === "true";
	const admin = workerVar("ADMIN_STANDALONE") === "true";
	const base = notify ? "" : admin ? "/email" : "/admin/email";
	const logout = notify || admin ? "/logout" : "/admin/logout";
	return {
		base,
		home: base || "/",
		settings: `${base}/settings`,
		recruitAlerts: `${base}/recruit-alerts`,
		logout,
	};
}
