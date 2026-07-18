import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the email dashboard, which now lives on the **admin** Worker
 * under `/mail` (the standalone notify service was retired).
 *
 * Builds + previews the admin Worker (`WRANGLER_CONFIG=wrangler.admin.jsonc` →
 * `ADMIN_STANDALONE=true`), so `/login`, `/mail`, `/mail/settings`,
 * `/api/email/*`, `/unsubscribe/*`, and `/api/webhooks/ses` all resolve as in
 * production. Runs on its own port so it can coexist with the main suite.
 *
 * The dashboard + `/api/email/*` are auth-gated: with no `ADMIN_PASSWORD` the
 * whole area returns 404, so the suite needs one set. Miniflare loads it from
 * `.dev.vars`; CI writes a `.dev.vars` before the run (see .github/workflows).
 *
 * SES credentials are deliberately NOT required — the send / test / schedule
 * endpoints check for them before contacting AWS, so no test dispatches a real
 * email.
 */
const PORT = Number(process.env.E2E_MAIL_PORT ?? 8789);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "./e2e/mail",
	globalTeardown: "./e2e/mail/global-teardown.ts",
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
		// Build + preview the admin Worker. WRANGLER_CONFIG must be set for BOTH
		// the build (adapter reads configPath) and preview (wrangler serves that
		// config's vars/bindings, incl. ADMIN_STANDALONE).
		command: `WRANGLER_CONFIG=wrangler.admin.jsonc pnpm build && WRANGLER_CONFIG=wrangler.admin.jsonc pnpm preview --port ${PORT}`,
		url: `${BASE_URL}/login`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		stdout: "pipe",
		stderr: "pipe",
	},
});
