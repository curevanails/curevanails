import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

// Server-rendered endpoint — never prerender.
export const prerender = false;

/**
 * Nail Technician job-application intake for the CureVà "getready" site.
 *
 * Accepts a multipart/form-data POST from /recruit, stores any uploaded
 * documents (resume, DOPL licence photo, portfolio images) in the R2 `MEDIA`
 * bucket, and writes the structured application into the D1 `DB` database.
 *
 * The table is created lazily with `CREATE TABLE IF NOT EXISTS` so the endpoint
 * is self-contained and needs no separate migration step.
 */

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
  portfolio_link      TEXT
)`;

const LICENSE_TYPES = new Set(["nail_tech", "cosmetologist_barber", "other"]);
const SKILLS = new Set([
	"manicure_pedicure",
	"gel_shellac",
	"acrylic_full_set",
	"gel_x_soft_gel",
	"dip_powder",
	"nail_art_3d",
]);
const ENGLISH = new Set(["native", "fluent", "conversational", "limited"]);
const EMPLOYMENT = new Set(["full_time", "part_time"]);
const DAYS = new Set([
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);

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

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return json({ ok: false, error: "Expected multipart form data." }, 400);
	}

	// --- Collect + validate fields ---
	const fullName = str(form, "full_name");
	const phone = str(form, "phone");
	const email = str(form, "email");
	const city = str(form, "city");
	const licenseTypes = form
		.getAll("license_types")
		.filter((v): v is string => typeof v === "string" && LICENSE_TYPES.has(v));
	const doplNumber = str(form, "dopl_license_number");
	const licenseExpiration = str(form, "license_expiration");
	const workAuthorized = str(form, "work_authorized");
	const skills = form
		.getAll("skills")
		.filter((v): v is string => typeof v === "string" && SKILLS.has(v));
	const englishProficiency = str(form, "english_proficiency");
	const employmentType = str(form, "employment_type");
	const daysAvailable = form
		.getAll("days_available")
		.filter((v): v is string => typeof v === "string" && DAYS.has(v));
	const startDate = str(form, "start_date");

	const portfolioLink = str(form, "portfolio_link");
	const resume = form.get("resume");
	const licensePhoto = form.get("license_photo");

	const errors: Record<string, string> = {};
	if (!fullName) errors.full_name = "Full name is required.";
	if (!phone) errors.phone = "Phone number is required.";
	if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
		errors.email = "A valid email address is required.";
	if (!city) errors.city = "City of residence is required.";
	if (licenseTypes.length === 0)
		errors.license_types = "Select at least one license type.";
	if (!doplNumber) errors.dopl_license_number = "DOPL license number is required.";
	if (!licenseExpiration)
		errors.license_expiration = "License expiration date is required.";
	if (workAuthorized !== "yes" && workAuthorized !== "no")
		errors.work_authorized = "Please answer the work authorization question.";
	if (!ENGLISH.has(englishProficiency))
		errors.english_proficiency = "Select your English proficiency.";
	if (!EMPLOYMENT.has(employmentType))
		errors.employment_type = "Select an employment type.";
	if (daysAvailable.length === 0)
		errors.days_available = "Select at least one available day.";
	if (!startDate) errors.start_date = "Available start date is required.";
	if (!isFile(resume)) errors.resume = "Please attach your resume / CV.";

	if (Object.keys(errors).length > 0) {
		return json({ ok: false, errors }, 400);
	}

	const id = crypto.randomUUID();

	// --- Upload documents to R2 ---
	let resumeMeta: { key: string; filename: string } | null = null;
	let licensePhotoMeta: { key: string; filename: string } | null = null;

	try {
		if (isFile(resume)) {
			resumeMeta = await uploadFile(bucket, `recruit/${id}/resume`, resume);
		}
		if (isFile(licensePhoto)) {
			licensePhotoMeta = await uploadFile(
				bucket,
				`recruit/${id}/license`,
				licensePhoto,
			);
		}
	} catch (err) {
		console.error("recruit upload failed", err);
		return json({ ok: false, error: "Failed to store uploaded files." }, 500);
	}

	// --- Persist to D1 ---
	try {
		await db.prepare(CREATE_TABLE).run();
		await db
			.prepare(
				`INSERT INTO job_applications (
					id, created_at, full_name, phone, email, city,
					license_types, dopl_license_number, license_expiration, work_authorized,
					skills, english_proficiency, employment_type, days_available, start_date,
					resume_key, resume_filename, license_photo_key, portfolio_link
				) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			)
			.bind(
				id,
				new Date().toISOString(),
				fullName,
				phone,
				email,
				city,
				JSON.stringify(licenseTypes),
				doplNumber,
				licenseExpiration,
				workAuthorized,
				JSON.stringify(skills),
				englishProficiency,
				employmentType,
				JSON.stringify(daysAvailable),
				startDate,
				resumeMeta?.key ?? null,
				resumeMeta?.filename ?? null,
				licensePhotoMeta?.key ?? null,
				portfolioLink || null,
			)
			.run();
	} catch (err) {
		console.error("recruit insert failed", err);
		return json({ ok: false, error: "Failed to save application." }, 500);
	}

	return json({ ok: true, id });
};
