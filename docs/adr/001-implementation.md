# ADR 001 — Initial implementation

Accepted choices: single-business modular monolith; Nest/Fastify API, Next.js Persian UI, PostgreSQL as source of truth, BullMQ/Redis as execution transport, separate API/gateway/job processes. The reporting projector and export worker share the job process in this initial deployment. Repositories use Drizzle for typed CRUD and parameterized PostgreSQL SQL for transactional coordination and locking.

The WhatsApp adapter is the sole owner of SDK sockets. Account leases fence auth writes and sends. Persisting SENDING before network I/O trades unattended retries for a visible UNKNOWN_DELIVERY state after uncertain crashes. LLM calls run outside a database transaction; outgoing intents revalidate mode/version under a bounded database lock during sending. This orders a handoff and a send without holding locks throughout model generation.

Cloud access is opt-in per account and AI is initially off. Provider keys come from process configuration, never browser storage or database responses. OpenAI is the initial provider; local OpenAI-compatible models are selected explicitly, with no automatic cross-privacy fallback. CRM/SMS integrations and outbound write tools remain disabled per the user's decision.

Pins: Node 24.19.x, pnpm 11.25.0, Baileys 7.0.0-rc14, exact resolution in pnpm-lock.yaml. Upgrade the Baileys pin only after fixture tests plus controlled live QR/resume/send/receipt tests. The ExcelJS uuid dependency is overridden to the CommonJS-compatible 11.1.1 to fix the published buffer-bounds advisory; CSV/XLSX round trips are tested.
