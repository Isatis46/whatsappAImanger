import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import argon2 from "argon2";
import { Database } from "../../packages/persistence/database.js";
import { migrate } from "../../infrastructure/scripts/migrate.js";
import { MessagingRepository } from "../../packages/modules/messaging/public-api.js";
import { CredentialCipher } from "../../packages/security/cipher.js";
import { AccountsRepository } from "../../packages/modules/accounts/public-api.js";
const base = new URL(process.env.DATABASE_URL!);
const maintenance = new pg.Pool({ connectionString: base.toString() });
const name = `wa_load_test_${process.pid}`;
await maintenance.query(`CREATE DATABASE ${name}`);
base.pathname = "/" + name;
const db = new Database(base.toString());
function percentile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    Math.round(
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]! * 100,
    ) / 100
  );
}
try {
  await migrate(db);
  const [org] = await db.query<{ id: string }>(
    "INSERT INTO organizations(name) VALUES($1) RETURNING id",
    ["Isolated load fixture"],
  );
  const [user] = await db.query<{ id: string }>(
    "INSERT INTO users(organization_id,email,display_name,password_hash,role) VALUES($1,$2,'Load fixture',$3,'ORG_ADMIN') RETURNING id",
    [org!.id, `${randomUUID()}@example.test`, await argon2.hash(randomUUID())],
  );
  const scope = {
    organizationId: org!.id,
    userId: user!.id,
    role: "ORG_ADMIN",
    accountIds: [],
  };
  const accounts = new AccountsRepository(db);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++)
    ids.push(
      (
        await accounts.create(scope, {
          name: `Fixture ${i + 1}`,
          timezone: "Asia/Tehran",
        })
      ).id,
    );
  const messages = new MessagingRepository(
    db,
    new CredentialCipher("e".repeat(64)),
  );
  const ingestion: number[] = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < 300) {
        const i = next++;
        const start = performance.now();
        await messages.receive({
          accountId: ids[i % 3]!,
          externalId: `fixture-${i}`,
          jid: `${10000 + (i % 30)}@lid`,
          participant: "",
          fromMe: false,
          body: "synthetic load fixture",
          timestamp: new Date(),
          history: false,
          displayName: "Fixture",
        });
        ingestion.push(performance.now() - start);
      }
    }),
  );
  const elapsed = performance.now() - started;
  const reads: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    const data = await accounts.list(scope);
    if (data.length !== 3) throw new Error("load_read_invariant");
    reads.push(performance.now() - start);
  }
  const [counts] = await db.query<{ messages: number; events: number }>(
    "SELECT (SELECT count(*)::int FROM messages) AS messages,(SELECT count(*)::int FROM outbox_events) AS events",
  );
  if (counts?.messages !== 300 || counts.events !== 300)
    throw new Error("load_durability_invariant");
  const result = {
    at: new Date().toISOString(),
    accounts: 3,
    messages: 300,
    concurrency: 6,
    elapsedMs: Math.round(elapsed),
    ingestionP50Ms: percentile(ingestion, 0.5),
    ingestionP95Ms: percentile(ingestion, 0.95),
    accountReadP95Ms: percentile(reads, 0.95),
    note: "Local synthetic database baseline; excludes network, WhatsApp and LLM latency.",
  };
  await mkdir(".local/validation", { recursive: true });
  await writeFile(
    ".local/validation/load.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.close();
  await maintenance.query(`DROP DATABASE ${name}`);
  await maintenance.end();
}
