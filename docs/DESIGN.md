# CureVà — Pre-launch Design System ("Gallacher Collective" warm theme)

The canonical design system for every **pre-launch marketing page**. The site
root (`/` → `src/pages/index.astro`) redirects to `/coming-soon`, and the
coming-soon splash defines the look every other splash/careers page must match.

**Pages on this system:**

| Page | File | Notes |
| --- | --- | --- |
| `/coming-soon` | `src/pages/coming-soon.astro` | The index page's public face — tokens inlined |
| `/getready` | `src/pages/getready.astro` | Waitlist landing (root of the `getready` Worker) — uses `RecruitHead.astro` |
| `/recruit` | `src/pages/recruit.astro` | Careers / talent list — uses `RecruitHead.astro` |
| `/recruit/apply` | `src/pages/recruit/apply.astro` | Full hiring form — uses `RecruitHead.astro` |

All of these are **standalone documents**: they render their own
`<html>/<head>` and do **not** use `Base.astro` or the blog's `theme.css`.
The shared stylesheet lives in
[`src/components/recruit/RecruitHead.astro`](../src/components/recruit/RecruitHead.astro)
(fonts + the full token set below); `coming-soon.astro` inlines an equivalent
copy. Style blocks must stay `is:inline` so Astro doesn't bundle/reorder them.

> The old teal Material-3 / Tailwind-CDN system survives only on
> `/early-access` (the archived full homepage) and the admin pages (TailAdmin).
> Do not use it for new marketing pages.

## Mood

The Gallacher Collective interior vision — *Intentional · Peaceful ·
Refreshing · Heritage · Natural*. Plaster, travertine, walnut, oak, linen,
real greenery. Calm, warm, editorial; nothing loud or glossy.

## Fonts

| Role | Face | CSS var |
| --- | --- | --- |
| Headings (h1–h4, pull quotes) | **Newsreader** (opsz 6..72, w 400–600, + italic) | `--serif` |
| Body / UI | **DM Sans** (w 400–600) | `--sans` |
| Eyebrows, meta, tags | **DM Mono** (w 400–500) | `--mono` |

Headings are `font-weight: 400–500`, tight line-height (~1.06),
`letter-spacing: -.01em`, `text-wrap: balance`. Italic Newsreader
(`.serif-i`) is the signature accent — use it for one or two words inside a
heading, usually coloured `--sage-deep`.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| `--oat` | `#F6F1E8` | Page background |
| `--plaster` | `#EFE9DE` | Card / band background |
| `--plaster-2` | `#E6DECF` | Deeper plaster |
| `--travertine` | `#D8CDBA` | Putty accents, avatars |
| `--linen` | `#E9E2D3` | Placeholder photo tiles |
| `--oak` | `#C8A97B` | Warm wood accent, selection bg |
| `--oak-deep` | `#B08E5E` | Oak hover |
| `--walnut` | `#5B4632` | Primary buttons, footer bg |
| `--sage` | `#7C8060` | Greenery accents, bullets |
| `--sage-deep` | `#5E6247` | Eyebrows, icons, italic accents |
| `--clay` | `#B07A5B` | Error / required marks / sparing terracotta |
| `--ink` | `#2B2419` | Text (warm near-black) |
| `--muted` | `#7C7160` | Secondary text |
| `--line` / `--line-2` | `#DED5C4` / `#CBBFA9` | Hairlines, input borders |

Rules: warm neutrals only — never pure white (`#fff` appears only inside small
chips/cards on plaster) and never cool greys or the blog blue. Errors and
required asterisks use `--clay`, not red.

## Shape & elevation

- Radii: `--r-lg: 20–22px` (cards), `--r-md: 14–16px` (inputs, tiles),
  `--r-pill: 999px` (buttons, chips, eyebrow pills).
- Shadows: `--sh-sm` / `--sh-md` / `--sh-lg` — soft, warm-tinted
  (`rgba(43,36,25,…)`), never hard or dark.

## Recurring components (classes from `RecruitHead.astro`)

- **`.btn`** — pill buttons. `.btn-primary` walnut/oat, `.btn-outline`
  hairline, `.btn-oak` oak; sizes `.btn-sm` / `.btn-lg`.
- **`.brand`** — Newsreader wordmark + the `.mark` teardrop logo
  (oak→walnut radial, rotated −8°).
- **`.nav`** — sticky, blurred oat bar with hairline bottom border, 78px tall.
- **`.eyebrow`** — DM Mono uppercase kicker with a 22px dash (dash hidden in
  `.center` blocks).
- **`.section`** — 110px vertical padding (74px for `.tight`); `.wrap` maxes
  at 1240px with 44px side padding (22px mobile).
- **`.card`** — plaster card, hairline border, `--r-lg`, `--sh-sm`.
- **`.chip`** / **`.value-pill`** — pill chips with a coloured `.dot`.
- **`.inp` / `.field`** — plaster-toned inputs, walnut focus ring
  (`0 0 0 4px rgba(91,70,50,.1)`), `.err` state in clay.
- **`.ph`** — labeled placeholder photo tiles (diagonal-stripe linen/oak/sage/
  walnut) used until real photography exists.
- **`.footer`** — walnut background, oat text, DM Mono column headings.
- Blobs (`.blobs`/`.blob` on coming-soon) — huge blurred oak/accent circles at
  ~0.3 opacity for background depth. Use sparingly.

## Voice & content rules

- Brand name is **CureVà** in the wordmark/UI, **CURE VÀ** when the copy doc
  spells it that way (e.g. "Why would you like to work at CURE VÀ?").
- Copy comes from the client docs (see `docs/` PDFs): calm, first-person
  plural, no salon clichés. Opening date is **December 2026**; the landing
  page says **Legacy Village**, the careers copy says **Sugar House** —
  keep whichever the source doc uses for that section.
- Every marketing page keeps a single primary CTA per section.

## Motion

- `html { scroll-behavior: smooth; }` on every page (anchor links glide).
- **Page transitions:** cross-document View Transitions — `@view-transition
  { navigation: auto; }` plus a ~0.3s fade-with-lift on
  `::view-transition-old/new(root)`, disabled under
  `prefers-reduced-motion: reduce`. The rules live in `RecruitHead.astro`
  (getready/recruit/apply), inline on `coming-soon` / `waitlist` /
  `early-access`, and in `src/styles/theme.css` for the blog pages. Keep the
  keyframe names (`vt-fade-out` / `vt-fade-in`) and timings in sync across
  copies.

## Astro rules for these pages

- `export const prerender = false;` on every page.
- Keep all `<script>`/`<style>` blocks `is:inline`.
- Forms post JSON to `/api/waitlist` (waitlist) or multipart to `/api/recruit`
  (hiring) — client-side validation must mirror the endpoint's rules.
