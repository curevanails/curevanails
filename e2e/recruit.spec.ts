import { expect, type Page, test } from "@playwright/test";

/**
 * End-to-end coverage for the nail-technician application form at `/recruit`
 * and its intake endpoint `POST /api/recruit`.
 *
 * The goal is applicant-safety: every realistic path a candidate can take —
 * a clean submission, each missing required field, a bad email, multi-select
 * choices, optional attachments, and backend/network failures — is exercised
 * so a real client never hits a dead end or an uncaught error.
 *
 * Tests that assert real persistence hit the live local API (and are cleaned
 * up by e2e/global-teardown.ts). Failure-mode tests stub the response with
 * route interception so they neither depend on nor pollute the database.
 */

const RESUME_BUFFER = Buffer.from("%PDF-1.4\nCureVa E2E test resume\n%%EOF\n");

const RESUME_FILE = {
	name: "resume.pdf",
	mimeType: "application/pdf",
	buffer: RESUME_BUFFER,
};

/** A date `days` from now as YYYY-MM-DD (negative = in the past). */
function offsetDate(days: number): string {
	return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
const FUTURE_START = offsetDate(14);
const FUTURE_EXPIRY = offsetDate(365);
const PAST_DATE = offsetDate(-30);

/**
 * The date fields are enhanced by flatpickr (altInput hides the real input),
 * so we drive them through the flatpickr instance — which syncs the underlying
 * `name=` input to the machine value the form submits and validation reads.
 */
async function setDate(page: Page, id: string, value: string): Promise<void> {
	await page.evaluate(
		({ id, value }) => {
			const el = document.getElementById(id) as
				| (HTMLInputElement & { _flatpickr?: { setDate: (v: string, fire: boolean) => void } })
				| null;
			if (el?._flatpickr) el._flatpickr.setDate(value, true);
			else if (el) {
				el.value = value;
				el.dispatchEvent(new Event("change", { bubbles: true }));
			}
		},
		{ id, value },
	);
}

/** Force a raw value onto the hidden input, bypassing the picker's min-date UI. */
async function forceRawDate(page: Page, id: string, value: string): Promise<void> {
	await page.evaluate(
		({ id, value }) => {
			const el = document.getElementById(id) as HTMLInputElement | null;
			if (el) el.value = value;
		},
		{ id, value },
	);
}

const LICENSE_PHOTO = {
	name: "license.png",
	mimeType: "image/png",
	// 1x1 transparent PNG
	buffer: Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
		"base64",
	),
};

/** Every required text/select field, keyed by the id (= field name). */
const REQUIRED_INPUT_FIELDS = [
	"full_name",
	"phone",
	"email",
	"city",
	"dopl_license_number",
	"license_expiration",
	"start_date",
	"english_proficiency",
] as const;

/** Required checkbox/radio groups (validated by their `data-group`). */
const REQUIRED_GROUPS = [
	"license_types",
	"work_authorized",
	"days_available",
	"employment_type",
] as const;

type SkipKey =
	| (typeof REQUIRED_INPUT_FIELDS)[number]
	| (typeof REQUIRED_GROUPS)[number]
	| "skills"
	| "resume"
	| "portfolio_link"
	| "license_photo";

/**
 * Fill the form with a valid application. Pass `skip` to leave specific
 * fields/groups blank (used to prove each one is independently required).
 */
async function fillValidApplication(
	page: Page,
	opts: { skip?: SkipKey[] } = {},
): Promise<void> {
	const skip = new Set(opts.skip ?? []);
	const want = (k: SkipKey) => !skip.has(k);

	if (want("full_name")) await page.fill("#full_name", "E2E Jane Doe");
	if (want("phone")) await page.fill("#phone", "8015550100");
	if (want("email"))
		await page.fill("#email", `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
	if (want("city")) await page.fill("#city", "Salt Lake City");

	if (want("license_types"))
		await page.check('input[name="license_types"][value="nail_tech"]');
	if (want("dopl_license_number"))
		await page.fill("#dopl_license_number", "1234567-5501");
	if (want("license_expiration"))
		await setDate(page, "license_expiration", FUTURE_EXPIRY);
	if (want("work_authorized"))
		await page.check('input[name="work_authorized"][value="yes"]');

	if (want("skills"))
		await page.check('input[name="skills"][value="gel_shellac"]');
	if (want("english_proficiency"))
		await page.selectOption("#english_proficiency", "fluent");

	if (want("employment_type"))
		await page.check('input[name="employment_type"][value="full_time"]');
	// Day checkboxes are visually hidden; click the wrapping label like a user.
	if (want("days_available")) {
		await page.locator('label:has(input[value="monday"])').click();
		await page.locator('label:has(input[value="friday"])').click();
	}
	if (want("start_date")) await setDate(page, "start_date", FUTURE_START);

	if (want("portfolio_link")) await page.fill("#portfolio_link", "@janedoenails");
	if (want("license_photo"))
		await page.locator("#license_photo").setInputFiles(LICENSE_PHOTO);
	if (want("resume")) await page.locator("#resume-input").setInputFiles(RESUME_FILE);
}

async function submit(page: Page): Promise<void> {
	await page.locator("#submit-btn").click();
}

// Guard: no test may produce an uncaught client-side JS error.
let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
	pageErrors = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));
	await page.goto("/recruit");
	await expect(page.locator("#recruit-form")).toBeVisible();
});

test.afterEach(() => {
	expect(
		pageErrors,
		`uncaught page errors: ${pageErrors.join("; ")}`,
	).toEqual([]);
});

test.describe("validation — required fields", () => {
	test("empty submit flags fields and does not navigate or succeed", async ({
		page,
	}) => {
		const url = page.url();
		await submit(page);

		await expect(page.locator("#success-panel")).toBeHidden();
		await expect(page.locator("#form-error")).toBeVisible();
		await expect(page.locator("#full_name")).toHaveClass(/field-error/);
		await expect(
			page.locator('[data-group="license_types"] .error-msg'),
		).toBeVisible();
		await expect(page.locator('[data-group="resume"] .error-msg')).toBeVisible();
		expect(page.url()).toBe(url); // native POST was prevented
	});

	for (const field of REQUIRED_INPUT_FIELDS) {
		test(`missing "${field}" alone blocks submission`, async ({ page }) => {
			await fillValidApplication(page, { skip: [field] });
			await submit(page);

			await expect(page.locator(`#${field}`)).toHaveClass(/field-error/);
			await expect(page.locator("#success-panel")).toBeHidden();
		});
	}

	for (const group of REQUIRED_GROUPS) {
		test(`missing "${group}" group blocks submission`, async ({ page }) => {
			await fillValidApplication(page, { skip: [group] });
			await submit(page);

			await expect(
				page.locator(`[data-group="${group}"] .error-msg`),
			).toBeVisible();
			await expect(page.locator("#success-panel")).toBeHidden();
		});
	}

	test("missing resume blocks submission and flags the drop zone", async ({
		page,
	}) => {
		await fillValidApplication(page, { skip: ["resume"] });
		await submit(page);

		await expect(page.locator("#drop-zone")).toHaveClass(/field-error/);
		await expect(page.locator('[data-group="resume"] .error-msg')).toBeVisible();
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("invalid email is flagged and not submitted", async ({ page }) => {
		await fillValidApplication(page);
		await page.fill("#email", "not-an-email");
		await submit(page);

		await expect(page.locator("#email")).toHaveClass(/field-error/);
		await expect(page.locator("#form-error")).toBeVisible();
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("fixing errors after a failed submit clears them and succeeds", async ({
		page,
	}) => {
		await submit(page); // empty -> errors
		await expect(page.locator("#form-error")).toBeVisible();

		await fillValidApplication(page);
		await submit(page);

		await expect(page.locator("#success-panel")).toBeVisible();
		await expect(page.locator("#form-error")).toBeHidden();
		await expect(page.locator(".error-msg")).toHaveCount(0);
		await expect(page.locator(".field-error")).toHaveCount(0);
	});
});

test.describe("form interactions", () => {
	test("selected resume filename is shown in the drop zone", async ({ page }) => {
		await page.locator("#resume-input").setInputFiles(RESUME_FILE);
		await expect(page.locator("#drop-title")).toHaveText(RESUME_FILE.name);
	});

	test("multiple licenses, skills and days can be selected together", async ({
		page,
	}) => {
		await page.check('input[name="license_types"][value="nail_tech"]');
		await page.check('input[name="license_types"][value="cosmetologist_barber"]');
		await page.check('input[name="license_types"][value="other"]');
		await page.check('input[name="skills"][value="gel_shellac"]');
		await page.check('input[name="skills"][value="acrylic_full_set"]');
		await page.locator('label:has(input[value="monday"])').click();
		await page.locator('label:has(input[value="saturday"])').click();

		await expect(
			page.locator('input[name="license_types"]:checked'),
		).toHaveCount(3);
		await expect(page.locator('input[name="skills"]:checked')).toHaveCount(2);
		await expect(
			page.locator('input[name="days_available"]:checked'),
		).toHaveCount(2);
	});
});

test.describe("submission — happy paths (real API)", () => {
	test("complete application persists and shows confirmation", async ({
		page,
	}) => {
		await fillValidApplication(page);

		const [response] = await Promise.all([
			page.waitForResponse(
				(r) =>
					r.url().endsWith("/api/recruit") && r.request().method() === "POST",
			),
			submit(page),
		]);

		expect(response.status()).toBe(200);
		const body = (await response.json()) as { ok: boolean; id?: string };
		expect(body.ok).toBe(true);
		expect(body.id).toBeTruthy();

		await expect(page.locator("#success-panel")).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Application Received!" }),
		).toBeVisible();
		await expect(page.locator("#recruit-form")).toBeHidden();
	});

	test("succeeds with optional fields omitted", async ({ page }) => {
		await fillValidApplication(page, {
			skip: ["portfolio_link", "license_photo"],
		});

		const [response] = await Promise.all([
			page.waitForResponse((r) => r.url().endsWith("/api/recruit")),
			submit(page),
		]);

		expect(response.status()).toBe(200);
		await expect(page.locator("#success-panel")).toBeVisible();
	});

	test("succeeds with an optional license photo attached", async ({ page }) => {
		await fillValidApplication(page, { skip: ["portfolio_link"] });
		// license photo is included by fillValidApplication's default

		const [response] = await Promise.all([
			page.waitForResponse((r) => r.url().endsWith("/api/recruit")),
			submit(page),
		]);

		expect(response.status()).toBe(200);
		await expect(page.locator("#success-panel")).toBeVisible();
	});
});

test.describe("resilience — backend & network failures", () => {
	test("shows a friendly message and keeps the form on a server 500", async ({
		page,
	}) => {
		await page.route("**/api/recruit", (route) =>
			route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({ ok: false, error: "Failed to save application." }),
			}),
		);

		await fillValidApplication(page);
		await submit(page);

		await expect(page.locator("#form-error")).toBeVisible();
		await expect(page.locator("#form-error-text")).toContainText(
			"Failed to save application.",
		);
		await expect(page.locator("#recruit-form")).toBeVisible();
		await expect(page.locator("#success-panel")).toBeHidden();
		// Button is re-enabled so the applicant can retry.
		await expect(page.locator("#submit-btn")).toBeEnabled();
	});

	test("maps server-side field errors back onto the form", async ({ page }) => {
		await page.route("**/api/recruit", (route) =>
			route.fulfill({
				status: 400,
				contentType: "application/json",
				body: JSON.stringify({
					ok: false,
					errors: {
						dopl_license_number: "Invalid DOPL number.",
						license_types: "Select at least one license type.",
					},
				}),
			}),
		);

		await fillValidApplication(page);
		await submit(page);

		await expect(page.locator("#dopl_license_number")).toHaveClass(
			/field-error/,
		);
		await expect(
			page.locator('[data-group="license_types"] .error-msg'),
		).toBeVisible();
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("shows a network-error message when the request fails", async ({
		page,
	}) => {
		await page.route("**/api/recruit", (route) => route.abort());

		await fillValidApplication(page);
		await submit(page);

		await expect(page.locator("#form-error")).toBeVisible();
		await expect(page.locator("#form-error-text")).toContainText(
			"Network error",
		);
		await expect(page.locator("#recruit-form")).toBeVisible();
		await expect(page.locator("#submit-btn")).toBeEnabled();
	});

	test("disables the button while submitting to prevent double submits", async ({
		page,
	}) => {
		await page.route("**/api/recruit", async (route) => {
			await new Promise((r) => setTimeout(r, 800));
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ ok: true, id: "stub-id" }),
			});
		});

		await fillValidApplication(page);
		await submit(page); // do not await the whole flow

		// Mid-flight: button is disabled and shows progress text.
		await expect(page.locator("#submit-btn")).toBeDisabled();
		await expect(page.locator("#submit-btn")).toContainText("Submitting");

		// Then it completes.
		await expect(page.locator("#success-panel")).toBeVisible();
	});
});

test.describe("validation — field data rules", () => {
	test("rejects a name containing numbers", async ({ page }) => {
		await fillValidApplication(page);
		await page.fill("#full_name", "Jane2 Doe");
		await submit(page);

		await expect(page.locator("#full_name")).toHaveClass(/field-error/);
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("rejects a phone number containing letters", async ({ page }) => {
		await fillValidApplication(page);
		await page.fill("#phone", "801-CALL-NOW");
		await submit(page);

		await expect(page.locator("#phone")).toHaveClass(/field-error/);
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("rejects a phone number that is too short", async ({ page }) => {
		await fillValidApplication(page);
		await page.fill("#phone", "12345");
		await submit(page);

		await expect(page.locator("#phone")).toHaveClass(/field-error/);
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("rejects a city containing numbers", async ({ page }) => {
		await fillValidApplication(page);
		await page.fill("#city", "Provo 84601");
		await submit(page);

		await expect(page.locator("#city")).toHaveClass(/field-error/);
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("rejects a malformed DOPL license number", async ({ page }) => {
		await fillValidApplication(page);
		await page.fill("#dopl_license_number", "12345");
		await submit(page);

		await expect(page.locator("#dopl_license_number")).toHaveClass(
			/field-error/,
		);
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("the date pickers block past dates (min = today)", async ({ page }) => {
		const today = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
		await expect(page.locator("#license_expiration")).toHaveAttribute(
			"min",
			todayStr,
		);
		await expect(page.locator("#start_date")).toHaveAttribute("min", todayStr);
	});

	test("rejects a past license expiration that slips past the picker", async ({
		page,
	}) => {
		await fillValidApplication(page);
		await forceRawDate(page, "license_expiration", PAST_DATE);
		await submit(page);

		await expect(page.locator("#license_expiration")).toHaveClass(
			/field-error/,
		);
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("rejects a past start date that slips past the picker", async ({
		page,
	}) => {
		await fillValidApplication(page);
		await forceRawDate(page, "start_date", PAST_DATE);
		await submit(page);

		await expect(page.locator("#start_date")).toHaveClass(/field-error/);
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("rejects a resume with the wrong file type", async ({ page }) => {
		await fillValidApplication(page, { skip: ["resume"] });
		await page.locator("#resume-input").setInputFiles({
			name: "resume.txt",
			mimeType: "text/plain",
			buffer: Buffer.from("not a real resume"),
		});
		await submit(page);

		await expect(page.locator("#drop-zone")).toHaveClass(/field-error/);
		await expect(page.locator('[data-group="resume"] .error-msg')).toBeVisible();
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("rejects a resume larger than 10 MB", async ({ page }) => {
		await fillValidApplication(page, { skip: ["resume"] });
		await page.locator("#resume-input").setInputFiles({
			name: "huge.pdf",
			mimeType: "application/pdf",
			buffer: Buffer.alloc(11 * 1024 * 1024, 0),
		});
		await submit(page);

		await expect(page.locator("#drop-zone")).toHaveClass(/field-error/);
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("rejects an invalid license-photo file type", async ({ page }) => {
		await fillValidApplication(page, { skip: ["license_photo"] });
		await page.locator("#license_photo").setInputFiles({
			name: "notes.txt",
			mimeType: "text/plain",
			buffer: Buffer.from("not an image"),
		});
		await submit(page);

		await expect(page.locator("#license_photo")).toHaveClass(/field-error/);
		await expect(page.locator("#success-panel")).toBeHidden();
	});
});

/**
 * Server-side validation, exercised directly against POST /api/recruit with
 * the API request fixture (no browser, so the client guard is bypassed). This
 * proves the backend independently rejects bad data.
 */
test.describe("API validation (server-side)", () => {
	function validMultipart(): Record<
		string,
		string | { name: string; mimeType: string; buffer: Buffer }
	> {
		return {
			full_name: "Api Jane",
			phone: "8015550100",
			email: `e2e+api-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
			city: "Provo",
			license_types: "nail_tech",
			dopl_license_number: "1234567-5501",
			license_expiration: FUTURE_EXPIRY,
			work_authorized: "yes",
			english_proficiency: "fluent",
			employment_type: "full_time",
			days_available: "monday",
			start_date: FUTURE_START,
			resume: {
				name: "resume.pdf",
				mimeType: "application/pdf",
				buffer: RESUME_BUFFER,
			},
		};
	}

	test("accepts a valid multipart submission", async ({ request }) => {
		const res = await request.post("/api/recruit", {
			multipart: validMultipart(),
		});
		expect(res.status()).toBe(200);
		expect((await res.json()).ok).toBe(true);
	});

	test("rejects an empty submission with field errors", async ({ request }) => {
		const res = await request.post("/api/recruit", { multipart: {} });
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(Object.keys(body.errors)).toEqual(
			expect.arrayContaining([
				"full_name",
				"phone",
				"email",
				"city",
				"license_types",
				"dopl_license_number",
				"license_expiration",
				"work_authorized",
				"english_proficiency",
				"employment_type",
				"days_available",
				"start_date",
				"resume",
			]),
		);
	});

	const badCases: Array<[string, Record<string, string>, string]> = [
		["a name with numbers", { full_name: "Jane2" }, "full_name"],
		["a phone with letters", { phone: "801-CALL-NOW" }, "phone"],
		["a short phone", { phone: "12345" }, "phone"],
		["a city with numbers", { city: "Provo 84601" }, "city"],
		["a bad email", { email: "nope" }, "email"],
		["a malformed DOPL number", { dopl_license_number: "12345" }, "dopl_license_number"],
		["a past expiration", { license_expiration: PAST_DATE }, "license_expiration"],
		["a past start date", { start_date: PAST_DATE }, "start_date"],
		["an unknown english level", { english_proficiency: "wizard" }, "english_proficiency"],
	];

	for (const [label, override, expectedKey] of badCases) {
		test(`rejects ${label}`, async ({ request }) => {
			const res = await request.post("/api/recruit", {
				multipart: { ...validMultipart(), ...override },
			});
			expect(res.status()).toBe(400);
			const body = await res.json();
			expect(body.errors).toHaveProperty(expectedKey);
		});
	}

	test("rejects a resume with the wrong type", async ({ request }) => {
		const res = await request.post("/api/recruit", {
			multipart: {
				...validMultipart(),
				resume: {
					name: "resume.txt",
					mimeType: "text/plain",
					buffer: Buffer.from("nope"),
				},
			},
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).errors).toHaveProperty("resume");
	});
});
