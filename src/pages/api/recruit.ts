import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
	BACKGROUND_OPTIONS,
	CURRENT_STATUS_OPTIONS,
	EMPLOYMENT_OPTIONS,
	POSITION_OPTIONS,
	ensureApplicationsSchema,
} from "../../utils/recruit-db";
import { rateLimit } from "../../utils/rate-limit";
import { sendRecruitEmails } from "../../utils/recruit-emails";
import { TURNSTILE_FIELD, verifyTurnstile } from "../../utils/turnstile";

// Server-rendered endpoint — never prerender.
export const prerender = false;

/**
 * Job-application intake for the CureVà careers site.
 *
 * Accepts a multipart/form-data POST from /recruit/apply with the "Hiring
 * Form" field set (contact info, positions of interest, licensure status,
 * background, employment type, optional resume OR social/portfolio link, a
 * short "why CURE VÀ" answer, and a contact-consent checkbox). Stores an
 * uploaded resume in the R2 `MEDIA` bucket and writes the structured
 * application into the D1 `DB` database.
 *
 * The table is created lazily via `ensureApplicationsSchema` so the endpoint
 * is self-contained and needs no separate migration step.
 */

const POSITIONS = new Set<string>(POSITION_OPTIONS);
const CURRENT_STATUSES = new Set<string>(CURRENT_STATUS_OPTIONS);
const BACKGROUNDS = new Set<string>(BACKGROUND_OPTIONS);
const EMPLOYMENT = new Set<string>(EMPLOYMENT_OPTIONS);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_ALLOWED_RE = /^[\d\s()+.\-]+$/;
const RESUME_EXT_RE = /\.(pdf|docx?)$/i;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_WHY_LENGTH = 1000;
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
// C0 controls + DEL — used to reject newlines/control chars in free-text fields
// that flow into the recruiter alert email.
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

/**
 * Ten US national digits, or `null` when the input is not that. A leading
 * country `1` is accepted and dropped — people paste it constantly — which
 * mirrors the formatter on the apply form exactly.
 */
function nationalPhone(raw: string): string | null {
	let d = digitsOnly(raw);
	if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
	return d.length === 10 ? d : null;
}

/** `8015550123` -> `(801) 555-0123`, so the admin and the alert emails agree. */
function formatPhone(d: string): string {
	return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function letterCount(s: string): number {
	return (s.match(/\p{L}/gu) ?? []).length;
}
function digitsOnly(s: string): string {
	return s.replace(/\D/g, "");
}

/**
 * Normalise the "Expected Graduation Date (Month / Year)" to `YYYY-MM`.
 * Accepts the native month-input value (`2027-05`) or the text fallback a
 * browser without month support submits (`5/2027`, `05 / 2027`).
 * Returns null when the value isn't recognisable.
 */
function normalizeMonthYear(s: string): string | null {
	let m = s.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
	if (m) return `${m[1]}-${m[2]}`;
	m = s.match(/^(0?[1-9]|1[0-2])\s*\/\s*(\d{4})$/);
	if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
	return null;
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function str(form: FormData, key: string): string {
	const v = form.get(key);
	return typeof v === "string" ? v.trim() : "";
}

function isFile(v: FormDataEntryValue | null): v is File {
	return v instanceof File && v.size > 0;
}

/**
 * True for a routable public client IP. Cloudflare always sets `CF-Connecting-IP`
 * to the real client address for public traffic, so loopback/private/link-local
 * values only appear in local dev/preview — we skip rate-limiting those rather
 * than lump every local caller into one shared bucket.
 */
function isPublicClientIp(ip: string | null): ip is string {
	if (!ip) return false;
	const v = ip.startsWith("::ffff:") ? ip.slice(7) : ip; // unwrap IPv4-mapped IPv6
	if (v === "::1" || v.startsWith("127.")) return false; // loopback
	if (v.startsWith("10.") || v.startsWith("192.168.")) return false; // private
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return false; // private 172.16/12
	if (v.startsWith("169.254.") || v.toLowerCase().startsWith("fe80:")) return false; // link-local
	if (/^f[cd][0-9a-f]{2}:/i.test(v)) return false; // unique-local IPv6
	return true;
}

async function uploadFile(bucket: R2Bucket, prefix: string, file: File) {
	const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
	const key = `${prefix}/${crypto.randomUUID()}-${safe}`;
	await bucket.put(key, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type || "application/octet-stream" },
	});
	return { key, filename: file.name };
}

export const POST: APIRoute = async ({ request }) => {
	const db = env.DB as D1Database;
	const bucket = env.MEDIA as R2Bucket;

	// Rate-limit this public upload endpoint by client IP (5 / 10 min / IP). It
	// writes an R2 object + a D1 row per call, so without this it can be scripted
	// to flood storage. `CF-Connecting-IP` is set by Cloudflare's edge and can't
	// be spoofed by the client.
	const ip = request.headers.get("CF-Connecting-IP");
	if (isPublicClientIp(ip)) {
		const kv = (env as unknown as { SESSION?: KVNamespace }).SESSION;
		const limit = await rateLimit(kv, `recruit:${ip}`, 5, 600);
		if (!limit.ok) {
			return json(
				{
					ok: false,
					error: "Too many submissions from this network. Please try again later.",
				},
				429,
			);
		}
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return json({ ok: false, error: "Expected multipart form data." }, 400);
	}

	// --- Collect + validate fields ---
	const firstName = str(form, "first_name");
	const lastName = str(form, "last_name");
	const email = str(form, "email");
	const phone = str(form, "phone");
	const positions = form
		.getAll("positions")
		.filter((v): v is string => typeof v === "string" && POSITIONS.has(v));
	const currentStatus = str(form, "current_status");
	const graduationRaw = str(form, "graduation_date");
	const background = str(form, "background");
	const employmentType = form
		.getAll("employment_type")
		.filter((v): v is string => typeof v === "string" && EMPLOYMENT.has(v));
	const portfolioLink = str(form, "portfolio_link");
	const whyCureva = str(form, "why_cureva");
	const contactConsent = str(form, "contact_consent") === "yes" ? 1 : 0;
	const resume = form.get("resume");
	const turnstileToken = str(form, TURNSTILE_FIELD);

	// Bot check before the R2 upload and the D1 write — an unverified caller
	// should not get to spend either. Costs nothing while unconfigured.
	const human = await verifyTurnstile(turnstileToken, ip);
	if (!human.ok) return json({ ok: false, error: human.error }, 400);

	const errors: Record<string, string> = {};

	// Contact information
	if (!firstName) errors.first_name = "First name is required.";
	else if (firstName.length > MAX_NAME_LENGTH || CONTROL_CHARS_RE.test(firstName))
		errors.first_name = "Enter a valid first name.";
	else if (/\d/.test(firstName)) errors.first_name = "Name can't contain numbers.";
	else if (letterCount(firstName) < 1) errors.first_name = "Enter your first name.";

	if (!lastName) errors.last_name = "Last name is required.";
	else if (lastName.length > MAX_NAME_LENGTH || CONTROL_CHARS_RE.test(lastName))
		errors.last_name = "Enter a valid last name.";
	else if (/\d/.test(lastName)) errors.last_name = "Name can't contain numbers.";
	else if (letterCount(lastName) < 1) errors.last_name = "Enter your last name.";

	if (email && (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)))
		errors.email = "Enter a valid email address.";

	let phoneNational: string | null = null;
	if (!phone) errors.phone = "Phone number is required.";
	else if (/[A-Za-z]/.test(phone) || !PHONE_ALLOWED_RE.test(phone))
		errors.phone = "Phone number can't contain letters.";
	else {
		phoneNational = nationalPhone(phone);
		if (!phoneNational)
			errors.phone = "Enter a 10-digit US phone number.";
	}

	// Professional information
	if (positions.length === 0)
		errors.positions = "Select at least one position.";

	if (!CURRENT_STATUSES.has(currentStatus))
		errors.current_status = "Select your current status.";

	let graduationDate: string | null = null;
	if (graduationRaw) {
		graduationDate = normalizeMonthYear(graduationRaw);
		if (!graduationDate)
			errors.graduation_date = "Use the Month / Year format (e.g. 05/2027).";
	}

	if (!BACKGROUNDS.has(background))
		errors.background = "Select the option that best describes you.";

	if (employmentType.length === 0)
		errors.employment_type = "Select the type of position you're looking for.";

	// Portfolio (both optional — resume OR a social/portfolio link)
	if (isFile(resume)) {
		if (!RESUME_EXT_RE.test(resume.name))
			errors.resume = "Resume must be a PDF or Word document (.pdf, .doc, .docx).";
		else if (resume.size > MAX_UPLOAD_BYTES)
			errors.resume = "Resume must be 10 MB or smaller.";
	}

	if (portfolioLink && portfolioLink.length > 200)
		errors.portfolio_link = "Portfolio link is too long.";

	// Short question
	if (whyCureva.length > MAX_WHY_LENGTH)
		errors.why_cureva = "Please keep your answer under 1,000 characters.";

	if (Object.keys(errors).length > 0) {
		return json({ ok: false, errors }, 400);
	}

	const id = crypto.randomUUID();

	// --- Upload resume to R2 ---
	let resumeMeta: { key: string; filename: string } | null = null;

	try {
		if (isFile(resume)) {
			resumeMeta = await uploadFile(bucket, `recruit/${id}/resume`, resume);
		}
	} catch (err) {
		console.error("recruit upload failed", err);
		return json({ ok: false, error: "Failed to store the uploaded file." }, 500);
	}

	// Everything past validation uses the canonical shape, so the admin table,
	// the recruiter alert and the candidate ack all read the same number.
	const storedPhone = formatPhone(phoneNational as string);

	// --- Persist to D1 ---
	try {
		await ensureApplicationsSchema(db);
		await db
			.prepare(
				`INSERT INTO job_applications (
					id, created_at, first_name, last_name, email, phone,
					positions, current_status, graduation_date, background, employment_type,
					resume_key, resume_filename, portfolio_link, why_cureva, contact_consent
				) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			)
			.bind(
				id,
				new Date().toISOString(),
				firstName,
				lastName,
				email || null,
				storedPhone,
				JSON.stringify(positions),
				currentStatus,
				graduationDate,
				background,
				JSON.stringify(employmentType),
				resumeMeta?.key ?? null,
				resumeMeta?.filename ?? null,
				portfolioLink || null,
				whyCureva || null,
				contactConsent,
			)
			.run();
	} catch (err) {
		console.error("recruit insert failed", err);
		return json({ ok: false, error: "Failed to save application." }, 500);
	}

	// Best-effort transactional emails (recruiter alert + candidate ack). The
	// application is already saved, so a failed/unconfigured send never affects
	// the applicant's result — swallow everything.
	try {
		await sendRecruitEmails(db, env as unknown as Record<string, unknown>, {
			id,
			firstName,
			lastName,
			email: email || null,
			phone: storedPhone,
			positions,
			currentStatus,
			graduationDate,
			background,
			employmentType,
			portfolioLink: portfolioLink || null,
			whyCureva: whyCureva || null,
		});
	} catch (err) {
		console.error("recruit emails failed", err);
	}

	return json({ ok: true, id });
};
