# Recruit — the Hiring Form (`/recruit/apply`)

The single job-application intake for the CureVà careers site. This document is
the source of truth for the form's **field contract**: what the page renders,
what the endpoint accepts, how it is validated, and where it is stored.

Related docs: [`ADMIN.md`](ADMIN.md) (the dashboard that reads these
applications) and [`TESTING.md`](TESTING.md) (the E2E suite that guards this
flow).

---

## 1. Flow at a glance

```
/recruit  ──"Apply"──▶  /recruit/apply  ──POST multipart──▶  /api/recruit
                          (form UI)                              │
                                                                 ├─▶ R2  MEDIA   (resume file, optional)
                                                                 └─▶ D1  DB       (job_applications row)
                                                                                      │
                                                            /admin dashboard ◀────────┘
```

- **Page:** `src/pages/recruit/apply.astro` (`prerender = false`). Also lists the
  open roles above the form.
- **Endpoint:** `src/pages/api/recruit.ts` (`POST`, `multipart/form-data`).
- **Schema + option vocabularies:** `src/utils/recruit-db.ts`.
- **Dashboard:** `src/pages/admin/index.astro`.

The form posts by `fetch` and swaps in a thank-you panel on success; it never
does a full-page navigation. The client validator is a **convenience** — the
endpoint re-validates every field and is the real boundary.

---

## 2. Field contract

Required unless noted. "Client rule" is the inline JS check in `apply.astro`;
"Server rule" is the authoritative check in `api/recruit.ts`.

| Field (`name`) | Control | Required | Client rule | Server rule |
| --- | --- | --- | --- | --- |
| `first_name` | text | ✅ | non-empty, no digits, ≥1 letter | same |
| `last_name` | text | ✅ | non-empty, no digits, ≥1 letter | same |
| `email` | email | — | if present, valid email | if present, valid email |
| `phone` | tel | ✅ | no letters, ≥10 digits | no letters, 10–15 digits, only `0-9 space ( ) + . -` |
| `positions` | checkbox (multi) | ✅ (≥1) | ≥1 checked | ≥1 value, each in `POSITION_OPTIONS` |
| `current_status` | radio | ✅ | one selected | value in `CURRENT_STATUS_OPTIONS` |
| `graduation_date` | month (text fallback) | — | if present, `YYYY-MM` or `MM/YYYY` | normalised to `YYYY-MM`; reject if unparseable |
| `background` | radio | ✅ | one selected | value in `BACKGROUND_OPTIONS` |
| `employment_type` | radio | ✅ | one selected | value in `EMPLOYMENT_OPTIONS` |
| `resume` | file | — | if present, `.pdf/.doc/.docx` & ≤10 MB | same; stored in R2 |
| `portfolio_link` | text | — | (none) | ≤200 chars |
| `why_cureva` | textarea | — | `maxlength=1000` | ≤1000 chars |
| `contact_consent` | checkbox | — | (none) | `"yes"` → `1`, else `0` |

Resume and `portfolio_link` are the two halves of an **"OR"** — both optional,
neither required. The applicant can attach a resume, paste a social/portfolio
link, both, or neither.

### Option vocabularies

Defined once in `src/utils/recruit-db.ts` and imported by both the endpoint and
the admin filters — keep the form `<option>`/`value=` in `apply.astro` in sync
with these.

- **`positions`:** `nail_technician`, `esthetician`, `cosmetologist`,
  `lash_artist`, `open_to_multiple` — stored as a JSON array string.
- **`current_status`:** `licensed_utah`, `beauty_school`, `transferring_license`.
- **`background`:** `school_or_recent_grad`, `salon_experience`.
- **`employment_type`:** `full_time`, `part_time`, `either`.

> ⚠️ The talent-list table (`talent_list`) uses a **different** role vocabulary
> (e.g. `lash_brow_specialist`, `other`). They are separate systems; don't assume
> the values match.

---

## 3. Response contract

`Content-Type: application/json`.

| Case | Status | Body |
| --- | --- | --- |
| Success | `200` | `{ "ok": true, "id": "<uuid>" }` |
| Validation failure | `400` | `{ "ok": false, "errors": { "<field>": "<message>", … } }` |
| Non-multipart body | `400` | `{ "ok": false, "error": "Expected multipart form data." }` |
| R2 upload failed | `500` | `{ "ok": false, "error": "Failed to store the uploaded file." }` |
| D1 insert failed | `500` | `{ "ok": false, "error": "Failed to save application." }` |

The client maps each key in `errors` back onto its field (or `data-name` group,
or the resume drop-zone) and highlights it.

---

## 4. Storage

### D1 — `job_applications`

Created lazily by `ensureApplicationsSchema(db)` on every write and every admin
load (no migration step). It parks any pre-July-2026 table as
`job_applications_legacy` and back-fills the `status`/`notes` columns onto older
tables.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | `crypto.randomUUID()` |
| `created_at` | TEXT NOT NULL | ISO 8601 |
| `first_name` / `last_name` | TEXT NOT NULL | |
| `email` | TEXT | nullable (optional field) |
| `phone` | TEXT NOT NULL | |
| `positions` | TEXT NOT NULL | JSON array, e.g. `["nail_technician"]` |
| `current_status` | TEXT NOT NULL | |
| `graduation_date` | TEXT | nullable, `YYYY-MM` |
| `background` | TEXT NOT NULL | |
| `employment_type` | TEXT NOT NULL | |
| `resume_key` | TEXT | nullable, R2 object key |
| `resume_filename` | TEXT | nullable, original filename |
| `portfolio_link` | TEXT | nullable |
| `why_cureva` | TEXT | nullable |
| `contact_consent` | INTEGER NOT NULL DEFAULT 0 | `1`/`0` |
| `status` | TEXT NOT NULL DEFAULT 'new' | staff-managed: `new`/`pending`/`contacted`/`deal` |
| `notes` | TEXT | staff-managed recruiter notes |

### R2 — `MEDIA` bucket

A resume, when attached, is stored at:

```
recruit/<application-id>/resume/<uuid>-<sanitized-filename>
```

The filename is sanitised (`[^a-zA-Z0-9._-] → _`, last 100 chars). Only the
`/admin/file` route serves these back, and only for keys under the `recruit/`
prefix.

---

## 5. Cloudflare topology (why `/admin` "just works")

All three Workers run the **same codebase** off different wrangler configs and
share the **same D1 database id and R2 bucket**:

| Worker | Config | Root serves | Extra binding |
| --- | --- | --- | --- |
| `curevanails` | `wrangler.jsonc` | main marketing site | KV `SESSION` |
| `getready` | `wrangler.getready.jsonc` | `/getready` waitlist landing | — |
| `admin` | `wrangler.admin.jsonc` | `/admin` dashboard | — |

Because the database and bucket are shared, an application submitted on any
Worker is immediately visible in the admin dashboard — **there is no sync
step**. A change to the field set only needs to touch the form (`apply.astro`),
the endpoint (`api/recruit.ts`), the schema/options (`recruit-db.ts`), and the
admin view (`admin/index.astro`) together, then redeploy all three
(`pnpm deploy`, `pnpm deploy:getready`, `pnpm deploy:admin`).

> **Custom domains** (`getready.curevanails.com`, `admin.curevanails.com`) are
> **not** declared in any wrangler config — they are wired in the Cloudflare
> dashboard. A fresh deploy will not recreate them.

---

## 6. Changing the form — checklist

When you add, remove, or rename a field:

1. **`apply.astro`** — the input, its label, and (if required) the client rule.
2. **`api/recruit.ts`** — read + validate + include in the INSERT.
3. **`recruit-db.ts`** — the column in `ensureApplicationsSchema`, plus any
   option vocabulary / labels.
4. **`admin/index.astro`** — display it (and a filter, if useful).
5. **`e2e/helpers.ts` + specs** — add/adjust the field so tests still fill a
   valid application.
6. Update the tables in **this file**.

> Renaming or dropping a column parks the old table as `job_applications_legacy`
> and starts fresh — this **orphans existing rows** from the admin view. If
> production has real applications, write a data migration that copies them over
> instead of relying on the lazy re-shape.
