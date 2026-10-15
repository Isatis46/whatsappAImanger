import argon2 from "argon2";
import { Database, audit } from "../../../persistence/database.js";
import {
  ensure,
  requireAccount,
  requireRole,
  type Scope,
} from "../../../core/errors.js";
import type { userSchema } from "../../../contracts/index.js";
import type { z } from "zod";
export class AdministrationRepository {
  constructor(private readonly db: Database) {}
  async users(scope: Scope) {
    requireRole(scope, []);
    return this.db.query(
      `SELECT u.id,u.email,u.display_name AS "displayName",u.role,u.active,coalesce(array_agg(x.account_id) FILTER(WHERE x.account_id IS NOT NULL),'{}') AS "accountIds" FROM users u LEFT JOIN user_account_access x ON x.user_id=u.id WHERE u.organization_id=$1 GROUP BY u.id ORDER BY u.created_at`,
      [scope.organizationId],
    );
  }
  async createUser(scope: Scope, input: z.infer<typeof userSchema>) {
    requireRole(scope, []);
    const hash = await argon2.hash(input.password, { type: argon2.argon2id });
    return this.db.transaction(async (tx) => {
      const [user] = await this.db.query<{ id: string }>(
        `INSERT INTO users(organization_id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [
          scope.organizationId,
          input.email,
          input.displayName,
          hash,
          input.role,
        ],
        tx,
      );
      for (const id of new Set(input.accountIds))
        await tx.query(
          "INSERT INTO user_account_access(user_id,account_id,organization_id) VALUES($1,$2,$3)",
          [user!.id, id, scope.organizationId],
        );
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "user.created",
        user!.id,
      );
      return user!;
    });
  }
  async updateUser(
    scope: Scope,
    id: string,
    input: { active?: boolean; accountIds?: string[] },
  ) {
    requireRole(scope, []);
    ensure(id !== scope.userId, "cannot_change_own_access");
    return this.db.transaction(async (tx) => {
      const [user] = await this.db.query(
        "SELECT id FROM users WHERE id=$1 AND organization_id=$2 AND role<>'SUPER_ADMIN' FOR UPDATE",
        [id, scope.organizationId],
        tx,
      );
      ensure(user, "user_not_found", 404);
      if (input.active !== undefined)
        await tx.query("UPDATE users SET active=$2 WHERE id=$1", [
          id,
          input.active,
        ]);
      if (input.accountIds) {
        await tx.query("DELETE FROM user_account_access WHERE user_id=$1", [
          id,
        ]);
        for (const account of new Set(input.accountIds))
          await tx.query(
            "INSERT INTO user_account_access(user_id,account_id,organization_id) VALUES($1,$2,$3)",
            [id, account, scope.organizationId],
          );
      }
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "user.access_changed",
        id,
      );
      return { updated: true };
    });
  }
  async auditLog(scope: Scope) {
    requireRole(scope, ["AUDITOR"]);
    return this.db.query(
      `SELECT l.id,l.action,l.target,l.occurred_at AS "occurredAt",u.display_name AS actor FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id WHERE l.organization_id=$1 ORDER BY l.occurred_at DESC LIMIT 100`,
      [scope.organizationId],
    );
  }
  async settings(scope: Scope) {
    requireRole(scope, []);
    const [org] = await this.db.query(
      `SELECT name,timezone,automation_enabled AS "automationEnabled",retention_days AS "retentionDays" FROM organizations WHERE id=$1`,
      [scope.organizationId],
    );
    return org;
  }
  async updateSettings(scope: Scope, enabled: boolean) {
    requireRole(scope, []);
    await this.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE organizations SET automation_enabled=$2 WHERE id=$1",
        [scope.organizationId, enabled],
      );
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "organization.automation_changed",
        scope.organizationId,
      );
    });
    return { automationEnabled: enabled };
  }
  async integrations(scope: Scope) {
    requireRole(scope, ["INTEGRATION_MANAGER"]);
    return {
      enabled: false,
      reason: "provider_not_configured",
      providers: [
        { key: "crm.custom-rest", enabled: false },
        { key: "sms.generic-http", enabled: false },
      ],
      items: await this.db.query(
        "SELECT id,name,kind,enabled FROM integration_instances WHERE organization_id=$1",
        [scope.organizationId],
      ),
    };
  }
  async knowledge(scope: Scope, accountId: string) {
    requireRole(scope, ["SUPERVISOR"]);
    await this.account(scope, accountId);
    return this.db.query(
      'SELECT id,title,body,created_at AS "createdAt" FROM knowledge_documents WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100',
      [accountId],
    );
  }
  async saveKnowledge(
    scope: Scope,
    accountId: string,
    title: string,
    body: string,
  ) {
    requireRole(scope, []);
    await this.account(scope, accountId);
    const [row] = await this.db.query(
      "INSERT INTO knowledge_documents(account_id,title,body) VALUES($1,$2,$3) RETURNING id",
      [accountId, title, body],
    );
    await audit(
      this.db.pool,
      scope.organizationId,
      scope.userId,
      "knowledge.created",
      String(row!.id),
    );
    return row;
  }
  async deleteKnowledge(scope: Scope, id: string) {
    requireRole(scope, []);
    await this.db.query(
      "DELETE FROM knowledge_documents k USING wa_accounts a WHERE k.account_id=a.id AND a.organization_id=$1 AND k.id=$2",
      [scope.organizationId, id],
    );
    await audit(
      this.db.pool,
      scope.organizationId,
      scope.userId,
      "knowledge.deleted",
      id,
    );
    return { deleted: true };
  }
  private async account(scope: Scope, id: string) {
    requireAccount(scope, id);
    const [row] = await this.db.query(
      "SELECT id FROM wa_accounts WHERE id=$1 AND organization_id=$2",
      [id, scope.organizationId],
    );
    ensure(row, "account_not_found", 404);
  }
}
