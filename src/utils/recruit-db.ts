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
] as const;

/**
 * Keyed loosely so the admin can still name `open_to_multiple`, retired when
 * the group became a plain multi-select — ticking several boxes now says the
 * same thing — but still present on applications taken before that.
 */
export const POSITION_LABELS: Record<string, string> = {
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

/**
 * "What type of position are you looking for?" — ONE choice, Full-time or
 * Part-time. It is still stored as a JSON array, like `positions`: the column,
 * the admin's reader and every row already written all speak that shape, and a
 * one-item array costs nothing. The retired "Either Full-time or Part-time"
 * option still has a label below, for the rows taken while it existed.
 */
export const EMPLOYMENT_OPTIONS = ["full_time", "part_time"] as const;

/** Loosely keyed so `either` still reads well on pre-multi-select rows. */
export const EMPLOYMENT_LABELS: Record<string, string> = {
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
  notes           TEXT,
  ack_email_sent_at TEXT
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
	if (!columns.has("ack_email_sent_at")) {
		await db
			.prepare("ALTER TABLE job_applications ADD COLUMN ack_email_sent_at TEXT")
			.run();
	}
	if (!columns.has("ack_last_attempt_at")) {
		await db
			.prepare("ALTER TABLE job_applications ADD COLUMN ack_last_attempt_at TEXT")
			.run();
	}
}

/**
 * Stamp the thank-you email as delivered to SES. NULL means "not sent" — either
 * the applicant left the optional email blank, SES isn't configured, or the send
 * failed (the failure itself is in `email_logs`). Best-effort: a failed stamp
 * must never break the send path, so this swallows its own errors.
 */
/**
 * Record that a thank-you was attempted, whatever came of it. This is what
 * lets the scheduled catch-up back off: a candidate whose send just failed is
 * not retried again five minutes later, and again five minutes after that,
 * writing a failed row into email_logs every time while the account is
 * still in the SES sandbox.
 */
export async function markAckAttempt(db: D1Database, id: string): Promise<void> {
	try {
		await db
			.prepare("UPDATE job_applications SET ack_last_attempt_at = ? WHERE id = ?")
			.bind(new Date().toISOString(), id)
			.run();
	} catch (err) {
		console.error("recruit: failed to stamp ack_last_attempt_at", err);
	}
}

export async function markAckEmailSent(
	db: D1Database,
	id: string,
): Promise<void> {
	try {
		await db
			.prepare("UPDATE job_applications SET ack_email_sent_at = ? WHERE id = ?")
			.bind(new Date().toISOString(), id)
			.run();
	} catch (err) {
		console.error("recruit: failed to stamp ack_email_sent_at", err);
	}
}

/** A saved application that supplied an address but was never thanked. */
export interface UnthankedApplication {
	id: string;
	first_name: string;
	last_name: string;
	email: string;
	phone: string;
	positions: string | null;
	current_status: string;
	graduation_date: string | null;
	background: string;
	employment_type: string | null;
	portfolio_link: string | null;
	why_cureva: string | null;
}

/**
 * Applications still owed a thank-you: they gave an address, and
 * `ack_email_sent_at` was never stamped.
 *
 * This exists because the send is best-effort and its most likely failure is
 * not transient. In the SES sandbox EVERY candidate address is unverified, so
 * the acknowledgement cannot succeed for anyone — and without a way to find
 * these afterwards, the people who applied during that window stay unthanked
 * forever, with nothing on the page to say so. Oldest first: they have been
 * waiting longest.
 */
export async function listUnthankedApplications(
	db: D1Database,
	limit = 100,
	/**
	 * Only rows not attempted since this instant (ISO). Omit to take everyone
	 * owed a thank-you regardless — the "send now" button — or pass a cutoff
	 * so the scheduled run leaves recent failures alone for a while.
	 */
	notAttemptedSince?: string,
): Promise<UnthankedApplication[]> {
	await ensureApplicationsSchema(db);
	const res = await db
		.prepare(
			`SELECT id, first_name, last_name, email, phone, positions, current_status,
			        graduation_date, background, employment_type, portfolio_link, why_cureva
			   FROM job_applications
			  WHERE ack_email_sent_at IS NULL
			    AND email IS NOT NULL AND TRIM(email) <> ''
			    AND (? IS NULL OR ack_last_attempt_at IS NULL OR ack_last_attempt_at < ?)
			  ORDER BY created_at ASC
			  LIMIT ?`,
		)
		.bind(notAttemptedSince ?? null, notAttemptedSince ?? null, limit)
		.all<UnthankedApplication>();
	return res.results ?? [];
}

export function isApplicationStatus(v: unknown): v is ApplicationStatus {
	return (
		typeof v === "string" &&
		(APPLICATION_STATUSES as readonly string[]).includes(v)
	);
}
