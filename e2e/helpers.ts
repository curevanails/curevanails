import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Shared fixtures + helpers for the CureVà E2E suite.
 *
 * Selector notes for /recruit/apply — the form has no `id` on its wrapper and
 * its checkboxes/radios are `opacity:0;width:0;pointer-events:none` (styled via
 * a sibling `.mk` span). Playwright's `check()` refuses to act on them, so every
 * choice is made by clicking the wrapping `<label>`, exactly as a user does.
 */

export const APPLY_URL = "/recruit/apply";

/**
 * Every real-API row we insert carries this surname so teardown can find it.
 * Must be letters only — the name validator rejects digits, so no "e2e"/"2".
 */
export const E2E_SURNAME = "Zzteststub";

export const RESUME_FILE = {
	name: "resume.pdf",
	mimeType: "application/pdf",
	buffer: Buffer.from("%PDF-1.4\nCureVa E2E test resume\n%%EOF\n"),
};

/** A unique, teardown-matchable email. Email is optional on this form. */
export function e2eEmail(): string {
	return `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

/** `YYYY-MM` a few years out — the graduation field is a native month input. */
export function futureMonth(): string {
	const d = new Date();
	d.setFullYear(d.getFullYear() + 2);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const SELECTORS = {
	form: ".js-apply-full",
	submit: ".js-submit",
	alert: ".js-alert",
	done: ".js-done",
	doneName: ".js-done-name",
	drop: ".js-drop",
	dropFile: ".js-dropfile",
	resumeInput: ".js-resume",
	group: (name: string) => `.js-group[data-name="${name}"]`,
	/** The clickable label wrapping a hidden checkbox/radio. */
	option: (value: string) => `label:has(input[value="${value}"])`,
} as const;

export type ApplyField =
	| "first_name"
	| "last_name"
	| "email"
	| "phone"
	| "positions"
	| "current_status"
	| "graduation_date"
	| "background"
	| "employment_type"
	| "resume"
	| "portfolio_link"
	| "why_cureva"
	| "contact_consent";

/**
 * Fill a valid application. `skip` omits fields so a test can prove each one is
 * independently required; `overrides` replaces a text field's value.
 */
export async function fillApplication(
	page: Page,
	opts: {
		skip?: ApplyField[];
		overrides?: Partial<Record<ApplyField, string>>;
	} = {},
): Promise<void> {
	const skip = new Set(opts.skip ?? []);
	const ov = opts.overrides ?? {};
	const want = (f: ApplyField) => !skip.has(f);
	const val = (f: ApplyField, fallback: string) => ov[f] ?? fallback;

	if (want("first_name")) await page.fill("#first_name", val("first_name", "Jane"));
	if (want("last_name")) await page.fill("#last_name", val("last_name", E2E_SURNAME));
	if (want("email")) await page.fill("#email", val("email", e2eEmail()));
	if (want("phone")) await page.fill("#phone", val("phone", "(801) 555-0100"));

	if (want("positions")) await page.click(SELECTORS.option("nail_technician"));
	if (want("current_status")) await page.click(SELECTORS.option("licensed_utah"));
	if (want("background")) await page.click(SELECTORS.option("salon_experience"));
	if (want("employment_type")) await page.click(SELECTORS.option("full_time"));

	// The field swaps text→month on focus, and `fill()` focuses first — so an
	// invalid string (which a text-fallback browser can still submit) would make
	// `fill()` throw against a month input. Set the value directly and fire the
	// events the form's error-clearing listeners expect, matching the raw string
	// a browser without month support posts.
	if (want("graduation_date")) {
		await page.evaluate((value) => {
			const el = document.getElementById("graduation_date") as HTMLInputElement | null;
			if (!el) return;
			el.value = value;
			el.dispatchEvent(new Event("input", { bubbles: true }));
			el.dispatchEvent(new Event("change", { bubbles: true }));
		}, val("graduation_date", futureMonth()));
	}

	if (want("resume")) await page.locator(SELECTORS.resumeInput).setInputFiles(RESUME_FILE);
	if (want("portfolio_link"))
		await page.fill("#portfolio_link", val("portfolio_link", "@janedoenails"));
	if (want("why_cureva"))
		await page.fill("#why_cureva", val("why_cureva", "I love the craft and the team."));
	if (want("contact_consent")) await page.click("label.consent");
}

export async function submitApplication(page: Page): Promise<void> {
	await page.locator(SELECTORS.submit).click();
}

/**
 * Read a key from `.dev.vars`, which Miniflare loads into the previewed Worker.
 * Falls back to `process.env` so CI can inject the same values. Returns
 * undefined when neither is set, letting a spec skip rather than fail.
 */
export function devVar(name: string): string | undefined {
	if (process.env[name]) return process.env[name];
	try {
		const raw = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
		for (const line of raw.split("\n")) {
			const t = line.trim();
			if (!t || t.startsWith("#")) continue;
			const eq = t.indexOf("=");
			if (eq === -1) continue;
			if (t.slice(0, eq).trim() !== name) continue;
			return t
				.slice(eq + 1)
				.trim()
				.replace(/^["']|["']$/g, "");
		}
	} catch {
		// No .dev.vars (e.g. CI) — caller decides whether to skip.
	}
	return undefined;
}
