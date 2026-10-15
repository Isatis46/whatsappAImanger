# Development guide

Use this checkout. Cloud tasks are already isolated; do not create worktrees unless the user asks.

- Read `README.md` and `docs/architecture/implementation-status.fa.md` before extending behavior.
- Keep framework, SQL, Baileys and provider SDK imports out of domain/application. Use module `public-api.ts` exports from composition roots and ports from adapters.
- PostgreSQL owns all durable message state. Preserve transactional receipt/message/outbox writes, consumer deduplication and queue-loss recovery.
- Never retry `UNKNOWN_DELIVERY` automatically. Check account lease, organization/account automation controls, conversation mode and version immediately before sending.
- Do not log message text, QR content, passwords, auth state, tokens or API keys. Never commit `.env`, generated exports, sessions or backup keys.
- CRM/SMS remain disabled until the user chooses a provider and explicitly requests integration.
- Run the relevant tests plus `pnpm typecheck` and `pnpm lint`. For persistence changes run `pnpm test:integration`; for UI changes use `pnpm test:e2e`. The tests create only their own temporary databases.
- Add versioned SQL migrations; do not alter an applied migration or use schema push in production.
- Preserve Persian RTL and usable mobile layouts. Keep product screens free of development-only internals.
