import { expect, type Page, test } from "@playwright/test";

/**
 * End-to-end coverage for the nail-technician application form at `/recruit`
 * and its intake endpoint `POST /api/recruit`.
 *
 * The happy-path test drives the whole stack: filling the form, uploading a
 * résumé, and asserting the API returns `{ ok: true, id }` (which only happens
 * after the row is written to D1 and files land in R2) plus the success panel.
 */

const RESUME_FILE = {
	name: "resume.pdf",
	mimeType: "application/pdf",
	buffer: Buffer.from("%PDF-1.4\nCureVa E2E test résumé\n%%EOF\n"),
};

/** Fill every required field with a valid value (plus optional ones). */
async function fillValidApplication(page: Page): Promise<void> {
	await page.fill("#full_name", "E2E Jane Doe");
	await page.fill("#phone", "8015550100");
	await page.fill("#email", `e2e+${Date.now()}@example.com`);
	await page.fill("#city", "Salt Lake City");

	await page.check('input[name="license_types"][value="nail_tech"]');
	await page.fill("#dopl_license_number", "1234567-5501");
	await page.fill("#license_expiration", "2027-05-01");
	await page.check('input[name="work_authorized"][value="yes"]');

	await page.check('input[name="skills"][value="gel_shellac"]');
	await page.check('input[name="skills"][value="manicure_pedicure"]');
	await page.selectOption("#english_proficiency", "fluent");

	await page.check('input[name="employment_type"][value="full_time"]');
	// The day checkboxes are visually hidden (styled via the wrapping label),
	// so click the label rather than the input — mirrors a real user.
	await page.locator('label:has(input[value="monday"])').click();
	await page.locator('label:has(input[value="friday"])').click();
	await page.fill("#start_date", "2026-07-01");

	await page.fill("#portfolio_link", "@janedoenails");
	await page.locator("#resume-input").setInputFiles(RESUME_FILE);
}

test.describe("Recruit application form", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/recruit");
		await expect(page.locator("#recruit-form")).toBeVisible();
	});

	test("blocks submission and flags required fields when empty", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "Submit Application" }).click();

		// No request should have succeeded into the success panel.
		await expect(page.locator("#success-panel")).toBeHidden();
		await expect(page.locator("#form-error")).toBeVisible();

		// A required text field is flagged, and a checkbox group shows its message.
		await expect(page.locator("#full_name")).toHaveClass(/field-error/);
		await expect(
			page.locator('[data-group="license_types"] .error-msg'),
		).toBeVisible();
	});

	test("flags an invalid email and does not submit", async ({ page }) => {
		await fillValidApplication(page);
		await page.fill("#email", "not-an-email");

		await page.getByRole("button", { name: "Submit Application" }).click();

		await expect(page.locator("#form-error")).toBeVisible();
		await expect(page.locator("#email")).toHaveClass(/field-error/);
		await expect(page.locator("#success-panel")).toBeHidden();
	});

	test("submits a complete application and persists it", async ({ page }) => {
		await fillValidApplication(page);

		const [response] = await Promise.all([
			page.waitForResponse(
				(r) =>
					r.url().endsWith("/api/recruit") && r.request().method() === "POST",
			),
			page.getByRole("button", { name: "Submit Application" }).click(),
		]);

		// A 200 + { ok: true, id } means the D1 insert and R2 uploads succeeded.
		expect(response.status()).toBe(200);
		const body = (await response.json()) as { ok: boolean; id?: string };
		expect(body.ok).toBe(true);
		expect(body.id).toBeTruthy();

		// The form is swapped for the confirmation panel.
		await expect(page.locator("#success-panel")).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Application Received!" }),
		).toBeVisible();
		await expect(page.locator("#recruit-form")).toBeHidden();
	});
});
