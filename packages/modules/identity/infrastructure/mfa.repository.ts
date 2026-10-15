import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { Database, audit } from "../../../persistence/database.js";
import { CredentialCipher, tokenHash } from "../../../security/cipher.js";
import { newTotpSecret, verifyTotp } from "../../../security/totp.js";
import { ensure, type Scope } from "../../../core/errors.js";
export class MfaRepository {
  constructor(
    private readonly db: Database,
    private readonly cipher: CredentialCipher,
  ) {}
  async enabled(userId: string): Promise<boolean> {
    const [row] = await this.db.query<{ enabled: boolean }>(
      "SELECT enabled FROM user_mfa WHERE user_id=$1",
      [userId],
    );
    return row?.enabled ?? false;
  }
  async setup(scope: Scope, password: string, email: string) {
    const [user] = await this.db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=$1",
      [scope.userId],
    );
    ensure(
      user && (await argon2.verify(user.password_hash, password)),
      "invalid_credentials",
      401,
    );
    ensure(!(await this.enabled(scope.userId)), "mfa_already_enabled", 409);
    const secret = newTotpSecret();
    await this.db.query(
      "INSERT INTO user_mfa(user_id,ciphertext) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext,last_step=-1,created_at=now() WHERE NOT user_mfa.enabled",
      [scope.userId, this.cipher.encrypt(secret, `mfa:${scope.userId}`)],
    );
    return {
      uri: `otpauth://totp/${encodeURIComponent("Hamsohbat:" + email)}?secret=${secret}&issuer=Hamsohbat&algorithm=SHA1&digits=6&period=30`,
    };
  }
  async confirm(scope: Scope, code: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await this.db.query<{
        ciphertext: string;
        enabled: boolean;
      }>(
        "SELECT * FROM user_mfa WHERE user_id=$1 AND created_at>now()-interval '10 minutes' FOR UPDATE",
        [scope.userId],
        tx,
      );
      ensure(row && !row.enabled, "mfa_setup_expired", 409);
      const step = verifyTotp(
        this.cipher.decrypt(row.ciphertext, `mfa:${scope.userId}`),
        code,
      );
      ensure(step !== null, "mfa_invalid", 401);
      const codes = Array.from({ length: 8 }, () =>
        randomBytes(8).toString("hex"),
      );
      await tx.query(
        "UPDATE user_mfa SET enabled=true,last_step=$2,recovery_hashes=$3 WHERE user_id=$1",
        [scope.userId, step, codes.map(tokenHash)],
      );
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [scope.userId]);
      await audit(
        tx,
        scope.organizationId,
        scope.userId,
        "mfa.enabled",
        scope.userId,
      );
      return { recoveryCodes: codes };
    });
  }
  async verify(userId: string, code: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await this.db.query<{
        ciphertext: string;
        last_step: string;
        recovery_hashes: string[];
      }>(
        "SELECT * FROM user_mfa WHERE user_id=$1 AND enabled FOR UPDATE",
        [userId],
        tx,
      );
      if (!row) return false;
      const hash = tokenHash(code);
      if (row.recovery_hashes.includes(hash)) {
        await tx.query(
          "UPDATE user_mfa SET recovery_hashes=array_remove(recovery_hashes,$2) WHERE user_id=$1",
          [userId, hash],
        );
        return true;
      }
      const step = verifyTotp(
        this.cipher.decrypt(row.ciphertext, `mfa:${userId}`),
        code,
        Number(row.last_step),
      );
      if (step === null) return false;
      await tx.query("UPDATE user_mfa SET last_step=$2 WHERE user_id=$1", [
        userId,
        step,
      ]);
      return true;
    });
  }
}
