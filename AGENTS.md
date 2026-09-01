This is the **CureVà Beauty Lounge** website -- an EmDash site (a CMS built on Astro with a full admin UI) that pairs a standalone marketing landing page with a blog/content system, deployed to Cloudflare Workers.

## Tech Stack

| Layer | Choice |
| --- | --- |
| Framework | Astro `^6.3`, `output: "server"` (all CMS pages server-rendered) |
| CMS | EmDash `^0.16` (`emdash`, `@emdash-cms/cloudflare`) |
| Runtime | Cloudflare Workers (`@astrojs/cloudflare` adapter) |
| Database | Cloudflare D1 (binding `DB`, database `curevanails`) |
| Media | Cloudflare R2 (binding `MEDIA`, bucket `curevanails-media`) |
| Sessions | Cloudflare KV (binding `SESSION`) |
| UI islands | React 19 (`@astrojs/react`) |
| Plugins | `@emdash-cms/plugin-forms`, `@emdash-cms/plugin-webhook-notifier` |
| Booking | Mangomint embedded online booking widget (Company ID `463532`) |
| Package manager | pnpm |

## Commands

```bash
npx emdash dev        # Start dev server (runs migrations, seeds, generates types)
npx emdash types      # Regenerate TypeScript types from schema
pnpm build            # astro build (compiles the Cloudflare Worker)
pnpm typecheck        # astro check
pnpm deploy           # astro build && wrangler deploy (main curevanails site)
pnpm deploy:getready  # build & deploy the standalone getready waitlist-landing Worker (design: docs/DESIGN.md)
pnpm deploy:admin     # build & deploy the admin console + email Worker (recruit, waitlist, /mail)
pnpm test:e2e         # build + preview the Worker, run the Playwright E2E suite (docs/TESTING.md)
pnpm test:e2e:mail    # build + preview the admin Worker, run the email-dashboard E2E suite (e2e/mail/)
```

The EmDash content admin is at `http://localhost:4321/_emdash/admin`.
The recruit dashboard is at `/admin` (login at `/admin/login`) — see "Recruit & Admin" below and [`docs/ADMIN.md`](docs/ADMIN.md).

## Verify

After a change, verify end-to-end before committing:

1. `pnpm build` succeeds (the Cloudflare adapter compiles the Worker).
2. `pnpm typecheck` passes.
3. `/` 302s to `/coming-soon`, which renders the version-H holding page. **`/coming-soon` must stay pixel-identical to the standalone build** — run `node design/version-h/build/parity.js` (needs `pnpm preview` and the design-system build; see "Design system" below).
4. Booking CTAs on `/early-access` (**Book now**, **Book your visit**) open the Mangomint popup; they fall back to `https://booking.mangomint.com/463532` if the widget script hasn't loaded. Booking must be enabled in the Mangomint account for the popup to appear.
5. Blog routes respond: `/posts`, a single post, `/search`, `/rss.xml`.
6. `/_emdash/admin` loads.
7. If you touched recruit/admin: `/recruit` renders the form; `/admin` redirects to `/admin/login` when signed out; logging in shows the dashboard. (See [`docs/ADMIN.md`](docs/ADMIN.md).) Run `pnpm test:e2e` — the Playwright suite in `e2e/` covers the apply form and the admin dashboard end-to-end (see [`docs/TESTING.md`](docs/TESTING.md)).

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, and storage                    |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/seed.json`         | Schema definition + demo content (collections, fields, taxonomies, menus, widgets) |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Content-page layout: version-H chrome + EmDash wiring (menus, search, contributions) |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |
| `src/pages/index.astro`  | 302s to `/coming-soon`. The site root is the holding page, not a landing page      |
| `design/version-h/`      | **The design system** — the whole public site runs on it (see "Design system")     |
| `src/styles/version-h.css` | The six system layers, in load order. The only stylesheet a page imports         |
| `src/styles/version-h-content.css` | This repo's editorial layer — articles, post lists, search, archives     |
| `src/layouts/VersionH.astro` | Version-H shell for the marketing pages                                       |
| `src/middleware.ts`      | Standalone-Worker root rewrites (`getready`/`admin`) + the admin auth gate         |
| `src/pages/recruit.astro` + `src/pages/api/recruit.ts` | Job application form + intake endpoint (writes D1 `job_applications` + R2 `recruit/`) |
| `src/pages/admin/`       | Recruit dashboard (`index.astro`), `login.astro`, `logout.ts`, `file.ts` (R2 download) |
| `src/utils/admin-auth.ts` | Signed session-cookie helpers for the admin login (see "Recruit & Admin")          |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.

## Documentation

The EmDash docs are available as an MCP server at `https://docs.emdashcms.com/mcp`. When you need to verify an API, hook, config option, field type, or pattern, call `search_docs` against the live documentation rather than relying on training-data recall. The docs reflect current behaviour; assumptions may not.

This template ships with `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json` so Claude Code, Cursor, and VS Code auto-discover the docs server. Other tools (OpenCode, Windsurf, etc.) need a manual one-time setup -- see [docs.emdashcms.com/docs-mcp](https://docs.emdashcms.com/docs-mcp).

Project docs in `docs/` (index: [`docs/README.md`](docs/README.md)):

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — **start here.** The whole platform in Mermaid diagrams: the three Workers, shared D1/R2/KV, auth, the recruit application + email flows, CI/CD, and the D1 data model.
- [`docs/RECRUIT.md`](docs/RECRUIT.md) — the `/recruit/apply` Hiring Form field contract (fields, validation, D1 columns, R2 layout, the multi-Worker topology). Update it whenever the form changes.
- [`docs/mail/`](docs/mail/README.md) — the email system (dashboard at `/mail`, SES send, scheduled campaigns, SNS webhook, unsubscribe). Now hosted on the `admin` Worker; formerly the standalone `notifications-service` repo / `notify` Worker.
- [`docs/ADMIN.md`](docs/ADMIN.md) — the recruit admin dashboard, auth, and endpoints.
- [`docs/TESTING.md`](docs/TESTING.md) — the Playwright E2E suite (`e2e/`): how to run it, structure, and conventions.
- [`docs/DESIGN.md`](docs/DESIGN.md), [`docs/EMAIL.md`](docs/EMAIL.md) — the getready landing design and email sending.

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).

## This Template

Started life as an EmDash blog template. It is now the **Cure Và** site: a
pre-launch marketing site (holding page, careers, waiting list) plus a Journal
built on the EmDash CMS, all on one design system — see "Design system" below.
The blog machinery (posts, pages, categories, tags, full-text search, RSS) is
intact and still EmDash's; only its skin changed.

## Pages

| Page        | Path               | What it shows                                                                                          |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| Home        | `/`                | 302 → `/coming-soon`                                                                                   |
| Coming soon | `/coming-soon`     | The version-H holding page + waitlist form. **Pixel-locked to the standalone build**                   |
| Get ready   | `/getready`        | Waiting-list landing; also the root of the standalone `getready` Worker                                |
| Waitlist    | `/waitlist`        | Waiting-list holding page (near-duplicate of `/getready` — see PORTING.md)                             |
| Early access| `/early-access`    | The full editorial homepage layout. Loads the Mangomint booking widget                                 |
| All posts   | `/posts`           | Article count, full post list with excerpts and tag chips                                              |
| Post detail | `/posts/[slug]`    | Featured image, title, body, left meta column (authors + date), right TOC + search + categories gutter |
| Search      | `/search`          | Full-text search UI                                                                                    |
| Page        | `/pages/[slug]`    | Static page content (Portable Text)                                                                    |
| Category    | `/category/[slug]` | Posts filtered by category                                                                             |
| Tag         | `/tag/[slug]`      | Posts filtered by tag                                                                                  |
| RSS         | `/rss.xml`         | Generated feed                                                                                         |
| Careers     | `/recruit`         | Careers page (version-H design, original copy); full application at `/recruit/apply` (POSTs to `/api/recruit`) |
| Admin login | `/admin/login`     | Styled login form for the admin console                                                                |
| Admin       | `/admin`           | Recruit dashboard — lists `job_applications`, résumé downloads (auth-gated)                            |
| Email       | `/admin/mail`      | Email dashboard — compose/send, templates, logs, settings, recruit alerts (auth-gated)                |

## Recruit & Admin

The application form (`/recruit/apply`) writes applicants to the D1
`job_applications` table and uploads the optional résumé to R2 under
`recruit/<id>/…`. A
password-protected dashboard reviews them. **Guides: the form field contract is
[`docs/RECRUIT.md`](docs/RECRUIT.md); the dashboard is
[`docs/ADMIN.md`](docs/ADMIN.md); the E2E coverage is
[`docs/TESTING.md`](docs/TESTING.md).** Key points for editing:

- **Three Workers, one codebase.** `getready` and `admin` reuse this code under
  different Worker names (= subdomains), selected by a `*_STANDALONE` var read in
  `src/middleware.ts`. The build must be driven by the matching wrangler config
  via `WRANGLER_CONFIG` (the `deploy:getready` / `deploy:admin` scripts do this),
  not by `wrangler deploy -c`. All three share the same D1 (+ R2).
- **Email lives on the `admin` Worker** (the standalone notify service was
  retired — everything is on `admin.curevanails.com`). The email dashboard is
  served under `/mail` (admin Worker) or `/admin/mail` (main Worker), gated by
  the same admin session, with `/settings` + `/recruit-alerts` sub-pages and the
  admin-gated `/api/email/*` + `/api/settings` endpoints. The public halves — the
  `/api/webhooks/ses` SNS receiver and the token-based `/unsubscribe/*` page —
  stay open. The dashboard pages physically live at `src/pages/notify/*` (direct
  `/notify/*` access is blocked; reachable only via the `/mail` rewrite), and
  base-aware links come from `src/utils/email-nav.ts`. The `admin` Worker also
  carries the **Cron Trigger** (`*/5 * * * *`, `wrangler.admin.jsonc`) that fires
  `runDueCampaigns()` via the `scheduled` handler in `src/worker.ts`. AWS SNS must
  post SES events to `https://admin.curevanails.com/api/webhooks/ses`. See
  [`docs/mail/`](docs/mail/README.md).
- **Auth is form-based with a signed cookie**, not HTTP Basic Auth.
  `src/utils/admin-auth.ts` mints an HMAC-SHA256 token (keyed by
  `ADMIN_PASSWORD`, 12 h TTL); `src/middleware.ts` verifies it on every
  `/admin*` request and redirects unauthenticated users to `/admin/login`.
  `/admin/login` and `/admin/logout` are the only public admin routes.
- **Secrets, not vars:** `ADMIN_PASSWORD` (required) and optional
  `ADMIN_USERNAME` (default `admin`) are set with
  `wrangler secret put … --config wrangler.admin.jsonc`. **If `ADMIN_PASSWORD`
  is unset the whole `/admin` area returns 404** — that is why `/admin` stays
  hidden on the main `curevanails` Worker even though the route exists there.
  Rotating `ADMIN_PASSWORD` invalidates all sessions.
- **PII:** the dashboard shows names, phones, emails, license numbers, and
  uploaded documents. Don't loosen the auth gate, and keep `/admin/file` locked
  to the `recruit/` key prefix.
- Local-dev admin credentials live in `.dev.vars` (gitignored).

## Design system — Cure Và version H

**The entire public site runs on one design system: version H**, imported
from the `cureva-ui` repo and living in [`design/version-h/`](design/version-h/).
Read [`design/version-h/PORTING.md`](design/version-h/PORTING.md) first — it
records what was copied verbatim, what had to change, and what is still open.

- **The system is upstream's, byte for byte.** `design/version-h/css/01-tokens.css`
  → `05-chrome.css` + `page-variants.css` and `design/version-h/js/runtime.js`
  are unmodified copies. **Do not edit them here.** Change them in `cureva-ui`,
  re-run its `extract.py`, and re-copy.
- **Load order is the contract**: 01 → 02 → 03 → 04 → 05 → page-variants →
  the page's own CSS. [`src/styles/version-h.css`](src/styles/version-h.css)
  `@import`s the six in order and is the only thing a page imports.
- **This repo's own layer** is
  [`src/styles/version-h-content.css`](src/styles/version-h-content.css) —
  articles, post lists, search and archives. Version H is a marketing site and
  ships no article template, so those are written here, in its idiom.
- **Fonts: one Google Fonts `<link>`** (Fraunces + Manrope), and it is the only
  external request the system makes. There is no `fonts:` block in
  `astro.config.mjs` any more. `/early-access` knowingly breaks this by loading
  the Mangomint booking widget — see the note at the top of that file.
- **Photography** is the brand's 28 WebP assets in `public/img/`, served at
  `/img/…`, which is exactly where `build-page.py` stamps them.

### The rules that are load-bearing

These are not preferences. Each is a bug that already happened once.

- **A component reads tokens and NEVER names a colour.** Not a hex, not
  `rgb()`, not `color-mix()`, not a brand alias like `var(--sage)`. Only
  `hsl(var(--token))`. That is what lets one rule work on night and on paper.
- **Tokens are bare HSL channels** (`144.8 26.7% 66.3%`), never colours — the
  only form that allows `hsl(var(--ring) / .25)`.
- **Every token is defined on `:root` AND re-themed under `.on-light`.**
- On a light ground `--card` is **white** (raised) and `--muted` is paper-2
  (recessed). Backwards makes a themed page look unthemed.
- **Motion is transform and opacity**, and a position is never animated in the
  same `transition` as a scale — use the separate `translate` / `scale`
  properties.
- **A page that opens on a paper section needs `nav="paper"` AND `.sec--first`**
  on that section, or the cream wordmark is invisible on paper.
- Inside a `<dialog>`, put `data-nocursor` on an ancestor.
- **Pages work with JavaScript off.** `[data-r]` reveals are `opacity:0` until
  the runtime marks them, so every document carries the `<noscript>` block that
  restores them. Do not remove it.

### Layouts

| Layout | For |
| --- | --- |
| [`src/layouts/VersionH.astro`](src/layouts/VersionH.astro) | marketing pages — `/recruit`, `/recruit/apply`, `/getready`, `/waitlist`, `/early-access` |
| [`src/layouts/Base.astro`](src/layouts/Base.astro) | content pages — Journal, articles, archives, search, static pages. Keeps every EmDash integration point (`EmDashHead`, `EmDashBodyStart/End`, `WidgetArea`, `LiveSearch`, menus). Pass `ground="paper"` for reading surfaces. |
| [`src/pages/coming-soon.astro`](src/pages/coming-soon.astro) | carries its own document — it is the one page that must stay pixel-identical to the standalone build |

Shared pieces: [`src/components/vh/RoleAccordion.astro`](src/components/vh/RoleAccordion.astro)
(the four open roles, used by `/recruit` and `/recruit/apply`) and
[`src/components/vh/WaitlistForm.astro`](src/components/vh/WaitlistForm.astro)
(the `/api/waitlist` form, used by `/getready` and `/waitlist`).

### Verifying a design change

```bash
python3 design/version-h/build/build-page.py html/coming-soon.html design/version-h/dist/soon/
node design/version-h/build/smoke.js      # the standalone templates
node design/version-h/build/parity.js     # /coming-soon vs that build, pixel for pixel
```

`parity.js` needs `pnpm preview` running (`ASTRO_URL` overrides the default
`localhost:4321`). It fails on any pixel difference.

## Schema

- `posts` collection: `title`, `featured_image`, `content` (Portable Text), `excerpt` (text).
- `pages` collection: `title`, `content` (Portable Text). Used for `/about` etc.
- Taxonomies: `category`, `tag`.
- Single `primary` menu (Home, About, Posts by default).
- **`job_applications`** is a plain D1 table (not an EmDash collection), created lazily by `src/pages/api/recruit.ts` with `CREATE TABLE IF NOT EXISTS` on first submission. Columns documented in [`docs/ADMIN.md`](docs/ADMIN.md).

Site settings have `title` and `tagline` -- both render in the header / footer.

## Visual character

> One system, site-wide. See "Design system" above for the rules.

Two families: **Fraunces** for anything editorial — every heading, every
`.post-title`, the wordmark — run optically large and barely soft
(`"opsz" 144, "SOFT" 12, "WONK" 0`). **Manrope** for everything else. The
`<em>` inside a heading opens the axes up (`"SOFT" 40, "WONK" 1`) and that
italic turn is how every headline on the site resolves; a heading without one
reads as unfinished.

The ground is **night** (`#0B1410`) by default with **paper** (`#F7F4EC`)
sections alternating through it, cream (`#FCF5D6`) as the call-to-action fill
and sage (`#92C0A5`) as the accent and focus colour. Alternate the grounds —
four dark sections in a row read as one long section.

The article layout keeps its three-column reading view: a left meta column for
bylines and date, a centred 680px body column, and a right gutter for the
table of contents. Don't flatten it on desktop — it signals "this is something
to read".

## Customisation

Colour, radius, elevation and easing all live in
`design/version-h/css/01-tokens.css` — **19 semantic tokens, defined twice**
(`:root` for night, `.on-light` for paper). That file is a verbatim copy of
upstream, so a change belongs in `cureva-ui` and comes back here through
`extract.py`. Anything page-specific goes in that page's own `<style is:global>`,
composed from `hsl(var(--token))`.

`src/styles/theme.css` is gone — it themed the old blog design, which no longer
exists.

## What not to do

- **Don't name a colour outside `01-tokens.css`.** Not in a component, not in a
  page's CSS. `hsl(var(--token))` only. It is what makes the theme real rather
  than decorative, and `build-page.py` guard 6 fails a build that breaks it.
- **Don't edit anything under `design/version-h/css/` or `js/`.** They are
  byte-for-byte upstream; edit `cureva-ui` and re-copy.
- **Don't add a second external request.** One Google Fonts link. `/early-access`
  is the one documented exception.
- **Don't remove the `<noscript>` block** from a layout — without it the page
  renders as an empty ground for anyone without JavaScript.
- Don't put a `.sec` class on anything that isn't a section shell; it carries
  up to 12.5rem of block padding. (`/recruit/apply` renames its field groups
  `.ap-grp` for exactly this reason.)
- Don't flatten the article gutter on desktop.
- Don't use stock blog copy, and don't seed the Journal with placeholder posts.
