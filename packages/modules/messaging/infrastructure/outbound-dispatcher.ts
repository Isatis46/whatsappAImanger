import { Database, appendEvent } from "../../../persistence/database.js";
import type { ChannelGatewayPort } from "../domain/reply-policy.js";
export class OutboundDispatcher {
  constructor(
    private readonly db: Database,
    private readonly gateway: ChannelGatewayPort,
  ) {}
  async sendNext(
    accountId: string,
    workerId: string,
    token: number,
  ): Promise<boolean> {
    const intent = await this.db.transaction(async (tx) => {
      const [row] = await this.db.query<{
        id: string;
        conversation_id: string;
        body: string;
        source: string;
        expected_version: number;
      }>(
        `SELECT * FROM outbound_intents WHERE account_id=$1 AND status='QUEUED' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [accountId],
        tx,
      );
      if (!row) return null;
      await tx.query(
        "UPDATE outbound_intents SET status='SENDING',updated_at=now() WHERE id=$1",
        [row.id],
      );
      return row;
    });
    if (!intent) return false;
    try {
      await this.db.transaction(async (tx) => {
        // The durable SENDING marker precedes external I/O. A crash cannot turn this into a safe retry.
        const [c] = await this.db.query<{
          mode: string;
          version: number;
          status: string;
          remote_jid: string;
          organization_id: string;
          enabled: boolean;
          ai_enabled: boolean;
          automation_enabled: boolean;
          opted_out: boolean;
        }>(
          `SELECT c.*,a.organization_id,a.enabled,a.ai_enabled,o.automation_enabled,ct.opted_out FROM conversations c JOIN wa_accounts a ON a.id=c.account_id JOIN organizations o ON o.id=a.organization_id JOIN contacts ct ON ct.id=c.contact_id WHERE c.id=$1 FOR UPDATE OF c,a`,
          [intent.conversation_id],
          tx,
        );
        const [lease] = await this.db.query(
          `SELECT account_id FROM wa_session_leases WHERE account_id=$1 AND worker_id=$2 AND fencing_token=$3 AND lease_until>now()`,
          [accountId, workerId, token],
          tx,
        );
        const valid =
          c &&
          lease &&
          c.enabled &&
          c.status === "OPEN" &&
          c.version === intent.expected_version &&
          (intent.source === "AI"
            ? c.mode === "AI" &&
              c.ai_enabled &&
              c.automation_enabled &&
              !c.opted_out
            : ["HUMAN", "ASSIST"].includes(c.mode));
        if (!valid) {
          await tx.query(
            "UPDATE outbound_intents SET status='CANCELLED',error_code='policy_or_lease_changed',updated_at=now() WHERE id=$1",
            [intent.id],
          );
          return;
        }
        const result = await this.gateway.sendText(
          accountId,
          c.remote_jid,
          intent.body,
        );
        if (result.kind === "ACCEPTED") {
          await tx.query(
            "UPDATE outbound_intents SET status='ACCEPTED',external_id=$2,updated_at=now() WHERE id=$1",
            [intent.id, result.externalMessageId],
          );
          const [msg] = await this.db.query<{ id: string }>(
            `INSERT INTO messages(account_id,conversation_id,dedupe_key,external_id,direction,source,body,event_time,status) VALUES($1,$2,$3,$4,'OUTBOUND',$5,$6,now(),'ACCEPTED') RETURNING id`,
            [
              accountId,
              intent.conversation_id,
              `intent:${intent.id}`,
              result.externalMessageId,
              intent.source,
              intent.body,
            ],
            tx,
          );
          await tx.query(
            "UPDATE conversations SET last_message_at=now(),last_preview=$2,unread_count=0 WHERE id=$1",
            [intent.conversation_id, intent.body.slice(0, 180)],
          );
          await appendEvent(
            tx,
            c.organization_id,
            accountId,
            "message.sent",
            msg!.id,
            { messageId: msg!.id, conversationId: intent.conversation_id },
          );
        } else
          await tx.query(
            "UPDATE outbound_intents SET status=$2,error_code=$3,updated_at=now() WHERE id=$1",
            [
              intent.id,
              result.kind === "UNKNOWN" ? "UNKNOWN_DELIVERY" : "FINAL_FAILURE",
              result.kind === "UNKNOWN" ? result.reason : result.code,
            ],
          );
      });
    } catch {
      await this.db.query(
        "UPDATE outbound_intents SET status='UNKNOWN_DELIVERY',error_code='send_outcome_uncertain',updated_at=now() WHERE id=$1 AND status='SENDING'",
        [intent.id],
      );
    }
    return true;
  }
  async recoverUnknown(): Promise<void> {
    await this.db.query(
      "UPDATE outbound_intents SET status='UNKNOWN_DELIVERY',error_code='worker_interrupted',updated_at=now() WHERE status='SENDING' AND updated_at<now()-interval '2 minutes'",
    );
  }
}
