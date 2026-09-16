import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, login } from "./helpers";

/**
 * Safety coverage for the endpoints that CAN dispatch mail — `/api/email/send`,
 * `/api/email/test`, `/api/email/schedule`.
 *
 * ⚠️  No test here may cause a real send. That invariant is upheld three ways,
 * all grounded in the endpoints' control flow (see the source):
 *   1. Malformed bodies fail Zod validation (422) and the audience/ids guard
 *      (422) BEFORE any mailer is built.
 *   2. A well-formed body that names a NON-EXISTENT template can never reach
 *      the send call: the endpoint either 500s when no transport can carry it
 *      or 404s at the template lookup — in both branches `sendOne` /
 *      `sendCampaign` is never invoked. So this file is safe whichever
 *      transport the Worker happens to have.
 *   3. Under Miniflare the `EMAIL` binding is simulated: a send is written to a
 *      local file, never delivered. Real delivery would need AWS secrets, which
 *      this test env does not set.
 *
 * The real happy-path send is intentionally NOT exercised end-to-end; doing so
 * would email real waitlist subscribers.
 */

test.skip(!ADMIN_PASSWORD, "ADMIN_PASSWORD is not set — the dashboard is disabled.");

test.beforeEach(async ({ page }) => {
	await login(page);
});

/** Statuses that prove "did not send": validation, missing creds, missing template. */
const NO_SEND = [404, 422, 500];

test.describe("POST /api/email/test", () => {
	test("rejects a missing template_id (422)", async ({ page }) => {
		const res = await page.request.post("/api/email/test", {
			data: { to: "someone@example.com" },
		});
		expect(res.status()).toBe(422);
	});

	test("rejects an invalid recipient address (422)", async ({ page }) => {
		const res = await page.request.post("/api/email/test", {
			data: { template_id: "tpl-welcome", to: "not-an-email" },
		});
		expect(res.status()).toBe(422);
		expect((await res.json()).error).toContain("valid email");
	});

	test("a well-formed request with an unknown template never sends", async ({ page }) => {
		const res = await page.request.post("/api/email/test", {
			data: { template_id: "tpl-nope", to: "someone@example.com" },
		});
		expect(NO_SEND).toContain(res.status());
		expect((await res.json()).ok).toBe(false);
	});
});

test.describe("POST /api/email/send", () => {
	test("rejects a missing template_id (422)", async ({ page }) => {
		const res = await page.request.post("/api/email/send", { data: { audience: "all" } });
		expect(res.status()).toBe(422);
	});

	test("rejects a request with neither subscriber_ids nor audience (422)", async ({ page }) => {
		const res = await page.request.post("/api/email/send", { data: { template_id: "tpl-welcome" } });
		expect(res.status()).toBe(422);
		expect((await res.json()).error).toContain("Provide subscriber_ids or an audience.");
	});

	test("rejects an unknown audience value (422)", async ({ page }) => {
		const res = await page.request.post("/api/email/send", {
			data: { template_id: "tpl-welcome", audience: "everyone" },
		});
		expect(res.status()).toBe(422);
	});

	test("a well-formed campaign with an unknown template never sends", async ({ page }) => {
		const res = await page.request.post("/api/email/send", {
			data: { template_id: "tpl-nope", audience: "all" },
		});
		expect(NO_SEND).toContain(res.status());
		expect((await res.json()).ok).toBe(false);
	});
});

test.describe("POST /api/email/schedule", () => {
	test("rejects a create with a non-positive scheduled_at (422)", async ({ page }) => {
		const res = await page.request.post("/api/email/schedule", {
			data: {
				action: "create",
				template_id: "tpl-welcome",
				audience: "all",
				scheduled_at: -1,
			},
		});
		expect(res.status()).toBe(422);
	});

	test("rejects a create with a missing audience (422)", async ({ page }) => {
		const res = await page.request.post("/api/email/schedule", {
			data: { action: "create", template_id: "tpl-welcome", scheduled_at: Date.now() + 3_600_000 },
		});
		expect(res.status()).toBe(422);
	});

	test("cancelling a non-existent campaign returns 404", async ({ page }) => {
		const res = await page.request.post("/api/email/schedule", {
			data: { action: "cancel", id: "cmp-does-not-exist" },
		});
		expect(res.status()).toBe(404);
	});
});

test.describe("compose page", () => {
	test("the send button is disabled when campaigns have no transport", async ({ page }) => {
		// A campaign is marketing, so it needs SES (Cloudflare Email Service is
		// transactional-only). The test env has no AWS secrets, so
		// `canSendCampaign` is false and Compose renders the button disabled — a
		// real campaign send is impossible from the UI here, even though the
		// simulated EMAIL binding could carry a transactional one.
		await expect(page.locator("#send-btn")).toBeDisabled();
	});
});
