import { env } from "cloudflare:workers";

/**
 * Navigation links for the email dashboard, resolved to wherever it is mounted
 * on the current Worker. The same physical pages (`src/pages/notify/*`) render
 * on two surfaces, so their internal links must adapt:
 *
 *  - admin Worker (`ADMIN_STANDALONE`) → served at "/mail".
 *  - main Worker (neither flag)        → served at "/admin/mail".
 *
 * Sign-out targets the admin surface the dashboard is served on (the admin
 * Worker exposes it at `/logout`; the main Worker at `/admin/logout`). See
 * src/middleware.ts for the matching rewrites.
 */
function workerVar(name: string): string | undefined {
	try {
		return (env as unknown as Record<string, string | undefined>)[name];
	} catch {
		return undefined;
	}
}

export interface EmailNav {
	/** Mount prefix: "/mail" | "/admin/mail". */
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
	const admin = workerVar("ADMIN_STANDALONE") === "true";
	const base = admin ? "/mail" : "/admin/mail";
	const logout = admin ? "/logout" : "/admin/logout";
	return {
		base,
		home: base,
		settings: `${base}/settings`,
		recruitAlerts: `${base}/recruit-alerts`,
		logout,
	};
}
