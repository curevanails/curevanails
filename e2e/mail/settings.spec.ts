import { type Page, expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, login } from "./helpers";

/**
 * The Settings page (`/settings`) that manages the recruit-alert recipient, and
 * the Recruit alerts list (`/recruit-alerts`). Both are auth-gated and read/write
 * the shared `app_settings` / `recruit_notifications` D1 tables. Saves go through
 * the Worker's own connection (no external wrangler), so they're lock-safe here.
 */

test.skip(!ADMIN_PASSWORD, "ADMIN_PASSWORD is not set — the dashboard is disabled.");

// Every test here reads/writes the single global `app_settings.recruit_notify_to`
// row, so running them in parallel (the local default; CI already pins workers:1)
// lets one test's save clobber another's between write and read. Force serial.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
	await login(page);
});

/**
 * Drive the recipient field the way an operator does.
 *
 * The addresses are chips now, so `#recruit_notify_to` is a hidden input the
 * chip view writes into — you cannot type at it. This clears what is there and
 * enters `value`, which may itself be a comma-separated list: the field splits
 * one on entry, which is worth exercising rather than stepping around.
 *
 * Assertions still read `#recruit_notify_to`, because that is the value the
 * endpoint actually receives.
 */
async function setAddresses(page: Page, value: string): Promise<void> {
	const removes = page.locator("[data-chip] button");
	for (let n = await removes.count(); n > 0; n = await removes.count()) {
		await removes.first().click();
	}
	if (!value.trim()) return;
	const entry = page.getByLabel("Add an address");
	await entry.fill(value);
	await entry.press("Enter");
}

test.afterAll(async ({ browser }) => {
	// Reset the recipient so a local run doesn't leave alerts pointed somewhere.
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await login(page);
	await page.goto("/mail/settings");
	await setAddresses(page, "");
	await page.click('button[type="submit"]');
	await ctx.close();
});

test.describe("settings", () => {
	test("renders the recruit-alerts recipient field", async ({ page }) => {
		await page.goto("/mail/settings");
		await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
		// What an operator can actually type at. The input behind it is hidden
		// on purpose — it carries the value, the chip view carries the editing.
		await expect(page.getByLabel("Add an address")).toBeVisible();
		await expect(page.locator("#recruit_notify_to")).toBeAttached();
	});

	test("saving a recipient persists across a reload", async ({ page }) => {
		await page.goto("/mail/settings");
		await setAddresses(page, "zz-e2e-notify@example.com");
		await page.click('button[type="submit"]');

		await expect(page.getByText(/Saved\./)).toBeVisible();
		await page.reload();
		await expect(page.locator("#recruit_notify_to")).toHaveValue("zz-e2e-notify@example.com");
		// and it comes back as a chip, not as raw text in a box
		// The label, not the whole chip — the chip also holds its × button.
		await expect(page.locator("[data-chip] > span")).toHaveText(["zz-e2e-notify@example.com"]);
	});

	test("normalises multiple addresses and reports the count", async ({ page }) => {
		await page.goto("/mail/settings");
		// One pasted string, two chips — the split happens in the field.
		await setAddresses(page, "a@example.com,  b@example.com");
		await expect(page.locator("[data-chip]")).toHaveCount(2);
		await page.click('button[type="submit"]');

		await expect(page.getByText("2 recipients will be notified.")).toBeVisible();
		await expect(page.locator("#recruit_notify_to")).toHaveValue("a@example.com, b@example.com");
	});

	test("rejects an invalid address", async ({ page }) => {
		await page.goto("/mail/settings");
		await setAddresses(page, "not-an-email");
		// Flagged in the field before the round trip, and still rejected by the
		// endpoint after it — the chip is a courtesy, not the boundary.
		await expect(page.locator("[data-chip]").first()).toHaveClass(/error/);
		await page.click('button[type="submit"]');

		await expect(page.getByText(/look invalid/)).toBeVisible();
	});

	// The chip view is an enhancement over a plain text input, and that claim
	// is the sort that rots quietly: the chips would keep working while the
	// fallback beneath them broke, and nobody would notice until a browser
	// blocked the script. So it gets a test with scripting off.
	test.describe("without JavaScript", () => {
		test.use({ javaScriptEnabled: false });

		test("the field is still a plain comma-separated input", async ({ page }) => {
			await page.goto("/mail/settings");
			const input = page.locator("#recruit_notify_to");
			await expect(input).toBeVisible();
			await expect(input).toHaveAttribute("type", "text");
			await expect(input).toHaveAttribute("name", "recruit_notify_to");
			// No chips, and the instructions that the chip view removes are here.
			await expect(page.locator("[data-chip]")).toHaveCount(0);
			await expect(page.getByText(/Separate multiple addresses with commas/)).toBeVisible();
		});
	});

	test("blank turns alerts off", async ({ page }) => {
		await page.goto("/mail/settings");
		await setAddresses(page, "");
		await page.click('button[type="submit"]');
		await expect(page.getByText(/alerts are now OFF/i)).toBeVisible();
	});
});

test.describe("recruit alerts list", () => {
	test("renders the alerts page", async ({ page }) => {
		await page.goto("/mail/recruit-alerts");
		await expect(page.getByRole("heading", { name: "Recruit alerts" })).toBeVisible();
		// Either the empty state or a table — both are valid depending on data.
		const hasTable = await page.locator("table").count();
		const hasEmpty = await page.getByText(/No alerts yet/).count();
		expect(hasTable + hasEmpty).toBeGreaterThan(0);
	});

	test("shows who is still owed a thank-you, and that nobody has to press anything", async ({ page }) => {
		await page.goto("/mail/recruit-alerts");

		// Whatever the backlog, there is no button: the cron sends on its own.
		await expect(page.getByRole("button", { name: /send/i })).toHaveCount(0);

		const waiting = page.getByText(/still waiting for their thank-you/i);
		if ((await waiting.count()) === 0) {
			// Nothing owed, nothing shown — a status line for zero people is noise.
			await expect(page.getByText(/Sent automatically/i)).toHaveCount(0);
			return;
		}
		await expect(waiting).toBeVisible();
		await expect(page.getByText(/Sent automatically/i)).toBeVisible();
	});

	test("reflects the configured recipient banner", async ({ page }) => {
		// Set a recipient, then the alerts page should name it.
		await page.goto("/mail/settings");
		await setAddresses(page, "banner-check@example.com");
		await page.click('button[type="submit"]');

		await page.goto("/mail/recruit-alerts");
		await expect(page.getByText("banner-check@example.com")).toBeVisible();
	});
});
