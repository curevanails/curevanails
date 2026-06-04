/**
 * Shared schema + helpers for the `job_applications` table.
 *
 * The table is created lazily (no migration step) so the recruit endpoint stays
 * self-contained. `ensureApplicationsSchema` is idempotent and also back-fills
 * the `status` / `notes` columns onto tables that were created before those
 * columns existed.
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

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS job_applications (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  full_name           TEXT NOT NULL,
  phone               TEXT NOT NULL,
  email               TEXT NOT NULL,
  city                TEXT NOT NULL,
  license_types       TEXT NOT NULL,
  dopl_license_number TEXT NOT NULL,
  license_expiration  TEXT NOT NULL,
  work_authorized     TEXT NOT NULL,
  skills              TEXT NOT NULL,
  english_proficiency TEXT NOT NULL,
  employment_type     TEXT NOT NULL,
  days_available      TEXT NOT NULL,
  start_date          TEXT NOT NULL,
  resume_key          TEXT,
  resume_filename     TEXT,
  license_photo_key   TEXT,
  portfolio_link      TEXT,
  status              TEXT NOT NULL DEFAULT 'new',
  notes               TEXT
)`;

/** Create the table if missing and add any columns introduced later. */
export async function ensureApplicationsSchema(db: D1Database): Promise<void> {
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
