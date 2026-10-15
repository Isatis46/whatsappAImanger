import { drizzle } from "drizzle-orm/node-postgres";
import { waAccounts } from "../../../persistence/schema.js";
import { Database, audit } from "../../../persistence/database.js";
import {
  ensure,
  isAdmin,
  requireAccount,
  requireRole,
  type Scope,
} from "../../../core/errors.js";
import type { z } from "zod";
import type { accountPatchSchema } from "../../../contracts/index.js";
const fields = `id,name,status,timezone,display_phone AS "displayPhone",enabled,ai_enabled AS "aiEnabled",allow_cloud AS "allowCloud",agent_id AS "agentId",version,last_error AS "lastError",last_seen_at AS "lastSeenAt"`;
export class AccountsRepository {
  constructor(private readonly db: Database) {}
  async list(scope: Scope) {
    return this.db.query(
      `SELECT ${fields} FROM wa_accounts WHERE organization_id=$1 AND ($2 OR id=ANY($3::uuid[])) ORDER BY created_at`,
      [scope.organizationId, isAdmin(scope), scope.accountIds],
    );
  }
  async get(scope: Scope, id: string) {
    requireAccount(scope, id);
    const [row] = await this.db.query(
      `SELECT ${fields} FROM wa_accounts WHERE id=$1 AND organization_id=$2`,
      [id, scope.organizationId],
    );
    ensure(row, "account_not_found", 404);
    return row;
  }
  async create(scope: Scope, input: { name: string; timezone: string }) {
    requireRole(scope, []);
    return this.db.transaction(async (tx) => {
      const [row] = await drizzle(tx)
        .insert(waAccounts)
        .values({
          organizationId: scope.organizationId,
          name: input.name,
          timezone: input.timezone,
        })
        .returning({
          id: waAccounts.id,
          name: waAccounts.name,
          status: waAccounts.status,
          timezone: waAccounts.timezone,
          enabled: waAccounts.enabled,
          aiEnabled: waAccounts.aiEnabled,
          allowCloud: waAccounts.allowCloud,
          agentId: waAccounts.agentId,
          version: waAccounts.version,
          lastError: waAccounts.lastError,
          lastSeenAt: waAccounts.lastSeenAt,
        });
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "account.created",
        row!.id,
      );
      return row!;
    });
  }
  async patch(
    scope: Scope,
    id: string,
    input: z.infer<typeof accountPatchSchema>,
  ) {
    requireRole(scope, []);
    await this.get(scope, id);
    return this.db.transaction(async (tx) => {
      const [row] = await this.db.query(
        `UPDATE wa_accounts SET name=coalesce($3,name),timezone=coalesce($4,timezone),ai_enabled=coalesce($5,ai_enabled),allow_cloud=coalesce($6,allow_cloud),agent_id=CASE WHEN $7 THEN $8::uuid ELSE agent_id END,version=version+1 WHERE id=$1 AND organization_id=$2 AND version=$9 RETURNING ${fields}`,
        [
          id,
          scope.organizationId,
          input.name,
          input.timezone,
          input.aiEnabled,
          input.allowCloud,
          input.agentId !== undefined,
          input.agentId,
          input.expectedVersion,
        ],
        tx,
      );
      ensure(row, "version_conflict", 409);
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "account.updated",
        id,
      );
      return row;
    });
  }
  async connection(scope: Scope, id: string, enabled: boolean) {
    requireRole(scope, []);
    await this.get(scope, id);
    await this.db.transaction(async (tx) => {
      if (enabled) {
        const [current] = await this.db.query<{ status: string }>(
          "SELECT status FROM wa_accounts WHERE id=$1 FOR UPDATE",
          [id],
          tx,
        );
        if (current?.status === "LOGGED_OUT") {
          await tx.query(
            "DELETE FROM wa_auth_signal_keys WHERE account_id=$1",
            [id],
          );
          await tx.query(
            "DELETE FROM wa_auth_credentials WHERE account_id=$1",
            [id],
          );
        }
      }
      await tx.query(
        "UPDATE wa_accounts SET enabled=$2,version=version+1,last_error=NULL,status=CASE WHEN $2 THEN 'CONNECTING' ELSE 'DISCONNECTED' END,qr=NULL WHERE id=$1",
        [id, enabled],
      );
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        enabled ? "account.connect" : "account.disconnect",
        id,
      );
    });
    return { requested: true };
  }
  async qr(scope: Scope, id: string) {
    requireRole(scope, []);
    await this.get(scope, id);
    const [row] = await this.db.query<{
      qr: string | null;
      expiresAt: Date | null;
    }>(
      'SELECT CASE WHEN qr_expires_at>now() THEN qr END AS qr,qr_expires_at AS "expiresAt" FROM wa_accounts WHERE id=$1',
      [id],
    );
    await audit(
      this.db.pool,
      scope.organizationId,
      scope.userId,
      "account.qr_viewed",
      id,
    );
    return row!;
  }
}
