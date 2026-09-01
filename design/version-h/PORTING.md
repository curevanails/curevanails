# version-H in this repo — what was changed, and what was not

The system was imported from
`/Users/sonnynguyen/Documents/SpaceShip/curevanails-space/cureva-ui/version-h/`
on 2026-09-01. `README.md`, `DESIGN-SYSTEM.md` and `GUIDE.md` beside this file
are the spec and are byte-for-byte the source. **This file is the only place
that describes the port**, so the spec stays diffable against upstream.

---

## 1 · What came across, and whether it was touched

| | source | here | touched |
|---|---|---|---|
| theme + base + components + motion + chrome + page-variants | `css/01–05`, `css/page-variants.css` | `css/` | **no — byte-identical** |
| runtime | `js/runtime.js` | `js/runtime.js` | **no — byte-identical** |
| page templates | `html/_page.html`, `coming-soon.html`, `careers.html` | `html/` | **no — byte-identical** |
| email | `email/README.md`, `email-base.html` | `email/` | **no — byte-identical** |
| the spec | `README.md`, `DESIGN-SYSTEM.md`, `GUIDE.md` | here | **no — byte-identical** |
| re-splitter | `build/extract.py` | `build/extract.py` | **no** — and it cannot run here, see §3 |
| page compiler | `build/build-page.py` | `build/build-page.py` | paths only, see §2 |
| smoke suite | `build/smoke.js` | `build/smoke.js` | paths + ESM, see §2 |
| photography | `dist/public/img/*.webp` (28 of 57) | `public/img/` | **no — md5-identical** |
| intrinsic sizes | `img-dims.json` (repo root) | `img-dims.json` | **no** — copied whole, 68 entries for 28 images |

`css/06-landing-sections.css` was deliberately **not** copied. It is the
landing page's own eleven sections, which this repo does not have; README §3
says to leave it behind unless you want them.

---

## 2 · The three things that had to change

Everything here is mechanical. No rule, measurement, token or assertion moved.

**Where the system lives.** Upstream it sat at `<repo>/version-h/` and read its
photography from `<repo>/dist/public/img/` with `img-dims.json` at the repo
root. Here the system lives under `design/version-h/` and the photography is a
real site asset: the 28 images sit in `public/img/`, which Astro serves at
`/img/…` — exactly where the `../img/…` this script stamps has to resolve.
`img-dims.json` stays with the system. (`dist` is git-ignored at any depth in
this repo, so assets under a `dist/` path would never have been committed.)
`build-page.py` derives all four paths from its own location; that block is the
only edit in the file and it says so.

**`smoke.js` is now ESM.** This package is `"type": "module"`, so a `.js` file
cannot `require()`. Same imports in the same order, and `chromium` now comes
from `@playwright/test` — this repo's own devDependency — rather than a bare
`playwright` that only resolved out of a home-directory `node_modules`. It
also serves two document roots instead of one: built pages reference their
photography as `../img/…`, so the server tries `dist/` first and `public/`
second — which is what the deployed site does. Every assertion is upstream's,
unchanged.

**Build output goes to `design/version-h/dist/`,** which the existing `dist`
ignore rule keeps out of git. Generated pages are not committed.

---

## 3 · What does not work here, by construction

`build/extract.py` re-splits `landing-page-h.template.html` into `css/` and
`js/`. That template is version H's source of truth and it stayed in
`cureva-ui`. The script is kept for provenance: **when the system changes,
change it upstream, re-run `extract.py` there, and re-copy `css/` + `js/`
here.** Running it in this repo fails at `open(SRC)` — which is the safe
failure, not a silent one.

The spec files likewise reference upstream-only things: `build-h.py`,
`landing-page-h.template.html`, `e2e/version-h.test.js`,
`VERSION-D-ADJUSTMENTS.md`, `dist/wrangler.jsonc`, and the
`cureva-preview.curevanails-tech.workers.dev` deploy. Read those as pointers
back into `cureva-ui`, not as paths in this repo.

---

## 4 · The site runs on this system

The import is no longer inert: **every public page now renders in version H.**

| route | layout | notes |
|---|---|---|
| `/` | — | 302 → `/coming-soon` |
| `/coming-soon` | its own document | **pixel-locked** to the standalone build — see §5 |
| `/recruit`, `/recruit/apply` | `VersionH.astro` | original copy, new design; the D1/R2 intake is untouched |
| `/getready`, `/waitlist`, `/early-access` | `VersionH.astro` | original copy, new design |
| `/posts`, `/posts/[slug]`, `/search`, `/category`, `/tag`, `/pages/[slug]`, `/404` | `Base.astro` | version-H chrome + every EmDash integration point |
| `/admin*`, `/notify*`, `/_emdash/*` | unchanged | internal tooling, deliberately out of scope |

The 28 assets moved to `public/img/`, which Astro serves at `/img/…` — exactly
where `build-page.py` stamps them, so a page built by the standalone chain and
a page rendered by Astro reference the same URLs.

`css/06-landing-sections.css` is still not copied. This repo has no landing
page; `src/styles/version-h-content.css` is its editorial layer instead.

## 5 · How to build and verify

```bash
python3 design/version-h/build/build-page.py html/coming-soon.html design/version-h/dist/soon/
python3 design/version-h/build/build-page.py html/careers.html      design/version-h/dist/careers/
python3 design/version-h/build/build-page.py html/_page.html        design/version-h/dist/_skeleton/
node design/version-h/build/smoke.js
```

`smoke.js` expects those three output paths (`/soon/`, `/careers/`,
`/_skeleton/`) — it is the upstream page list. Screenshots land in
`design/version-h/dist/_screens/`; override with `SMOKE_OUT`.

Last run: all six profiles clean (3 pages × 1440 and 390), guards passing —
CSS balanced, component layer names no colour, 17 shadcn tokens defined and
re-themed on both grounds as bare HSL triplets, one external stylesheet (the
fonts), no image without `alt`.

---

## 6 · Carried forward — known, deliberate, awaiting the client

Not code bugs. Do not "fix" these without a decision.

1. **Every form is front-end only.** `coming-soon.html` and `careers.html`
   validate, announce themselves accessibly, and say thank you. They send
   nothing. Note that this repo *already has* a real intake pipeline
   (`src/pages/api/recruit.ts`, `src/pages/api/waitlist.ts`) — wiring these
   forms to it is a small job and an obvious one, but it is not what the
   import was.
2. **The ritual-builder service data contradicts the landing page menu** on
   purpose. Both `PACKAGES` / `SERVICES` in `js/runtime.js` are marked
   placeholders; §06 prices a Signature Manicure at $55, the builder prices a
   Waterless Manicure at $45.
3. **§05's five ingredient chips** are a competitor's claims, taken on the
   client's instruction, and are unconfirmed. (They live in
   `06-landing-sections.css`, which was not copied — the note travels with the
   system anyway.)
4. **Fonts are the Google Fonts releases.** The delivered brand package ships
   *trial* licences of the display faces. Confirm before a paying domain.

## 7 · Found during verification — and fixed

**Pages did not work with JavaScript off.** `04-motion.css` line 15 sets
`[data-r]{opacity:0}` and only `runtime.js` ever adds `.in`, so with scripting
disabled every revealed element stayed invisible — a careers page that rendered
as an empty paper field with a nav and one button.

This is **upstream's behaviour, not the port's**: there is no `<noscript>`
anywhere in the web system, so `/version-h/` itself does the same. It was
tolerable while the import was inert. It stopped being tolerable the moment the
whole site moved onto the system, so the fallback is now in all three
documents — `VersionH.astro`, `Base.astro` and `coming-soon.astro`:

```html
<noscript><style>
  [data-r]{opacity:1!important;transform:none!important;clip-path:none!important}
  #pre{display:none!important}
</style></noscript>
```

It costs nothing when scripts run (`<noscript>` is inert then) and it does not
move a pixel — `parity.js` still reports 0/1,296,000 differing.

**It belongs upstream too.** Add it to `landing-page-h.template.html` and the
three `html/` templates in `cureva-ui`, so `extract.py` keeps carrying it.

## 8 · Invariants this repo knowingly breaks

One, in one place, and it is commented at the top of the file.

`/early-access` loads the Mangomint booking widget from
`booking.mangomint.com`, which is a **second external request** — the system
allows exactly one, the Google Fonts link, and `build-page.py` guard 9 fails a
build that adds another. Booking is what that page is for, so the widget stays.
The CTAs are plain anchors to the hosted booking URL, so they still work when
the script does not load.
