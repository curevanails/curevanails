import { expect, test } from "@playwright/test";
import {
	APPLY_URL,
	E2E_SURNAME,
	RESUME_FILE,
	SELECTORS,
	e2eEmail,
	fillApplication,
	futureMonth,
	submitApplication,
} from "./helpers";

/**
 * End-to-end coverage for the Hiring Form at `/recruit/apply` and its intake
 * endpoint `POST /api/recruit`.
 *
 * The goal is applicant-safety: every realistic path a candidate can take — a
 * clean submission, each missing required field, bad data, optional attachments,
 * and backend/network failures — is exercised so a real applicant never hits a
 * dead end or an uncaught error.
 *
 * Tests that assert real persistence hit the live local API (rows carry the
 * surname E2E_SURNAME and are removed by e2e/global-teardown.ts). Failure-mode
 * tests stub the response with route interception, so they neither depend on nor
 * pollute the database.
 *
 * Required (per src/pages/api/recruit.ts): first_name, last_name, phone,
 * positions (>=1), current_status, background, employment_type.
 * Optional: email, graduation_date, resume, portfolio_link, why_cureva,
 * contact_consent.
 */

const REQUIRED_TEXT_FIELDS = ["first_name", "last_name", "phone"] as const;
const REQUIRED_GROUPS = [
	"positions",
	"current_status",
	"background",
	"employment_type",
] as const;

// Guard: no test may produce an uncaught client-side JS error.
let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
	pageErrors = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));
	await page.goto(APPLY_URL);
	await expect(page.locator(SELECTORS.form)).toBeVisible();
});

test.afterEach(() => {
	expect(pageErrors, `uncaught page errors: ${pageErrors.join("; ")}`).toEqual([]);
});

test.describe("validation — required fields", () => {
	test("empty submit flags fields and does not navigate or succeed", async ({ page }) => {
		const url = page.url();
		await submitApplication(page);

		await expect(page.locator(SELECTORS.done)).not.toHaveClass(/show/);
		await expect(page.locator(SELECTORS.alert)).toHaveClass(/bad/);
		await expect(page.locator("#first_name")).toHaveClass(/err/);
		await expect(page.locator(SELECTORS.group("positions"))).toHaveClass(/err/);
		expect(page.url()).toBe(url); // native POST was prevented
	});

	test("the alert counts the remaining problems", async ({ page }) => {
		await submitApplication(page);
		// 3 required text fields + 4 required groups, all empty.
		await expect(page.locator(SELECTORS.alert)).toContainText("7 remaining");
	});

	for (const field of REQUIRED_TEXT_FIELDS) {
		test(`missing "${field}" alone blocks submission`, async ({ page }) => {
			await fillApplication(page, { skip: [field] });
			await submitApplication(page);

			await expect(page.locator(`#${field}`)).toHaveClass(/err/);
			await expect(page.locator(SELECTORS.done)).not.toHaveClass(/show/);
		});
	}

	for (const group of REQUIRED_GROUPS) {
		test(`missing "${group}" group blocks submission`, async ({ page }) => {
			await fillApplication(page, { skip: [group] });
			await submitApplication(page);

			await expect(page.locator(SELECTORS.group(group))).toHaveClass(/err/);
			await expect(page.locator(SELECTORS.done)).not.toHaveClass(/show/);
		});
	}

	test("fixing errors after a failed submit clears them and succeeds", async ({ page }) => {
		await submitApplication(page); // empty -> errors
		await expect(page.locator(SELECTORS.alert)).toHaveClass(/bad/);

		await fillApplication(page);
		await submitApplication(page);

		await expect(page.locator(SELECTORS.done)).toHaveClass(/show/);
		await expect(page.locator(".err")).toHaveCount(0);
	});
});

test.describe("validation — field data rules", () => {
	const badCases: Array<[string, string, string]> = [
		["a first name containing numbers", "first_name", "Jane2"],
		["a last name containing numbers", "last_name", "Doe3"],
		["a phone containing letters", "phone", "801-CALL-NOW"],
		["a phone that is too short", "phone", "12345"],
		["a malformed email", "email", "not-an-email"],
		["a malformed graduation date", "graduation_date", "sometime-2027"],
	];

	for (const [label, field, value] of badCases) {
		test(`rejects ${label}`, async ({ page }) => {
			await fillApplication(page, { overrides: { [field]: value } });
			await submitApplication(page);

			await expect(page.locator(`#${field}`)).toHaveClass(/err/);
			await expect(page.locator(SELECTORS.done)).not.toHaveClass(/show/);
		});
	}

	test("accepts the MM/YYYY graduation fallback for browsers without month support", async ({
		page,
	}) => {
		await fillApplication(page, { overrides: { graduation_date: "05/2027" } });
		await submitApplication(page);

		await expect(page.locator("#graduation_date")).not.toHaveClass(/err/);
		await expect(page.locator(SELECTORS.done)).toHaveClass(/show/);
	});

	test("rejects a resume with the wrong file type", async ({ page }) => {
		await fillApplication(page, { skip: ["resume"] });
		await page.locator(SELECTORS.resumeInput).setInputFiles({
			name: "resume.txt",
			mimeType: "text/plain",
			buffer: Buffer.from("not a real resume"),
		});
		await submitApplication(page);

		await expect(page.locator(SELECTORS.drop)).toHaveClass(/err/);
		await expect(page.locator(SELECTORS.done)).not.toHaveClass(/show/);
	});

	test("rejects a resume larger than 10 MB", async ({ page }) => {
		await fillApplication(page, { skip: ["resume"] });
		await page.locator(SELECTORS.resumeInput).setInputFiles({
			name: "huge.pdf",
			mimeType: "application/pdf",
			buffer: Buffer.alloc(11 * 1024 * 1024, 0),
		});
		await submitApplication(page);

		await expect(page.locator(SELECTORS.drop)).toHaveClass(/err/);
		await expect(page.locator(SELECTORS.done)).not.toHaveClass(/show/);
	});
});

test.describe("form interactions", () => {
	test("the selected resume filename is shown in the drop zone", async ({ page }) => {
		await page.locator(SELECTORS.resumeInput).setInputFiles(RESUME_FILE);
		await expect(page.locator(SELECTORS.dropFile)).toHaveText(`✓ ${RESUME_FILE.name}`);
		await expect(page.locator(SELECTORS.drop)).toHaveClass(/filled/);
	});

	test("multiple positions can be selected together", async ({ page }) => {
		await page.click(SELECTORS.option("nail_technician"));
		await page.click(SELECTORS.option("esthetician"));
		await page.click(SELECTORS.option("open_to_multiple"));

		await expect(page.locator('input[name="positions"]:checked')).toHaveCount(3);
	});

	test("current_status is single-select (radio semantics)", async ({ page }) => {
		await page.click(SELECTORS.option("licensed_utah"));
		await page.click(SELECTORS.option("beauty_school"));

		await expect(page.locator('input[name="current_status"]:checked')).toHaveCount(1);
		await expect(page.locator('input[value="beauty_school"]')).toBeChecked();
	});

	test("editing a flagged field clears its error styling", async ({ page }) => {
		await submitApplication(page);
		await expect(page.locator("#first_name")).toHaveClass(/err/);

		await page.fill("#first_name", "Jane");
		await expect(page.locator("#first_name")).not.toHaveClass(/err/);
	});
});

test.describe("submission — happy paths (real API)", () => {
	test("a complete application persists and shows the confirmation", async ({ page }) => {
		await fillApplication(page);

		const [response] = await Promise.all([
			page.waitForResponse(
				(r) => r.url().endsWith("/api/recruit") && r.request().method() === "POST",
			),
			submitApplication(page),
		]);

		expect(response.status()).toBe(200);
		const body = (await response.json()) as { ok: boolean; id?: string };
		expect(body.ok).toBe(true);
		expect(body.id).toBeTruthy();

		await expect(page.locator(SELECTORS.done)).toHaveClass(/show/);
		await expect(page.locator(SELECTORS.doneName)).toHaveText("Jane");
		await expect(page.locator(SELECTORS.form)).toBeHidden();
	});

	test("succeeds with every optional field omitted", async ({ page }) => {
		await fillApplication(page, {
			skip: [
				"email",
				"graduation_date",
				"resume",
				"portfolio_link",
				"why_cureva",
				"contact_consent",
			],
		});

		const [response] = await Promise.all([
			page.waitForResponse((r) => r.url().endsWith("/api/recruit")),
			submitApplication(page),
		]);

		expect(response.status()).toBe(200);
		await expect(page.locator(SELECTORS.done)).toHaveClass(/show/);
	});

	test("succeeds with a portfolio link instead of a resume", async ({ page }) => {
		await fillApplication(page, { skip: ["resume"] });

		const [response] = await Promise.all([
			page.waitForResponse((r) => r.url().endsWith("/api/recruit")),
			submitApplication(page),
		]);

		expect(response.status()).toBe(200);
		await expect(page.locator(SELECTORS.done)).toHaveClass(/show/);
	});
});

test.describe("resilience — backend & network failures", () => {
	test("shows a friendly message and keeps the form on a server 500", async ({ page }) => {
		await page.route("**/api/recruit", (route) =>
			route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({ ok: false, error: "Failed to save application." }),
			}),
		);

		await fillApplication(page);
		await submitApplication(page);

		await expect(page.locator(SELECTORS.alert)).toContainText("Failed to save application.");
		await expect(page.locator(SELECTORS.form)).toBeVisible();
		await expect(page.locator(SELECTORS.done)).not.toHaveClass(/show/);
		// Button is restored so the applicant can retry.
		await expect(page.locator(SELECTORS.submit)).toBeEnabled();
		await expect(page.locator(SELECTORS.submit)).toHaveText("Submit Application");
	});

	test("maps server-side field errors back onto the form", async ({ page }) => {
		await page.route("**/api/recruit", (route) =>
			route.fulfill({
				status: 400,
				contentType: "application/json",
				body: JSON.stringify({
					ok: false,
					errors: {
						phone: "Enter a valid phone number (at least 10 digits).",
						positions: "Select at least one position.",
						resume: "Resume must be a PDF or Word document.",
					},
				}),
			}),
		);

		await fillApplication(page);
		await submitApplication(page);

		await expect(page.locator("#phone")).toHaveClass(/err/);
		await expect(page.locator(SELECTORS.group("positions"))).toHaveClass(/err/);
		await expect(page.locator(SELECTORS.drop)).toHaveClass(/err/);
		await expect(page.locator(SELECTORS.done)).not.toHaveClass(/show/);
	});

	test("shows a network-error message when the request fails", async ({ page }) => {
		await page.route("**/api/recruit", (route) => route.abort());

		await fillApplication(page);
		await submitApplication(page);

		await expect(page.locator(SELECTORS.alert)).toContainText("Network error");
		await expect(page.locator(SELECTORS.form)).toBeVisible();
		await expect(page.locator(SELECTORS.submit)).toBeEnabled();
	});

	test("disables the button while submitting to prevent double submits", async ({ page }) => {
		await page.route("**/api/recruit", async (route) => {
			await new Promise((r) => setTimeout(r, 800));
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ ok: true, id: "stub-id" }),
			});
		});

		await fillApplication(page);
		await submitApplication(page); // do not await the whole flow

		await expect(page.locator(SELECTORS.submit)).toBeDisabled();
		await expect(page.locator(SELECTORS.submit)).toContainText("Submitting");

		await expect(page.locator(SELECTORS.done)).toHaveClass(/show/);
	});
});

/**
 * Server-side validation, exercised directly against POST /api/recruit with the
 * API request fixture (no browser, so the client guard is bypassed). This proves
 * the backend independently rejects bad data — the client validator is a
 * convenience, not the security boundary.
 */
test.describe("API validation (server-side)", () => {
	function validMultipart(): Record<
		string,
		string | { name: string; mimeType: string; buffer: Buffer }
	> {
		return {
			first_name: "Api",
			last_name: E2E_SURNAME,
			email: e2eEmail(),
			phone: "8015550100",
			positions: "nail_technician",
			current_status: "licensed_utah",
			graduation_date: futureMonth(),
			background: "salon_experience",
			employment_type: "full_time",
			resume: RESUME_FILE,
		};
	}

	test("accepts a valid multipart submission", async ({ request }) => {
		const res = await request.post("/api/recruit", { multipart: validMultipart() });
		expect(res.status()).toBe(200);
		expect((await res.json()).ok).toBe(true);
	});

	test("rejects a non-multipart body", async ({ request }) => {
		const res = await request.post("/api/recruit", {
			data: "not a form",
			headers: { "content-type": "text/plain" },
		});
		expect(res.status()).toBe(400);
	});

	test("rejects an empty submission with every required field flagged", async ({ request }) => {
		const res = await request.post("/api/recruit", { multipart: {} });
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(Object.keys(body.errors)).toEqual(
			expect.arrayContaining([
				"first_name",
				"last_name",
				"phone",
				"positions",
				"current_status",
				"background",
				"employment_type",
			]),
		);
		// Optional fields must NOT be flagged when absent.
		expect(body.errors).not.toHaveProperty("email");
		expect(body.errors).not.toHaveProperty("resume");
		expect(body.errors).not.toHaveProperty("graduation_date");
	});

	const badCases: Array<[string, Record<string, string>, string]> = [
		["a first name with numbers", { first_name: "Jane2" }, "first_name"],
		["a last name with numbers", { last_name: "Doe3" }, "last_name"],
		["a phone with letters", { phone: "801-CALL-NOW" }, "phone"],
		["a short phone", { phone: "12345" }, "phone"],
		["an over-long phone", { phone: "12345678901234567" }, "phone"],
		["a bad email", { email: "nope" }, "email"],
		["an unknown current_status", { current_status: "wizard" }, "current_status"],
		["an unknown background", { background: "wizard" }, "background"],
		["an unknown employment_type", { employment_type: "wizard" }, "employment_type"],
		["a malformed graduation date", { graduation_date: "next spring" }, "graduation_date"],
	];

	for (const [label, override, expectedKey] of badCases) {
		test(`rejects ${label}`, async ({ request }) => {
			const res = await request.post("/api/recruit", {
				multipart: { ...validMultipart(), ...override },
			});
			expect(res.status()).toBe(400);
			expect((await res.json()).errors).toHaveProperty(expectedKey);
		});
	}

	test("rejects an unknown position value (not just a missing one)", async ({ request }) => {
		const res = await request.post("/api/recruit", {
			multipart: { ...validMultipart(), positions: "chief_wizard" },
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).errors).toHaveProperty("positions");
	});

	test("rejects a why_cureva answer over 1,000 characters", async ({ request }) => {
		const res = await request.post("/api/recruit", {
			multipart: { ...validMultipart(), why_cureva: "x".repeat(1001) },
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).errors).toHaveProperty("why_cureva");
	});

	test("rejects a portfolio_link over 200 characters", async ({ request }) => {
		const res = await request.post("/api/recruit", {
			multipart: { ...validMultipart(), portfolio_link: "x".repeat(201) },
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).errors).toHaveProperty("portfolio_link");
	});

	test("rejects a resume with the wrong type", async ({ request }) => {
		const res = await request.post("/api/recruit", {
			multipart: {
				...validMultipart(),
				resume: { name: "resume.txt", mimeType: "text/plain", buffer: Buffer.from("nope") },
			},
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).errors).toHaveProperty("resume");
	});

	test("normalises the MM/YYYY graduation fallback to YYYY-MM", async ({ request }) => {
		const res = await request.post("/api/recruit", {
			multipart: { ...validMultipart(), graduation_date: "5/2027" },
		});
		expect(res.status()).toBe(200);
	});
});
