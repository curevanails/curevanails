import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the CureVà recruit form.
 *
 * Tests run against the *built* Cloudflare Worker via `astro preview`
 * (Miniflare), so they exercise the real `/api/recruit` endpoint with live
 * local D1 + R2 bindings — not the dev server (whose vite dep-optimizer can
 * 500 mid-warmup). The `webServer` block builds then previews on PORT.
 */
const PORT = Number(process.env.E2E_PORT ?? 8788);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "./e2e",
	// The email-dashboard suite lives in ./e2e/mail and runs against a different
	// build (the admin Worker) via playwright.mail.config.ts — keep it out of the
	// main run.
	testIgnore: "**/mail/**",
	globalTeardown: "./e2e/global-teardown.ts",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI
		? [["github"], ["html", { open: "never" }]]
		: "list",
	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		// The display suite also runs in WebKit. It is the engine most of this
		// site's visitors are on (Safari, and every browser on iOS), and it is
		// where a Chromium-only suite misses a layout break — `overflow:clip`,
		// `100svh`/`100dvh`, `:has()`, `@starting-style` and the Popover API all
		// behave differently or not at all across engines, and this design leans
		// on every one of them. Scoped to design.spec.ts on purpose: the recruit
		// suite posts real rows to D1, and running it twice doubles the writes
		// for no extra coverage of the thing being tested.
		{
			name: "webkit-design",
			use: { ...devices["Desktop Safari"] },
			testMatch: /design\.spec\.ts/,
		},
	],
	webServer: {
		// `reuseExistingServer` (local only) lets you point at an already-running
		// `pnpm preview --port 8788` to skip the rebuild while iterating.
		command: `pnpm build && pnpm preview --port ${PORT}`,
		url: `${BASE_URL}/recruit/apply`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		stdout: "pipe",
		stderr: "pipe",
	},
});
