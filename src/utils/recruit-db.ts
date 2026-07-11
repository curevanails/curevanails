/**
 * Shared schema + helpers for the `job_applications` table.
 *
 * The table is created lazily (no migration step) so the recruit endpoint stays
 * self-contained. `ensureApplicationsSchema` is idempotent: it parks any
 * old-shape table (the pre-July-2026 nail-tech-only field set) as
 * `job_applications_legacy`, creates the current table, and back-fills the
 * `status` / `notes` columns onto tables created before those columns existed.
 */

export const APPLICATION_STATUSES = [
	"new",
	"pending",
	"contacted",
	"deal",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
	new: "New",
	pending: "Pending",
	contacted: "Contacted",
	deal: "Deal",
};

/** "Which position(s) are you interested in?" — stored as a JSON array. */
export const POSITION_OPTIONS = [
	"nail_technician",
	"esthetician",
	"cosmetologist",
	"lash_artist",
	"open_to_multiple",
] as const;

export const POSITION_LABELS: Record<(typeof POSITION_OPTIONS)[number], string> = {
	nail_technician: "Nail Technician",
	esthetician: "Esthetician",
	cosmetologist: "Cosmetologist",
	lash_artist: "Lash Artist",
	open_to_multiple: "Open to multiple roles",
};

/** "What is your current status?" */
export const CURRENT_STATUS_OPTIONS = [
	"licensed_utah",
	"beauty_school",
	"transferring_license",
] as const;

export const CURRENT_STATUS_LABELS: Record<
	(typeof CURRENT_STATUS_OPTIONS)[number],
	string
> = {
	licensed_utah: "Licensed in Utah",
	beauty_school: "Attending beauty school",
	transferring_license: "Transferring license to Utah",
};

/** "Which best describes you?" */
export const BACKGROUND_OPTIONS = [
	"school_or_recent_grad",
	"salon_experience",
] as const;

export const BACKGROUND_LABELS: Record<
	(typeof BACKGROUND_OPTIONS)[number],
	string
> = {
	school_or_recent_grad: "In beauty school / recent graduate",
	salon_experience: "Salon or spa experience",
};

/** "What type of position are you looking for?" */
export const EMPLOYMENT_OPTIONS = ["full_time", "part_time", "either"] as const;

export const EMPLOYMENT_LABELS: Record<
	(typeof EMPLOYMENT_OPTIONS)[number],
	string
> = {
	full_time: "Full-time",
	part_time: "Part-time",
	either: "Full-time or Part-time",
};

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS job_applications (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT NOT NULL,
  positions       TEXT NOT NULL,
  current_status  TEXT NOT NULL,
  graduation_date TEXT,
  background      TEXT NOT NULL,
  employment_type TEXT NOT NULL,
  resume_key      TEXT,
  resume_filename TEXT,
  portfolio_link  TEXT,
  why_cureva      TEXT,
  contact_consent INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'new',
  notes           TEXT
)`;

/**
 * Create the table if missing, migrating any old-shape table out of the way
 * first, and add any columns introduced later.
 */
export async function ensureApplicationsSchema(db: D1Database): Promise<void> {
	const before = await db.prepare("PRAGMA table_info(job_applications)").all();
	const existing = new Set(
		(before.results ?? []).map((row) => (row as { name: string }).name),
	);

	// The pre-July-2026 table (DOPL licence / skills / availability fields) has
	// NOT NULL columns the current form no longer collects, so inserts would
	// fail. Park it — with its data — as `job_applications_legacy`. This runs at
	// most once: after the rename the live table has the new shape.
	if (existing.size > 0 && existing.has("dopl_license_number")) {
		await db
			.prepare(
				"ALTER TABLE job_applications RENAME TO job_applications_legacy",
			)
			.run();
	}

	await db.prepare(CREATE_TABLE).run();

	const info = await db.prepare("PRAGMA table_info(job_applications)").all();
	const columns = new Set(
		(info.results ?? []).map((row) => (row as { name: string }).name),
	);

	if (!columns.has("status")) {
		await db
			.prepare(
				"ALTER TABLE job_applications ADD COLUMN status TEXT NOT NULL DEFAULT 'new'",
			)
			.run();
	}
	if (!columns.has("notes")) {
		await db.prepare("ALTER TABLE job_applications ADD COLUMN notes TEXT").run();
	}
}

export function isApplicationStatus(v: unknown): v is ApplicationStatus {
	return (
		typeof v === "string" &&
		(APPLICATION_STATUSES as readonly string[]).includes(v)
	);
}
