import {
  Database,
  audit,
  appendEvent,
  type Connection,
} from "../../../persistence/database.js";
import {
  ensure,
  isAdmin,
  requireAccount,
  requireRole,
  type Scope,
} from "../../../core/errors.js";
import {
  Conversation,
  type ConversationMode,
} from "../domain/conversation.entity.js";
import { DomainError } from "../../../core/errors.js";
export type ConversationRow = {
  id: string;
  account_id: string;
  organization_id: string;
  mode: ConversationMode;
  version: number;
  status: "OPEN" | "CLOSED";
  remote_jid: string;
  contact_id: string;
};
export function decodeCursor(
  cursor?: string,
): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (
      typeof v === "object" &&
      v &&
      "at" in v &&
      typeof v.at === "string" &&
      Number.isFinite(Date.parse(v.at)) &&
      "id" in v &&
      typeof v.id === "string" &&
      /^[a-f\d-]{36}$/i.test(v.id)
    )
      return { at: v.at, id: v.id };
  } catch {
    /* invalid external cursor */
  }
  throw new DomainError("invalid_cursor");
}
export class ConversationsRepository {
  constructor(private readonly db: Database) {}
  async get(
    scope: Scope,
    id: string,
    tx?: Connection,
    lock = false,
  ): Promise<ConversationRow> {
    const [row] = await this.db.query<ConversationRow>(
      `SELECT c.*,a.organization_id FROM conversations c JOIN wa_accounts a ON a.id=c.account_id WHERE c.id=$1 AND a.organization_id=$2 ${lock ? "FOR UPDATE OF c" : ""}`,
      [id, scope.organizationId],
      tx,
    );
    ensure(row, "conversation_not_found", 404);
    requireAccount(scope, row.account_id);
    return row;
  }
  async list(
    scope: Scope,
    input: {
      accountId?: string;
      mode?: string;
      q?: string;
      limit: number;
      cursor?: string;
    },
  ) {
    requireRole(scope, ["SUPERVISOR", "AGENT"]);
    const cursor = decodeCursor(input.cursor);
    const rows = await this.db.query<{ id: string; lastMessageAt: Date }>(
      `SELECT c.id,c.contact_id AS "contactId",c.account_id AS "accountId",a.name AS "accountName",ct.display_name AS "contactName",c.mode,c.status,c.version,c.tags,c.assigned_to AS "assignedTo",c.last_preview AS preview,c.unread_count AS "unreadCount",c.last_message_at AS "lastMessageAt" FROM conversations c JOIN wa_accounts a ON a.id=c.account_id JOIN contacts ct ON ct.id=c.contact_id WHERE c.merged_into IS NULL AND a.organization_id=$1 AND ($2 OR a.id=ANY($3::uuid[])) AND ($4::uuid IS NULL OR a.id=$4) AND ($5::text IS NULL OR c.mode=$5) AND ($6::text IS NULL OR ct.display_name ILIKE '%'||$6||'%' OR c.last_preview ILIKE '%'||$6||'%') AND ($7::timestamptz IS NULL OR (c.last_message_at,c.id)<($7,$8::uuid)) ORDER BY c.last_message_at DESC,c.id DESC LIMIT $9`,
      [
        scope.organizationId,
        isAdmin(scope),
        scope.accountIds,
        input.accountId,
        input.mode,
        input.q,
        cursor?.at,
        cursor?.id,
        input.limit + 1,
      ],
    );
    const more = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        more && last
          ? Buffer.from(
              JSON.stringify({ at: last.lastMessageAt, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }
  async messages(
    scope: Scope,
    id: string,
    input: { limit: number; cursor?: string },
  ) {
    requireRole(scope, ["SUPERVISOR", "AGENT"]);
    await this.get(scope, id);
    const cursor = decodeCursor(input.cursor);
    const rows = await this.db.query<{ id: string; eventTime: Date }>(
      `SELECT id,direction,source,body,status,history,event_time AS "eventTime" FROM messages WHERE (conversation_id=$1 OR conversation_id IN(SELECT id FROM conversations WHERE merged_into=$1)) AND ($2::timestamptz IS NULL OR (event_time,id)<($2,$3::uuid)) ORDER BY event_time DESC,id DESC LIMIT $4`,
      [id, cursor?.at, cursor?.id, input.limit + 1],
    );
    const more = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    const pending = await this.db.query(
      `SELECT id,body,source,status,error_code AS "errorCode",created_at AS "eventTime" FROM outbound_intents WHERE conversation_id=$1 AND status IN ('QUEUED','SENDING','UNKNOWN_DELIVERY','FINAL_FAILURE','CANCELLED') ORDER BY created_at DESC LIMIT 30`,
      [id],
    );
    const drafts = await this.db.query(
      `SELECT id,reply,conversation_version AS version FROM agent_runs WHERE conversation_id=$1 AND status='DRAFT' ORDER BY started_at DESC LIMIT 3`,
      [id],
    );
    const activities = await this.db.query(
      'SELECT id,kind,body,created_at AS "createdAt" FROM conversation_activities WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 20',
      [id],
    );
    return {
      items,
      nextCursor:
        more && last
          ? Buffer.from(
              JSON.stringify({ at: last.eventTime, id: last.id }),
            ).toString("base64url")
          : null,
      pending,
      drafts,
      activities,
    };
  }
  async mode(
    scope: Scope,
    id: string,
    input: {
      mode: ConversationMode;
      expectedVersion: number;
      assignedTo?: string | null;
    },
  ) {
    requireRole(scope, ["SUPERVISOR", "AGENT"]);
    return this.db.transaction(async (tx) => {
      const row = await this.get(scope, id, tx, true);
      const entity = new Conversation(id, row.mode, row.version, row.status);
      entity.transition(input.mode, input.expectedVersion);
      if (input.assignedTo) {
        const [user] = await this.db.query(
          `SELECT u.id FROM users u WHERE id=$1 AND organization_id=$2 AND active AND (role IN ('SUPER_ADMIN','ORG_ADMIN') OR EXISTS(SELECT 1 FROM user_account_access x WHERE x.user_id=u.id AND x.account_id=$3))`,
          [input.assignedTo, scope.organizationId, row.account_id],
          tx,
        );
        ensure(user, "invalid_assignee");
      }
      await tx.query(
        "UPDATE conversations SET mode=$2,version=$3,assigned_to=$4 WHERE id=$1",
        [
          id,
          entity.currentMode,
          entity.currentVersion,
          input.assignedTo ?? (input.mode === "HUMAN" ? scope.userId : null),
        ],
      );
      await tx.query(
        "UPDATE outbound_intents SET status='CANCELLED',error_code='mode_changed',updated_at=now() WHERE conversation_id=$1 AND source='AI' AND status='QUEUED'",
        [id],
      );
      await tx.query(
        "INSERT INTO conversation_activities(conversation_id,actor_id,kind) VALUES($1,$2,$3)",
        [id, scope.userId, `mode.${input.mode}`],
      );
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "conversation.mode_changed",
        id,
      );
      await appendEvent(
        tx,
        scope.organizationId,
        row.account_id,
        "conversation.updated",
        id,
        { mode: input.mode },
      );
      return { mode: entity.currentMode, version: entity.currentVersion };
    });
  }
  async send(
    scope: Scope,
    id: string,
    input: { body: string; expectedVersion: number },
    operationId: string,
  ) {
    requireRole(scope, ["SUPERVISOR", "AGENT"]);
    ensure(
      operationId.length >= 8 && operationId.length <= 100,
      "idempotency_key_required",
    );
    return this.db.transaction(async (tx) => {
      const row = await this.get(scope, id, tx, true);
      const [existing] = await this.db.query<{
        id: string;
        body: string;
        conversation_id: string;
      }>(
        "SELECT id,body,conversation_id FROM outbound_intents WHERE account_id=$1 AND operation_id=$2",
        [row.account_id, operationId],
        tx,
      );
      if (existing) {
        ensure(
          existing.body === input.body && existing.conversation_id === id,
          "idempotency_conflict",
          409,
        );
        return { id: existing.id };
      }
      ensure(row.version === input.expectedVersion, "version_conflict", 409);
      ensure(
        row.mode === "HUMAN" || row.mode === "ASSIST",
        "human_mode_required",
        409,
      );
      ensure(row.status === "OPEN", "conversation_closed", 409);
      const [intent] = await this.db.query<{ id: string }>(
        `INSERT INTO outbound_intents(account_id,conversation_id,operation_id,expected_version,source,body) VALUES($1,$2,$3,$4,'HUMAN',$5) RETURNING id`,
        [row.account_id, id, operationId, row.version, input.body],
        tx,
      );
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "message.manual_queued",
        intent!.id,
      );
      return intent!;
    });
  }
  async updateDetails(
    scope: Scope,
    id: string,
    input: {
      tags?: string[];
      note?: string;
      close?: boolean;
      expectedVersion: number;
    },
  ) {
    requireRole(scope, ["SUPERVISOR", "AGENT"]);
    return this.db.transaction(async (tx) => {
      const c = await this.get(scope, id, tx, true);
      ensure(c.version === input.expectedVersion, "version_conflict", 409);
      await tx.query(
        `UPDATE conversations SET tags=coalesce($2,tags),status=CASE WHEN $3 THEN 'CLOSED' ELSE status END,closed_at=CASE WHEN $3 THEN now() ELSE closed_at END,resolved_by=CASE WHEN $3 THEN 'HUMAN' ELSE resolved_by END,version=version+1 WHERE id=$1`,
        [id, input.tags, input.close ?? false],
      );
      if (input.note)
        await tx.query(
          "INSERT INTO conversation_activities(conversation_id,actor_id,kind,body) VALUES($1,$2,'note',$3)",
          [id, scope.userId, input.note],
        );
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "conversation.updated",
        id,
      );
      return { version: c.version + 1 };
    });
  }
}
