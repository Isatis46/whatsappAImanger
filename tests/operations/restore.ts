import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { Database } from "../../packages/persistence/database.js";
import { CredentialCipher } from "../../packages/security/cipher.js";
import { MessagingRepository } from "../../packages/modules/messaging/public-api.js";
import { AccountsRepository } from "../../packages/modules/accounts/public-api.js";
import { migrate } from "../../infrastructure/scripts/migrate.js";

const run = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "wa-restore-drill-"));
const sourceName = `wa_backup_test_${process.pid}`;
const restoreName = `wa_restore_test_${process.pid}`;
const url = new URL(process.env.DATABASE_URL!);
const maintenance = new pg.Pool({ connectionString: url.toString() });
const names: string[] = [];
let source: Database | undefined;
let restored: Database | undefined;
const started = performance.now();
try {
  for (const name of [sourceName, restoreName]) {
    await maintenance.query(`CREATE DATABASE ${name}`);
    names.push(name);
  }
  url.pathname = "/" + sourceName;
  source = new Database(url.toString());
  await migrate(source);
  const [org] = await source.query<{ id: string }>(
    "INSERT INTO organizations(name) VALUES('Restore fixture') RETURNING id",
  );
  const [user] = await source.query<{ id: string }>(
    "INSERT INTO users(organization_id,email,display_name,password_hash,role) VALUES($1,$2,'Restore fixture','unusable-test-hash','ORG_ADMIN') RETURNING id",
    [org!.id, `${randomUUID()}@example.test`],
  );
  const scope = {
    organizationId: org!.id,
    userId: user!.id,
    role: "ORG_ADMIN",
    accountIds: [],
  };
  const account = await new AccountsRepository(source).create(scope, {
    name: "Restore account",
    timezone: "Asia/Tehran",
  });
  await source.query(
    "INSERT INTO user_account_access(user_id,account_id,organization_id) VALUES($1,$2,$3)",
    [user!.id, account.id, org!.id],
  );
  const cipher = new CredentialCipher(randomBytes(32).toString("hex"));
  const auth = JSON.stringify({ fixture: randomUUID() });
  await source.query(
    "INSERT INTO wa_auth_credentials(account_id,ciphertext) VALUES($1,$2)",
    [account.id, cipher.encrypt(auth, `auth:${account.id}`)],
  );
  await new MessagingRepository(source, cipher).receive({
    accountId: account.id,
    externalId: randomUUID(),
    jid: "restore@lid",
    participant: "",
    fromMe: false,
    body: "isolated recovery fixture",
    timestamp: new Date(),
    history: true,
    displayName: "Fixture",
  });
  const key = join(root, "key");
  await writeFile(key, randomBytes(48).toString("hex"), { mode: 0o600 });
  const compose = "infrastructure/compose/development.yaml";
  await run("bash", ["infrastructure/scripts/backup.sh"], {
    env: {
      ...process.env,
      BACKUP_PASSPHRASE_FILE: key,
      BACKUP_DIRECTORY: root,
      BACKUP_COMPOSE_FILE: compose,
      BACKUP_DATABASE: sourceName,
    },
  });
  const file = join(
    root,
    (await readdir(root)).find((name) => name.endsWith(".enc"))!,
  );
  await run("node", ["infrastructure/scripts/verify-backup.mjs", file, key]);
  await run("python3", ["infrastructure/scripts/verify-backup.py", file, key]);
  await run("bash", [
    "-c",
    'set -o pipefail; openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$1" -in "$2" | docker compose --env-file .env -f "$3" exec -T postgres pg_restore -U wa -d "$4" --exit-on-error',
    "restore-drill",
    key,
    file,
    compose,
    restoreName,
  ]);
  url.pathname = "/" + restoreName;
  restored = new Database(url.toString());
  await migrate(restored); // Validates the restored migration checksums.
  assert.equal(
    (await restored.query<{ body: string }>("SELECT body FROM messages"))[0]
      ?.body,
    "isolated recovery fixture",
  );
  const [credential] = await restored.query<{ ciphertext: string }>(
    "SELECT ciphertext FROM wa_auth_credentials WHERE account_id=$1",
    [account.id],
  );
  assert.equal(
    cipher.decrypt(credential!.ciphertext, `auth:${account.id}`),
    auth,
  );
  const analyst = { ...scope, role: "ANALYST", accountIds: [account.id] };
  assert.equal(
    (await new AccountsRepository(restored).list(analyst)).length,
    1,
  );
  assert.equal(
    (
      await new AccountsRepository(restored).list({
        ...analyst,
        accountIds: [],
      })
    ).length,
    0,
  );
  assert.equal(
    (await restored.query("SELECT * FROM user_account_access")).length,
    1,
  );
  const corrupted = join(root, "tampered.enc");
  const bytes = await readFile(file);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  await writeFile(corrupted, bytes);
  await writeFile(corrupted + ".hmac", await readFile(file + ".hmac"));
  await assert.rejects(
    run("node", ["infrastructure/scripts/verify-backup.mjs", corrupted, key]),
  );
  await assert.rejects(
    run("python3", ["infrastructure/scripts/verify-backup.py", corrupted, key]),
  );
  const result = {
    at: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - started),
    checks: [
      "encrypted backup",
      "authenticated restore",
      "migration checksums",
      "message contents",
      "auth decryption",
      "account access",
      "tamper rejection",
    ],
    note: "Isolated synthetic database; no live WhatsApp session started.",
  };
  await mkdir(".local/validation", { recursive: true });
  await writeFile(
    ".local/validation/restore.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await source?.close();
  await restored?.close();
  for (const name of names) await maintenance.query(`DROP DATABASE ${name}`);
  await maintenance.end();
  await rm(root, { recursive: true, force: true });
}
