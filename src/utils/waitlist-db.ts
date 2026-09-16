/**
 * Shared schema + helpers for the `waitlist` table.
 *
 * The table is created lazily (no migration step) so the waitlist endpoint
 * stays self-contained — mirroring `recruit-db.ts`. `ensureWaitlistSchema` is
 * idempotent and back-fills columns introduced after the table first appeared.
 *
 * Capture-only for now: we store phone + email. The `discount_code`,
 * `claimed_at`, and `status` columns are the seam for the later
 * "claim a discount code" feature (and a possible Mangomint sync) — they cost
 * nothing to add now and save an `ALTER TABLE` later.
 */

import { nanoid } from "nanoid";

/** A new unsubscribe token (URL-safe, unguessable) for a subscriber. */
export function newUnsubscribeToken(): string {
	return nanoid(32);
}

export const WAITLIST_STATUSES = ["waiting", "invited", "redeemed"] as const;

export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export const WAITLIST_STATUS_LABELS: Record<WaitlistStatus, string> = {
	waiting: "Waiting",
	invited: "Invited",
	redeemed: "Redeemed",
};

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS waitlist (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email_norm    TEXT NOT NULL,
  phone_norm    TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'getready',
  status        TEXT NOT NULL DEFAULT 'waiting',
  discount_code TEXT,
  claimed_at    TEXT,
  notes         TEXT,
  unsubscribe_token TEXT,
  email_status  TEXT NOT NULL DEFAULT 'active',
  ack_email_sent_at TEXT,
  ack_last_attempt_at TEXT
)`;

const CREATE_EMAIL_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist (email_norm)`;

/** Create the table + unique-email index if missing, adding later columns. */
export async function ensureWaitlistSchema(db: D1Database): Promise<void> {
	await db.prepare(CREATE_TABLE).run();

	const info = await db.prepare("PRAGMA table_info(waitlist)").all();
	const columns = new Set(
		(info.results ?? []).map((row) => (row as { name: string }).name),
	);

	if (!columns.has("status")) {
		await db
			.prepare(
				"ALTER TABLE waitlist ADD COLUMN status TEXT NOT NULL DEFAULT 'waiting'",
			)
			.run();
	}
	if (!columns.has("discount_code")) {
		await db.prepare("ALTER TABLE waitlist ADD COLUMN discount_code TEXT").run();
	}
	if (!columns.has("claimed_at")) {
		await db.prepare("ALTER TABLE waitlist ADD COLUMN claimed_at TEXT").run();
	}
	if (!columns.has("notes")) {
		await db.prepare("ALTER TABLE waitlist ADD COLUMN notes TEXT").run();
	}
	if (!columns.has("unsubscribe_token")) {
		await db.prepare("ALTER TABLE waitlist ADD COLUMN unsubscribe_token TEXT").run();
	}
	if (!columns.has("email_status")) {
		await db
			.prepare("ALTER TABLE waitlist ADD COLUMN email_status TEXT NOT NULL DEFAULT 'active'")
			.run();
	}

	if (!columns.has("ack_email_sent_at")) {
		await db.prepare("ALTER TABLE waitlist ADD COLUMN ack_email_sent_at TEXT").run();
	}
	if (!columns.has("ack_last_attempt_at")) {
		await db.prepare("ALTER TABLE waitlist ADD COLUMN ack_last_attempt_at TEXT").run();
	}

	await db.prepare(CREATE_EMAIL_INDEX).run();

	// Back-fill unsubscribe tokens for any rows created before the column existed.
	const missing = await db
		.prepare("SELECT id FROM waitlist WHERE unsubscribe_token IS NULL OR unsubscribe_token = ''")
		.all<{ id: string }>();
	for (const row of missing.results ?? []) {
		await db
			.prepare("UPDATE waitlist SET unsubscribe_token = ? WHERE id = ?")
			.bind(newUnsubscribeToken(), row.id)
			.run();
	}
}

/**
 * Record that a welcome was attempted, whatever came of it. This is what lets
 * the scheduled catch-up back off: a subscriber whose send just failed is not
 * retried five minutes later, and again five minutes after that, writing a
 * failed row into `email_logs` every time. Mirrors `markAckAttempt` in
 * `recruit-db.ts`.
 */
export async function markWelcomeAttempt(db: D1Database, id: string): Promise<void> {
	try {
		await db
			.prepare("UPDATE waitlist SET ack_last_attempt_at = ? WHERE id = ?")
			.bind(new Date().toISOString(), id)
			.run();
	} catch (err) {
		console.error("waitlist: failed to stamp ack_last_attempt_at", err);
	}
}

/** A subscriber who joined but was never welcomed. */
export interface UnwelcomedSubscriber {
	id: string;
	created_at: string;
	email: string;
	unsubscribe_token: string | null;
}

/**
 * Subscribers still owed a welcome: `ack_email_sent_at` was never stamped.
 *
 * The send at signup is best-effort and its most likely failure was not
 * transient — in the SES sandbox every subscriber address is unverified, so the
 * welcome could not succeed for anyone. Without a way to find them afterwards
 * the people who joined during that window stay unwelcomed forever. Oldest
 * first: they have been waiting longest.
 *
 * `email_status = 'active'` is the difference from the recruit query: the
 * waitlist carries unsubscribes, bounces and complaints, and a catch-up that
 * ignored them would mail people who already asked us to stop.
 */
export async function listUnwelcomedSubscribers(
	db: D1Database,
	limit = 100,
	/**
	 * Only rows not attempted since this instant (ISO). Omit to take everyone
	 * owed a welcome regardless; pass a cutoff so the scheduled run leaves
	 * recent failures alone for a while.
	 */
	notAttemptedSince?: string,
): Promise<UnwelcomedSubscriber[]> {
	await ensureWaitlistSchema(db);
	const res = await db
		.prepare(
			`SELECT id, created_at, email, unsubscribe_token
			   FROM waitlist
			  WHERE ack_email_sent_at IS NULL
			    AND email IS NOT NULL AND TRIM(email) <> ''
			    AND email_status = 'active'
			    AND (? IS NULL OR ack_last_attempt_at IS NULL OR ack_last_attempt_at < ?)
			  ORDER BY created_at ASC
			  LIMIT ?`,
		)
		.bind(notAttemptedSince ?? null, notAttemptedSince ?? null, limit)
		.all<UnwelcomedSubscriber>();
	return res.results ?? [];
}

/**
 * Stamp the welcome email as delivered to SES. NULL means "not sent" — SES isn't
 * configured, the address is suppressed, or the send failed (the failure itself
 * is in `email_logs`). Best-effort: never let a failed stamp break the send path.
 */
export async function markWelcomeEmailSent(
	db: D1Database,
	id: string,
): Promise<void> {
	try {
		await db
			.prepare("UPDATE waitlist SET ack_email_sent_at = ? WHERE id = ?")
			.bind(new Date().toISOString(), id)
			.run();
	} catch (err) {
		console.error("waitlist: failed to stamp ack_email_sent_at", err);
	}
}

export function isWaitlistStatus(v: unknown): v is WaitlistStatus {
	return (
		typeof v === "string" &&
		(WAITLIST_STATUSES as readonly string[]).includes(v)
	);
}

/** Lowercase + trim, for case-insensitive dedupe of email addresses. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** Digits only, for dedupe-friendly phone storage. */
export function normalizePhone(phone: string): string {
	return phone.replace(/\D/g, "");
}
