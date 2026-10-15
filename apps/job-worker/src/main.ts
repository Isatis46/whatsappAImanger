import { Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { readConfig } from "../../../packages/core/config.js";
import { Database } from "../../../packages/persistence/database.js";
import { EventRelay } from "../../../packages/queue/event-relay.js";
import { eventQueue, redisConnection } from "../../../packages/queue/queue.js";
import { AgentsRepository } from "../../../packages/modules/agents/public-api.js";
import {
  AgentOrchestrator,
  ProviderRegistry,
} from "../../../packages/modules/agents/application/agent-orchestrator.js";
import { OpenAiAdapter } from "../../../packages/adapters/llm-openai/openai.adapter.js";
import { LocalLlmAdapter } from "../../../packages/adapters/llm-local/local.adapter.js";
import { ContactsRepository } from "../../../packages/modules/contacts/public-api.js";
import { ExportWorker } from "../../../packages/modules/reporting/public-api.js";
import { logger } from "../../../packages/observability/logger.js";
const config = readConfig();
const db = new Database(config.DATABASE_URL);
const queue = eventQueue(config.REDIS_URL);
const providers = new ProviderRegistry([
  ...(config.OPENAI_API_KEY || config.LLM_API_KEY
    ? [new OpenAiAdapter(config.OPENAI_API_KEY || config.LLM_API_KEY!)]
    : []),
  ...(config.LOCAL_LLM_URL ? [new LocalLlmAdapter(config.LOCAL_LLM_URL)] : []),
]);
const orchestrator = new AgentOrchestrator(new AgentsRepository(db), providers);
const exporter = new ExportWorker(db, config.STORAGE_PATH);
const worker = new Worker<{ eventId: string }>(
  "wa-events",
  async (job) => {
    const [event] = await db.query<{
      id: string;
      event_type: string;
      aggregate_id: string;
      payload: {
        eligible?: boolean;
        conversationId?: string;
        version?: number;
      };
    }>("SELECT * FROM outbox_events WHERE id=$1", [job.data.eventId]);
    if (!event) return;
    const done = await db.query(
      "SELECT event_id FROM consumer_inbox WHERE consumer_name='ai' AND event_id=$1",
      [event.id],
    );
    if (done.length) return;
    if (
      event.event_type === "message.received" &&
      event.payload.eligible &&
      event.payload.conversationId &&
      event.payload.version
    )
      await orchestrator.run(
        event.payload.conversationId,
        event.payload.version,
      );
    await db.query(
      "INSERT INTO consumer_inbox(consumer_name,event_id) VALUES('ai',$1) ON CONFLICT DO NOTHING",
      [event.id],
    );
  },
  { connection: redisConnection(config.REDIS_URL), concurrency: 4 },
);
worker.on("error", () => logger.error("queue_worker_error"));
worker.on("failed", (job) => logger.warn({ jobId: job?.id }, "job_failed"));
let running = true;
const workerId = `jobs-${randomUUID()}`;
process.on("SIGTERM", () => {
  running = false;
});
process.on("SIGINT", () => {
  running = false;
});
logger.info({ workerId }, "job_worker_started");
let cycle = 0;
try {
  while (running) {
    try {
      await new EventRelay(db, queue).publishBatch();
      // Projection is repeatable and independent from AI failures or Redis delivery.
      await db.query(
        `INSERT INTO fact_messages(message_id,organization_id,account_id,conversation_id,direction,source,history,event_time) SELECT m.id,a.organization_id,m.account_id,m.conversation_id,m.direction,m.source,m.history,m.event_time FROM messages m JOIN wa_accounts a ON a.id=m.account_id WHERE NOT EXISTS(SELECT 1 FROM fact_messages f WHERE f.message_id=m.id) ORDER BY m.created_at LIMIT 1000 ON CONFLICT DO NOTHING`,
      );
      await exporter.next();
      await db.query(
        `INSERT INTO worker_heartbeats(id,kind) VALUES($1,'jobs') ON CONFLICT(id) DO UPDATE SET seen_at=now()`,
        [workerId],
      );
      if (cycle % 3600 === 0)
        await new ContactsRepository(db).enforceRetention();
      if (cycle++ % 60 === 0) {
        await exporter.cleanup();
        await db.query(
          "UPDATE agent_runs SET status='FAILED',error_code='worker_interrupted',completed_at=now() WHERE status='RUNNING' AND started_at<now()-interval '3 minutes'",
        );
        await db.query(
          "UPDATE messages SET raw_ciphertext=NULL WHERE raw_ciphertext IS NOT NULL AND created_at<now()-interval '7 days'",
        );
      }
    } catch {
      logger.error("job_relay_cycle_failed");
    }
    await delay(1000);
  }
} finally {
  await worker.close();
  await queue.close();
  await db.close();
}
