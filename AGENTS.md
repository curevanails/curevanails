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
pnpm deploy:admin     # build & deploy the standalone admin recruit-dashboard Worker
pnpm test:e2e         # build + preview the Worker, run the Playwright E2E suite (docs/TESTING.md)
```

The EmDash content admin is at `http://localhost:4321/_emdash/admin`.
The recruit dashboard is at `/admin` (login at `/admin/login`) — see "Recruit & Admin" below and [`docs/ADMIN.md`](docs/ADMIN.md).

## Verify

After a change, verify end-to-end before committing:

1. `pnpm build` succeeds (the Cloudflare adapter compiles the Worker).
2. `pnpm typecheck` passes.
3. `/` renders the CureVà landing page with its own teal/DM Sans design system (not the blog theme).
4. Booking CTAs (**Book now** in the header, **Book your visit** in the hero) open the Mangomint popup; they fall back to `https://booking.mangomint.com/463532` if the widget script hasn't loaded. Booking must be enabled in the Mangomint account for the popup to appear.
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
| `src/layouts/Base.astro` | Base layout with EmDash wiring (menus, search, page contributions)                 |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |
| `src/pages/index.astro`  | **CureVà landing page** -- standalone, does NOT use `Base.astro` (see "Homepage")  |
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

Project docs in `docs/`:

- [`docs/RECRUIT.md`](docs/RECRUIT.md) — the `/recruit/apply` Hiring Form field contract (fields, validation, D1 columns, R2 layout, the three-Worker topology). Update it whenever the form changes.
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

A blog with posts, pages, categories, tags, full-text search, and RSS. Designed for personal writing, technical writing, indie newsletters, and anything where the writing is the product. Editorial-tech aesthetic: confident sans-serif, restrained accent, real article structure with bylines and reading time.

## Pages

| Page        | Path               | What it shows                                                                                          |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| Home        | `/`                | **CureVà landing page** (standalone — see "Homepage" below). Marketing sections, not blog content      |
| All posts   | `/posts`           | Article count, full post list with excerpts and tag chips                                              |
| Post detail | `/posts/[slug]`    | Featured image, title, body, left meta column (authors + date), right TOC + search + categories gutter |
| Search      | `/search`          | Full-text search UI                                                                                    |
| Page        | `/pages/[slug]`    | Static page content (Portable Text)                                                                    |
| Category    | `/category/[slug]` | Posts filtered by category                                                                             |
| Tag         | `/tag/[slug]`      | Posts filtered by tag                                                                                  |
| RSS         | `/rss.xml`         | Generated feed                                                                                         |
| Careers     | `/recruit`         | Careers page + talent list; full application at `/recruit/apply` (POSTs to `/api/recruit`)             |
| Admin login | `/admin/login`     | Styled login form for the recruit dashboard                                                            |
| Admin       | `/admin`           | Recruit dashboard — lists `job_applications`, résumé downloads (auth-gated)                            |

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
  not by `wrangler deploy -c`. All three share the same D1 + R2.
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

## Homepage (CureVà landing page)

`src/pages/index.astro` is a **standalone marketing landing page** for the CureVà beauty lounge. It deliberately does **not** use `Base.astro` — it renders its own `<html>`, `<head>`, header, footer, fonts, and design system. The rest of the site (`/posts`, `/pages`, `/category`, `/tag`, `/search`) is still the blog template on `Base.astro` and the `theme.css` design tokens below.

Because the two design systems are separate, the homepage does not inherit the blog's Inter font, `#0066cc` accent, or CSS variables. Editing `theme.css` will not affect the homepage, and editing the homepage will not affect the blog pages.

**How it's built:**

- **Tailwind via the Play CDN** (`<script src="https://cdn.tailwindcss.com?...">`), configured inline through the `#tailwind-config` block. There is no Tailwind build step, no `tailwind.config.js`, and no PostCSS — utility classes resolve in the browser at runtime. The CDN prints a "not for production" console warning; converting to a compiled Tailwind setup is a known future step.
- **Fonts:** DM Sans (body + headings) and Material Symbols Outlined (icons), both loaded from Google Fonts in the page `<head>`.
- **Palette:** a teal Material-3 token set defined in the inline Tailwind config (`primary #3a656e`, `background #f0fbff`, `primary-container`, `tertiary-container`, `surface-*`, etc.). Colours are referenced as Tailwind classes like `text-primary`, `bg-primary-container`, `text-on-surface-variant`.
- **Custom Tailwind tokens** also defined inline: spacing (`section-padding`, `margin-mobile`/`margin-desktop`, `gutter`, `container-max`), border radii, and the `display-lg` / `headline-lg` / `body-md` / `label-md` type scale used via `font-*` + `text-*` classes.

**Editing rules (important for Astro):**

- Any `<script>` in this page must keep `is:inline` (the Tailwind CDN, the `tailwind.config` block, and the behaviour script). Without it Astro tries to bundle them, which breaks the global `tailwind.config` object and the `onclick="switchTab(...)"` handlers (they rely on `switchTab` being a global).
- The `.material-symbols-outlined` / `.blob-bg` CSS lives in an `is:global` `<style>` block so it also applies to the persona-tab list items injected at runtime by `switchTab`.
- The persona tabs ("Designed for your life") swap content via the inline `tabs` object. All four personas currently point at the same interior image URL — the original design used placeholder IDs that would 404 on click.

**Still placeholder / not wired up:**

- All images are temporary Google `aida-public` URLs that will eventually expire — replace with real assets.
- Nav links, footer links, the "Book now" / "View Openings" buttons, and the newsletter form are static (`href="#"`, no form action).
- **"From the Journal"** is three hard-coded cards. It is the obvious candidate to wire to the real `posts` collection (`getEmDashCollection("posts", { limit: 3 })`) — not yet done.

## Schema

- `posts` collection: `title`, `featured_image`, `content` (Portable Text), `excerpt` (text).
- `pages` collection: `title`, `content` (Portable Text). Used for `/about` etc.
- Taxonomies: `category`, `tag`.
- Single `primary` menu (Home, About, Posts by default).
- **`job_applications`** is a plain D1 table (not an EmDash collection), created lazily by `src/pages/api/recruit.ts` with `CREATE TABLE IF NOT EXISTS` on first submission. Columns documented in [`docs/ADMIN.md`](docs/ADMIN.md).

Site settings have `title` and `tagline` -- both render in the header / footer.

## Visual character

> Applies to the **blog pages** (`/posts`, `/pages`, `/category`, `/tag`, `/search`) on `Base.astro`. The homepage has its own separate design system — see "Homepage" above.

Single typeface: **Inter** on `--font-sans`, used for everything including headings (with tighter letter-spacing on h1/h2). **JetBrains Mono** on `--font-mono` for inline code and code blocks. Body and headings share the same family; weight and size carry the hierarchy.

The accent is `#0066cc` -- used for links, the post-card title hover, and the search input focus ring. There's also a secondary text colour (`--color-text-secondary`) and a `--color-muted` for meta info. Don't add a second accent.

The article layout is the standout feature: a three-column reading view with a left meta column (author bylines, date), centred 680px body column, and a right gutter for search, table of contents, and categories. Don't flatten that into one column on desktop -- the layout signals "this is something to read".

## Customisation

`src/styles/theme.css` is the only file to edit for visual changes. Every CSS variable from `Base.astro` is listed there as a commented default -- uncomment and change to override. The dark mode palette is defined inside `Base.astro` itself; light-mode overrides in `theme.css` won't affect dark mode. To customise dark mode, add `@media (prefers-color-scheme: dark)` and `:root.dark` rules in `theme.css`.

Fonts are configured in `astro.config.mjs` under `fonts:`. To swap the body face, change the `name:` for the entry bound to `cssVariable: "--font-sans"`. Good alternatives: Geist, IBM Plex Sans, Söhne (if you have a licence), Public Sans. If you want a serif-bodied blog, swap to a humanist serif like Source Serif, Crimson Pro, or Lora -- but then also raise `--font-size-base` to `1.0625rem` for readability.

CSS variables worth knowing:

- `--color-accent`, `--color-accent-hover`, `--color-on-accent`, `--color-accent-ring`
- `--color-bg`, `--color-bg-subtle`, `--color-surface`, `--color-text`, `--color-text-secondary`, `--color-muted`, `--color-border`, `--color-border-subtle`
- `--font-sans`, `--font-mono`
- `--tracking-tight` / `--tracking-snug` / `--tracking-wide` / `--tracking-wider` -- letter-spacing tokens used across headings and meta labels
- `--content-width` (680px) -- article body column
- `--wide-width` (1200px) -- max container
- `--gutter-width` (200px) -- right sidebar (TOC) on article pages
- `--meta-col-width` (180px) -- left meta column on article pages
- `--avatar-size-{xs,sm,md,lg}` -- byline avatar sizes at different scales

## What not to do

> These rules are about the **blog pages** design language. The homepage intentionally breaks from them (teal palette, DM Sans, multiple surface colours).

- Don't add a second accent colour or coloured section backgrounds. The page should be black, white, and one blue.
- Don't replace Inter with a display sans (Bebas, Anton, etc.). Headings rely on weight contrast, not novelty faces.
- Don't collapse the article gutter on desktop -- it's part of the reading experience.
- Don't use stock blog copy ("Welcome to my blog", "Stay tuned for more"). Write a real tagline that says what this blog is about.
- Don't seed the home page with three identical placeholder posts. If you only have one real post, show one real post.
- Don't enable comments without a plan to moderate them. The template doesn't ship a comments system by default for a reason.
