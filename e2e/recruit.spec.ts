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

const RESUME_FILE = {
	name: "resume.pdf",
	mimeType: "application/pdf",
	buffer: Buffer.from("%PDF-1.4\nCureVa E2E test resume\n%%EOF\n"),
};

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
		await page.fill("#license_expiration", "2027-05-01");
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
	if (want("start_date")) await page.fill("#start_date", "2026-07-01");

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
