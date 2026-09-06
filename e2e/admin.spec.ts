import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_SURNAME, RESUME_FILE, devVar, e2eEmail, futureMonth } from "./helpers";
import { fmtPhone } from "../src/utils/recruit-format";

/**
 * End-to-end coverage for the admin console — the widget dashboard (`/admin`),
 * the recruit pipeline that holds the applications list (`/admin/recruit`), the
 * auth gate (src/middleware.ts), and the endpoints the pipeline drives:
 * `/admin/file` (R2 resume download) and `/admin/update` (status + notes).
 *
 * The dashboard holds applicant PII, so the auth boundary is tested as
 * carefully as the happy path: every admin path must redirect to the login form
 * without a valid signed session cookie.
 *
 * Credentials come from `.dev.vars` (gitignored), which Miniflare loads into the
 * previewed Worker; `process.env` takes precedence so CI can inject them. When
 * neither is set the whole file skips rather than fails — the admin area
 * returns 404 with no ADMIN_PASSWORD, so there would be nothing to test.
 */

const ADMIN_USERNAME = devVar("ADMIN_USERNAME") || "admin";
const ADMIN_PASSWORD = devVar("ADMIN_PASSWORD");

test.skip(
	!ADMIN_PASSWORD,
	"ADMIN_PASSWORD is not set (.dev.vars or env) — the admin area is disabled.",
);

/** Submit a real application so the dashboard has a row to render. */
async function seedApplication(
	request: APIRequestContext,
	overrides: Record<string, string> = {},
): Promise<{ id: string; firstName: string; phone: string }> {
	// Letters only — the recruit endpoint rejects names containing digits.
	const rand = Math.random()
		.toString(36)
		.replace(/[^a-z]/g, "")
		.padEnd(6, "x")
		.slice(0, 6);
	const firstName = `Seed${rand}`;
	const phone = "8015550100";
	const res = await request.post("/api/recruit", {
		multipart: {
			first_name: firstName,
			last_name: E2E_SURNAME,
			email: e2eEmail(),
			phone,
			positions: "nail_technician",
			current_status: "licensed_utah",
			graduation_date: futureMonth(),
			background: "salon_experience",
			employment_type: "full_time",
			why_cureva: "Seeded by the admin E2E spec.",
			resume: RESUME_FILE,
			...overrides,
		},
	});
	expect(res.status()).toBe(200);
	const body = await res.json();
	return { id: body.id as string, firstName, phone };
}

async function login(page: Page): Promise<void> {
	await page.goto("/admin/login");
	await page.fill('input[name="username"]', ADMIN_USERNAME);
	await page.fill('input[name="password"]', ADMIN_PASSWORD as string);
	await Promise.all([
		page.waitForURL("**/admin"),
		page.click('button[type="submit"]'),
	]);
}

/** Sign in and open the applications list, where every row-level test runs. */
async function loginToRecruit(page: Page): Promise<void> {
	await login(page);
	await page.goto("/admin/recruit");
}

test.describe("auth gate", () => {
	test("unauthenticated /admin redirects to the login form", async ({ page }) => {
		await page.goto("/admin");
		await expect(page).toHaveURL(/\/admin\/login$/);
		await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
	});

	test("the login page is not indexable", async ({ page }) => {
		await page.goto("/admin/login");
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
			"content",
			"noindex, nofollow",
		);
	});

	for (const path of ["/admin", "/admin/recruit", "/admin/waitlist", "/admin/mail"]) {
		test(`unauthenticated ${path} is not served`, async ({ request }) => {
			const res = await request.get(path, { maxRedirects: 0 });
			expect(res.status()).toBe(302);
			expect(res.headers().location).toBe("/admin/login");
		});
	}

	test("unauthenticated /api/email/send is gated (admin-only)", async ({ request }) => {
		const res = await request.post("/api/email/send", {
			data: { templateId: "x", audience: "all" },
			maxRedirects: 0,
		});
		expect(res.status()).toBe(302);
		expect(res.headers().location).toBe("/admin/login");
	});

	test("unauthenticated /admin/file does not stream uploads", async ({ request }) => {
		const res = await request.get("/admin/file?key=recruit/whatever/resume/x.pdf", {
			maxRedirects: 0,
		});
		expect(res.status()).toBe(302);
	});

	test("unauthenticated /admin/update cannot mutate an application", async ({ request }) => {
		const res = await request.post("/admin/update", {
			data: { id: "any", status: "deal" },
			maxRedirects: 0,
		});
		expect(res.status()).toBe(302);
	});

	test("wrong credentials are rejected and stay on the login form", async ({ page }) => {
		await page.goto("/admin/login");
		await page.fill('input[name="username"]', ADMIN_USERNAME);
		await page.fill('input[name="password"]', "definitely-not-the-password");
		await page.click('button[type="submit"]');

		await expect(page).toHaveURL(/\/admin\/login$/);
		await expect(page.locator("form")).toBeVisible();
		await expect(page.getByText(/invalid|incorrect|try again/i).first()).toBeVisible();
	});

	test("a forged session cookie is rejected", async ({ page, context }) => {
		// Establish the origin first so the cookie has a concrete URL to bind to.
		await page.goto("/admin/login");
		await context.addCookies([
			{
				name: "cureva_admin_session",
				// Far-future expiry, bogus signature.
				value: `${Date.now() + 86_400_000}.not-a-real-signature`,
				url: page.url(),
			},
		]);
		await page.goto("/admin");
		await expect(page).toHaveURL(/\/admin\/login$/);
	});

	test("valid credentials sign in, and logout ends the session", async ({ page }) => {
		await login(page);
		await expect(page).toHaveURL(/\/admin$/);

		await page.goto("/admin/logout");
		await page.goto("/admin");
		await expect(page).toHaveURL(/\/admin\/login$/);
	});
});

test.describe("dashboard (widgets)", () => {
	test("the dashboard shows widgets and links on to the lists", async ({ page, request }) => {
		await seedApplication(request);
		await login(page);

		await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "Recruit pipeline" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "Latest applications" })).toBeVisible();
		// Widgets only — the applications TABLE lives on /admin/recruit.
		await expect(page.locator("#apps-table")).toHaveCount(0);
		await expect(page.locator('a[href="/admin/recruit"]').first()).toBeVisible();
	});

	test("a dashboard link opens the recruit pipeline", async ({ page }) => {
		await login(page);
		await page.locator('a[href="/admin/recruit"]').first().click();
		await expect(page).toHaveURL(/\/admin\/recruit$/);
		await expect(page.locator("#apps-table")).toBeVisible();
	});
});

test.describe("recruit pipeline", () => {
	test("a submitted application appears with its details", async ({ page, request }) => {
		const { firstName, phone } = await seedApplication(request);
		await loginToRecruit(page);

		const row = page.locator(`.app-group[data-search*="${firstName.toLowerCase()}"]`);
		await expect(row).toHaveCount(1);
		await expect(row).toContainText(`${firstName} ${E2E_SURNAME}`);
		// Phone is normalised for display — "8015550100" renders as "(801) 555-0100".
		await expect(row).toContainText(fmtPhone(phone));
		await expect(row).toHaveAttribute("data-employment", "full_time");
		await expect(row).toHaveAttribute("data-cstatus", "licensed_utah");
		await expect(row).toHaveAttribute("data-positions", "nail_technician");
	});

	test("expanding a row reveals the full application", async ({ page, request }) => {
		const { firstName } = await seedApplication(request);
		await loginToRecruit(page);

		const row = page.locator(`.app-group[data-search*="${firstName.toLowerCase()}"]`);
		await row.locator(".app-main").click();

		await expect(row).toContainText("Seeded by the admin E2E spec.");
		await expect(row.locator('a[href^="/admin/file?key="]')).toBeVisible();
	});

	test("search narrows the table to the matching applicant", async ({ page, request }) => {
		const { firstName } = await seedApplication(request);
		await loginToRecruit(page);

		await page.fill("#f-search", firstName);

		const visibleRows = page.locator(".app-group:visible");
		await expect(visibleRows).toHaveCount(1);
		await expect(visibleRows.first()).toContainText(firstName);
	});

	test("search for a term with no matches empties the table", async ({ page }) => {
		await loginToRecruit(page);
		await page.fill("#f-search", "zzz-no-such-applicant-zzz");

		await expect(page.locator(".app-group:visible")).toHaveCount(0);
		await expect(page.locator("#result-count")).toHaveText("0");
	});
});

test.describe("resume download (/admin/file)", () => {
	test("streams the uploaded resume back as an attachment", async ({ page, request }) => {
		const { firstName } = await seedApplication(request);
		await loginToRecruit(page);

		const row = page.locator(`.app-group[data-search*="${firstName.toLowerCase()}"]`);
		await row.locator(".app-main").click();
		const href = await row.locator('a[href^="/admin/file?key="]').getAttribute("href");
		expect(href).toBeTruthy();

		const res = await page.request.get(href as string);
		expect(res.status()).toBe(200);
		expect(res.headers()["content-disposition"]).toContain("attachment");
		expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
	});

	test("refuses keys outside the recruit/ prefix", async ({ page }) => {
		await login(page);
		const res = await page.request.get("/admin/file?key=secrets/private.pdf");
		expect(res.status()).toBe(403);
	});

	test("refuses path traversal", async ({ page }) => {
		await login(page);
		const res = await page.request.get("/admin/file?key=recruit/../secrets/private.pdf");
		expect(res.status()).toBe(403);
	});

	test("returns 404 for a well-formed key with no object", async ({ page }) => {
		await login(page);
		const res = await page.request.get("/admin/file?key=recruit/none/resume/none.pdf");
		expect(res.status()).toBe(404);
	});
});

test.describe("status & notes (/admin/update)", () => {
	test("a status change persists across a reload", async ({ page, request }) => {
		const { id, firstName } = await seedApplication(request);
		await loginToRecruit(page);

		const select = page.locator(`select.status-select[data-id="${id}"]`);
		await expect(select).toHaveValue("new");
		await select.selectOption("contacted");

		await page.waitForResponse(
			(r) => r.url().endsWith("/admin/update") && r.request().method() === "POST",
		);

		await page.reload();
		await expect(page.locator(`select.status-select[data-id="${id}"]`)).toHaveValue(
			"contacted",
		);
		// The row's filter attribute tracks the new status too.
		await expect(
			page.locator(`.app-group[data-search*="${firstName.toLowerCase()}"]`),
		).toHaveAttribute("data-status", "contacted");
	});

	test("recruiter notes persist across a reload", async ({ page, request }) => {
		const { id } = await seedApplication(request);
		await loginToRecruit(page);

		const row = page.locator(`.app-group:has(select[data-id="${id}"])`);
		await row.locator(".app-main").click();

		const notes = page.locator(`textarea[data-id="${id}"]`);
		await notes.fill("Strong portfolio — schedule a call.");
		await notes.blur();

		await page.waitForResponse(
			(r) => r.url().endsWith("/admin/update") && r.request().method() === "POST",
		);

		await page.reload();
		await page
			.locator(`.app-group:has(select[data-id="${id}"]) .app-main`)
			.click();
		await expect(page.locator(`textarea[data-id="${id}"]`)).toHaveValue(
			"Strong portfolio — schedule a call.",
		);
	});

	test("rejects an unknown status value", async ({ page, request }) => {
		const { id } = await seedApplication(request);
		await login(page);

		const res = await page.request.post("/admin/update", {
			data: { id, status: "chief_wizard" },
		});
		expect(res.status()).toBe(400);
	});

	test("rejects a request with no id", async ({ page }) => {
		await login(page);
		const res = await page.request.post("/admin/update", { data: { status: "deal" } });
		expect(res.status()).toBe(400);
	});

	test("rejects a non-JSON body", async ({ page }) => {
		await login(page);
		const res = await page.request.post("/admin/update", {
			data: "not json",
			headers: { "content-type": "text/plain" },
		});
		expect(res.status()).toBe(400);
	});
});

test.describe("email dashboard (folded in from notify)", () => {
	test("signed-in admin reaches the email dashboard at /admin/mail", async ({ page }) => {
		await login(page);
		await page.goto("/admin/mail");
		// The dashboard home is Compose (not a 404 / redirect back to login).
		await expect(page.getByRole("heading", { name: "Compose", exact: true })).toBeVisible();
		await expect(page).toHaveURL(/\/admin\/mail$/);
	});

	test("dashboard nav links are prefixed for the /admin/mail mount", async ({ page }) => {
		await login(page);
		await page.goto("/admin/mail");
		// Base-aware links (src/utils/email-nav.ts) must point under /admin/mail,
		// not at the notify Worker's root, so navigation stays in the admin session.
		for (const sub of ["campaigns", "templates", "analytics", "activity", "suppressed", "recruit-alerts", "settings"]) {
			await expect(page.locator(`a[href="/admin/mail/${sub}"]`).first()).toBeVisible();
		}
	});

	// Every sidebar item is its own page — each must resolve under the mount.
	for (const [sub, heading] of [
		["campaigns", "Campaigns"],
		["templates", "Templates"],
		["analytics", "Analytics"],
		["activity", "Activity"],
		["suppressed", "Suppressed"],
		["recruit-alerts", "Recruit alerts"],
		["settings", "Settings"],
	] as const) {
		test(`the ${sub} page loads under the admin session`, async ({ page }) => {
			await login(page);
			await page.goto(`/admin/mail/${sub}`);
			await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
			await expect(page).toHaveURL(new RegExp(`/admin/mail/${sub}$`));
		});
	}
});
