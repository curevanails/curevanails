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
| `getready`  | `wrangler.getready.jsonc` | `getready.curevanails-tech.workers.dev`     | `/getready` (careers) |
| `admin`     | `wrangler.admin.jsonc`    | `admin.curevanails-tech.workers.dev`        | `/admin` (dashboard) |

All three share the **same D1 database** (`curevanails`) and **R2 bucket**
(`curevanails-media`), so the admin Worker reads exactly what the public form
writes.

---

## 1. The application form

- **Page:** `src/pages/recruit.astro` → `/recruit` (linked from the `getready`
  careers page).
- **Endpoint:** `src/pages/api/recruit.ts` → `POST /api/recruit`
  (`multipart/form-data`).

On submit the endpoint:

1. Validates the structured fields (name, phone, email, license types, skills,
   availability, etc.).
2. Uploads the **résumé** (required) and optional **DOPL license photo** to R2
   under `recruit/<application-id>/resume/...` and `recruit/<application-id>/license/...`.
3. Inserts a row into the D1 `job_applications` table. The table is created
   lazily with `CREATE TABLE IF NOT EXISTS`, so no separate migration is needed —
   it appears on the first successful submission.

### `job_applications` columns

| Column                | Notes                                            |
| --------------------- | ------------------------------------------------ |
| `id`                  | UUID, primary key                                |
| `created_at`          | ISO timestamp                                    |
| `full_name`, `phone`, `email`, `city` | Contact details                  |
| `license_types`       | JSON array (`nail_tech`, `cosmetologist_barber`, `other`) |
| `dopl_license_number`, `license_expiration` | Utah DOPL license info     |
| `work_authorized`     | `yes` / `no`                                     |
| `skills`              | JSON array (manicure_pedicure, gel_shellac, …)   |
| `english_proficiency` | `native` / `fluent` / `conversational` / `limited` |
| `employment_type`     | `full_time` / `part_time`                        |
| `days_available`      | JSON array of weekdays                            |
| `start_date`          | Available start date                             |
| `resume_key`, `resume_filename` | R2 object key + original filename      |
| `license_photo_key`   | R2 object key (nullable)                          |
| `portfolio_link`      | URL (nullable)                                   |

---

## 2. The admin dashboard

> ⚠️ **The dashboard exposes applicant PII** (names, phones, emails, license
> numbers, uploaded documents). It is gated by authentication on **every**
> Worker — see [Auth](#3-authentication).

| File                            | Purpose                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| `src/pages/admin/index.astro`   | Dashboard — lists all applications (newest first) as cards          |
| `src/pages/admin/login.astro`   | Styled login form; handles `GET` (show) and `POST` (validate + set cookie) |
| `src/pages/admin/logout.ts`     | Clears the session cookie, redirects to login                       |
| `src/pages/admin/file.ts`       | `GET /admin/file?key=…` — streams a résumé / license file out of R2 (key locked to the `recruit/` prefix) |
| `src/utils/admin-auth.ts`       | Session-token signing/verification + credential check               |
| `src/middleware.ts`             | Gates `/admin*`, handles the standalone root rewrite                 |

The dashboard renders each application as a card with contact info, license
details, skills/availability chips, and download buttons for the résumé,
license photo, and portfolio link. The header shows the total count and a
**Sign out** button.

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
- Possible future work: multiple admin users, an applicant status/notes field,
  CSV export, delete/archive actions, and email notification on new submissions
  (an `@emdash-cms/plugin-webhook-notifier` is already a dependency).
