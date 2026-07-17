# Testing — the E2E suite

End-to-end tests for the two flows that touch applicant data: the public
**Hiring Form** (`/recruit/apply` → `POST /api/recruit`) and the **admin
dashboard** (`/admin` and its `/admin/file`, `/admin/update` endpoints).

They run with [Playwright](https://playwright.dev) against the **built
Cloudflare Worker** — not the dev server — so they exercise the real endpoints
with live local D1 + R2 + KV bindings.

Field-level details of what's being tested live in [`RECRUIT.md`](RECRUIT.md)
and [`ADMIN.md`](ADMIN.md).

---

## 1. Running the tests

```bash
pnpm test:e2e            # build the Worker, preview it, run every spec
pnpm test:e2e:ui         # the same, in Playwright's interactive UI
```

Target a single file or test:

```bash
npx playwright test e2e/recruit-apply.spec.ts
npx playwright test e2e/admin.spec.ts -g "resume download"
```

First run only:

```bash
npx playwright install chromium
```

### How the server is started

`playwright.config.ts` runs `pnpm build && pnpm preview` on `E2E_PORT` (default
`8788`) via Miniflare, and waits for `/recruit/apply` to respond. Miniflare loads
`.dev.vars`, so the admin credentials and other secrets are available.

- **Reuse a running server** while iterating: start `pnpm preview --port 8788`
  yourself and Playwright reuses it (`reuseExistingServer`, local only) — this
  skips the ~30 s rebuild between runs. Rebuild manually after changing source.
- The preview uses the built Worker, so **rebuild after editing `src/`** — a
  stale `dist/` will test old code.

---

## 2. Layout

| File | Covers |
| --- | --- |
| `e2e/helpers.ts` | Shared fixtures, selectors, `fillApplication()`, `devVar()` |
| `e2e/recruit-apply.spec.ts` | The Hiring Form UI + `POST /api/recruit` |
| `e2e/admin.spec.ts` | Auth gate, dashboard, `/admin/file`, `/admin/update` |
| `e2e/global-teardown.ts` | Deletes the rows real-API tests insert |

### What each spec proves

**`recruit-apply.spec.ts`**

- Every required field, alone, blocks submission (client-side).
- Field data rules (digits in names, letters/length in phone, bad email,
  malformed graduation date, wrong/oversized resume).
- Happy paths against the **real API** — full application, all-optionals-omitted,
  portfolio link instead of a resume — persist and show the confirmation.
- Resilience — server `500`, mapped field errors, network abort, and the
  double-submit guard — using route interception (no DB writes).
- Server-side validation hit **directly** against `POST /api/recruit`, bypassing
  the browser, to prove the endpoint is the real boundary.

**`admin.spec.ts`**

- **Auth gate:** every admin path (`/admin`, `/admin/talent`, `/admin/file`,
  `/admin/update`) redirects to the login form without a valid session; wrong
  credentials and a forged cookie are rejected; logout ends the session.
- **Dashboard:** a seeded application appears with its fields; expand, search,
  and empty-search behave.
- **`/admin/file`:** downloads the resume as an attachment; refuses keys outside
  `recruit/`, path traversal, and missing objects.
- **`/admin/update`:** status and recruiter notes persist across a reload;
  unknown status, missing id, and non-JSON bodies are rejected.

---

## 3. Conventions worth knowing

**Selectors on `/recruit/apply`.** The form has no wrapper `id`, and its
checkboxes/radios are visually hidden (`opacity:0; width:0; pointer-events:none`)
behind a styled `.mk` span. Playwright's `check()` refuses hidden inputs, so the
helpers **click the wrapping `<label>`** instead — exactly what a user does.
Stable hooks are the `.js-*` classes and `data-name` groups, centralised in
`SELECTORS` in `helpers.ts`.

**Success is a CSS class, not navigation.** The form swaps in `.js-done.show`;
tests assert on that rather than a URL change.

**Test data must be valid.** Names reject digits — so fixture names are letters
only (`E2E_SURNAME = "Zzteststub"`, and admin seed names strip non-letters).
Don't reintroduce an `e2e`/`2` prefix into a name field.

**Real-API rows are matched by surname for cleanup.** Email is optional (one
test omits it), so `global-teardown.ts` deletes by `last_name = E2E_SURNAME`, not
by email. Any new real-API test must submit with that surname or it will leave a
row in local D1 (and in the local admin dashboard).

**Admin credentials.** `admin.spec.ts` reads `ADMIN_USERNAME` / `ADMIN_PASSWORD`
via `devVar()` — `process.env` first, then `.dev.vars`. With no password the
admin area is 404 by design, so the whole file **skips** rather than fails.

---

## 4. CI

`playwright.config.ts` already switches for CI (`process.env.CI`): retries,
single worker, and the `github` + `html` reporters. Provide the same secrets the
preview needs — `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and any others in
`.dev.vars` — as CI environment variables (they take precedence over the file).
CI's local D1 is ephemeral, so teardown is a no-op there.
