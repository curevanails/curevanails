/**
 * Shared schema + helpers for the `talent_list` table — the lightweight
 * pre-launch "Join Our Talent List" signups from /recruit (name, email, role,
 * optional portfolio + a few sentences). Distinct from `job_applications`,
 * which holds the full /recruit/apply hiring-form submissions.
 *
 * The table is created lazily (no migration step) so the endpoint stays
 * self-contained — mirroring `recruit-db.ts` / `waitlist-db.ts`.
 *
 * The staff pipeline reuses the application statuses (new / pending /
 * contacted / deal) so the admin UI reads the same across both lists.
 */

import { APPLICATION_STATUSES, type ApplicationStatus } from "./recruit-db";

export type TalentStatus = ApplicationStatus;

/** "Role you're interested in" — single select on the talent form. */
export const TALENT_ROLE_OPTIONS = [
	"nail_technician",
	"esthetician",
	"lash_brow_specialist",
	"cosmetologist",
	"open_to_multiple",
	"other",
] as const;

export type TalentRole = (typeof TALENT_ROLE_OPTIONS)[number];

export const TALENT_ROLE_LABELS: Record<TalentRole, string> = {
	nail_technician: "Nail Technician",
	esthetician: "Esthetician",
	lash_brow_specialist: "Lash & Brow Specialist",
	cosmetologist: "Cosmetologist",
	open_to_multiple: "Open to multiple roles",
	other: "Something else",
};

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS talent_list (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  email_norm  TEXT NOT NULL,
  role        TEXT NOT NULL,
  portfolio   TEXT,
  about       TEXT,
  source      TEXT NOT NULL DEFAULT 'recruit',
  status      TEXT NOT NULL DEFAULT 'new',
  notes       TEXT
)`;

const CREATE_EMAIL_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_talent_email ON talent_list (email_norm)`;

/** Create the table + unique-email index if missing. */
export async function ensureTalentSchema(db: D1Database): Promise<void> {
	await db.prepare(CREATE_TABLE).run();
	await db.prepare(CREATE_EMAIL_INDEX).run();
}

export function isTalentStatus(v: unknown): v is TalentStatus {
	return (
		typeof v === "string" &&
		(APPLICATION_STATUSES as readonly string[]).includes(v)
	);
}

export function isTalentRole(v: unknown): v is TalentRole {
	return (
		typeof v === "string" &&
		(TALENT_ROLE_OPTIONS as readonly string[]).includes(v)
	);
}
