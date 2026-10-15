import { Database } from "../persistence/database.js";
export interface DurableQueuePort {
  add(
    name: string,
    data: { eventId: string },
    options: { jobId: string; delay: number },
  ): Promise<unknown>;
  getJob(
    id: string,
  ): Promise<
    { getState(): Promise<string>; remove(): Promise<unknown> } | undefined
  >;
}
export class EventRelay {
  constructor(
    private readonly db: Database,
    private readonly queue: DurableQueuePort,
  ) {}
  async publishBatch(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const events = await this.db.query<{
        id: string;
        payload: { eligible?: boolean; conversationId?: string };
      }>(
        `SELECT e.* FROM outbox_events e WHERE published_at IS NULL OR (published_at<now()-interval '5 minutes' AND NOT EXISTS(SELECT 1 FROM consumer_inbox i WHERE i.event_id=e.id AND i.consumer_name='ai')) ORDER BY occurred_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
        [],
        tx,
      );
      for (const event of events) {
        let debounce = 0;
        if (event.payload.eligible && event.payload.conversationId) {
          const [row] = await this.db.query<{ debounce_seconds: number }>(
            "SELECT v.debounce_seconds FROM conversations c JOIN wa_accounts a ON a.id=c.account_id JOIN LATERAL(SELECT debounce_seconds FROM agent_versions WHERE agent_id=a.agent_id ORDER BY version DESC LIMIT 1)v ON true WHERE c.id=$1",
            [event.payload.conversationId],
            tx,
          );
          debounce = row?.debounce_seconds ?? 4;
        }
        const existing = await this.queue.getJob(event.id);
        // A Redis completion without a committed consumer receipt is safe to replay.
        if (existing && (await existing.getState()) === "completed")
          await existing.remove();
        await this.queue.add(
          "event",
          { eventId: event.id },
          { jobId: event.id, delay: debounce * 1000 },
        );
        await tx.query(
          "UPDATE outbox_events SET published_at=now() WHERE id=$1",
          [event.id],
        );
      }
      return events.length;
    });
  }
}
