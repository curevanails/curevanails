# Cure Và · Version H — design system

Everything needed to run version H, and to build new pages that look like it.

> Folder is `version-h`, not `version H`. A space in a path breaks half the
> CLI invocations you are about to point at it.

---

## 1 · What version H needs to run

Version H is **one HTML file with an inline `<style>` and one inline
`<script>`**, compiled from a template by a Python string-substituter. It has
no npm, no bundler, no framework and no runtime dependency beyond two Google
fonts.

To build and serve the page exactly as it runs today, you need six things:

| | what | why |
|---|---|---|
| 1 | `landing-page-h.template.html` | the source of truth — markup, CSS and JS in one file |
| 2 | `build-h.py` | compiles the template into two targets, and runs 11 guards |
| 3 | `img-dims.json` | intrinsic width/height per image, so lazy images cannot shift the page |
| 4 | `dist/public/img/*.webp` | **28 files, 1.85 MB** — see §1.1 |
| 5 | `dist/wrangler.jsonc` | the Cloudflare Worker that serves `dist/public` as static assets |
| 6 | `e2e/version-h.test.js` | 500 assertions across 7 profiles — the thing that says it still works |

Nothing else in the repo is required. Versions A–G are independent.

### 1.1 · The 28 images

```
d-facial      d-feet        d-hero-drop   d-hero-hands  d-hero-room
d-lash        d-lash2       d-leaf2       d-leaf3       d-linen
d-linen2      d-lounge      d-nails-a     d-nails-b     d-nails-c
d-nails-d     d-oil         d-pedi        d-rest        d-ripple
d-serum       d-spa-light   d-work        e-space       g-chair
g-vy          h-applying    h-bare
```

All `.webp`, all in `dist/public/img/`, shared with versions A–G. Every one
must also have an entry in `img-dims.json` or the build fails.

### 1.2 · Fonts

Two families from Google Fonts, loaded with one `<link>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..700,0..100,0..1;1,9..144,300..700,0..100,0..1&family=Manrope:wght@300..800&display=swap">
```

**This is the only external request the page makes.** `build-h.py` guard 9
fails the build if a second one appears.

> ⚠️ These are the Google Fonts releases. `cureva-web-blockers` records that
> the delivered brand package ships *trial* licences of the display faces —
> confirm the licence before this goes to a paying domain.

### 1.3 · Build, test, deploy

```bash
python3 build-h.py                 # → landing-page-h.html  +  dist/public/version-h/index.html
node e2e/version-h.test.js         # 500 assertions, 7 profiles, against the local build
cd dist && npx wrangler deploy     # → https://cureva-preview.curevanails-tech.workers.dev/version-h/

# the same suite against what is actually live:
TARGET="https://cureva-preview.curevanails-tech.workers.dev/version-h/" node e2e/version-h.test.js
```

`build-h.py` writes **two** targets from one template:

- `landing-page-h.html` — every image inlined as a data URI. One file, ~3.9 MB,
  openable from disk and emailable.
- `dist/public/version-h/index.html` — external images with `width`/`height`
  stamped and `loading="lazy"` applied. ~216 KB. This is what deploys.

If the wrangler token has expired the deploy fails with
`Authentication error [code: 10000]` while printing a scope list that looks
like progress. It is not. Run `npx wrangler login` first.

---

## 2 · What is in this folder

```
version-h/
  README.md                  you are here
  DESIGN-SYSTEM.md           the spec: tokens, type, space, components, motion, a11y
  GUIDE.md                   how to build a new page, section or email
  css/
    01-tokens.css            the theme — every colour, twice (dark + .on-light)
    02-base.css              reset, document defaults, type atoms
    03-components.css        Button · Badge · Card · Label · Input · Checkbox ·
                             Alert · Separator · Tabs
    04-motion.css            reveals, image frames, preloader, cursor, grain,
                             progress rail, reduced-motion
    05-chrome.css            nav, full-screen menu, section shell, footer, contour
    06-landing-sections.css  the landing page's own sections — reference only
  js/
    runtime.js               preloader, reveals, cursor + magnets, nav, menu,
                             live motion-preference listener
  html/
    _page.html               blank page skeleton, chrome wired, nothing else
    coming-soon.html         a one-screen holding page
    careers.html             a content page with a form
  email/
    README.md                why email is a different system
    email-base.html          table-based, hex palette, tested shape
  build/
    extract.py               re-splits the template into css/ and js/
    build-page.py            compiles an html/ template the way build-h.py does
```

**Every file in `css/` and `js/` is extracted, not transcribed.** They are
byte-for-byte the rules running at `/version-h/`. The split is verified: 572
selectors in the shipped stylesheet, 572 across the six layers, none missing,
none invented. Re-run `python3 version-h/build/extract.py` from the repo root
after any change to the template.

---

## 3 · Using this from another repo

Point Claude CLI at this folder and give it `GUIDE.md`. The short version:

1. Copy `css/01`–`05` and `js/runtime.js`. Leave `06-landing-sections.css`
   behind unless you want the landing page's own sections.
2. Start from `html/_page.html`. It already has the nav, the menu, the footer,
   the preloader and the section shell.
3. Read `DESIGN-SYSTEM.md` §2 before writing a single colour. **The rule that
   holds the whole thing together is that a component reads tokens and never
   names a colour.** Everything else is a preference; that one is load-bearing.
4. For email, read `email/README.md` first. Custom properties do not work in
   Outlook, so email is a **separate** system that shares only the hexes.

### The invariants worth keeping

These are not style preferences — each one is a bug that already happened once:

- **A component names no colour.** Not a hex, not `rgb(`, not a brand alias.
  Only `hsl(var(--token))`. `build-h.py` guard 6 enforces it.
- **Tokens are bare HSL channels**, not colours: `--ring: 144.8 26.7% 66.3%`.
  It is the only form that allows `hsl(var(--ring) / .25)`. A token that
  resolves to a hex silently kills every alpha use of it.
- **Both grounds, always.** Every token is defined on `:root` *and* re-themed
  under `.on-light`. A token the light scope forgets inherits the dark value
  and the component vanishes on paper.
- **No page state.** No attribute on `<html>` that sections read. What loads is
  what there is, so the JavaScript page and the no-JavaScript page are one page.
- **Motion is transform and opacity.** Every continuous scroll-linked motion is
  a CSS scroll-driven animation. JavaScript handles discrete events only, and
  everything it touches is one custom property. Nothing is measured per frame.
- **`prefers-reduced-motion` removes motion, not information.**

---

## 4 · Still open on version H

Carried forward so they are not lost in a repo move. None are code bugs.

1. **The waitlist form is front-end only.** It validates, it says "You're on the
   list", and it sends nothing anywhere. Wire it before the link reaches a real
   visitor.
2. **§07b's service data contradicts §06.** The menu prices a Signature
   Manicure at $55; the ritual builder prices a Waterless Manicure at $45. Both
   cannot be right on one page. Both arrays are marked as placeholders.
3. **§05's five ingredient chips are another studio's claims**, taken from a
   competitor's page on instruction. Ingredient names are nobody's property, so
   this is not copyright — it is truth in advertising. Vy confirms each one or
   it comes out.
4. **Image weight.** 1.85 MB, and 27 of the 43 `<img>` on the page are served
   at 3–12× the box they are drawn in. `e-space` (the LCP) can be sharpened
   from a 2912 px original; the §05b thumbnails can lose more than half their
   bytes. §05's lens cannot be fixed — there is no larger original.
5. **Nine breakpoints and a real opening date** — see `VERSION-D-ADJUSTMENTS.md` §3.
