# Recruit pipeline & Admin dashboard

This document describes the **nail-technician recruiting flow** for CureVà: the
public application form, where the data lands, and the password-protected admin
dashboard used to review applicants.

```
 Applicant                     Cloudflare                         Staff
 ─────────                     ──────────                         ─────
  /recruit  ──POST──▶  /api/recruit ──┬─▶ D1  job_applications     admin.curevanails-tech.workers.dev
 (form)                              └─▶ R2  recruit/<id>/...      └─ /admin/login ─▶ /admin (dashboard)
```

There are **three** Workers running this one codebase, selected at build time by
which wrangler config drives the build (see
[§6 Three Workers, one codebase](#6-three-workers-one-codebase)):

| Worker      | Config                    | URL                                         | Serves at `/`        |
| ----------- | ------------------------- | ------------------------------------------- | -------------------- |
| `curevanails` | `wrangler.jsonc`          | `curevanails-tech.workers.dev`              | Marketing + blog     |
| `getready`  | `wrangler.getready.jsonc` | `getready.curevanails-tech.workers.dev`     | `/getready` (waitlist landing) |
| `admin`     | `wrangler.admin.jsonc`    | `admin.curevanails-tech.workers.dev`        | `/admin` (dashboard) |

All three share the **same D1 database** (`curevanails`) and **R2 bucket**
(`curevanails-media`), so the admin Worker reads exactly what the public form
writes.

---

## 1. The application form

- **Careers page + talent list:** `src/pages/recruit.astro` → `/recruit`.
  Its lightweight "Join Our Talent List" form (name, email, role, optional
  portfolio + about) POSTs JSON to `src/pages/api/talent.ts` →
  `POST /api/talent`, which upserts into the D1 `talent_list` table
  (`src/utils/talent-db.ts`, deduped by email). Reviewed at `/admin/talent`.
- **Full application page:** `src/pages/recruit/apply.astro` → `/recruit/apply`.
- **Endpoint:** `src/pages/api/recruit.ts` → `POST /api/recruit`
  (`multipart/form-data`).

On submit the endpoint:

1. Validates the structured fields (name, phone, positions of interest,
   licensure status, background, employment type, etc. — the July 2026
   "Hiring Form" field set).
2. Uploads the optional **résumé** to R2 under
   `recruit/<application-id>/resume/...`.
3. Inserts a row into the D1 `job_applications` table. The table is created
   lazily via `ensureApplicationsSchema` (`src/utils/recruit-db.ts`), so no
   separate migration is needed — it appears on the first successful
   submission. A pre-existing old-shape table (the original nail-tech-only
   field set with DOPL/skills/availability columns) is renamed to
   `job_applications_legacy`, keeping its data.

### `job_applications` columns

| Column                | Notes                                            |
| --------------------- | ------------------------------------------------ |
| `id`                  | UUID, primary key                                |
| `created_at`          | ISO timestamp                                    |
| `first_name`, `last_name`, `phone` | Contact details (required)          |
| `email`               | Contact email (nullable — optional on the form)  |
| `positions`           | JSON array (`nail_technician`, `esthetician`, `cosmetologist`, `lash_artist`, `open_to_multiple`) |
| `current_status`      | `licensed_utah` / `beauty_school` / `transferring_license` |
| `graduation_date`     | `YYYY-MM` expected graduation (nullable)         |
| `background`          | `school_or_recent_grad` / `salon_experience`     |
| `employment_type`     | `full_time` / `part_time` / `either`             |
| `resume_key`, `resume_filename` | R2 object key + original filename (nullable — résumé is optional) |
| `portfolio_link`      | Instagram / Facebook / LinkedIn handle or URL (nullable) |
| `why_cureva`          | Short "Why would you like to work at CURE VÀ?" answer (nullable) |
| `contact_consent`     | `1` if the applicant agreed to be contacted about future opportunities |
| `status`, `notes`     | Staff-managed pipeline status + recruiter notes  |
| `ack_email_sent_at`   | ISO timestamp of the thank-you email to the applicant; **NULL = never sent**. Written only after SES accepts the message. Surfaced in the dashboard's Contact column as a "Thank-you sent" / "Not sent" chip. |

---

## 2. The admin dashboard

> ⚠️ **The dashboard exposes applicant PII** (names, phones, emails, license
> numbers, uploaded documents). It is gated by authentication on **every**
> Worker — see [Auth](#3-authentication).

### URLs on the standalone `admin` Worker (clean, no `/admin` prefix)

The pages live at `src/pages/admin/*`, but on **admin.curevanails.com** the
middleware serves them at the **root** — the whole Worker *is* the admin:

| Page | Clean URL (admin Worker) | Underlying route |
| --- | --- | --- |
| Dashboard | `/` | `/admin` |
| Talent list | `/talent` | `/admin/talent` |
| Waitlist | `/waitlist` | `/admin/waitlist` |
| Login / logout | `/login`, `/logout` | `/admin/login`, `/admin/logout` |
| Résumé download | `/file?key=…` | `/admin/file` |
| Status/notes update | `POST /update` | `/admin/update` |

- **Legacy `/admin/*` URLs 308-redirect to their clean form** (e.g.
  `/admin/talent` → `/talent`), so old bookmarks and links keep working.
- **Email management is retired here and redirects to the notify service:**
  `/admin/email` (and `/email`) → `https://notify.curevanails.com/`. This
  redirect fires on every Worker.
- On the **main** `curevanails` Worker the admin still resolves at `/admin/*`
  (gated) — the clean-URL rewrites are specific to the standalone admin Worker.
- Implemented in `src/middleware.ts`; the clean paths are served with
  `next("/admin/<seg>")` (a forward rewrite that does not re-enter middleware, so
  the strip-redirect can't loop).

| File                            | Purpose                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| `src/pages/admin/index.astro`   | Dashboard — lists all applications (newest first) as cards          |
| `src/pages/admin/login.astro`   | Styled login form; handles `GET` (show) and `POST` (validate + set cookie) |
| `src/pages/admin/logout.ts`     | Clears the session cookie, redirects to login                       |
| `src/pages/admin/file.ts`       | `GET /admin/file?key=…` — streams a résumé / license file out of R2 (key locked to the `recruit/` prefix) |
| `src/utils/admin-auth.ts`       | Session-token signing/verification + credential check               |
| `src/middleware.ts`             | Gates `/admin*`, handles the standalone root rewrite                 |

The dashboard renders each application as an expandable table row with contact
info, position/employment chips, licensure status, background, the "Why
CURE VÀ?" answer, and links for the résumé and portfolio. The header shows the
pipeline stat cards and a **Sign out** button.

---

## 3. Authentication

Auth is **form-based with a signed session cookie** (not HTTP Basic Auth, so
there is a proper login UI rather than the browser's native popup).

**Flow:**

1. Any unauthenticated request to `/admin*` (except `/admin/login` and
   `/admin/logout`) is redirected to `/admin/login`.
2. `login.astro` validates the submitted username/password against the
   `ADMIN_USERNAME` / `ADMIN_PASSWORD` secrets.
3. On success it issues a cookie `cureva_admin_session` whose value is an
   **HMAC-SHA256 signature of its own expiry timestamp**, keyed by
   `ADMIN_PASSWORD`. The token is stateless (no server-side session storage)
   and valid for **12 hours**. The cookie is `HttpOnly; Secure; SameSite=Lax`.
4. `middleware.ts` verifies the cookie signature + expiry on every admin
   request. Tampered or expired tokens are rejected back to the login form.

**Implications:**

- **Rotating `ADMIN_PASSWORD` instantly invalidates every outstanding session**
  (the signing key changed).
- If `ADMIN_PASSWORD` is **not set**, the entire admin area returns **404** — so
  even though `/admin` technically resolves on the main `curevanails` Worker
  (shared codebase), it stays hidden there because that Worker has no
  `ADMIN_PASSWORD` secret.

### Secrets

| Secret           | Required | Default   | Set on Worker |
| ---------------- | -------- | --------- | ------------- |
| `ADMIN_PASSWORD` | ✅ yes    | —         | `admin`       |
| `ADMIN_USERNAME` | optional | `"admin"` | `admin`       |

Set them after the first deploy (interactive prompt):

```bash
wrangler secret put ADMIN_PASSWORD --config wrangler.admin.jsonc
wrangler secret put ADMIN_USERNAME --config wrangler.admin.jsonc   # optional
```

To rotate the password later, re-run the `ADMIN_PASSWORD` command with the new
value.

---

## 4. Deploying the admin Worker

```bash
pnpm deploy:admin   # WRANGLER_CONFIG=wrangler.admin.jsonc astro build && wrangler deploy
```

This deploys to `https://admin.curevanails-tech.workers.dev`. On the very first
deploy Cloudflare auto-provisions a `SESSION` KV namespace for the Astro adapter.

**After the first deploy you MUST set `ADMIN_PASSWORD`** (see above) or the
dashboard will return 404.

---

## 5. Local development

`npx emdash dev` runs the main site. Visit `/admin/login` directly (the
standalone-root rewrite only applies on the deployed `admin` Worker).

Admin credentials for local dev live in `.dev.vars` (gitignored):

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme-local
```

> Note: cookies are issued with the `Secure` flag only over HTTPS. Astro's dev
> server is HTTP, so the login page detects the protocol and drops `Secure`
> locally — login works on `http://localhost:4321/admin/login`.

---

## 6. Three Workers, one codebase

The `getready` and `admin` Workers reuse the main codebase but deploy under
different names (the Worker name becomes the subdomain). The selector is a
`*_STANDALONE` var in each wrangler config, read by `src/middleware.ts`:

- `GETREADY_STANDALONE="true"` → serves `/getready` at the root.
- `ADMIN_STANDALONE="true"` → serves `/admin` at the root.

Because `@astrojs/cloudflare` bakes the wrangler config into the build, you must
drive the **build** with the alternate config via the `WRANGLER_CONFIG` env var
(handled by the `deploy:getready` / `deploy:admin` scripts) — not by passing
`-c` to `wrangler deploy`.

---

## 7. Security notes & TODO

- The admin area is the **only** thing protecting applicant PII — keep
  `ADMIN_PASSWORD` strong and out of version control. It is a Worker **secret**,
  not a `var`.
- The `/admin/file` endpoint only serves keys under the `recruit/` prefix and
  rejects `..`, so it cannot be used to read arbitrary bucket objects.
- Per-applicant **status** (`new` / `pending` / `contacted` / `deal`) and
  **recruiter notes** are implemented — the dashboard writes them through
  `POST /admin/update`, and they survive a reload. They are covered end-to-end
  in `e2e/admin.spec.ts` (see [`docs/TESTING.md`](TESTING.md)).
- Possible future work: multiple admin users, CSV export, delete/archive
  actions, and email notification on new submissions (an
  `@emdash-cms/plugin-webhook-notifier` is already a dependency).

See [`docs/RECRUIT.md`](RECRUIT.md) for the full apply-form field contract and
[`docs/TESTING.md`](TESTING.md) for the E2E suite that guards this flow.
