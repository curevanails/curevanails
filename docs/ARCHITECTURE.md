# CureVà — System Architecture

A single, diagram-first map of how the CureVà platform fits together, for both
humans and AI agents. Read this first; the deep-dive docs are linked at the end.

> **TL;DR** — One Astro codebase deploys as **four Cloudflare Workers** that all
> share **one D1 database, one R2 bucket, and one KV namespace**. A public
> marketing/careers site, a waitlist landing page, a recruiter admin dashboard,
> and a standalone email service are all the *same code* wearing different hats,
> selected by an environment flag. Email goes out through **AWS SES**; delivery
> events come back through **AWS SNS**.

---

## 1. The big picture

```mermaid
flowchart TB
    subgraph clients["People"]
        applicant["👩 Candidate"]
        subscriber["🙋 Waitlist subscriber"]
        recruiter["🧑‍💼 Recruiter / Owner"]
    end

    subgraph cf["Cloudflare (one Astro codebase, 4 Workers)"]
        direction TB
        main["curevanails<br/>marketing + careers + blog"]
        getready["getready<br/>waitlist landing"]
        admin["admin<br/>recruit dashboard"]
        notify["notify<br/>email service"]
    end

    subgraph stores["Shared Cloudflare storage"]
        d1[("D1 · curevanails<br/>applications, waitlist,<br/>email tables, settings")]
        r2[("R2 · curevanails-media<br/>résumés")]
        kv[("KV · SESSION<br/>rate-limit + sessions")]
    end

    subgraph aws["AWS"]
        ses["SES<br/>send email"]
        sns["SNS<br/>delivery events"]
    end

    applicant -->|apply| main
    applicant -->|apply| getready
    subscriber -->|join| getready
    recruiter -->|review| admin
    recruiter -->|campaigns + settings| notify

    main --> d1 & r2 & kv
    getready --> d1 & kv
    admin --> d1 & r2
    notify --> d1

    main -->|recruit emails| ses
    notify -->|campaigns + recruit emails| ses
    sns -->|webhook| notify

    classDef worker fill:#e7ebd6,stroke:#5e6247,color:#241f17;
    classDef store fill:#dff1f7,stroke:#3a656e,color:#0d1e22;
    classDef ext fill:#fbeee0,stroke:#b07a5b,color:#241f17;
    class main,getready,admin,notify worker;
    class d1,r2,kv store;
    class ses,sns ext;
```

**Why one codebase, four Workers?** The marketing site, waitlist landing, and
admin dashboard are the same app; a `*_STANDALONE` var (read in
`src/middleware.ts`) changes only what the root path (`/`) serves. `notify` is a
separate repo ([`notifications-service`](https://github.com/curevanails/notifications-service))
but points at the **same D1 database id**, which is what lets the two sides
cooperate without any cross-service API calls.

---

## 2. The four Workers

| Worker | Repo · config | Root `/` serves | `*_STANDALONE` | Extra binding |
| --- | --- | --- | --- | --- |
| **curevanails** | this repo · `wrangler.jsonc` | marketing landing + blog | — | KV `SESSION` |
| **getready** | this repo · `wrangler.getready.jsonc` | `/getready` waitlist landing | `GETREADY_STANDALONE` | — |
| **admin** | this repo · `wrangler.admin.jsonc` | rewrites `/` → `/admin` | `ADMIN_STANDALONE` | — |
| **notify** | `notifications-service` · `wrangler.jsonc` | email dashboard | — | KV `SESSION`, Cron `*/5` |

All four share **D1 `curevanails`** (`fcc8f06b-…`) and **R2 `curevanails-media`**.
Custom domains (`admin.curevanails.com`, `getready.curevanails.com`,
`notify.curevanails.com`) are wired in the Cloudflare dashboard, **not** in the
wrangler configs — a fresh deploy won't recreate them.

Deploy is E2E-gated in CI; the main site's deploy job ships **all three** of
this repo's Workers ([§7](#7-cicd--deploy)).

---

## 3. Request routing & middleware

Every request passes through `src/middleware.ts`, which does two jobs: pick what
`/` means for the current Worker, and gate the admin area.

```mermaid
flowchart TD
    req["Incoming request"] --> norm["Normalize path<br/>(strip trailing slash)"]
    norm --> isAdmin{"/admin* ?<br/>or ADMIN_STANDALONE and /"}
    isAdmin -->|no| isGetready{"GETREADY_STANDALONE<br/>and / ?"}
    isGetready -->|yes| rwGet["rewrite → /getready"]
    isGetready -->|no| pass["serve normally"]

    isAdmin -->|yes| hasPw{"ADMIN_PASSWORD set?"}
    hasPw -->|no| notfound["404 — admin hidden"]
    hasPw -->|yes| pub{"/admin/login<br/>or /admin/logout?"}
    pub -->|yes| pass2["serve (self-managed auth)"]
    pub -->|no| cookie{"valid signed<br/>session cookie?"}
    cookie -->|no| login["302 → /admin/login"]
    cookie -->|yes| adminOk["serve admin<br/>(rewrite / → /admin on admin Worker)"]

    classDef gate fill:#fbf4ee,stroke:#b07a5b,color:#241f17;
    class isAdmin,isGetready,hasPw,pub,cookie gate;
```

Key rule: **if `ADMIN_PASSWORD` is unset, the whole `/admin` area returns 404** —
that's why `/admin` stays invisible on the public marketing Worker even though
the route physically exists in the shared code.

---

## 4. Authentication (admin & notify)

Auth is a **stateless, signed session cookie** — no server-side session store.
The token is `"<expiry>.<HMAC-SHA256(secret, expiry)>"`; verifying it needs only
the secret, and rotating the secret invalidates every outstanding cookie.

```mermaid
sequenceDiagram
    autonumber
    actor U as Recruiter
    participant L as /admin/login
    participant A as admin-auth.ts
    participant M as middleware
    U->>L: POST username + password
    L->>A: verifyCredentials()
    A-->>L: ok
    L->>A: createSessionToken(secret, 12h)
    A-->>L: "<expiry>.<HMAC>"
    L-->>U: Set-Cookie cureva_admin_session (302 → /admin)
    U->>M: GET /admin (cookie)
    M->>A: verifySessionToken(cookie, secret)
    A-->>M: valid & unexpired
    M-->>U: dashboard
```

- **Signing secret:** a dedicated `SESSION_SECRET` when set, otherwise it falls
  back to `ADMIN_PASSWORD` (with a warning). Using a separate secret means a
  captured cookie can't be used to brute-force the login password offline.
- Cookie: `cureva_admin_session`, HttpOnly, 12-hour TTL.
- The identical mechanism protects the `notify` dashboard (its own repo).

---

## 5. Recruit application flow

The end-to-end path when a candidate applies at `/recruit/apply`.

```mermaid
sequenceDiagram
    autonumber
    actor C as Candidate
    participant F as /recruit/apply (form)
    participant API as POST /api/recruit
    participant KV as KV SESSION
    participant R2 as R2 MEDIA
    participant D1 as D1 job_applications
    participant EM as recruit-emails.ts
    participant SES as AWS SES

    C->>F: fill + submit (multipart)
    F->>API: fetch POST (JS, no navigation)
    API->>KV: rateLimit(ip, 5 / 10 min)
    API->>API: validate fields (server is the boundary)
    alt invalid
        API-->>F: 400 { errors } → highlight fields
    else valid
        API->>R2: put résumé → recruit/<id>/resume/... (if attached)
        API->>D1: INSERT application
        API-->>F: 200 { ok, id } → "Thank you" panel
        Note over API,EM: best-effort, non-blocking ↓
        API->>EM: sendRecruitEmails(application)
        EM->>SES: tpl-recruit-alert → recruiter(s)
        EM->>SES: tpl-recruit-ack → candidate (if email given)
    end
```

**Design guarantees**
- **The applicant's result never depends on email.** The application is saved
  first; `sendRecruitEmails` is wrapped and swallows every error, so a failed or
  unconfigured send still returns `ok`.
- **The server is the validation boundary.** The client validator is a
  convenience; `/api/recruit` re-checks everything.
- **Résumé is optional** and, when present, goes to R2 under
  `recruit/<application-id>/resume/<uuid>-<sanitised-name>`.

Full field contract → [`RECRUIT.md`](RECRUIT.md).

---

## 6. Recruit emails (recruiter alert + candidate acknowledgement)

Both recruit emails are **DB "system templates"** (Handlebars), sent through the
shared `sendOne` path so each is logged to `email_logs` and shows up on the
notify dashboard — no separate mailer.

```mermaid
flowchart LR
    submit["Application saved"] --> ensure["ensureEmailSchema<br/>(system templates exist)"]
    ensure --> ses{"SES configured?"}
    ses -->|no| skip["skip quietly<br/>(app already saved)"]
    ses -->|yes| who

    subgraph who["Recipients"]
        setting[["recruit_notify_to<br/>(app_settings)"]]
        cand{"candidate<br/>gave email?"}
    end

    setting --> alert["render tpl-recruit-alert<br/>→ recruiter(s)"]
    cand -->|yes| ack["render tpl-recruit-ack<br/>→ candidate"]
    cand -->|no| noack["no ack"]

    alert --> log[("email_logs")]
    ack --> log
    log --> list["notify → Recruit alerts list"]

    classDef store fill:#dff1f7,stroke:#3a656e,color:#0d1e22;
    class log,setting store;
```

| Template id | Goes to | Purpose |
| --- | --- | --- |
| `tpl-recruit-alert` | recruiter address(es) in `recruit_notify_to` | "New application from <name>" + details + admin link |
| `tpl-recruit-ack` | the candidate (only if they gave an email) | "We've received your application — we'll reach out soon" |

- **`recruit_notify_to`** lives in the shared `app_settings` table and is edited
  on the notify dashboard (**notify → Settings**). The main site *reads* it.
- **System templates** are ensured by id (`INSERT OR IGNORE`) on every schema
  check, so they always exist to render, yet operator edits are preserved.
- ⚠️ **SES sandbox** only delivers to *verified* addresses. Candidate acks to
  arbitrary applicants require SES **production access**.

---

## 7. CI/CD & deploy

Push to `main` → tests must pass → deploy. Deploy is **gated** on E2E.

```mermaid
flowchart LR
    push["push / PR to main"] --> ci["ci: build + typecheck"]
    push --> e2e["e2e: Playwright<br/>(built Worker under Miniflare)"]
    ci --> gate{"both pass<br/>and push to main?"}
    e2e --> gate
    gate -->|no / PR| stop["no deploy"]
    gate -->|yes| dep["deploy job"]
    dep --> d1w["wrangler deploy · curevanails"]
    dep --> d2w["wrangler deploy · getready"]
    dep --> d3w["wrangler deploy · admin"]

    classDef ok fill:#e7ebd6,stroke:#5e6247;
    class dep,d1w,d2w,d3w ok;
```

- Workflow: `.github/workflows/deploy.yml`. PRs run the tests but never deploy.
- The deploy job ships **all three** Workers via the `pnpm deploy*` scripts
  (each sets `WRANGLER_CONFIG` so the astro build + `wrangler deploy` target the
  right Worker).
- Secrets needed in CI: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Details & conventions → [`TESTING.md`](TESTING.md).

---

## 8. Data model (D1)

One database, shared by all Workers. Timestamps are ISO strings in the
recruit/waitlist tables and **Unix-ms integers** in the email tables (kept
internally consistent per domain).

```mermaid
erDiagram
    job_applications {
        TEXT id PK
        TEXT created_at
        TEXT first_name
        TEXT last_name
        TEXT email "nullable (optional)"
        TEXT phone
        TEXT positions "JSON array"
        TEXT current_status
        TEXT graduation_date
        TEXT background
        TEXT employment_type
        TEXT resume_key "R2 key, nullable"
        TEXT resume_filename
        TEXT portfolio_link
        TEXT why_cureva
        INTEGER contact_consent
        TEXT status "new|pending|contacted|deal"
        TEXT notes "recruiter notes"
    }
    waitlist {
        TEXT id PK
        TEXT email
        TEXT email_norm UK
        TEXT status "waiting|invited|redeemed"
        TEXT unsubscribe_token UK
        TEXT email_status "active|unsubscribed|bounced|complained"
        TEXT discount_code
    }
    email_templates {
        TEXT id PK
        TEXT name
        TEXT subject
        TEXT html
        TEXT text
        TEXT variables "JSON"
    }
    email_logs {
        TEXT id PK
        TEXT subscriber_id "= application id for recruit emails"
        TEXT template_id
        TEXT email "recipient"
        TEXT ses_message_id
        TEXT status "queued|sent|delivered|bounced|complained|failed"
        INTEGER sent_at
        INTEGER delivered_at
        INTEGER opened_at
        INTEGER clicked_at
    }
    suppression_list {
        TEXT email PK
        TEXT reason "bounce|complaint|unsubscribe|manual"
        INTEGER added_at
    }
    email_campaigns {
        TEXT id PK
        TEXT template_id
        TEXT audience
        INTEGER scheduled_at
        TEXT status
    }
    app_settings {
        TEXT key PK "e.g. recruit_notify_to"
        TEXT value
        INTEGER updated_at
    }

    job_applications ||..o{ email_logs : "recruit email (subscriber_id)"
    email_templates  ||..o{ email_logs : "template_id"
    waitlist         ||..o{ email_logs : "campaign send (subscriber_id)"
    email_templates  ||..o{ email_campaigns : "template_id"
    waitlist         ||..o{ suppression_list : "email"
```

All tables are **lazily created** by `ensure…Schema` helpers on first use — there
is no migration step. See `src/utils/recruit-db.ts`, `waitlist-db.ts`,
`email-db.ts`, `app-settings.ts`.

---

## 9. Where things live (repo map)

```
src/
├─ middleware.ts               Worker routing (getready/admin) + admin auth gate
├─ pages/
│  ├─ index.astro              CureVà marketing landing (standalone design system)
│  ├─ recruit.astro            Careers page → links to /recruit/apply
│  ├─ recruit/apply.astro      The Hiring Form (client validation + fetch submit)
│  ├─ api/recruit.ts           Intake: validate → R2 → D1 → recruit emails
│  ├─ admin/                   Dashboard, login, logout, file.ts (R2 dl), update.ts
│  └─ getready.astro           Waitlist landing (email capture)
├─ utils/
│  ├─ recruit-db.ts            job_applications schema + option vocabularies
│  ├─ recruit-emails.ts        recruiter alert + candidate ack (system templates)
│  ├─ app-settings.ts          shared key/value store (recruit_notify_to)
│  ├─ email-db.ts              email tables + default/system template seeding
│  ├─ email/ses-client.ts      SES send + suppression precheck
│  ├─ email/send-service.ts    sendOne (render + log + send)
│  └─ admin-auth.ts            signed-cookie session helpers
└─ e2e/                        Playwright suites (recruit-apply, admin)
```

---

## 10. Deep-dive docs

| Doc | What it covers |
| --- | --- |
| [`RECRUIT.md`](RECRUIT.md) | Hiring-Form field contract, validation, D1 columns, R2 layout |
| [`ADMIN.md`](ADMIN.md) | Recruit admin dashboard, auth, `/admin/file`, `/admin/update` |
| [`EMAIL.md`](EMAIL.md) | SES email infra, templates, SNS webhook, suppression |
| [`TESTING.md`](TESTING.md) | Playwright E2E suite + the deploy pipeline |
| [`DESIGN.md`](DESIGN.md) | getready waitlist landing design |
| notify repo `docs/ARCHITECTURE.md` | The email service in depth (campaigns, SNS, unsubscribe) |

> **Rendering the diagrams:** every diagram above is a Mermaid code block, which
> GitHub, VS Code (with the Mermaid extension), and most Markdown viewers render
> natively. No build step required.
