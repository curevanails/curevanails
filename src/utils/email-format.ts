/**
 * Presentation helpers shared by the email dashboard pages
 * (`src/pages/notify/*`). Pure formatting — no DB, no env — so every page can
 * import what it renders without pulling in the others' queries.
 *
 * CureVà serves clients in Utah → all timestamps render in Mountain Time
 * (America/Denver, handles MST/MDT automatically). Workers run in UTC, so
 * without an explicit timeZone these would show UTC.
 */
export const TZ = "America/Denver";

/** Short date + time in Mountain Time, e.g. "Jun 15 9:00 AM". */
export function fmtTs(ms: number | null): string {
	if (!ms) return "—";
	const d = new Date(ms);
	return (
		d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ }) +
		" " +
		d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })
	);
}

/** Full date + time in Mountain Time, e.g. "Jun 15, 2026, 9:00 AM MT". */
export function fmtSchedule(ms: number | null): string {
	if (!ms) return "—";
	return (
		new Date(ms).toLocaleString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZone: TZ,
		}) + " MT"
	);
}

/** Percentage of n over d, e.g. pct(96, 100) → "96%". "—" when d is 0. */
export function pct(n: number, d: number): string {
	return d > 0 ? Math.round((n / d) * 100) + "%" : "—";
}

/** TailAdmin-style status badge: soft tinted bg with dark mode variants. */
export const PILL = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

const NEUTRAL = "bg-gray-100 text-gray-700 dark:bg-white/[0.03] dark:text-gray-400";

const LOG_STATUS_CLASS: Record<string, string> = {
	queued: NEUTRAL,
	sent: "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/15 dark:text-blue-light-400",
	delivered: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-500",
	bounced: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-orange-400",
	complained: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400",
	failed: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-500",
};

/** Badge classes for an `email_logs.status`. */
export function logClass(status: string): string {
	return LOG_STATUS_CLASS[status] ?? NEUTRAL;
}

const CAMPAIGN_STATUS_CLASS: Record<string, string> = {
	scheduled: "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/15 dark:text-blue-light-400",
	sending: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400",
	sent: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-500",
	failed: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-500",
	canceled: "bg-gray-100 text-gray-600 dark:bg-white/[0.03] dark:text-gray-400",
};

/** Badge classes for an `email_campaigns.status`. */
export function campaignClass(status: string): string {
	return CAMPAIGN_STATUS_CLASS[status] ?? "bg-gray-100 text-gray-600 dark:bg-white/[0.03] dark:text-gray-400";
}

const AUDIENCE_LABEL: Record<string, string> = {
	all: "All active",
	waiting: "Waiting",
	invited: "Invited",
	redeemed: "Redeemed",
};

/** Human label for a campaign audience key. */
export function audienceLabel(audience: string): string {
	return AUDIENCE_LABEL[audience] ?? audience;
}
