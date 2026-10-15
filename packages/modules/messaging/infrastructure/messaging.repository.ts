import { createHash } from "node:crypto";
import { Database, appendEvent, audit } from "../../../persistence/database.js";
import { CredentialCipher } from "../../../security/cipher.js";
import {
  ReplyEligibilityPolicy,
  type IncomingMessage,
} from "../domain/reply-policy.js";
export function messageDedupe(input: IncomingMessage): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.accountId,
        input.jid,
        input.externalId,
        input.fromMe,
        input.participant,
      ]),
    )
    .digest("hex");
}
export class MessagingRepository {
  private readonly eligibility = new ReplyEligibilityPolicy();
  constructor(
    private readonly db: Database,
    private readonly cipher: CredentialCipher,
  ) {}
  async receive(
    input: IncomingMessage,
  ): Promise<{
    duplicate: boolean;
    conversationId?: string;
    messageId?: string;
  }> {
    return this.db.transaction(async (tx) => {
      const [account] = await this.db.query<{ organization_id: string }>(
        "SELECT organization_id FROM wa_accounts WHERE id=$1",
        [input.accountId],
        tx,
      );
      if (!account) throw new Error("unknown_account");
      const key = messageDedupe(input);
      const receipt = await tx.query(
        "INSERT INTO inbox_receipts(account_id,dedupe_key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING dedupe_key",
        [input.accountId, key],
      );
      if (!receipt.rowCount) return { duplicate: true };
      if (input.fromMe) {
        const known = await tx.query(
          "UPDATE outbound_intents SET status=CASE WHEN status IN ('SENDING','UNKNOWN_DELIVERY') THEN 'ACCEPTED' ELSE status END,updated_at=now() WHERE account_id=$1 AND external_id=$2 RETURNING id",
          [input.accountId, input.externalId],
        );
        if (known.rowCount) return { duplicate: true };
      }
      // Account-local identity serialization prevents duplicate contacts on concurrent first messages.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${input.accountId}:${input.jid}`,
      ]);
      let [identity] = await this.db.query<{ contact_id: string }>(
        "SELECT contact_id FROM contact_identifiers WHERE account_id=$1 AND jid=$2",
        [input.accountId, input.jid],
        tx,
      );
      if (!identity) {
        const [contact] = await this.db.query<{ id: string }>(
          "INSERT INTO contacts(organization_id,display_name) VALUES($1,$2) RETURNING id",
          [account.organization_id, input.displayName || "مخاطب واتساپ"],
          tx,
        );
        identity = { contact_id: contact!.id };
        await tx.query(
          "INSERT INTO contact_identifiers(account_id,jid,contact_id,kind) VALUES($1,$2,$3,$4)",
          [
            input.accountId,
            input.jid,
            identity.contact_id,
            input.jid.endsWith("@lid") ? "LID" : "PN",
          ],
        );
      }
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${input.accountId}:contact:${identity.contact_id}`,
      ]);
      const existing = await tx.query(
        "SELECT id FROM conversations WHERE account_id=$1 AND contact_id=$2 AND merged_into IS NULL",
        [input.accountId, identity.contact_id],
      );
      if (!existing.rowCount)
        await tx.query(
          "INSERT INTO conversations(account_id,contact_id,remote_jid) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [input.accountId, identity.contact_id, input.jid],
        );
      const [conv] = await this.db.query<{
        id: string;
        version: number;
        mode: string;
      }>(
        "SELECT id,version,mode FROM conversations WHERE account_id=$1 AND contact_id=$2 AND merged_into IS NULL ORDER BY opened_at LIMIT 1 FOR UPDATE",
        [input.accountId, identity.contact_id],
        tx,
      );
      const [message] = await this.db.query<{ id: string }>(
        `INSERT INTO messages(account_id,conversation_id,dedupe_key,external_id,direction,source,body,history,event_time,raw_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          input.accountId,
          conv!.id,
          key,
          input.externalId,
          input.fromMe ? "OUTBOUND" : "INBOUND",
          input.fromMe ? "DEVICE" : "CUSTOMER",
          input.body,
          input.history,
          input.timestamp,
          input.raw
            ? this.cipher.encrypt(
                input.raw,
                `message:${input.accountId}:${input.externalId}`,
              )
            : null,
        ],
        tx,
      );
      const live = this.eligibility.accepts(input, new Date());
      const humanRequest =
        live &&
        /(?:اپراتور|پشتیبان انسانی|صحبت با انسان|\bhuman\b|\bagent\b)/iu.test(
          input.body,
        );
      const optOut = live && /^(?:stop|لغو|توقف)$/iu.test(input.body.trim());
      const mode = optOut
        ? "PAUSED"
        : humanRequest || (input.fromMe && !input.history)
          ? "HUMAN"
          : conv!.mode;
      await tx.query(
        `UPDATE conversations SET last_message_at=greatest(last_message_at,$2),last_preview=CASE WHEN $2>=last_message_at THEN $3 ELSE last_preview END,version=version+$4,mode=$5,unread_count=unread_count+$6,status=CASE WHEN $4=1 THEN 'OPEN' ELSE status END,closed_at=CASE WHEN $4=1 THEN NULL ELSE closed_at END WHERE id=$1`,
        [
          conv!.id,
          input.timestamp,
          input.body.slice(0, 180),
          !input.history ? 1 : 0,
          mode,
          live ? 1 : 0,
        ],
      );
      if (optOut)
        await tx.query("UPDATE contacts SET opted_out=true WHERE id=$1", [
          identity.contact_id,
        ]);
      if (mode !== conv!.mode) {
        await audit(
          tx,
          account.organization_id,
          null,
          `conversation.auto_${mode.toLowerCase()}`,
          conv!.id,
        );
        await tx.query(
          "INSERT INTO conversation_activities(conversation_id,kind) VALUES($1,$2)",
          [conv!.id, `mode.${mode}`],
        );
      }
      await appendEvent(
        tx,
        account.organization_id,
        input.accountId,
        "message.received",
        message!.id,
        {
          messageId: message!.id,
          conversationId: conv!.id,
          eligible: live && !humanRequest && !optOut,
          version: conv!.version + (!input.history ? 1 : 0),
        },
      );
      return {
        duplicate: false,
        conversationId: conv!.id,
        messageId: message!.id,
      };
    });
  }
  async receipt(
    accountId: string,
    externalId: string,
    status: "DELIVERED" | "READ",
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE outbound_intents SET status=CASE WHEN status='READ' THEN 'READ' ELSE $3 END,updated_at=now() WHERE account_id=$1 AND external_id=$2 AND status IN ('ACCEPTED','DELIVERED','READ','UNKNOWN_DELIVERY')`,
        [accountId, externalId, status],
      );
      const rows = await this.db.query<{ id: string }>(
        `UPDATE messages SET status=CASE WHEN status='READ' THEN 'READ' ELSE $3 END WHERE account_id=$1 AND external_id=$2 RETURNING id`,
        [accountId, externalId, status],
        tx,
      );
      for (const row of rows)
        await tx.query(
          "INSERT INTO message_status_events(message_id,status) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [row.id, status],
        );
    });
  }
}
