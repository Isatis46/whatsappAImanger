import { Database, audit } from "../../../persistence/database.js";
import { ensure, requireRole, type Scope } from "../../../core/errors.js";
export class ContactsRepository {
  constructor(private readonly db: Database) {}
  async mapIdentity(accountId: string, lid: string, pn: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `identity:${accountId}`,
      ]);
      const rows = await this.db.query<{ contact_id: string }>(
        "SELECT contact_id FROM contact_identifiers WHERE account_id=$1 AND jid=ANY($2::text[]) ORDER BY jid FOR UPDATE",
        [accountId, [lid, pn]],
        tx,
      );
      const target = rows[0]?.contact_id;
      if (!target) return;
      const ids = [...new Set(rows.map((r) => r.contact_id))];
      const conversations = await this.db.query<{
        id: string;
        contact_id: string;
      }>(
        "SELECT id,contact_id FROM conversations WHERE account_id=$1 AND contact_id=ANY($2::uuid[]) AND merged_into IS NULL ORDER BY opened_at,id FOR UPDATE",
        [accountId, ids],
        tx,
      );
      const canonical = conversations[0];
      for (const conversation of conversations.slice(1)) {
        await tx.query(
          "UPDATE conversations SET merged_into=$2,mode='PAUSED',status='CLOSED',version=version+1 WHERE id=$1",
          [conversation.id, canonical!.id],
        );
        await tx.query(
          "UPDATE outbound_intents SET status='CANCELLED',error_code='identity_merged' WHERE conversation_id=$1 AND status='QUEUED'",
          [conversation.id],
        );
        await tx.query(
          "INSERT INTO identity_merge_history(account_id,source_contact_id,target_contact_id,source_conversation_id,target_conversation_id) VALUES($1,$2,$3,$4,$5)",
          [
            accountId,
            conversation.contact_id,
            target,
            conversation.id,
            canonical!.id,
          ],
        );
      }
      for (const old of ids)
        if (old !== target) {
          await tx.query(
            "INSERT INTO identity_merge_history(account_id,source_contact_id,target_contact_id,target_conversation_id) VALUES($1,$2,$3,$4)",
            [accountId, old, target, canonical?.id],
          );
          await tx.query(
            "UPDATE contact_identifiers SET contact_id=$3 WHERE account_id=$1 AND contact_id=$2",
            [accountId, old, target],
          );
          await tx.query(
            "UPDATE conversations SET contact_id=$3 WHERE account_id=$1 AND contact_id=$2 AND merged_into IS NULL",
            [accountId, old, target],
          );
        }
      for (const [jid, kind] of [
        [lid, "LID"],
        [pn, "PN"],
      ])
        await tx.query(
          "INSERT INTO contact_identifiers(account_id,jid,contact_id,kind) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,jid) DO UPDATE SET contact_id=excluded.contact_id",
          [accountId, jid, target, kind],
        );
      const [account] = await this.db.query<{ organization_id: string }>(
        "SELECT organization_id FROM wa_accounts WHERE id=$1",
        [accountId],
        tx,
      );
      await audit(
        tx,
        account!.organization_id,
        null,
        "contact.identity_linked",
        target,
      );
    });
  }
  async anonymize(scope: Scope, id: string) {
    requireRole(scope, []);
    return this.db.transaction(async (tx) => {
      const [contact] = await this.db.query(
        "SELECT id FROM contacts WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [id, scope.organizationId],
        tx,
      );
      ensure(contact, "contact_not_found", 404);
      const lineage = await this.db.query<{ id: string }>(
        "WITH RECURSIVE family(id) AS(SELECT $1::uuid UNION SELECT h.source_contact_id FROM identity_merge_history h JOIN family f ON h.target_contact_id=f.id) SELECT id FROM family",
        [id],
        tx,
      );
      const ids = lineage.map((row) => row.id);
      await tx.query(
        "SELECT id FROM conversations WHERE contact_id=ANY($1::uuid[]) FOR UPDATE",
        [ids],
      );
      await tx.query(
        "UPDATE contacts SET display_name='مخاطب حذف‌شده',opted_out=true WHERE id=ANY($1::uuid[])",
        [ids],
      );
      await tx.query(
        "UPDATE messages SET body='[حذف‌شده]',raw_ciphertext=NULL,external_id=NULL WHERE conversation_id IN(SELECT id FROM conversations WHERE contact_id=ANY($1::uuid[]))",
        [ids],
      );
      await tx.query(
        "UPDATE agent_runs SET reply=NULL WHERE conversation_id IN(SELECT id FROM conversations WHERE contact_id=ANY($1::uuid[]))",
        [ids],
      );
      await tx.query(
        "UPDATE outbound_intents SET body='[حذف‌شده]',external_id=NULL,status=CASE WHEN status IN ('QUEUED','SENDING') THEN 'CANCELLED' ELSE status END WHERE conversation_id IN(SELECT id FROM conversations WHERE contact_id=ANY($1::uuid[]))",
        [ids],
      );
      await tx.query(
        "UPDATE conversation_activities SET body=NULL WHERE conversation_id IN(SELECT id FROM conversations WHERE contact_id=ANY($1::uuid[]))",
        [ids],
      );
      await tx.query(
        "UPDATE conversations SET remote_jid='redacted:'||id::text,mode='PAUSED',status='CLOSED',version=version+1,last_preview='[حذف‌شده]' WHERE contact_id=ANY($1::uuid[])",
        [ids],
      );
      await tx.query(
        "DELETE FROM contact_identifiers WHERE contact_id=ANY($1::uuid[])",
        [ids],
      );
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "contact.anonymized",
        id,
      );
      return { anonymized: true };
    });
  }
  async enforceRetention(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE conversations c SET last_preview='[منقضی‌شده]',tags='{}' FROM wa_accounts a,organizations o WHERE c.account_id=a.id AND a.organization_id=o.id AND c.last_message_at<now()-o.retention_days*interval '1 day' AND c.last_preview<>'[منقضی‌شده]'",
      );
      await tx.query(
        "UPDATE conversation_activities ca SET body=NULL FROM conversations c,wa_accounts a,organizations o WHERE ca.conversation_id=c.id AND c.account_id=a.id AND a.organization_id=o.id AND ca.created_at<now()-o.retention_days*interval '1 day' AND ca.body IS NOT NULL",
      );
      await tx.query(
        "UPDATE messages m SET body='[منقضی‌شده]',raw_ciphertext=NULL FROM wa_accounts a,organizations o WHERE m.account_id=a.id AND a.organization_id=o.id AND m.created_at<now()-o.retention_days*interval '1 day' AND m.body<>'[منقضی‌شده]'",
      );
      await tx.query(
        "UPDATE agent_runs r SET reply=NULL FROM wa_accounts a,organizations o WHERE r.account_id=a.id AND a.organization_id=o.id AND r.started_at<now()-o.retention_days*interval '1 day' AND r.reply IS NOT NULL",
      );
      await tx.query(
        "UPDATE outbound_intents i SET body='[منقضی‌شده]' FROM wa_accounts a,organizations o WHERE i.account_id=a.id AND a.organization_id=o.id AND i.created_at<now()-o.retention_days*interval '1 day' AND i.body<>'[منقضی‌شده]' AND i.status NOT IN ('QUEUED','SENDING')",
      );
    });
  }
}
