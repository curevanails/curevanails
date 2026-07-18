import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the standalone **notify** Worker (email dashboard, SES send,
 * scheduled campaigns, SNS webhook, unsubscribe).
 *
 * Separate from the main `playwright.config.ts` because it builds + previews a
 * different Worker: `WRANGLER_CONFIG=wrangler.notify.jsonc` sets
 * `NOTIFY_STANDALONE=true`, so the dashboard is served at the root (`/`) and the
 * suite's `/login`, `/`, `/api/email/*` paths resolve. Runs on its own port so
 * it can coexist with the main suite.
 *
 * The dashboard and `/api/email/*` are auth-gated: with no `ADMIN_PASSWORD` the
 * whole area returns 404, so the suite needs one set. Miniflare loads it from
 * `.dev.vars`; CI writes a `.dev.vars` before the run (see .github/workflows).
 *
 * SES credentials are deliberately NOT required — the send / test / schedule
 * endpoints check for them before contacting AWS, so no test dispatches a real
 * email.
 */
const PORT = Number(process.env.E2E_NOTIFY_PORT ?? 8789);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "./e2e/notify",
	globalTeardown: "./e2e/notify/global-teardown.ts",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		// Build + preview the notify Worker. WRANGLER_CONFIG must be set for BOTH
		// the build (adapter reads configPath) and preview (wrangler serves that
		// config's vars/bindings, incl. NOTIFY_STANDALONE).
		command: `WRANGLER_CONFIG=wrangler.notify.jsonc pnpm build && WRANGLER_CONFIG=wrangler.notify.jsonc pnpm preview --port ${PORT}`,
		url: `${BASE_URL}/login`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		stdout: "pipe",
		stderr: "pipe",
	},
});
