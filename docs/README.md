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
7. [`mail/`](mail/README.md) — the email system (dashboard at `/mail`, SES send,
   scheduled campaigns, SNS events, unsubscribe). Hosted on the `admin` Worker;
   formerly the standalone `notifications-service` repo / `notify` Worker.

Email runs on the `admin` Worker (dashboard at `admin.curevanails.com/mail`, the
SES send + campaign cron, and the SNS webhook) — see [`mail/README.md`](mail/README.md)
and [`mail/ARCHITECTURE.md`](mail/ARCHITECTURE.md) for campaigns, SNS events, and
unsubscribe.

Diagrams are [Mermaid](https://mermaid.js.org/) code blocks — GitHub and most
Markdown viewers render them with no build step. Older rendered diagrams are in
[`diagrams/`](diagrams/).
