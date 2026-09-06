import { env } from "cloudflare:workers";
import { ensureEmailSchema } from "./email-db";

/**
 * Data loaders for the email dashboard pages (`src/pages/notify/*`).
 *
 * The dashboard is one page per sidebar item — Compose, Campaigns, Templates,
 * Analytics, Activity, Suppressed — so each page loads only the rows it renders
 * instead of every table on every request. The row shapes and the queries live
 * here so the pages stay markup.
 */

export interface TemplateRow {
	id: string;
	name: string;
	subject: string;
	html: string;
	variables: string | null;
}

export interface LogRow {
	id: string;
	email: string;
	template_id: string | null;
	status: string;
	sent_at: number | null;
	delivered_at: number | null;
	opened_at: number | null;
	bounce_reason: string | null;
	error_message: string | null;
}

export interface SuppressionRow {
	email: string;
	reason: string;
	added_at: number;
}

export interface AudienceCounts {
	all: number;
	waiting: number;
	invited: number;
	redeemed: number;
}

export interface Stats {
	total: number;
	sent: number;
	delivered: number;
	opened: number;
	clicked: number;
	bounced: number;
	complained: number;
	failed: number;
}

export interface TemplateStat extends Stats {
	template_id: string | null;
}

export interface CampaignRow {
	id: string;
	template_id: string | null;
	audience: string;
	scheduled_at: number;
	status: string;
	total: number | null;
	sent: number | null;
	failed: number | null;
	error_message: string | null;
}

export const EMPTY_STATS: Stats = {
	total: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, failed: 0,
};

/** The Worker's D1 binding. */
export function mailDb(): D1Database {
	return env.DB as D1Database;
}

/** True when the AWS secrets needed to talk to SES are set on this Worker. */
export function sesConfigured(): boolean {
	const record = env as unknown as Record<string, unknown>;
	return (
		typeof record.AWS_REGION === "string" &&
		typeof record.AWS_ACCESS_KEY_ID === "string" &&
		typeof record.AWS_SECRET_ACCESS_KEY === "string"
	);
}

/**
 * Ensure the email schema exists, then run `load`. A failure (missing table,
 * D1 outage) becomes an `error` string the page renders as a banner instead of
 * a 500 — the rest of the console stays usable.
 */
export async function loadMailData<T>(
	db: D1Database,
	load: (db: D1Database) => Promise<T>,
): Promise<{ data: T | null; error: string | null }> {
	try {
		await ensureEmailSchema(db);
		return { data: await load(db), error: null };
	} catch (err) {
		console.error("mail: failed to load page data", err);
		return { data: null, error: err instanceof Error ? err.message : String(err) };
	}
}

export async function loadTemplates(db: D1Database): Promise<TemplateRow[]> {
	const { results } = await db
		.prepare("SELECT id, name, subject, html, variables FROM email_templates ORDER BY name")
		.all<TemplateRow>();
	return results ?? [];
}

export async function loadLogs(db: D1Database, limit = 50): Promise<LogRow[]> {
	const { results } = await db
		.prepare(
			`SELECT id, email, template_id, status, sent_at, delivered_at, opened_at, bounce_reason, error_message
			 FROM email_logs ORDER BY COALESCE(sent_at, 0) DESC LIMIT ?`,
		)
		.bind(limit)
		.all<LogRow>();
	return results ?? [];
}

export async function loadSuppressed(db: D1Database, limit = 50): Promise<SuppressionRow[]> {
	const { results } = await db
		.prepare("SELECT email, reason, added_at FROM suppression_list ORDER BY added_at DESC LIMIT ?")
		.bind(limit)
		.all<SuppressionRow>();
	return results ?? [];
}

/** Audience sizes for the Compose dropdown — active subscribers only. */
export async function loadAudienceCounts(db: D1Database): Promise<AudienceCounts> {
	const row = await db
		.prepare(
			`SELECT
			   SUM(CASE WHEN email_status='active' THEN 1 ELSE 0 END) AS all_active,
			   SUM(CASE WHEN email_status='active' AND status='waiting'  THEN 1 ELSE 0 END) AS waiting,
			   SUM(CASE WHEN email_status='active' AND status='invited'  THEN 1 ELSE 0 END) AS invited,
			   SUM(CASE WHEN email_status='active' AND status='redeemed' THEN 1 ELSE 0 END) AS redeemed
			 FROM waitlist`,
		)
		.first<{ all_active: number; waiting: number; invited: number; redeemed: number }>();
	return {
		all: row?.all_active ?? 0,
		waiting: row?.waiting ?? 0,
		invited: row?.invited ?? 0,
		redeemed: row?.redeemed ?? 0,
	};
}

/**
 * Active-subscriber count for the header pill. Never throws: the header is
 * chrome, so a broken query hides the pill rather than failing the page.
 */
export async function loadSubscriberCount(db: D1Database): Promise<number | null> {
	try {
		const row = await db
			.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE email_status='active'")
			.first<{ n: number }>();
		return row?.n ?? 0;
	} catch {
		return null;
	}
}

/**
 * Delivery analytics over email_logs. Counts are derived from the event
 * timestamps the SNS webhook fills in (sent/delivered/opened/clicked) plus the
 * terminal status for bounces/complaints/failures.
 */
const AGG = `
	COUNT(*) AS total,
	SUM(CASE WHEN sent_at      IS NOT NULL THEN 1 ELSE 0 END) AS sent,
	SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
	SUM(CASE WHEN opened_at    IS NOT NULL THEN 1 ELSE 0 END) AS opened,
	SUM(CASE WHEN clicked_at   IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
	SUM(CASE WHEN status='bounced'    THEN 1 ELSE 0 END) AS bounced,
	SUM(CASE WHEN status='complained' THEN 1 ELSE 0 END) AS complained,
	SUM(CASE WHEN status='failed'     THEN 1 ELSE 0 END) AS failed`;

export async function loadStats(db: D1Database): Promise<Stats> {
	return (await db.prepare(`SELECT ${AGG} FROM email_logs`).first<Stats>()) ?? EMPTY_STATS;
}

export async function loadTemplateStats(db: D1Database): Promise<TemplateStat[]> {
	const { results } = await db
		.prepare(`SELECT template_id, ${AGG} FROM email_logs GROUP BY template_id ORDER BY sent DESC, total DESC`)
		.all<TemplateStat>();
	return results ?? [];
}

/** Scheduled campaigns: upcoming ones first, then recent completed/failed. */
export async function loadCampaigns(db: D1Database, limit = 20): Promise<CampaignRow[]> {
	const { results } = await db
		.prepare(
			`SELECT id, template_id, audience, scheduled_at, status, total, sent, failed, error_message
			 FROM email_campaigns
			 ORDER BY CASE WHEN status = 'scheduled' THEN 0 ELSE 1 END, scheduled_at DESC
			 LIMIT ?`,
		)
		.bind(limit)
		.all<CampaignRow>();
	return results ?? [];
}

/** Resolve a template id to its name, falling back to the raw id. */
export function templateNamer(templates: TemplateRow[]): (id: string | null) => string {
	return (id) => templates.find((t) => t.id === id)?.name ?? (id ?? "—");
}
