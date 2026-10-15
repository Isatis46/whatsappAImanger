import { randomBytes } from "node:crypto";
import { Database, audit } from "../../../persistence/database.js";
import { ensure, requireRole, type Scope } from "../../../core/errors.js";
import { tokenHash } from "../../../security/cipher.js";
export class ApiTokensRepository {
  constructor(private readonly db: Database) {}
  async create(scope: Scope, name: string, accountIds: string[], days: number) {
    requireRole(scope, []);
    ensure(accountIds.length > 0, "account_scope_required");
    const token = "wa_" + randomBytes(32).toString("base64url");
    return this.db.transaction(async (tx) => {
      const accounts = await this.db.query<{ id: string }>(
        "SELECT id FROM wa_accounts WHERE organization_id=$1 AND id=ANY($2::uuid[])",
        [scope.organizationId, accountIds],
        tx,
      );
      ensure(
        accounts.length === new Set(accountIds).size,
        "account_forbidden",
        403,
      );
      const [row] = await this.db.query<{ id: string; expiresAt: Date }>(
        `INSERT INTO api_tokens(organization_id,user_id,name,token_hash,account_ids,expires_at) VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 day') RETURNING id,expires_at AS "expiresAt"`,
        [
          scope.organizationId,
          scope.userId,
          name,
          tokenHash(token),
          accountIds,
          days,
        ],
        tx,
      );
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "api_token.created",
        row!.id,
      );
      return { ...row, token, permissions: ["reports:read", "accounts:read"] };
    });
  }
  async list(scope: Scope) {
    requireRole(scope, []);
    return this.db.query(
      'SELECT id,name,account_ids AS "accountIds",expires_at AS "expiresAt",revoked_at AS "revokedAt" FROM api_tokens WHERE organization_id=$1 ORDER BY expires_at DESC',
      [scope.organizationId],
    );
  }
  async revoke(scope: Scope, id: string) {
    requireRole(scope, []);
    await this.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE api_tokens SET revoked_at=now() WHERE id=$1 AND organization_id=$2",
        [id, scope.organizationId],
      );
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "api_token.revoked",
        id,
      );
    });
    return { revoked: true };
  }
  async authenticate(token: string): Promise<Scope> {
    const [row] = await this.db.query<{
      organization_id: string;
      user_id: string;
      account_ids: string[];
      role: string;
    }>(
      `SELECT t.organization_id,t.user_id,t.account_ids,u.role FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>now() AND u.active`,
      [tokenHash(token)],
    );
    ensure(row, "unauthenticated", 401);
    let accounts = row.account_ids;
    if (!["ORG_ADMIN", "SUPER_ADMIN"].includes(row.role)) {
      const allowed = await this.db.query<{ account_id: string }>(
        "SELECT account_id FROM user_account_access WHERE user_id=$1",
        [row.user_id],
      );
      accounts = accounts.filter((id) =>
        allowed.some((a) => a.account_id === id),
      );
    }
    return {
      userId: row.user_id,
      organizationId: row.organization_id,
      role: "ANALYST",
      accountIds: accounts,
    };
  }
}
