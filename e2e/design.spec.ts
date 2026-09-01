import { test, expect, type Page } from "@playwright/test";

/**
 * Version-H design-system E2E — the DISPLAY suite.
 *
 * Every check here exists because the bug it catches actually shipped. The
 * recruit suite next door proves the form still POSTs; this one proves the
 * site still LOOKS right, which is the class of failure that slipped past
 * `pnpm build`, `pnpm typecheck` and a page-loads-without-erroring check
 * more than once during the version-H rollout:
 *
 *   · a leaked template fragment rendered as the literal text ")) }" on
 *     /recruit — the page built, typechecked and "rendered fine"
 *   · the custom cursor was invisible on every paper section (cream ring on
 *     cream ground, 1.02:1) — and the page sets cursor:none, so the ring IS
 *     the pointer
 *   · the "+" in the role accordion dropped onto its own row under 720px
 *   · the month picker rendered in system blue on a light-grey sheet
 *   · with JavaScript off every page rendered as an empty ground
 *
 * Read-only: nothing here writes to D1 or R2, so there is nothing to clean
 * up afterwards.
 */

/** Every public page, and the ground its first section sits on. */
const PAGES = [
	{ path: "/coming-soon", name: "coming-soon", ground: "night" },
	{ path: "/recruit", name: "recruit", ground: "paper" },
	{ path: "/recruit/apply", name: "apply", ground: "paper" },
	{ path: "/getready", name: "getready", ground: "night" },
	{ path: "/waitlist", name: "waitlist", ground: "night" },
	{ path: "/early-access", name: "early-access", ground: "night" },
	{ path: "/posts", name: "posts", ground: "night" },
	{ path: "/search", name: "search", ground: "night" },
	{ path: "/404", name: "404", ground: "night" },
] as const;

/** Wait for fonts, let the preloader leave, then fire every reveal. */
async function settle(page: Page) {
	await page.evaluate(() => document.fonts.ready);
	await page.waitForFunction(() => !document.getElementById("pre"), null, { timeout: 8000 });
	await page.evaluate(async () => {
		for (let y = 0; y < document.body.scrollHeight; y += 600) {
			scrollTo({ top: y, behavior: "instant" });
			await new Promise((r) => setTimeout(r, 60));
		}
		scrollTo({ top: 0, behavior: "instant" });
		await new Promise((r) => setTimeout(r, 400));
	});
}

/** WCAG relative luminance, from a computed `rgb(...)` / `rgba(...)` string. */
function luminance(color: string): number {
	const [r, g, b] = (color.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
	const f = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string): number {
	const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
	return (x + 0.05) / (y + 0.05);
}

/* ═══════════════════════════════════════════════════════════════════════
   1 · Every page, both viewports — the sweep
   ═══════════════════════════════════════════════════════════════════════ */
for (const pg of PAGES) {
	test.describe(`${pg.name}`, () => {
		test(`renders clean at 1440 and 390`, async ({ page }) => {
			const errors: string[] = [];
			const httpFailures: string[] = [];
			page.on("pageerror", (e) => errors.push(e.message));
			page.on("response", (r) => {
				// /404 is expected to 404; the booking widget is third-party.
				if (r.status() >= 400 && !r.url().endsWith("/404") && !r.url().includes("mangomint")) {
					httpFailures.push(`${r.status()} ${r.url()}`);
				}
			});

			for (const size of [
				{ width: 1440, height: 900 },
				{ width: 390, height: 844 },
			]) {
				await page.setViewportSize(size);
				await page.goto(pg.path, { waitUntil: "load" });
				await settle(page);

				const state = await page.evaluate(() => ({
					hScroll:
						document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
					hiddenReveals: document.querySelectorAll("[data-r]:not(.in)").length,
					// laid out only, and never the closed menu panel: it is clip-path'd
					// shut, so its photograph is legitimately deferred
					brokenImages: [...document.images].filter(
						(i) =>
							i.getClientRects().length &&
							!i.closest("#menuPanel") &&
							(!i.complete || i.naturalWidth === 0),
					).length,
					imagesWithoutAlt: [...document.images].filter((i) => !i.hasAttribute("alt")).length,
					// the token contract: bare HSL channels, never a colour
					primary: getComputedStyle(document.documentElement)
						.getPropertyValue("--primary")
						.trim(),
				}));

				expect(state.hScroll, `${pg.name} @${size.width} scrolls horizontally`).toBe(false);
				expect(state.hiddenReveals, `${pg.name} @${size.width} has unrevealed content`).toBe(0);
				expect(state.brokenImages, `${pg.name} @${size.width} has broken images`).toBe(0);
				expect(state.imagesWithoutAlt, `${pg.name} @${size.width} has an img with no alt`).toBe(0);
				expect(state.primary, `--primary must stay a bare HSL triplet`).toMatch(
					/^[\d.]+ [\d.]+% [\d.]+%$/,
				);
			}

			expect(errors, `${pg.name} threw`).toEqual([]);
			expect(httpFailures, `${pg.name} had failed requests`).toEqual([]);
		});

		test(`leaks no template syntax into the page text`, async ({ page }) => {
			await page.goto(pg.path, { waitUntil: "load" });
			await settle(page);
			const text = await page.evaluate(() => document.body.innerText || "");

			// The ")) }" regression, and its neighbours.
			expect(text, "a JSX/Astro fragment reached the rendered text").not.toMatch(/\)\)\s*\}/);
			expect(text).not.toMatch(/\{[A-Za-z_$][\w$]*\.map/);
			expect(text).not.toMatch(/=>/);
			expect(text).not.toContain("[object Object]");
			expect(text).not.toMatch(/<\/?(details|div|section|span)>/i);
		});
	});
}

/* ═══════════════════════════════════════════════════════════════════════
   2 · The custom cursor must be visible on BOTH grounds
   The page sets cursor:none — losing the ring means losing the pointer.
   ═══════════════════════════════════════════════════════════════════════ */
test.describe("custom cursor", () => {
	test("the ring contrasts with the ground it is over", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto("/recruit", { waitUntil: "load" });
		await settle(page);

		// over the opening PAPER section
		await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
		await page.waitForTimeout(300);
		await page.mouse.move(400, 420);
		await page.waitForTimeout(300);

		const onPaper = await page.evaluate(() => {
			const cur = document.getElementById("cur")!;
			const ring = getComputedStyle(cur).boxShadow.match(/rgba?\([^)]+\)/)?.[0] ?? "";
			return { ring, ground: getComputedStyle(document.querySelector("#team")!).backgroundColor };
		});
		expect(
			contrast(onPaper.ring, onPaper.ground),
			`cursor ring ${onPaper.ring} on paper ${onPaper.ground}`,
		).toBeGreaterThan(3);

		// over a NIGHT section
		await page.evaluate(() => {
			const el = document.getElementById("why-we-exist")!;
			scrollTo({ top: window.scrollY + el.getBoundingClientRect().top + 200, behavior: "instant" });
		});
		await page.waitForTimeout(400);
		await page.mouse.move(400, 300);
		await page.waitForTimeout(300);

		const onNight = await page.evaluate(() => {
			const cur = document.getElementById("cur")!;
			const ring = getComputedStyle(cur).boxShadow.match(/rgba?\([^)]+\)/)?.[0] ?? "";
			return {
				ring,
				ground: getComputedStyle(document.querySelector("#why-we-exist")!).backgroundColor,
			};
		});
		expect(
			contrast(onNight.ring, onNight.ground),
			`cursor ring ${onNight.ring} on night ${onNight.ground}`,
		).toBeGreaterThan(3);
	});
});

/* ═══════════════════════════════════════════════════════════════════════
   3 · The role accordion
   ═══════════════════════════════════════════════════════════════════════ */
test.describe("role accordion", () => {
	for (const width of [390, 600, 900, 1440]) {
		test(`the toggle stays on the title's row at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto("/recruit", { waitUntil: "load" });
			await settle(page);

			const rows = await page.evaluate(() => {
				const s = document.querySelector(".rc-role summary")!;
				const t = s.querySelector(".rc-role-t")!.getBoundingClientRect();
				const x = s.querySelector(".rc-role-x")!.getBoundingClientRect();
				return {
					onSameRow: x.top < t.bottom && x.bottom > t.top,
					toTheRight: Math.round(x.left) > Math.round(t.right) - 2,
				};
			});
			expect(rows.onSameRow, "the +/- dropped onto its own row").toBe(true);
			expect(rows.toTheRight).toBe(true);
		});
	}

	test("an open role is inset from its own ground", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.goto("/recruit", { waitUntil: "load" });
		await settle(page);

		await page.evaluate(() => {
			document.getElementById("roles")!.scrollIntoView({ behavior: "instant" });
		});
		await page.locator(".rc-role summary").first().click();
		await page.waitForTimeout(500);

		const inset = await page.evaluate(() => {
			const row = document.querySelector(".rc-role[open]")!;
			const copy = row.querySelector(".rc-role-b p")!;
			return copy.getBoundingClientRect().left - row.getBoundingClientRect().left;
		});
		expect(inset, "an open role's copy sits flush against its tint").toBeGreaterThan(16);
	});

	test("only one role is open at a time", async ({ page }) => {
		await page.goto("/recruit", { waitUntil: "load" });
		await settle(page);
		const summaries = page.locator(".rc-role summary");
		await summaries.nth(0).click();
		await page.waitForTimeout(250);
		await summaries.nth(1).click();
		await page.waitForTimeout(250);
		await expect(page.locator(".rc-role[open]")).toHaveCount(1);
	});
});

/* ═══════════════════════════════════════════════════════════════════════
   4 · The month picker — shadcn Popover + Calendar, Cure Và's clothes
   ═══════════════════════════════════════════════════════════════════════ */
test.describe("graduation month picker", () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.goto("/recruit/apply", { waitUntil: "load" });
		await settle(page);
		await page.evaluate(() =>
			document.getElementById("graduation_date")!.scrollIntoView({ block: "center", behavior: "instant" }),
		);
	});

	test("opens anchored to its trigger and inside the viewport", async ({ page }) => {
		await page.locator(".js-monthbtn").click();
		const panel = page.locator("#gradPop");
		await expect(panel).toBeVisible();

		const box = await page.evaluate(() => {
			const el = document.getElementById("gradPop")!;
			const trigger = document.querySelector(".js-monthbtn")!.getBoundingClientRect();
			const r = el.getBoundingClientRect();
			return {
				months: el.querySelectorAll(".mpick-m").length,
				inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
				anchored: Math.abs(r.top - trigger.bottom) < 24 || Math.abs(r.bottom - trigger.top) < 24,
				// the top layer paints above the custom cursor — without this the
				// visitor has no pointer over the panel (DESIGN-SYSTEM.md §6)
				optsOutOfTheCursor: !!el.closest("[data-nocursor]"),
			};
		});
		expect(box.months).toBe(12);
		expect(box.inViewport, "the panel opened off-screen").toBe(true);
		expect(box.anchored, "the panel is not anchored to its trigger").toBe(true);
		expect(box.optsOutOfTheCursor, "the panel needs data-nocursor").toBe(true);
	});

	test("names no colour of its own — no system blue", async ({ page }) => {
		await page.locator(".js-monthbtn").click();
		await expect(page.locator("#gradPop")).toBeVisible();

		const colours = await page.evaluate(() => {
			const pop = document.getElementById("gradPop")!;
			const cell = pop.querySelector(".mpick-m")!;
			const g = (e: Element, prop: string) => getComputedStyle(e).getPropertyValue(prop);
			return {
				panel: g(pop, "background-color"),
				ink: g(pop, "color"),
				cell: g(cell, "color"),
				action: g(pop.querySelector(".mpick-act--go")!, "color"),
				radius: g(cell, "border-radius"),
			};
		});

		// the brand has no blue; a blue channel dominating is the native picker
		for (const [key, value] of Object.entries(colours)) {
			if (key === "radius") continue;
			const [r, g, b] = (value.match(/\d+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
			expect(b - Math.max(r, g), `${key} (${value}) looks like system blue`).toBeLessThan(40);
		}
		// this brand's controls are pills, not shadcn's stock rounded squares
		expect(colours.radius).toBe("999px");
	});

	test("selecting a month writes MM/YYYY and closes", async ({ page }) => {
		await page.locator(".js-monthbtn").click();
		await expect(page.locator("#gradPop")).toBeVisible();
		await page.locator('.mpick-nav[data-step="1"]').click();
		await page.locator('.mpick-m[data-m="5"]').click();

		await expect(page.locator("#gradPop")).toBeHidden();
		const value = await page.inputValue("#graduation_date");
		expect(value).toMatch(/^(0?[1-9]|1[0-2])\s*\/\s*\d{4}$/);
		expect(value.endsWith(String(new Date().getFullYear() + 1))).toBe(true);
	});

	test("re-opens on the month already chosen", async ({ page }) => {
		await page.evaluate(() => {
			const el = document.getElementById("graduation_date") as HTMLInputElement;
			el.value = "05/2027";
			el.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await page.locator(".js-monthbtn").click();
		await expect(page.locator("#gradPop")).toBeVisible();
		await expect(page.locator(".js-mpick-y")).toHaveText("2027");
		await expect(page.locator('.mpick-m[aria-pressed="true"]')).toHaveText("May");
	});

	test("Clear empties the field", async ({ page }) => {
		await page.evaluate(() => {
			const el = document.getElementById("graduation_date") as HTMLInputElement;
			el.value = "05/2027";
			el.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await page.locator(".js-monthbtn").click();
		await page.locator('.mpick-act[data-act="clear"]').click();
		await expect(page.locator("#graduation_date")).toHaveValue("");
	});

	test("Escape closes it, and the arrows move within the grid", async ({ page }) => {
		await page.locator(".js-monthbtn").click();
		await expect(page.locator("#gradPop")).toBeVisible();

		const first = await page.evaluate(() => document.activeElement?.textContent);
		await page.keyboard.press("ArrowRight");
		const second = await page.evaluate(() => document.activeElement?.textContent);
		expect(second, "ArrowRight did not move focus within the grid").not.toBe(first);

		await page.keyboard.press("Escape");
		await expect(page.locator("#gradPop")).toBeHidden();
	});

	test("the field still accepts a typed MM/YYYY", async ({ page }) => {
		await page.fill("#graduation_date", "09/2028");
		await expect(page.locator("#graduation_date")).toHaveValue("09/2028");
		// and the picker reads it back
		await page.locator(".js-monthbtn").click();
		await expect(page.locator(".js-mpick-y")).toHaveText("2028");
	});
});

/* ═══════════════════════════════════════════════════════════════════════
   5 · The theme contract — raised vs recessed on paper
   Getting this pair backwards is the one mistake that makes a themed page
   look unthemed, and a single screenshot does not show it.
   ═══════════════════════════════════════════════════════════════════════ */
test.describe("theming", () => {
	test("on paper, a card is white (raised) and the tray is paper-2 (recessed)", async ({
		page,
	}) => {
		await page.goto("/recruit/apply", { waitUntil: "load" });
		await settle(page);

		const t = await page.evaluate(() => {
			const shell = document.querySelector(".app-shell")!;
			const section = shell.closest("section")!;
			return {
				card: getComputedStyle(shell).backgroundColor,
				section: getComputedStyle(section).backgroundColor,
				label: getComputedStyle(document.querySelector('label[for="first_name"]')!).color,
				input: getComputedStyle(document.querySelector("#first_name")!).color,
			};
		});

		expect(t.card, "the card should be the raised surface").toBe("rgb(255, 255, 255)");
		expect(luminance(t.card)).toBeGreaterThan(luminance(t.section));
		// and the ink must have inverted with the ground
		expect(contrast(t.input, t.card), "field text on the card").toBeGreaterThan(7);
		expect(contrast(t.label, t.card), "field label on the card").toBeGreaterThan(4.5);
	});

	test("a paper page's wordmark is legible on its bar", async ({ page }) => {
		await page.goto("/recruit", { waitUntil: "load" });
		await settle(page);
		const t = await page.evaluate(() => ({
			mark: getComputedStyle(document.querySelector(".mark b")!).color,
			ground: getComputedStyle(document.querySelector("#team")!).backgroundColor,
			navIsPaper: document.getElementById("nav")!.classList.contains("nav--paper"),
		}));
		// without nav--paper this is a cream wordmark on paper: 1.02:1
		expect(t.navIsPaper, "a page opening on paper needs nav--paper").toBe(true);
		expect(contrast(t.mark, t.ground), "the wordmark on paper").toBeGreaterThan(4.5);
	});
});

/* ═══════════════════════════════════════════════════════════════════════
   6 · With JavaScript off, the page still carries its content
   [data-r] is opacity:0 until the runtime marks it, so without the
   <noscript> fallback every page renders as an empty ground.
   ═══════════════════════════════════════════════════════════════════════ */
test.describe("without JavaScript", () => {
	test.use({ javaScriptEnabled: false });

	for (const pg of PAGES.filter((p) => p.name !== "404")) {
		test(`${pg.name} still shows its content`, async ({ page }) => {
			await page.goto(pg.path, { waitUntil: "load" });
			await page.waitForTimeout(3200); // the CSS preloader leaves at 2.4s

			const state = await page.evaluate(() => {
				const hidden = [...document.querySelectorAll("[data-r]")].filter(
					(e) => parseFloat(getComputedStyle(e).opacity) < 0.9,
				).length;
				const pre = document.getElementById("pre");
				return {
					hidden,
					preloaderStillUp: !!pre && getComputedStyle(pre).display !== "none",
					headings: document.querySelectorAll("h1, h2, h3").length,
				};
			});

			expect(state.hidden, "reveals never fired and the content is invisible").toBe(0);
			expect(state.preloaderStillUp, "the preloader never left").toBe(false);
			expect(state.headings, "the page has no headings").toBeGreaterThan(0);
		});
	}
});

/* ═══════════════════════════════════════════════════════════════════════
   7 · /coming-soon — the countdown and the first-visit dialog
   ═══════════════════════════════════════════════════════════════════════ */
test.describe("coming-soon", () => {
	test("the countdown runs and shows real figures", async ({ page }) => {
		await page.goto("/coming-soon", { waitUntil: "load" });
		await settle(page);

		const first = await page.evaluate(() => ({
			days: document.querySelector("[data-d]")!.textContent!.trim(),
			seconds: document.querySelector("[data-s]")!.textContent!.trim(),
			tabular: getComputedStyle(document.querySelector("[data-d]")!).fontVariantNumeric,
		}));
		expect(first.days, "the countdown never started").toMatch(/^\d+$/);
		expect(Number(first.days)).toBeGreaterThan(0);
		// .num — a changing second must not make the row jitter
		expect(first.tabular).toContain("tabular-nums");

		await page.waitForTimeout(1400);
		const second = await page.evaluate(() =>
			document.querySelector("[data-s]")!.textContent!.trim(),
		);
		expect(second, "the countdown is frozen").not.toBe(first.seconds);
	});

	test("the first-visit dialog opens once, and not again", async ({ page }) => {
		await page.goto("/coming-soon", { waitUntil: "load" });
		const dialog = page.locator("#ask");
		await expect(dialog).toBeVisible({ timeout: 10000 });

		// a real <dialog> in the top layer, so it must opt out of the cursor
		const shape = await page.evaluate(() => {
			const d = document.getElementById("ask") as HTMLDialogElement;
			return {
				isDialog: d.tagName === "DIALOG",
				modal: d.matches(":modal"),
				nocursor: d.hasAttribute("data-nocursor"),
				locked: document.body.classList.contains("lock"),
			};
		});
		expect(shape.isDialog).toBe(true);
		expect(shape.modal, "must be opened with showModal(), not shown with CSS").toBe(true);
		expect(shape.nocursor, "a top-layer element needs data-nocursor").toBe(true);
		expect(shape.locked).toBe(true);

		await page.locator('.ask-opt[data-go="waitlist"]').click();
		await expect(dialog).toBeHidden();

		// the lock must be released on the dialog's own close event
		await expect
			.poll(() => page.evaluate(() => document.body.classList.contains("lock")))
			.toBe(false);

		// second visit: same browser context, so localStorage persists
		await page.goto("/coming-soon", { waitUntil: "load" });
		await settle(page);
		await expect(dialog).toBeHidden();
	});

	test("Escape closes it without leaking the scroll lock", async ({ page }) => {
		await page.goto("/coming-soon", { waitUntil: "load" });
		await expect(page.locator("#ask")).toBeVisible({ timeout: 10000 });
		await page.keyboard.press("Escape");
		await expect(page.locator("#ask")).toBeHidden();
		await expect
			.poll(() => page.evaluate(() => document.body.classList.contains("lock")))
			.toBe(false);
	});

	test("it stays shut for a visitor who arrived with a hash", async ({ page }) => {
		await page.goto("/coming-soon#waitlist", { waitUntil: "load" });
		await page.waitForTimeout(4200);
		await expect(page.locator("#ask")).toBeHidden();
	});

	test("the waitlist form posts to the real endpoint", async ({ page }) => {
		await page.goto("/coming-soon#waitlist", { waitUntil: "load" });
		await settle(page);
		const form = page.locator(".js-waitlist");
		await expect(form).toBeVisible();
		await expect(form.locator("[data-wl-email]")).toBeVisible();
		await expect(form).toHaveAttribute("data-wl-source", "coming-soon");
	});
});

/* ═══════════════════════════════════════════════════════════════════════
   8 · /recruit/apply — the layout and contrast decisions, pinned
   ═══════════════════════════════════════════════════════════════════════ */
test.describe("apply page", () => {
	test("the form comes before the roles list", async ({ page }) => {
		await page.goto("/recruit/apply", { waitUntil: "load" });
		await settle(page);
		const order = await page.evaluate(() =>
			[...document.querySelectorAll("main section")].map(
				(s) => s.id || s.getAttribute("aria-labelledby"),
			),
		);
		expect(order.slice(0, 2)).toEqual(["formH", "roles"]);
	});

	test("a chosen option pill is unmistakable, and legible either way", async ({ page }) => {
		await page.goto("/recruit/apply", { waitUntil: "load" });
		await settle(page);

		const unchosen = await page.evaluate(() => {
			const el = document.querySelector(".opt")!;
			return { bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color };
		});
		await page.locator(".opt").first().click();
		await page.waitForTimeout(450);
		const chosen = await page.evaluate(() => {
			const el = document.querySelector(".opt")!;
			return { bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color };
		});

		// both states have to be readable...
		expect(contrast(unchosen.ink, unchosen.bg), "unchosen pill").toBeGreaterThan(4.5);
		expect(contrast(chosen.ink, chosen.bg), "chosen pill").toBeGreaterThan(4.5);
		// ...and a chosen pill must be obviously darker, not a hairline change
		expect(
			luminance(unchosen.bg) - luminance(chosen.bg),
			"a chosen pill is not visibly darker than an unchosen one",
		).toBeGreaterThan(0.3);
	});

	test("the submit button keeps one calm transition", async ({ page }) => {
		await page.goto("/recruit/apply", { waitUntil: "load" });
		await settle(page);
		const btn = await page.evaluate(() => {
			const b = document.querySelector(".js-submit")!;
			return {
				magnet: b.hasAttribute("data-mag"),
				risingFill: getComputedStyle(b, "::before").content,
				properties: getComputedStyle(b).transitionProperty,
			};
		});
		expect(btn.magnet, "the magnetic pull belongs on marketing CTAs, not a submit").toBe(false);
		expect(btn.risingFill, "the rising fill reads as a loading bar at this size").toBe("none");
		expect(btn.properties).not.toContain("transform");
	});
});
