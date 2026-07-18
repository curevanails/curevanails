# CureVà docs

Start here to understand the system.

1. **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — the whole platform in diagrams
   (four Workers, shared D1/R2, auth, recruit flow, recruit emails, CI/CD, data
   model). **Read this first.**
2. [`RECRUIT.md`](RECRUIT.md) — the `/recruit/apply` Hiring-Form field contract.
3. [`ADMIN.md`](ADMIN.md) — the recruit admin dashboard.
4. [`EMAIL.md`](EMAIL.md) — AWS SES email infrastructure.
5. [`TESTING.md`](TESTING.md) — Playwright E2E + the deploy pipeline.
6. [`DESIGN.md`](DESIGN.md) — the getready waitlist landing design.
7. [`notify/`](notify/README.md) — the **notify** email Worker (dashboard, SES
   send, scheduled campaigns, SNS events, unsubscribe). Formerly the standalone
   `notifications-service` repo, now the 4th Worker built from this codebase.

The email service (the **notify** Worker) is built from this repo via
`wrangler.notify.jsonc` — see [`notify/README.md`](notify/README.md) and
[`notify/ARCHITECTURE.md`](notify/ARCHITECTURE.md) for campaigns, SNS events, and
unsubscribe.

Diagrams are [Mermaid](https://mermaid.js.org/) code blocks — GitHub and most
Markdown viewers render them with no build step. Older rendered diagrams are in
[`diagrams/`](diagrams/).
