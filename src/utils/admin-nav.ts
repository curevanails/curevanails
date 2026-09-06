import { env } from "cloudflare:workers";
import type { MailActive } from "./email-nav";

/**
 * Navigation links for the admin console, resolved to wherever it is mounted on
 * the current Worker:
 *
 *  - admin Worker (`ADMIN_STANDALONE`) → clean roots: `/`, `/recruit`, …
 *  - main Worker (neither flag)        → under `/admin/*`.
 *
 * See src/middleware.ts for the matching rewrites, and src/utils/email-nav.ts
 * for the email dashboard's own links.
 */
function workerVar(name: string): string | undefined {
	try {
		return (env as unknown as Record<string, string | undefined>)[name];
	} catch {
		return undefined;
	}
}

/** Sidebar keys — one per admin page. */
export type AdminActive = "dashboard" | "recruit" | "waitlist" | MailActive;

export interface AdminNav {
	/** Mount prefix: "" on the admin Worker, "/admin" elsewhere. */
	base: string;
	/** Dashboard (widgets) home. */
	home: string;
	/** Recruit pipeline — the applications list. */
	recruit: string;
	/** Waitlist table. */
	waitlist: string;
	/** Email dashboard mount. */
	mail: string;
	/** R2 resume download endpoint. */
	file: string;
	/** Status + notes write endpoint. */
	update: string;
	/** Sign-out link. */
	logout: string;
}

export function adminNav(): AdminNav {
	const base = workerVar("ADMIN_STANDALONE") === "true" ? "" : "/admin";
	return {
		base,
		home: base || "/",
		recruit: `${base}/recruit`,
		waitlist: `${base}/waitlist`,
		mail: `${base}/mail`,
		file: `${base}/file`,
		update: `${base}/update`,
		logout: `${base}/logout`,
	};
}
