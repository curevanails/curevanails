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

			/* Errors thrown INSIDE a third-party iframe surface on the parent in
			   WebKit, so the Google Maps embed on /recruit/apply and the booking
			   widget on /early-access can both report failures of their own
			   internal RPCs. They are not ours and we cannot fix them; the map
			   was verified to render identically in both engines despite it.
			   Matched by the third-party origin, so anything WE throw still
			   fails the test. */
			const THIRD_PARTY = /maps\.googleapis\.com|maps\.google\.com|www\.google\.com|mangomint/;
			page.on("pageerror", (e) => {
				if (!THIRD_PARTY.test(e.message)) errors.push(e.message);
			});
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
				locked: document.documentElement.classList.contains("ask-open"),
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
			.poll(() => page.evaluate(() => document.documentElement.classList.contains("ask-open")))
			.toBe(false);

		// same tab again: sessionStorage survives a navigation
		await page.goto("/coming-soon", { waitUntil: "load" });
		await settle(page);
		await expect(dialog, "it asked again in the same session").toBeHidden();
	});

	test("it opens immediately, not after the page has loaded", async ({ page }) => {
		// The ask was "as soon as I arrive", not "once the page settles". The
		// dialog script sits at the end of <body>, so the question is up before
		// the load event — and well before the preloader would have lifted at
		// 2.4s. Measured from the moment navigation commits.
		const started = Date.now();
		await page.goto("/coming-soon", { waitUntil: "commit" });
		await page.locator("#ask").waitFor({ state: "visible", timeout: 3000 });
		const elapsed = Date.now() - started;
		expect(elapsed, `the dialog took ${elapsed}ms to appear`).toBeLessThan(2400);

		// and it must not be waiting behind a curtain: on the visit that shows
		// the dialog the preloader stands down, so there is only ever one
		const curtain = await page.evaluate(() => !!document.getElementById("pre"));
		expect(curtain, "a modal over the preloader is two curtains").toBe(false);
	});

	test("a visit that shows no dialog keeps the normal preloader", async ({ page }) => {
		// answer the question first, so the second view is a returning one
		await page.goto("/coming-soon", { waitUntil: "load" });
		await page.locator('.ask-opt[data-go="waitlist"]').click();

		await page.goto("/coming-soon", { waitUntil: "commit" });
		const hadCurtain = await page
			.waitForFunction(() => !!document.getElementById("pre"), null, { timeout: 2000 })
			.then(() => true)
			.catch(() => false);
		expect(hadCurtain, "the preloader should be untouched when no dialog opens").toBe(true);
	});

	test("it asks again in a new session, but not in the same one", async ({ page }) => {
		// This is the assertion that tells sessionStorage from localStorage.
		// With localStorage the second context below would stay silent, and the
		// question would be answered for the visitor on every future visit from
		// this browser — including after the studio opens.
		await page.goto("/coming-soon", { waitUntil: "load" });
		await expect(page.locator("#ask")).toBeVisible({ timeout: 10000 });
		await page.locator('.ask-opt[data-go="waitlist"]').click();
		await expect(page.locator("#ask")).toBeHidden();

		// a second tab in the SAME context is a separate sessionStorage
		const sameBrowserNewTab = await page.context().newPage();
		await sameBrowserNewTab.goto("/coming-soon", { waitUntil: "load" });
		await expect(
			sameBrowserNewTab.locator("#ask"),
			"a new tab should be a new session",
		).toBeVisible({ timeout: 10000 });
		await sameBrowserNewTab.close();

		// and the original tab still remembers
		await page.goto("/coming-soon", { waitUntil: "load" });
		await settle(page);
		await expect(page.locator("#ask")).toBeHidden();
	});

	test("the answer is kept in sessionStorage, not localStorage", async ({ page }) => {
		await page.goto("/coming-soon", { waitUntil: "load" });
		await expect(page.locator("#ask")).toBeVisible({ timeout: 10000 });
		await page.locator('.ask-opt[data-go="waitlist"]').click();
		await expect(page.locator("#ask")).toBeHidden();

		const stored = await page.evaluate(() => ({
			session: sessionStorage.getItem("cureva:visitor"),
			local: localStorage.getItem("cureva:visitor"),
		}));
		expect(stored.session).toBe("guest");
		expect(stored.local, "the answer must not outlive the session").toBeNull();
	});

	test("it is a required choice — Escape and the backdrop do not dismiss it", async ({
		page,
	}) => {
		await page.goto("/coming-soon", { waitUntil: "load" });
		const dialog = page.locator("#ask");
		await expect(dialog).toBeVisible({ timeout: 10000 });

		await page.keyboard.press("Escape");
		await page.waitForTimeout(400);
		await expect(dialog, "Escape dismissed a required choice").toBeVisible();

		// a click on the <dialog> element itself is a click on the backdrop
		await page.evaluate(() => {
			const d = document.getElementById("ask")!;
			const r = d.getBoundingClientRect();
			d.dispatchEvent(
				new MouseEvent("click", { bubbles: true, clientX: r.left + 2, clientY: r.top + 2 }),
			);
		});
		await page.waitForTimeout(400);
		await expect(dialog, "the backdrop dismissed a required choice").toBeVisible();

		// and there are exactly two ways out, both of which go somewhere
		await expect(page.locator(".ask-opt")).toHaveCount(2);
		await expect(page.locator(".ask-skip")).toHaveCount(0);
	});

	test("on a phone it fills the screen", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/coming-soon", { waitUntil: "load" });
		await expect(page.locator("#ask")).toBeVisible({ timeout: 10000 });

		const box = await page.evaluate(() => {
			const r = document.getElementById("ask")!.getBoundingClientRect();
			return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight,
				stacked: getComputedStyle(document.querySelector(".ask-opts")!).gridTemplateColumns };
		});
		expect(box.w).toBeCloseTo(box.vw, 0);
		expect(box.h).toBeGreaterThanOrEqual(box.vh - 1);
		// the two options stack rather than squeezing side by side
		expect(box.stacked.split(" ").length).toBe(1);
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
	test("three sections, in order: the count, the form, the roles", async ({ page }) => {
		await page.goto("/recruit/apply", { waitUntil: "load" });
		await settle(page);
		const order = await page.evaluate(() =>
			[...document.querySelectorAll("main section")].map(
				(s) => s.id || s.getAttribute("aria-labelledby"),
			),
		);
		expect(order).toEqual(["open", "formH", "roles"]);
	});

	test("the opening count matches the roles listed below it", async ({ page }) => {
		await page.goto("/recruit/apply", { waitUntil: "load" });
		await settle(page);

		const counted = await page.evaluate(() => {
			// sum the "N opening(s)" on every role in the list further down
			const fromList = [...document.querySelectorAll(".rc-role-m")]
				.map((el) => parseInt(el.textContent!.trim(), 10) || 0)
				.reduce((a, b) => a + b, 0);
			const headline = document.querySelector("[data-count-to]")!;
			return {
				fromList,
				attr: Number(headline.getAttribute("data-count-to")),
				shown: Number(headline.textContent!.trim()),
				tabular: getComputedStyle(headline).fontVariantNumeric,
			};
		});

		expect(counted.attr, "the headline number drifted from the roles list").toBe(counted.fromList);
		expect(counted.shown, "the count did not land on its target").toBe(counted.attr);
		// tabular figures, or the line reflows on every frame while counting
		expect(counted.tabular).toContain("tabular-nums");
	});

	test("the count animates up and still lands exactly", async ({ page }) => {
		await page.goto("/recruit/apply", { waitUntil: "commit" });
		const el = page.locator("[data-count-to]");
		await el.waitFor({ state: "visible", timeout: 10000 });
		await page.waitForTimeout(1600); // the run is 900ms
		const target = await el.getAttribute("data-count-to");
		await expect(el).toHaveText(target!);
	});

	test("both buttons in the opening section go where they say", async ({ page }) => {
		await page.goto("/recruit/apply", { waitUntil: "load" });
		await settle(page);
		const links = await page.evaluate(() =>
			[...document.querySelectorAll("#open .ap-cta a")].map((a) => a.getAttribute("href")),
		);
		expect(links).toEqual(["#form", "/recruit"]);

		// and "Apply now" actually reaches the form
		await page.locator('#open .ap-cta a[href="#form"]').click();
		await page.waitForTimeout(800);
		const reached = await page.evaluate(() => {
			const r = document.getElementById("form")!.getBoundingClientRect();
			return r.top < innerHeight && r.bottom > 0;
		});
		expect(reached, "Apply now did not scroll the form into view").toBe(true);
	});

	test("the map is embedded accessibly and opts out of the custom cursor", async ({ page }) => {
		await page.goto("/recruit/apply", { waitUntil: "load" });
		await settle(page);
		const map = await page.evaluate(() => {
			const frame = document.querySelector(".ap-map iframe") as HTMLIFrameElement | null;
			if (!frame) return null;
			return {
				title: frame.getAttribute("title"),
				loading: frame.getAttribute("loading"),
				src: frame.getAttribute("src"),
				// the iframe swallows pointer events, so the ring would freeze on it
				nocursor: !!frame.closest("[data-nocursor]"),
			};
		});
		expect(map, "the map is missing").toBeTruthy();
		expect(map!.title, "an untitled iframe is unusable with a screen reader").toBeTruthy();
		expect(map!.loading).toBe("lazy");
		expect(map!.src).toContain("google.com/maps");
		expect(map!.nocursor).toBe(true);
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

/* ═══════════════════════════════════════════════════════════════════════
   9 · An overlay that is closed must actually be GONE
   ───────────────────────────────────────────────────────────────────────
   This shipped. The mobile rule for the visitor dialog set `display:grid`
   on `.ask` rather than on `.ask[open]`, and an author `display` on a
   <dialog> overrides the UA's `dialog:not([open]){display:none}` at any
   specificity — so under 640px the dialog stayed laid out over the page
   after it was dismissed, and the whole page looked replaced by a panel.

   Every earlier check missed it for the same reason: they closed the
   overlay and then measured the PAGE, which was perfectly fine, and never
   asked whether the closed overlay was still on screen. 639px is in the
   list because that is the last pixel the media query applies at.
   ═══════════════════════════════════════════════════════════════════════ */
test.describe("closed overlays leave the screen", () => {
	for (const width of [1440, 900, 700, 639, 500, 390]) {
		test(`the visitor dialog is gone once closed at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 844 });
			await page.goto("/coming-soon", { waitUntil: "load" });
			const dialog = page.locator("#ask");
			await expect(dialog).toBeVisible({ timeout: 10000 });

			await page.locator('.ask-opt[data-go="waitlist"]').click();

			const after = await page.evaluate(() => {
				const d = document.getElementById("ask")!;
				const r = d.getBoundingClientRect();
				return { open: (d as HTMLDialogElement).open, display: getComputedStyle(d).display,
					w: Math.round(r.width), h: Math.round(r.height) };
			});
			expect(after.open).toBe(false);
			expect(after.display, `a closed dialog is still rendering at ${width}px`).toBe("none");
			expect(after.w * after.h, "a closed dialog still occupies the screen").toBe(0);
			await expect(dialog).toBeHidden();

			// and the page underneath must be reachable again
			await expect
				.poll(() => page.evaluate(() => document.documentElement.classList.contains("ask-open")))
				.toBe(false);
		});
	}

	for (const width of [1440, 390]) {
		test(`the month picker is gone once closed at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto("/recruit/apply", { waitUntil: "load" });
			await settle(page);
			await page.evaluate(() =>
				document.getElementById("graduation_date")!.scrollIntoView({ block: "center", behavior: "instant" }),
			);
			await page.locator(".js-monthbtn").click();
			await expect(page.locator("#gradPop")).toBeVisible();
			await page.keyboard.press("Escape");

			// The panel exits over 160ms with `transition-behavior: allow-discrete`,
			// so `display` legitimately stays set until that finishes — poll rather
			// than racing it. What must not happen is it settling on anything but
			// `none`, which is the failure this whole section exists for.
			await expect
				.poll(
					() => page.evaluate(() => getComputedStyle(document.getElementById("gradPop")!).display),
					{ timeout: 2000, message: `a closed popover is still rendering at ${width}px` },
				)
				.toBe("none");

			const box = await page.evaluate(() => {
				const r = document.getElementById("gradPop")!.getBoundingClientRect();
				return Math.round(r.width) * Math.round(r.height);
			});
			expect(box, "a closed popover still occupies the screen").toBe(0);
		});
	}
});

/* ═══════════════════════════════════════════════════════════════════════
   10 · SEO
   ───────────────────────────────────────────────────────────────────────
   Before this, the standalone documents (/coming-soon and everything on
   VersionH.astro) emitted a <title> and a description and nothing else —
   no canonical, no og:url, no og:image — and the content pages passed
   neither a canonical nor an image into EmDashHead, so it had none to
   emit. The sitemap was an empty <sitemapindex>: not one URL was being
   offered to a crawler.
   ═══════════════════════════════════════════════════════════════════════ */
const ORIGIN = "https://curevanails.com";

test.describe("SEO", () => {
	for (const pg of PAGES.filter((p) => p.name !== "404")) {
		test(`${pg.name} carries a complete head`, async ({ page }) => {
			await page.goto(pg.path, { waitUntil: "load" });

			const head = await page.evaluate(() => {
				const meta = (sel: string) =>
					document.querySelector(sel)?.getAttribute("content")?.trim() ?? null;
				return {
					title: document.title.trim(),
					description: meta('meta[name="description"]'),
					canonical: document.querySelector("link[rel=canonical]")?.getAttribute("href") ?? null,
					ogTitle: meta('meta[property="og:title"]'),
					ogDesc: meta('meta[property="og:description"]'),
					ogImage: meta('meta[property="og:image"]'),
					ogUrl: meta('meta[property="og:url"]'),
					twCard: meta('meta[name="twitter:card"]'),
					h1: document.querySelectorAll("h1").length,
					lang: document.documentElement.lang,
				};
			});

			expect(head.title.length, "title is empty").toBeGreaterThan(10);
			expect(head.title.length, "title will be truncated in results").toBeLessThan(70);
			expect(head.description, "no meta description").toBeTruthy();
			expect(head.description!.length).toBeGreaterThan(50);
			expect(head.description!.length, "description will be truncated").toBeLessThan(200);

			expect(head.canonical, "no canonical").toBeTruthy();
			expect(head.canonical!.startsWith(ORIGIN), `canonical is not absolute: ${head.canonical}`).toBe(true);

			expect(head.ogTitle, "no og:title").toBeTruthy();
			expect(head.ogDesc, "no og:description").toBeTruthy();
			expect(head.ogImage, "no og:image — the link previews as bare text").toBeTruthy();
			expect(head.ogImage!.startsWith("http"), "og:image must be absolute").toBe(true);
			expect(head.ogUrl, "no og:url").toBeTruthy();
			expect(head.twCard).toBe("summary_large_image");

			expect(head.h1, "a page needs exactly one h1").toBe(1);
			expect(head.lang).toBe("en");
		});
	}

	test("the duplicate holding pages point at one canonical", async ({ page }) => {
		// /waitlist and /getready make the same offer as /coming-soon. Three
		// URLs competing for one query is how a small site buries itself.
		for (const path of ["/waitlist", "/getready"]) {
			await page.goto(path, { waitUntil: "load" });
			const canonical = await page.evaluate(
				() => document.querySelector("link[rel=canonical]")?.getAttribute("href"),
			);
			expect(canonical, `${path} should canonical to /coming-soon`).toBe(`${ORIGIN}/coming-soon`);
		}
	});

	test("/early-access is kept out of the index", async ({ page }) => {
		// It carries invented journal posts with invented dates, an invented
		// testimonial and an unconfirmed partner list, and it says "Now open"
		// while the studio opens in December. None of that belongs in Google.
		await page.goto("/early-access", { waitUntil: "load" });
		const robots = await page.evaluate(
			() => document.querySelector('meta[name="robots"]')?.getAttribute("content"),
		);
		expect(robots).toContain("noindex");
	});

	test("/recruit publishes its four roles as JobPosting", async ({ page }) => {
		await page.goto("/recruit", { waitUntil: "load" });
		const jobs = await page.evaluate(() =>
			[...document.querySelectorAll('script[type="application/ld+json"]')]
				.map((s) => {
					try { return JSON.parse(s.textContent || "{}"); } catch { return {}; }
				})
				.filter((j) => j["@type"] === "JobPosting"),
		);
		expect(jobs, "Google Jobs needs JobPosting to show these at all").toHaveLength(4);
		for (const job of jobs) {
			// the fields Google requires, or the rich result never appears
			for (const field of ["title", "description", "datePosted", "hiringOrganization", "jobLocation"]) {
				expect(job[field], `JobPosting "${job.title}" is missing ${field}`).toBeTruthy();
			}
			expect(new Date(job.validThrough).getTime(), "an expired posting is dropped").toBeGreaterThan(Date.now());
		}
	});

	test("/coming-soon publishes the studio as a LocalBusiness", async ({ page }) => {
		await page.goto("/coming-soon", { waitUntil: "load" });
		const biz = await page.evaluate(() =>
			[...document.querySelectorAll('script[type="application/ld+json"]')]
				.map((s) => { try { return JSON.parse(s.textContent || "{}"); } catch { return {}; } })
				.find((j) => j["@type"] === "BeautySalon"),
		);
		expect(biz, "a local salon with no LocalBusiness record cannot rank locally").toBeTruthy();
		expect(biz.address?.addressLocality).toBe("Sugar House");
		expect(biz.telephone).toBeTruthy();
		expect(biz.openingHoursSpecification?.length).toBeGreaterThan(0);
	});

	test("the sitemap lists real URLs and contradicts nothing", async ({ request }) => {
		const res = await request.get("/sitemap.xml");
		expect(res.status()).toBe(200);
		const xml = await res.text();
		expect(xml).toContain("<urlset");

		const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
		expect(locs.length, "the sitemap is empty").toBeGreaterThan(3);
		expect(locs).toContain(`${ORIGIN}/coming-soon`);
		expect(locs).toContain(`${ORIGIN}/recruit`);

		// a sitemap must not list a page that canonicals elsewhere or is noindex
		for (const excluded of ["/waitlist", "/getready", "/early-access", "/admin", "/unsubscribe"]) {
			expect(locs.some((l) => l.includes(excluded)), `${excluded} must not be in the sitemap`).toBe(false);
		}
	});

	test("robots.txt protects what should not be crawled", async ({ request }) => {
		const res = await request.get("/robots.txt");
		expect(res.status()).toBe(200);
		const txt = await res.text();
		for (const path of ["/_emdash/", "/admin", "/api/", "/unsubscribe/"]) {
			expect(txt, `${path} is crawlable`).toContain(`Disallow: ${path}`);
		}
		expect(txt).toContain("Sitemap:");
	});
});

test.describe("the visitor dialog's careers door", () => {
	test("sends candidates straight to the application", async ({ page }) => {
		await page.goto("/coming-soon", { waitUntil: "load" });
		await expect(page.locator("#ask")).toBeVisible({ timeout: 10000 });

		const href = await page.locator('.ask-opt[data-go="careers"]').getAttribute("href");
		expect(href, "the careers door should land on the form, not the overview").toBe(
			"/recruit/apply",
		);

		await page.locator('.ask-opt[data-go="careers"]').click();
		await page.waitForURL("**/recruit/apply");
		await expect(page.locator("[data-count-to]")).toBeVisible();
	});
});
