import { env } from "cloudflare:workers";

/**
 * Navigation links for the email dashboard, resolved to wherever it is mounted
 * on the current Worker. Every sidebar item is its own page under this mount
 * (Compose at the root, then campaigns/templates/analytics/activity/suppressed/
 * recruit-alerts/settings). The same physical pages (`src/pages/notify/*`) render
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

/**
 * Sidebar keys — one per email dashboard page. Shared by AdminSidebar and
 * MailLayout (and folded into `AdminActive` in src/utils/admin-nav.ts) so a new
 * page has to be named in exactly one place.
 */
export type MailActive =
	| "mail"
	| "mail-campaigns"
	| "mail-templates"
	| "mail-analytics"
	| "mail-activity"
	| "mail-suppressed"
	| "mail-recruit-alerts"
	| "mail-settings";

export interface EmailNav {
	/** Mount prefix: "/mail" | "/admin/mail". */
	base: string;
	/** Dashboard home — the Compose page. */
	home: string;
	/** Campaigns page link. */
	campaigns: string;
	/** Templates page link. */
	templates: string;
	/** Analytics page link. */
	analytics: string;
	/** Activity (recent sends) page link. */
	activity: string;
	/** Suppression list page link. */
	suppressed: string;
	/** Recruit-alerts page link. */
	recruitAlerts: string;
	/** Settings page link. */
	settings: string;
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
		campaigns: `${base}/campaigns`,
		templates: `${base}/templates`,
		analytics: `${base}/analytics`,
		activity: `${base}/activity`,
		suppressed: `${base}/suppressed`,
		recruitAlerts: `${base}/recruit-alerts`,
		settings: `${base}/settings`,
		logout,
	};
}
