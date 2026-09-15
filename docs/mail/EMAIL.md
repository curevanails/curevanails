# Email infrastructure

Lets the owner send templated emails (welcome, opening announcement, discount
codes) to the **waitlist** and tracks delivery / bounces / complaints. Built
into the existing CureVà admin — no separate app.

```
 Owner                         Cloudflare (this codebase)
 ─────                         ──────────────────────────
 / (dashboard) ─POST─▶ /api/email/send ─────┬─▶ render (Handlebars)
 (compose UI)                               ├─▶ suppression precheck (D1)
                                            └─▶ mailer.send() ──▶ Cloudflare Email Service (EMAIL binding)
                                                  writes email_logs      └─ fallback: AWS SES ──▶ SNS ──▶ /api/webhooks/ses
                                                                                                     (delivery/bounce/complaint → D1)
```

## Transport: Cloudflare Email Service, SES as fallback

`src/utils/email/mailer.ts` is the one place that decides how an email leaves.
Every Worker (`wrangler.jsonc`, `wrangler.getready.jsonc`, `wrangler.admin.jsonc`)
carries a `send_email` binding named `EMAIL`, and the mailer sends with
`env.EMAIL.send()`: no credentials, no sandbox, any recipient from the moment
the domain is onboarded. Everything above the mailer — templates, `sendOne`,
`email_logs`, the dashboard, the crons — never learns which transport is in use.

- **From** is `CureVà <hello@curevanails.com>` (`src/utils/email/sender.ts`).
  The domain must be onboarded for Email Sending on the Cloudflare account:
  `npx wrangler email sending enable curevanails.com`, then
  `npx wrangler email sending dns get curevanails.com` to confirm the SPF/DKIM
  records landed (DNS is on Cloudflare, so they are added for you). Keep a
  **single** SPF record: merge the Cloudflare include into the existing one
  rather than adding a second `v=spf1` TXT.
- **Suppression** is two-layered: our `suppression_list` is checked before
  every send, and Cloudflare keeps its own list of hard bounces and spam
  complaints. A send refused with `E_RECIPIENT_SUPPRESSED` is mirrored into
  ours, so the dashboard's Suppressed page stays truthful without a webhook.
- **`email_logs.ses_message_id`** keeps its name and now holds whichever
  transport's message id was minted. Delivery/open/click columns only fill in
  on the SES fallback (they come from SNS); on Cloudflare a row stops at `sent`,
  and per-message delivery detail lives in the Cloudflare dashboard.
- **Fallback.** A Worker deployed without the `EMAIL` binding uses AWS SES via
  the `AWS_*` secrets. Only then do the SES sandbox rule, the Configuration Set
  and the `/api/webhooks/ses` receiver matter. The recruit catch-up cron asks
  the transport whether it can reach unverified addresses before trying — always
  yes on Cloudflare, `GetAccount` on SES.
- **Local dev / E2E.** `wrangler dev` (and `astro preview`) simulate the binding:
  a send is logged and written to a local file, never delivered. Add
  `"remote": true` to the binding only when you deliberately want real sends
  from a dev session.

## Key idea: the subscriber list **is** the `waitlist` table

The public getready form already populates `waitlist`. We extended that table
with a few columns instead of creating a second subscriber store:

- `unsubscribe_token` — unique, unguessable token for the opt-out link (set at
  signup; back-filled for older rows by `ensureWaitlistSchema`)
- `email_status` — `active` | `unsubscribed` | `bounced` | `complained`
  (independent of the pipeline `status` of waiting/invited/redeemed)
- `ack_email_sent_at` — ISO timestamp of the automatic welcome email; **NULL =
  never sent**. See "Automatic transactional sends" below.

## Automatic transactional sends

Two public forms send their own email the moment someone submits, with no
operator action. Both are best-effort — the row is persisted first and every
email error is swallowed, so a failed or unconfigured send never affects the
visitor's result — and both stamp an `ack_email_sent_at` column on success, so
staff can see at a glance who has actually been thanked.

| Form | Endpoint | Template | Sent when | Stamped on |
| --- | --- | --- | --- | --- |
| Job application | `POST /api/recruit` | `tpl-recruit-ack` | The applicant filled in the optional email field | `job_applications.ack_email_sent_at` |
| Waitlist signup | `POST /api/waitlist` | `tpl-welcome` | A new email joins — **or** an existing row still has `ack_email_sent_at IS NULL` | `waitlist.ack_email_sent_at` |

The waitlist retry rule is what keeps re-submissions from re-sending: once the
stamp is set, joining again with the same address updates the row but sends
nothing. Rows that predate this feature (or whose send failed) get the welcome
on their next submission.

`/api/recruit` additionally sends `tpl-recruit-alert` to the recruiters in the
`recruit_notify_to` setting. That one is not stamped — it goes to staff, not the
applicant.

Both paths go through the shared `sendOne()`, so every attempt appears in
`email_logs` with its `status` and `error_message`. When `ack_email_sent_at` is
NULL, `email_logs` says why: a `failed` row carries the reason — no transport
configured (no `EMAIL` binding and no `AWS_*` secrets), a suppression-list hit,
or the transport's own error message.

## Template syntax

Templates are **not** rendered by Handlebars. Handlebars compiles by generating
JavaScript and running it through `new Function()`, which Cloudflare Workers
refuses ("Code generation from strings disallowed for this context"), and
templates live in D1 where operators edit them, so build-time precompilation
isn't possible either. `template-render.ts` interprets them instead.

The supported syntax is verified against Handlebars by a 52-case parity suite:

| Syntax | Meaning |
| --- | --- |
| `{{name}}` | value, HTML-escaped |
| `{{{name}}}` | value, raw |
| `{{user.email}}` | dotted path |
| `{{#if x}}…{{else}}…{{/if}}` | conditional, nestable |
| `{{#unless x}}…{{/unless}}` | negated conditional |
| `{{! … }}` | comment, dropped |

Missing variables render empty and an empty array is falsy, both matching
Handlebars. The subject and plain-text body render unescaped; HTML escapes. Any
**other** block helper throws, so a dashboard typo becomes a recorded send
failure instead of a silently mangled email.

## Transport configuration

| Setting | Where | Notes |
| --- | --- | --- |
| `EMAIL` | `send_email` binding in **every** `wrangler*.jsonc` | The Cloudflare Email Service transport. Must be on every Worker that serves a public form, not just `admin` — `/api/recruit` and `/api/waitlist` run on `curevanails` and `getready` too. Needs the From domain onboarded (see above). |
| From address | `FROM_EMAIL` / `FROM_NAME` in `sender.ts` | `hello@curevanails.com`. The domain must be onboarded on Cloudflare (and verified in SES for the fallback). |
| `PUBLIC_SITE_URL` | Worker **secret** (optional) | Public origin for unsubscribe links when there is no request (cron). |

The SES fallback, used only by a Worker with no `EMAIL` binding:

| Setting | Where | Notes |
| --- | --- | --- |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Worker **secrets** | All three, or the fallback is not configured. |
| `SES_CONFIGURATION_SET` | Worker **var** | Optional, empty by default. SES rejects the entire send when the named set doesn't exist, so don't set it until the set exists in AWS. Setting it is what makes SES publish delivery/bounce/complaint events to SNS — `/api/webhooks/ses` and automatic bounce suppression only work while it is configured. |
| `SES_TOPIC_ARN` | Worker **var** | The SNS topic the configuration set publishes to. The webhook fails closed without it. |

While the AWS account is in the SES **sandbox**, recipients must also be
verified identities and sending is capped (200/day, 1/sec) — the reason the
Cloudflare transport is the live one.

## Tables (D1, lazy-created — no migration step)

| Table | Purpose |
| --- | --- |
| `email_templates` | Handlebars templates (`subject`, `html`, `text`, `variables`). Seeded with **Welcome**, **Opening announcement**, **Discount code**. |
| `email_logs` | One row per send: `ses_message_id`, `status`, and `sent/delivered/opened/clicked_at`, `bounce_reason`, `error_message`. |
| `suppression_list` | `email` (PK), `reason` (`bounce`/`complaint`/`unsubscribe`/`manual`), `added_at`. Checked before every send. |

All email timestamps are Unix **milliseconds** (INTEGER).

## Dashboard — `/` (root)

The single **Email** dashboard (this is a standalone, email-only service):

- **Compose & send** — pick a template, pick an audience (All active / Waiting /
  Invited / Redeemed, with live counts), optional shared discount code, send.
- **Preview** — live render with sample values.
- **Templates** — create / edit / delete templates in a modal editor with live
  preview. Handlebars variables (`{{name}}`, `{{discount_code}}`, …) are
  detected automatically and stored on the template. Defaults are seeded only
  on a fresh table, so edits and deletes persist (see `ensureEmailSchema`).
- **Send test** — per template, send one rendered email to an address you type
  (`/api/email/test`), to check it in a real inbox before a campaign.
- **Analytics** — all-time delivery stats over `email_logs` (sent / delivered /
  opened / clicked / bounced / complaints, with rates), plus a per-template
  breakdown. Populated from the SNS event timestamps.
- **Recent sends** — last 50 `email_logs` with status.
- **Suppressed addresses** — the suppression list.

Sending is disabled with a banner until the SES secrets are set (below).

## Secrets (production)

The Cloudflare transport needs none. Optional on either transport, and the SES
fallback's credentials, are **secrets**, not vars — never commit them:

```bash
# Optional: public origin used to build unsubscribe links in emails
wrangler secret put PUBLIC_SITE_URL       --config wrangler.admin.jsonc   # https://admin.curevanails.com
# SES fallback only
wrangler secret put AWS_REGION            --config wrangler.admin.jsonc
wrangler secret put AWS_ACCESS_KEY_ID     --config wrangler.admin.jsonc
wrangler secret put AWS_SECRET_ACCESS_KEY --config wrangler.admin.jsonc
```

Local dev: the `EMAIL` binding is simulated (nothing is delivered); to exercise
the SES fallback instead, remove the binding and uncomment the `AWS_*` lines in
`.dev.vars` (gitignored).

Fixed in code (not secrets): From address `CureVà <hello@curevanails.com>` in
`src/utils/email/sender.ts`; the SES Configuration Set comes from the
`SES_CONFIGURATION_SET` var.

## SNS webhook (SES fallback only)

Point the SES Configuration Set's SNS subscription at:

```
https://admin.curevanails.com/api/webhooks/ses
```

(The handler is public and only needs the shared D1 — no AWS secrets. It runs
on the always-on main Worker even though sending runs on the admin Worker,
because all three Workers share one D1.)

Every SNS message's **signature is verified** against its AWS signing cert
before it is acted on (`src/utils/email/sns-verify.ts`). The handler
auto-confirms the subscription, marks delivery/open/click, and **auto-suppresses
permanent bounces + complaints** (also flipping the subscriber's `email_status`).

## Unsubscribe

Every email includes `{{unsubscribe_url}}` → `/unsubscribe/<token>` (public,
no auth). Confirming sets `email_status='unsubscribed'` and adds the address to
the suppression list, so it's excluded from future audiences and blocked at
send time.

**One-click unsubscribe (RFC 8058).** Every send also carries the headers
`List-Unsubscribe: <https://…/unsubscribe/<token>>` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` (built in
`src/utils/email/sender.ts`, sent by either transport). This renders the native **Unsubscribe** button
in Gmail / Apple Mail and is **required by Gmail & Yahoo for bulk senders** —
without it, campaigns risk the spam folder. The mail provider sends a cookieless
`POST` (body `List-Unsubscribe=One-Click`) to the same `/unsubscribe/<token>`
page, which opts the address out; it isn't CSRF-blocked because
`security.checkOrigin` is off (see the SNS webhook note). The `List-Unsubscribe`
URL must be **absolute** — for cron-triggered scheduled campaigns (no request
origin) it falls back to `DEFAULT_PUBLIC_URL`; set `PUBLIC_SITE_URL` to override.
One-click only takes full effect once the domain's DKIM/DMARC is verified, since
the header must be on an authenticated message.

## Abuse protection

The public `POST /api/waitlist` is rate-limited to **5 signups / 10 min / IP**
(KV-backed, fails open). See `src/utils/rate-limit.ts`.

## Files

| File | Purpose |
| --- | --- |
| `src/utils/email-db.ts` | email tables + default-template seeding |
| `src/utils/email/template-render.ts` | template interpreter (see "Template syntax") |
| `src/utils/waitlist-db.ts` | subscriber schema (`unsubscribe_token`, `email_status`, `ack_email_sent_at`) |
| `src/utils/waitlist-emails.ts` | automatic `tpl-welcome` send on signup |
| `src/utils/recruit-emails.ts` | automatic `tpl-recruit-alert` + `tpl-recruit-ack` on application |
| `src/utils/email/ses-client.ts` | SES send + suppression precheck |
| `src/utils/email/template-render.ts` | Handlebars render + unsubscribe URL |
| `src/utils/email/suppression.ts` | suppression check / add |
| `src/utils/email/sns-verify.ts` | SNS signature verification |
| `src/utils/email/send-service.ts` | throttled campaign loop (≈12/sec) |
| `src/pages/index.astro` | dashboard at `/` — compose / preview / templates / logs |
| `src/pages/api/email/send.ts` | `POST /api/email/send` — campaign send (auth) |
| `src/pages/api/email/templates.ts` | `POST /api/email/templates` — template create/update/delete (auth) |
| `src/pages/api/email/test.ts` | `POST /api/email/test` — single test send (auth) |
| `src/pages/login.astro` · `src/pages/logout.ts` | sign-in / sign-out (`/login`, `/logout`) |
| `src/middleware.ts` | auth gate — protects `/` and `/api/email/*` |
| `src/pages/api/webhooks/ses.ts` | `POST /api/webhooks/ses` (public, SNS) |
| `src/pages/unsubscribe/[token].astro` | public opt-out page |

## Deferred to Phase 2

- **Cloudflare Queues** for send throttling/retries at scale. Today the campaign
  loop sends inline (`send-service.ts`), fine for the pre-launch list; `sendOne`
  is written so a queue consumer can call it per-message unchanged.
- ~~Template editor UI~~ — **done** (`src/pages/api/email/templates.ts` +
  the Templates section in the admin UI). Campaign scheduling (Cron Triggers)
  is still pending.
- ~~Open/click analytics dashboard~~ — **done** (Analytics section in the
  dashboard, aggregated over `email_logs`).
