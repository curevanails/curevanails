/**
 * Presentation helpers for the recruit admin pages (dashboard + pipeline).
 *
 * Every value here mirrors a field of the application form at `/recruit/apply`
 * (see src/utils/recruit-db.ts for the option keys), so the admin reads back
 * exactly what the candidate filled in.
 */
import {
	APPLICATION_STATUSES,
	BACKGROUND_LABELS,
	CURRENT_STATUS_LABELS,
	EMPLOYMENT_LABELS,
	POSITION_LABELS,
	type ApplicationStatus,
} from "./recruit-db";

/** One row of `job_applications`, as the admin pages read it. */
export interface ApplicationRow {
	id: string;
	created_at: string;
	first_name: string;
	last_name: string;
	email: string | null;
	phone: string;
	positions: string;
	current_status: string;
	graduation_date: string | null;
	background: string;
	employment_type: string;
	resume_key: string | null;
	resume_filename: string | null;
	portfolio_link: string | null;
	why_cureva: string | null;
	contact_consent: number;
	status: string | null;
	notes: string | null;
	/** ISO timestamp of the thank-you email; NULL = never sent. */
	ack_email_sent_at: string | null;
}

const LABELS: Record<string, string> = {
	...POSITION_LABELS,
	...CURRENT_STATUS_LABELS,
	...BACKGROUND_LABELS,
	...EMPLOYMENT_LABELS,
};

/** Human label for any stored option key, falling back to the raw value. */
export function label(v: string): string {
	return LABELS[v] ?? v;
}

/** Tailwind classes per status (Play CDN ships the full default palette). */
export const STATUS_CLASS: Record<ApplicationStatus, string> = {
	new: "bg-gray-100 text-gray-700 border-gray-300",
	pending: "bg-amber-100 text-amber-800 border-amber-300",
	contacted: "bg-brand-50 text-brand-600 border-brand-200",
	deal: "bg-emerald-100 text-emerald-800 border-emerald-300",
};

export const STATUS_DOT: Record<ApplicationStatus, string> = {
	new: "bg-gray-400",
	pending: "bg-amber-500",
	contacted: "bg-brand-500",
	deal: "bg-emerald-500",
};

export function statusOf(s: string | null): ApplicationStatus {
	return s && (APPLICATION_STATUSES as readonly string[]).includes(s)
		? (s as ApplicationStatus)
		: "new";
}

/**
 * `positions` and `employment_type` hold a JSON array. Rows written before the
 * columns held JSON keep a single bare value (`full_time`, `either`) — read
 * them as the one-item list they are.
 */
export function parseList(json: string | null): string[] {
	if (!json) return [];
	try {
		const arr = JSON.parse(json);
		return Array.isArray(arr) ? arr.map(String) : [];
	} catch {
		return [json];
	}
}

export function fmtDate(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? iso
		: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtTime(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? ""
		: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "2027-05" → "May 2027" — the form asks for a Month / Year. */
export function fmtMonth(ym: string): string {
	const m = ym.match(/^(\d{4})-(\d{2})$/);
	if (!m) return ym;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
	return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * `8015550123` / `18015550123` → `(801) 555-0123`.
 *
 * The intake endpoint stores this shape, but rows taken before it did (and any
 * legacy import) hold whatever the candidate typed — so the admin normalises at
 * render time and the column reads consistently either way. Anything that isn't
 * a 10-digit US number is shown as stored.
 */
export function fmtPhone(raw: string): string {
	let d = raw.replace(/\D/g, "");
	if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
	if (d.length !== 10) return raw;
	return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** `tel:` target for a stored phone number. */
export function telHref(raw: string): string {
	const d = raw.replace(/[^+\d]/g, "");
	return `tel:${d}`;
}

/** Applicants often enter "@handle" instead of a URL — make it clickable. */
export function portfolioHref(v: string): string {
	if (/^https?:\/\//i.test(v)) return v;
	if (v.startsWith("@")) return `https://instagram.com/${v.slice(1)}`;
	return `https://${v}`;
}

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function fullName(app: { first_name: string; last_name: string }): string {
	return `${app.first_name} ${app.last_name}`.trim();
}
