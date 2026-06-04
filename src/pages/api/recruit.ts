import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { ensureApplicationsSchema } from "../../utils/recruit-db";

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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOPL_RE = /^\d{6,8}-\d{4}$/;
const PHONE_ALLOWED_RE = /^[\d\s()+.\-]+$/;
const RESUME_EXT_RE = /\.(pdf|docx?)$/i;
const PHOTO_EXT_RE = /\.(png|jpe?g|gif|webp|heic|pdf)$/i;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

function letterCount(s: string): number {
	return (s.match(/\p{L}/gu) ?? []).length;
}
function isValidDateStr(s: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}
/**
 * Earliest acceptable "not in the past" date. We use yesterday (UTC) rather
 * than today so a candidate in a timezone behind UTC isn't wrongly rejected for
 * picking their local "today" — the client enforces the stricter local-today.
 */
function minAcceptableDate(): string {
	return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function digitsOnly(s: string): string {
	return s.replace(/\D/g, "");
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
	const minDate = minAcceptableDate();

	// Personal information
	if (!fullName) errors.full_name = "Full name is required.";
	else if (/\d/.test(fullName)) errors.full_name = "Name can't contain numbers.";
	else if (letterCount(fullName) < 2) errors.full_name = "Please enter your full name.";

	if (!phone) errors.phone = "Phone number is required.";
	else if (/[A-Za-z]/.test(phone) || !PHONE_ALLOWED_RE.test(phone))
		errors.phone = "Phone number can't contain letters.";
	else if (digitsOnly(phone).length < 10 || digitsOnly(phone).length > 15)
		errors.phone = "Enter a valid phone number (at least 10 digits).";

	if (!email) errors.email = "Email address is required.";
	else if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";

	if (!city) errors.city = "City of residence is required.";
	else if (/\d/.test(city)) errors.city = "City can't contain numbers.";

	// Licensing
	if (licenseTypes.length === 0)
		errors.license_types = "Select at least one license type.";

	if (!doplNumber) errors.dopl_license_number = "DOPL license number is required.";
	else if (!DOPL_RE.test(doplNumber))
		errors.dopl_license_number = "Use the format 1234567-5501.";

	if (!licenseExpiration)
		errors.license_expiration = "License expiration date is required.";
	else if (!isValidDateStr(licenseExpiration))
		errors.license_expiration = "Enter a valid date.";
	else if (licenseExpiration < minDate)
		errors.license_expiration =
			"License has expired — enter a current expiration date.";

	if (workAuthorized !== "yes" && workAuthorized !== "no")
		errors.work_authorized = "Please answer the work authorization question.";

	// Skills & communication
	if (!ENGLISH.has(englishProficiency))
		errors.english_proficiency = "Select your English proficiency.";

	// Availability
	if (!EMPLOYMENT.has(employmentType))
		errors.employment_type = "Select an employment type.";
	if (daysAvailable.length === 0)
		errors.days_available = "Select at least one available day.";

	if (!startDate) errors.start_date = "Available start date is required.";
	else if (!isValidDateStr(startDate)) errors.start_date = "Enter a valid date.";
	else if (startDate < minDate)
		errors.start_date = "Start date can't be in the past.";

	// Documents
	if (!isFile(resume)) errors.resume = "Please attach your resume / CV.";
	else if (!RESUME_EXT_RE.test(resume.name))
		errors.resume = "Resume must be a PDF or Word document (.pdf, .doc, .docx).";
	else if (resume.size > MAX_UPLOAD_BYTES)
		errors.resume = "Resume must be 10 MB or smaller.";

	if (isFile(licensePhoto)) {
		if (!PHOTO_EXT_RE.test(licensePhoto.name))
			errors.license_photo = "License photo must be an image or PDF.";
		else if (licensePhoto.size > MAX_UPLOAD_BYTES)
			errors.license_photo = "License photo must be 10 MB or smaller.";
	}

	if (portfolioLink && portfolioLink.length > 200)
		errors.portfolio_link = "Portfolio link is too long.";

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
		await ensureApplicationsSchema(db);
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
