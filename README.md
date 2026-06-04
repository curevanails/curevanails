# CureVà — Beauty Lounge Site

The website for **CureVà Beauty Lounge**: a standalone marketing landing page paired with a full content/blog system. Built on [EmDash](https://github.com/emdash-cms/emdash) (a CMS on top of Astro) and deployed to **Cloudflare Workers** with **D1** (database) and **R2** (media storage).

## What This Site Is

- **Homepage (`/`)** — a standalone CureVà marketing landing page (hero, services, personas, journal teaser, careers, newsletter). It has its own design system (teal Material-3 palette, DM Sans, Tailwind via CDN) and does **not** share the blog's theme.
- **Blog / content** (`/posts`, `/pages`, `/category`, `/tag`, `/search`, `/rss.xml`) — the EmDash editorial template: posts, static pages, categories, tags, full-text search, and an RSS feed.
- **Booking** — the "Book now" / "Book your visit" CTAs are wired to **Mangomint online booking** (Company ID `463532`). The Mangomint widget script is loaded in the homepage `<head>` and intercepts links to `https://booking.mangomint.com/463532`, opening the booking flow in a popup.
- **Admin UI** — the EmDash admin lives at `/_emdash/admin`.

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | [Astro](https://astro.build) `^6.3` (`output: "server"` — all CMS pages are server-rendered) |
| CMS | [EmDash](https://github.com/emdash-cms/emdash) `^0.16` (`emdash`, `@emdash-cms/cloudflare`) |
| Runtime | Cloudflare Workers (`@astrojs/cloudflare` adapter) |
| Database | Cloudflare **D1** (binding `DB`, database `curevanails`) |
| Media storage | Cloudflare **R2** (binding `MEDIA`, bucket `curevanails-media`) |
| Sessions | Cloudflare **KV** (binding `SESSION`) |
| UI islands | React 19 (`@astrojs/react`) |
| Plugins | `@emdash-cms/plugin-forms`, `@emdash-cms/plugin-webhook-notifier` |
| Fonts (blog) | Inter + JetBrains Mono via Astro font providers |
| Homepage styling | Tailwind (Play CDN, inline config) + DM Sans + Material Symbols |
| Booking | Mangomint embedded online booking widget |
| Package manager | pnpm |

## Local Development

```bash
pnpm install
npx emdash dev        # runs migrations, seeds content, generates types, starts the dev server
```

The site runs at `http://localhost:4321` and the admin UI at `http://localhost:4321/_emdash/admin`.

```bash
npx emdash types      # regenerate TypeScript types from the schema after editing seed/seed.json
pnpm typecheck        # astro check
```

## Verify

After making a change, verify it end-to-end:

1. **Build passes** — `pnpm build` (runs `astro build`; the Cloudflare adapter must compile the Worker cleanly).
2. **Types** — `pnpm typecheck`.
3. **Homepage renders** — open `/` and confirm the CureVà landing page loads with its teal theme and DM Sans, not the blog theme.
4. **Booking works** — click **Book now** (header) and **Book your visit** (hero). The Mangomint booking popup should open. The link falls back to `https://booking.mangomint.com/463532` if the script hasn't loaded. Booking must be enabled in the Mangomint account for the popup to appear.
5. **Blog renders** — `/posts`, a single post, `/search`, and `/rss.xml` all respond.
6. **Admin** — `/_emdash/admin` loads.

## Deploying

Deploys to Cloudflare Workers. The default build targets the main `curevanails` site (`wrangler.jsonc`):

```bash
pnpm deploy           # astro build && wrangler deploy
```

A second standalone Worker (`getready`) can be built from the same codebase:

```bash
pnpm deploy:getready  # WRANGLER_CONFIG=wrangler.getready.jsonc astro build && wrangler deploy
```

## Project Layout

| Path | Purpose |
|---|---|
| `astro.config.mjs` | Astro config: `emdash()` integration, D1/R2 bindings, fonts |
| `wrangler.jsonc` | Cloudflare Worker config for the main `curevanails` site |
| `wrangler.getready.jsonc` | Config for the standalone `getready` Worker |
| `seed/seed.json` | Schema + demo content (collections, fields, taxonomies, menus) |
| `src/pages/index.astro` | **CureVà landing page** (standalone, includes Mangomint booking) |
| `src/pages/` | All other routes (blog, search, RSS, etc.) |
| `src/layouts/Base.astro` | Base layout for blog pages |
| `src/styles/theme.css` | Design tokens for the blog pages |
| `emdash-env.d.ts` | Generated collection types (auto-regenerated on dev start) |

See [`CLAUDE.md`](./CLAUDE.md) for the full design-system, schema, and editing rules.

## See Also

- [EmDash documentation](https://docs.emdashcms.com)
- [Mangomint online booking setup](https://www.mangomint.com/learn/adding-online-booking-to-your-website/)
