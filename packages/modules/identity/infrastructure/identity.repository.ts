import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { Database, audit } from "../../../persistence/database.js";
import { ensure, type Scope } from "../../../core/errors.js";
import type { MfaRepository } from "./mfa.repository.js";
import { tokenHash } from "../../../security/cipher.js";
export class IdentityRepository {
  constructor(
    private readonly db: Database,
    private readonly mfa?: MfaRepository,
  ) {}
  async login(email: string, password: string, otp?: string) {
    const [user] = await this.db.query<{ id: string; password_hash: string }>(
      "SELECT id,password_hash FROM users WHERE lower(email)=lower($1) AND active=true",
      [email],
    );
    // A dummy Argon2 computation limits username timing differences.
    const valid = user
      ? await argon2.verify(user.password_hash, password)
      : (await argon2.hash(password), false);
    ensure(valid && user, "invalid_credentials", 401);
    if (await this.mfa?.enabled(user.id)) {
      ensure(otp, "mfa_required", 401);
      ensure(await this.mfa!.verify(user.id, otp), "mfa_invalid", 401);
    }
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(24).toString("base64url");
    await this.db.transaction(async (tx) => {
      await tx.query("DELETE FROM sessions WHERE expires_at<now()");
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
        [tokenHash(token), user.id, csrfToken],
      );
      const [row] = await this.db.query<{ organization_id: string }>(
        "SELECT organization_id FROM users WHERE id=$1",
        [user.id],
        tx,
      );
      await audit(tx, row!.organization_id, user.id, "auth.login", user.id);
    });
    return { token, csrfToken };
  }
  async authenticate(
    token: string,
  ): Promise<{
    scope: Scope;
    csrfToken: string;
    email: string;
    displayName: string;
  }> {
    const [user] = await this.db.query<{
      id: string;
      organization_id: string;
      role: string;
      email: string;
      display_name: string;
      csrf_token: string;
    }>(
      `SELECT u.*,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active`,
      [tokenHash(token)],
    );
    ensure(user, "unauthenticated", 401);
    const access = await this.db.query<{ account_id: string }>(
      "SELECT account_id FROM user_account_access WHERE user_id=$1",
      [user.id],
    );
    return {
      scope: {
        organizationId: user.organization_id,
        userId: user.id,
        role: user.role,
        accountIds: access.map((a) => a.account_id),
      },
      csrfToken: user.csrf_token,
      email: user.email,
      displayName: user.display_name,
    };
  }
  async logout(token: string): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE token_hash=$1", [
      tokenHash(token),
    ]);
  }
}
