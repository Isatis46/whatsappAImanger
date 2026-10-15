import argon2 from "argon2";
import { z } from "zod";
import { Database } from "../../packages/persistence/database.js";
const env = z
  .object({
    DATABASE_URL: z.string(),
    ADMIN_EMAIL: z.string().email(),
    ADMIN_PASSWORD: z.string().min(12),
    ORGANIZATION_NAME: z.string().default("سازمان من"),
  })
  .parse(process.env);
const db = new Database(env.DATABASE_URL);
try {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('wa-bootstrap'))");
    const existing = await tx.query("SELECT id FROM users LIMIT 1");
    if (existing.rowCount) {
      console.log("Administrator already exists; no credentials changed.");
      return;
    }
    const org = await tx.query<{ id: string }>(
      "INSERT INTO organizations(name) VALUES($1) RETURNING id",
      [env.ORGANIZATION_NAME],
    );
    await tx.query(
      "INSERT INTO users(organization_id,email,display_name,password_hash,role) VALUES($1,$2,'مدیر سیستم',$3,'ORG_ADMIN')",
      [
        org.rows[0]!.id,
        env.ADMIN_EMAIL,
        await argon2.hash(env.ADMIN_PASSWORD, { type: argon2.argon2id }),
      ],
    );
    console.log("Organization and administrator created.");
  });
} finally {
  await db.close();
}
