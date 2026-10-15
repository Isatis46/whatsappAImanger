import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Database } from "../../packages/persistence/database.js";
export async function migrate(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtext('wa-schema-migration'))",
    );
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())",
    );
    for (const name of (await readdir("packages/persistence/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(
        `packages/persistence/migrations/${name}`,
        "utf8",
      );
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = await tx.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].checksum !== checksum)
          throw new Error(`migration_checksum_mismatch:${name}`);
        continue;
      }
      await tx.query(sql);
      await tx.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      console.log(`Applied ${name}`);
    }
  });
}
if (
  process.argv[1]?.endsWith("/migrate.ts") ||
  process.argv[1]?.endsWith("/migrate.js")
) {
  const db = new Database(process.env.DATABASE_URL ?? "");
  try {
    await migrate(db);
  } finally {
    await db.close();
  }
}
