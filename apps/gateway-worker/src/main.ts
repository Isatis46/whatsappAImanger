import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { readConfig } from "../../../packages/core/config.js";
import { Database } from "../../../packages/persistence/database.js";
import { CredentialCipher } from "../../../packages/security/cipher.js";
import { ContactsRepository } from "../../../packages/modules/contacts/public-api.js";
import { MessagingRepository } from "../../../packages/modules/messaging/public-api.js";
import { OutboundDispatcher } from "../../../packages/modules/messaging/public-api.js";
import { SessionLeaseService } from "../../../packages/adapters/whatsapp-baileys/lease.service.js";
import { WhatsAppSession } from "../../../packages/adapters/whatsapp-baileys/session.js";
import { logger } from "../../../packages/observability/logger.js";
const config = readConfig();
const db = new Database(config.DATABASE_URL);
const workerId = `gateway-${randomUUID()}`;
const cipher = new CredentialCipher(config.MASTER_KEY);
const messages = new MessagingRepository(db, cipher);
const leases = new SessionLeaseService(db, workerId);
const sessions = new Map<
  string,
  { session: WhatsAppSession; token: number; renewAt: number }
>();
const outbound = new OutboundDispatcher(db, {
  sendText: async (id, jid, body) =>
    sessions.get(id)?.session.send(jid, body) ?? {
      kind: "REJECTED",
      code: "no_session",
    },
});
let running = true;
process.on("SIGTERM", () => {
  running = false;
});
process.on("SIGINT", () => {
  running = false;
});
logger.info({ workerId }, "gateway_started");
try {
  while (running) {
    try {
      const accounts = await db.query<{ id: string }>(
        "SELECT id FROM wa_accounts WHERE enabled ORDER BY created_at LIMIT 100",
      );
      const enabled = new Set(accounts.map((a) => a.id));
      for (const [id, entry] of sessions)
        if (!enabled.has(id)) {
          await entry.session.drain();
          await leases.release(id, entry.token);
          sessions.delete(id);
        }
      const selected = [
        ...accounts.filter((a) => sessions.has(a.id)),
        ...accounts
          .filter((a) => !sessions.has(a.id))
          .slice(0, Math.max(0, 10 - sessions.size)),
      ];
      await Promise.all(
        selected.map(async (account) => {
          try {
            let entry = sessions.get(account.id);
            if (!entry && sessions.size < 10) {
              const token = await leases.acquire(account.id);
              if (token === null) return;
              entry = {
                session: new WhatsAppSession(
                  account.id,
                  token,
                  db,
                  cipher,
                  leases,
                  messages,
                  new ContactsRepository(db),
                ),
                token,
                renewAt: Date.now() + 10000,
              };
              sessions.set(account.id, entry);
            }
            if (!entry) return;
            if (entry.session.terminal) {
              await entry.session.drain();
              await leases.release(account.id, entry.token);
              sessions.delete(account.id);
              await db.query(
                "UPDATE wa_accounts SET enabled=false,status=CASE WHEN status='LOGGED_OUT' THEN status ELSE 'DEGRADED' END WHERE id=$1",
                [account.id],
              );
              return;
            }
            if (Date.now() >= entry.renewAt) {
              if (!(await leases.renew(account.id, entry.token))) {
                entry.session.stop();
                sessions.delete(account.id);
                return;
              }
              entry.renewAt = Date.now() + 10000;
            }
            await entry.session.start();
            if (entry.session.ready)
              await outbound.sendNext(account.id, workerId, entry.token);
          } catch {
            const entry = sessions.get(account.id);
            entry?.session.stop();
            sessions.delete(account.id);
            logger.error({ accountId: account.id }, "account_cycle_failed");
          }
        }),
      );
      await outbound.recoverUnknown();
      await db.query(
        `INSERT INTO worker_heartbeats(id,kind) VALUES($1,'gateway') ON CONFLICT(id) DO UPDATE SET seen_at=now()`,
        [workerId],
      );
    } catch {
      for (const entry of sessions.values()) entry.session.stop();
      sessions.clear();
      logger.error("gateway_cycle_failed");
    }
    await delay(1000);
  }
} finally {
  for (const [id, entry] of sessions) {
    await entry.session.drain();
    await leases.release(id, entry.token);
  }
  await db.close();
}
