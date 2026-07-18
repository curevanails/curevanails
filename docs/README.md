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

The standalone email service lives in the
[`notifications-service`](https://github.com/curevanails/notifications-service)
repo; its `docs/ARCHITECTURE.md` covers campaigns, SNS events, and unsubscribe.

Diagrams are [Mermaid](https://mermaid.js.org/) code blocks — GitHub and most
Markdown viewers render them with no build step. Older rendered diagrams are in
[`diagrams/`](diagrams/).
