import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Worker } from "bullmq";
import argon2 from "argon2";
import pg from "pg";
import { Database } from "../../packages/persistence/database.js";
import { migrate } from "../../infrastructure/scripts/migrate.js";
import { CredentialCipher } from "../../packages/security/cipher.js";
import { MessagingRepository } from "../../packages/modules/messaging/infrastructure/messaging.repository.js";
import { ConversationsRepository } from "../../packages/modules/conversations/infrastructure/conversations.repository.js";
import { AccountsRepository } from "../../packages/modules/accounts/infrastructure/accounts.repository.js";
import { AgentsRepository } from "../../packages/modules/agents/infrastructure/agents.repository.js";
import { ReportingRepository } from "../../packages/modules/reporting/infrastructure/reporting.repository.js";
import { ExportWorker } from "../../packages/modules/reporting/infrastructure/export.worker.js";
import { OutboundDispatcher } from "../../packages/modules/messaging/infrastructure/outbound-dispatcher.js";
import { SessionLeaseService } from "../../packages/adapters/whatsapp-baileys/lease.service.js";
import { DatabaseAuthStateStore } from "../../packages/adapters/whatsapp-baileys/auth-state.store.js";
import { eventQueue, redisConnection } from "../../packages/queue/queue.js";
import type { IncomingMessage } from "../../packages/modules/messaging/domain/reply-policy.js";
import type { Scope } from "../../packages/core/errors.js";
// Exercise exactly the compiled server used by production, including Nest decorators.
// @ts-expect-error compiled server has no declaration output
import { createApp } from "../../dist/apps/api/src/app.js";
let db: Database;
let maintenance: pg.Pool;
let scope: Scope;
let accountId: string;
let messages: MessagingRepository;
let conversations: ConversationsRepository;
let agents: AgentsRepository;
let sqlUrl: string;
const cipher = new CredentialCipher("d".repeat(64));
const databaseName = `wa_test_${process.pid}`;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let services: Awaited<ReturnType<typeof createApp>>["services"];
const key = "d".repeat(64);
beforeAll(async () => {
  process.loadEnvFile(".env");
  const url = new URL(process.env.DATABASE_URL!);
  maintenance = new pg.Pool({ connectionString: url.toString() });
  await maintenance.query(`CREATE DATABASE ${databaseName}`);
  url.pathname = "/" + databaseName;
  sqlUrl = url.toString();
  db = new Database(sqlUrl);
  await migrate(db);
  await migrate(db);
  messages = new MessagingRepository(db, cipher);
  conversations = new ConversationsRepository(db);
  agents = new AgentsRepository(db);
  const result = await createApp({
    NODE_ENV: "test",
    DATABASE_URL: sqlUrl,
    REDIS_URL: process.env.REDIS_URL,
    MASTER_KEY: key,
    PORT: 4001,
    APP_ORIGIN: "http://localhost:3000",
    OPENAI_MODEL: "fixture",
    STORAGE_PATH: ".local/test-exports",
    LOG_LEVEL: "silent",
  });
  app = result.app;
  services = result.services;
}, 30000);
afterAll(async () => {
  await app?.close();
  await services?.close();
  await db?.close();
  await maintenance?.query(`DROP DATABASE ${databaseName}`);
  await maintenance?.end();
});
beforeEach(async () => {
  const [org] = await db.query<{ id: string }>(
    "INSERT INTO organizations(name) VALUES($1) RETURNING id",
    ["Test organization"],
  );
  const [user] = await db.query<{ id: string }>(
    "INSERT INTO users(organization_id,email,display_name,password_hash,role) VALUES($1,$2,'Tester',$3,'ORG_ADMIN') RETURNING id",
    [
      org!.id,
      `${randomUUID()}@example.test`,
      await argon2.hash("a-long-test-password"),
    ],
  );
  scope = {
    organizationId: org!.id,
    userId: user!.id,
    role: "ORG_ADMIN",
    accountIds: [],
  };
  const a = await new AccountsRepository(db).create(scope, {
    name: "Account A",
    timezone: "Asia/Tehran",
  });
  accountId = a.id;
  await db.query(
    "UPDATE wa_accounts SET enabled=true,ai_enabled=true,allow_cloud=true WHERE id=$1",
    [accountId],
  );
  const agent = await agents.save(scope, {
    name: "Test agent",
    prompt: "Reply helpfully and accurately.",
    provider: "openai",
    model: "fixture",
    maxOutputTokens: 100,
    debounceSeconds: 0,
    inputPrice: 1,
    outputPrice: 2,
  });
  await db.query("UPDATE wa_accounts SET agent_id=$2 WHERE id=$1", [
    accountId,
    agent.id,
  ]);
});
function incoming(patch: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    accountId,
    externalId: randomUUID(),
    jid: "123@s.whatsapp.net",
    participant: "",
    fromMe: false,
    body: "hello",
    timestamp: new Date(),
    history: false,
    displayName: "Customer",
    ...patch,
  };
}
async function conversation() {
  const received = await messages.receive(incoming());
  return conversations.get(scope, received.conversationId!);
}
describe("Durable message ingestion", () => {
  it("deduplicates simultaneous deliveries atomically", async () => {
    const msg = incoming();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => messages.receive(msg)),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    const rows = await db.query("SELECT id FROM messages WHERE account_id=$1", [
      accountId,
    ]);
    expect(rows).toHaveLength(1);
    const events = await db.query(
      "SELECT id FROM outbox_events WHERE account_id=$1",
      [accountId],
    );
    expect(events).toHaveLength(1);
  });
  it("records history and own messages without triggering AI", async () => {
    for (const msg of [
      incoming({ history: true }),
      incoming({ fromMe: true }),
      incoming({ timestamp: new Date(Date.now() - 360000) }),
    ])
      await messages.receive(msg);
    const rows = await db.query<{ payload: { eligible: boolean } }>(
      "SELECT payload FROM outbox_events WHERE account_id=$1",
      [accountId],
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.payload.eligible)).toBe(true);
  });
  it("hands customer requests to an operator and respects STOP", async () => {
    const received = await messages.receive(
      incoming({ body: "لطفاً اپراتور پاسخ بدهد" }),
    );
    expect(
      (await conversations.get(scope, received.conversationId!)).mode,
    ).toBe("HUMAN");
    await messages.receive(incoming({ body: "STOP" }));
    expect(
      (await conversations.get(scope, received.conversationId!)).mode,
    ).toBe("PAUSED");
  });
  it("rolls back inbox receipt if durable message storage fails", async () => {
    const msg = incoming({ body: null as unknown as string });
    await expect(messages.receive(msg)).rejects.toThrow();
    expect(
      await db.query("SELECT * FROM inbox_receipts WHERE account_id=$1", [
        accountId,
      ]),
    ).toHaveLength(0);
  });
});
describe("AI / human concurrency and outbound recovery", () => {
  it("discards a model result completed after human handoff", async () => {
    const c = await conversation();
    const ctx = await agents.claim(c.id, c.version);
    expect(ctx).not.toBeNull();
    await conversations.mode(scope, c.id, {
      mode: "HUMAN",
      expectedVersion: c.version,
    });
    await agents.complete(
      ctx!,
      { text: "stale reply", inputTokens: 10, outputTokens: 2 },
      30,
    );
    expect(
      (
        await db.query("SELECT status FROM agent_runs WHERE id=$1", [
          ctx!.runId,
        ])
      )[0]?.status,
    ).toBe("STALE");
    expect(
      await db.query(
        "SELECT id FROM outbound_intents WHERE conversation_id=$1",
        [c.id],
      ),
    ).toHaveLength(0);
  });
  it("claims a single AI run on simultaneous job replay", async () => {
    const c = await conversation();
    const results = await Promise.allSettled([
      agents.claim(c.id, c.version),
      agents.claim(c.id, c.version),
    ]);
    expect(
      results.filter((r) => r.status === "fulfilled" && r.value),
    ).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("ASSIST stores a draft and never enqueues an automatic send", async () => {
    const c = await conversation();
    await conversations.mode(scope, c.id, {
      mode: "ASSIST",
      expectedVersion: c.version,
    });
    const ctx = await agents.claim(c.id, c.version + 1);
    await agents.complete(
      ctx!,
      { text: "draft", inputTokens: null, outputTokens: null },
      40,
    );
    expect(
      (
        await db.query("SELECT status,cost_minor FROM agent_runs WHERE id=$1", [
          ctx!.runId,
        ])
      )[0],
    ).toMatchObject({ status: "DRAFT", cost_minor: null });
    expect(
      await db.query(
        "SELECT id FROM outbound_intents WHERE conversation_id=$1",
        [c.id],
      ),
    ).toHaveLength(0);
  });
  it("sends an intent once even when dispatcher is replayed", async () => {
    const c = await conversation();
    const ctx = await agents.claim(c.id, c.version);
    await agents.complete(
      ctx!,
      { text: "reply", inputTokens: 10, outputTokens: 3 },
      50,
    );
    const lease = new SessionLeaseService(db, "worker-a");
    const token = await lease.acquire(accountId);
    let sends = 0;
    const dispatch = new OutboundDispatcher(db, {
      sendText: async () => {
        sends++;
        return {
          kind: "ACCEPTED",
          externalMessageId: "test-ext-" + randomUUID(),
        };
      },
    });
    expect(await dispatch.sendNext(accountId, "worker-a", token!)).toBe(true);
    expect(await dispatch.sendNext(accountId, "worker-a", token!)).toBe(false);
    expect(sends).toBe(1);
    expect(
      (
        await db.query(
          "SELECT status FROM outbound_intents WHERE conversation_id=$1",
          [c.id],
        )
      )[0]?.status,
    ).toBe("ACCEPTED");
  });
  it("rechecks human mode at send time and cancels queued AI", async () => {
    const c = await conversation();
    const ctx = await agents.claim(c.id, c.version);
    await agents.complete(
      ctx!,
      { text: "reply", inputTokens: 10, outputTokens: 3 },
      50,
    );
    await conversations.mode(scope, c.id, {
      mode: "HUMAN",
      expectedVersion: c.version,
    });
    let sends = 0;
    const lease = new SessionLeaseService(db, "worker-a");
    const token = await lease.acquire(accountId);
    await new OutboundDispatcher(db, {
      sendText: async () => {
        sends++;
        return { kind: "UNKNOWN", reason: "bad" };
      },
    }).sendNext(accountId, "worker-a", token!);
    expect(sends).toBe(0);
  });
  it("never retries unknown delivery and recovers stale SENDING as unknown", async () => {
    const c = await conversation();
    await conversations.mode(scope, c.id, {
      mode: "HUMAN",
      expectedVersion: c.version,
    });
    await conversations.send(
      scope,
      c.id,
      { body: "reply", expectedVersion: c.version + 1 },
      randomUUID(),
    );
    let sends = 0;
    const lease = new SessionLeaseService(db, "worker-a");
    const token = await lease.acquire(accountId);
    const dispatch = new OutboundDispatcher(db, {
      sendText: async () => {
        sends++;
        return { kind: "UNKNOWN", reason: "network" };
      },
    });
    await dispatch.sendNext(accountId, "worker-a", token!);
    await dispatch.sendNext(accountId, "worker-a", token!);
    expect(sends).toBe(1);
    await db.query(
      "UPDATE outbound_intents SET status='SENDING',updated_at=now()-interval '3 minutes' WHERE conversation_id=$1",
      [c.id],
    );
    await dispatch.recoverUnknown();
    expect(
      (
        await db.query(
          "SELECT status FROM outbound_intents WHERE conversation_id=$1",
          [c.id],
        )
      )[0]?.status,
    ).toBe("UNKNOWN_DELIVERY");
  });
  it("idempotency conflicts do not overwrite an already queued human message", async () => {
    const c = await conversation();
    await conversations.mode(scope, c.id, {
      mode: "HUMAN",
      expectedVersion: c.version,
    });
    const operation = randomUUID();
    const first = await conversations.send(
      scope,
      c.id,
      { body: "one", expectedVersion: c.version + 1 },
      operation,
    );
    expect(
      await conversations.send(
        scope,
        c.id,
        { body: "one", expectedVersion: c.version + 1 },
        operation,
      ),
    ).toEqual(first);
    await expect(
      conversations.send(
        scope,
        c.id,
        { body: "two", expectedVersion: c.version + 1 },
        operation,
      ),
    ).rejects.toThrow("idempotency_conflict");
  });
});
describe("Account isolation and lease fencing", () => {
  it("allows one lease owner and rejects stale credential writes", async () => {
    const a = new SessionLeaseService(db, "a"),
      b = new SessionLeaseService(db, "b");
    const token = await a.acquire(accountId);
    expect(await b.acquire(accountId)).toBeNull();
    const store = await new DatabaseAuthStateStore(db, cipher, a).load(
      accountId,
      token!,
    );
    await db.query(
      "UPDATE wa_session_leases SET lease_until=now()-interval '1 second' WHERE account_id=$1",
      [accountId],
    );
    const newToken = await b.acquire(accountId);
    expect(newToken).toBeGreaterThan(token!);
    expect(await a.renew(accountId, token!)).toBe(false);
    await expect(store.save()).rejects.toThrow("lease_lost");
  });
  it("persists Signal buffers across auth store restart, encrypted at rest", async () => {
    const lease = new SessionLeaseService(db, "a");
    const token = await lease.acquire(accountId);
    const first = await new DatabaseAuthStateStore(db, cipher, lease).load(
      accountId,
      token!,
    );
    const data = {
      private: Buffer.from("private-test"),
      public: Buffer.from("public-test"),
    };
    await first.state.keys.set({ "pre-key": { k: data } });
    const second = await new DatabaseAuthStateStore(db, cipher, lease).load(
      accountId,
      token!,
    );
    const loaded = await second.state.keys.get("pre-key", ["k"]);
    expect(loaded.k?.private.equals(data.private)).toBe(true);
    const [row] = await db.query(
      "SELECT ciphertext FROM wa_auth_signal_keys WHERE account_id=$1",
      [accountId],
    );
    expect(row?.ciphertext).not.toContain("private-test");
  });
  it("rejects cross-account inbox, reports and assignees", async () => {
    const c = await conversation();
    const restricted: Scope = { ...scope, role: "AGENT", accountIds: [] };
    await expect(
      conversations.messages(restricted, c.id, { limit: 10 }),
    ).rejects.toThrow("account_forbidden");
    await expect(
      new ReportingRepository(db).overview(
        { ...restricted, role: "ANALYST" },
        accountId,
        {
          from: "2026-01-01T00:00:00Z",
          to: "2027-01-01T00:00:00Z",
          timezone: "UTC",
        },
      ),
    ).rejects.toThrow("account_forbidden");
    expect(
      (await conversations.list(restricted, { limit: 40 })).items,
    ).toHaveLength(0);
    await expect(
      conversations.mode(scope, c.id, {
        mode: "HUMAN",
        expectedVersion: c.version,
        assignedTo: randomUUID(),
      }),
    ).rejects.toThrow("invalid_assignee");
  });
});
describe("Reporting and export", () => {
  it("uses half-open periods and account timezone; exports a real CSV", async () => {
    const r = await messages.receive(
      incoming({ timestamp: new Date("2026-10-14T21:00:00Z"), history: false }),
    );
    await db.query(
      `INSERT INTO fact_messages(message_id,organization_id,account_id,conversation_id,direction,source,history,event_time) SELECT m.id,a.organization_id,m.account_id,m.conversation_id,m.direction,m.source,m.history,m.event_time FROM messages m JOIN wa_accounts a ON a.id=m.account_id WHERE m.id=$1`,
      [r.messageId],
    );
    const report = new ReportingRepository(db);
    const period = {
      from: "2026-10-14T20:30:00Z",
      to: "2026-10-15T20:30:00Z",
      timezone: "Asia/Tehran",
    };
    expect(await report.timeline(scope, accountId, period)).toEqual([
      { day: "2026-10-15", inbound: 1, outbound: 0 },
    ]);
    expect(
      await report.timeline(scope, accountId, {
        ...period,
        to: "2026-10-14T21:00:00Z",
      }),
    ).toEqual([]);
    const exported = await report.requestExport(
      scope,
      accountId,
      period,
      "csv",
    );
    await new ExportWorker(db, ".local/test-exports").next();
    const file = await report.exportFile(scope, exported.id);
    expect(
      await readFile(".local/test-exports/" + file.storage_key, "utf8"),
    ).toContain('"2026-10-15","1","0"');
  });
});
describe("HTTP security and functional workflow", () => {
  it("requires authentication, enforces CSRF and validates DTOs", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/accounts" })).statusCode,
    ).toBe(401);
    const [u] = await db.query<{ email: string }>(
      "SELECT email FROM users WHERE id=$1",
      [scope.userId],
    );
    const logged = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: u!.email, password: "a-long-test-password" },
    });
    expect(logged.statusCode).toBe(201);
    const cookie = logged.headers["set-cookie"].split(";")[0];
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    const csrf = me.json().csrfToken;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/accounts",
          headers: { cookie },
          payload: { name: "new" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/accounts",
          headers: { cookie, "x-csrf-token": csrf },
          payload: { name: "" },
        })
      ).statusCode,
    ).toBe(400);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      headers: { cookie, "x-csrf-token": csrf },
      payload: { name: "HTTP Account", timezone: "Asia/Tehran" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().name).toBe("HTTP Account");
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/accounts",
      headers: { cookie },
    });
    expect(list.json()).toHaveLength(2);
    expect(JSON.stringify(list.json())).not.toContain("ciphertext");
    const health = await app.inject({
      method: "GET",
      url: "/api/v1/health/ready",
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().redis).toBe(true);
  });
});
describe("Real Redis queue", () => {
  it("delivers and retries a job with stable identity", async () => {
    const url = process.env.REDIS_URL!;
    const queueName = `wa-test-${process.pid}`;
    const queue = eventQueue(url, queueName);
    const jobId = randomUUID();
    let attempts = 0;
    const worker = new Worker(
      queueName,
      async (job) => {
        if (job.id !== jobId) return;
        attempts++;
        if (attempts === 1) throw new Error("transient_test_failure");
      },
      { connection: redisConnection(url), concurrency: 1 },
    );
    const done = new Promise<void>((resolve, reject) => {
      worker.on("completed", (job) => {
        if (job.id === jobId) resolve();
      });
      worker.on("error", reject);
    });
    try {
      await worker.waitUntilReady();
      await queue.add(
        "test",
        { eventId: jobId },
        { jobId, attempts: 2, backoff: { type: "fixed", delay: 20 } },
      );
      await done;
      expect(attempts).toBe(2);
    } finally {
      await worker.close();
      await queue.close();
    }
  });
});

import { EventRelay } from "../../packages/queue/event-relay.js";
import { MfaRepository } from "../../packages/modules/identity/infrastructure/mfa.repository.js";
import { ApiTokensRepository } from "../../packages/modules/identity/infrastructure/api-tokens.repository.js";
import { totp } from "../../packages/security/totp.js";
describe("Recovery and second-factor controls", () => {
  it("replays interrupted AI computation without creating a second send intent", async () => {
    const c = await conversation();
    const ctx = await agents.claim(c.id, c.version);
    await db.query(
      "UPDATE agent_runs SET started_at=now()-interval '5 minutes' WHERE id=$1",
      [ctx!.runId],
    );
    const resumed = await agents.claim(c.id, c.version);
    expect(resumed!.runId).toBe(ctx!.runId);
    await agents.complete(
      resumed!,
      { text: "recovered", inputTokens: 10, outputTokens: 2 },
      50,
    );
    expect(
      await db.query(
        "SELECT id FROM outbound_intents WHERE conversation_id=$1",
        [c.id],
      ),
    ).toHaveLength(1);
  });
  it("keeps an unpublished event on queue failure and recovers after Redis loss", async () => {
    await conversation();
    await db.query(
      "INSERT INTO consumer_inbox(consumer_name,event_id) SELECT 'ai',id FROM outbox_events WHERE account_id<>$1 ON CONFLICT DO NOTHING",
      [accountId],
    );
    await db.query(
      "UPDATE outbox_events SET published_at=now() WHERE account_id<>$1",
      [accountId],
    );
    await expect(
      new EventRelay(db, {
        getJob: async () => undefined,
        add: async () => {
          throw new Error("redis_down");
        },
      }).publishBatch(),
    ).rejects.toThrow("redis_down");
    expect(
      (
        await db.query(
          "SELECT published_at FROM outbox_events WHERE account_id=$1",
          [accountId],
        )
      )[0]?.published_at,
    ).toBeNull();
    let added = 0;
    const relay = new EventRelay(db, {
      getJob: async () => undefined,
      add: async () => {
        added++;
      },
    });
    await relay.publishBatch();
    expect(added).toBe(1);
    await db.query(
      "UPDATE outbox_events SET published_at=now()-interval '6 minutes' WHERE account_id=$1",
      [accountId],
    );
    await relay.publishBatch();
    expect(added).toBe(2);
  });
  it("enrolls MFA, rejects a reused TOTP, and consumes recovery codes once", async () => {
    const mfa = new MfaRepository(db, cipher);
    const setup = await mfa.setup(
      scope,
      "a-long-test-password",
      "user@example.test",
    );
    const secret = new URL(setup.uri).searchParams.get("secret")!;
    const code = totp(secret, Math.floor(Date.now() / 30000));
    const result = await mfa.confirm(scope, code);
    expect(await mfa.enabled(scope.userId)).toBe(true);
    expect(await mfa.verify(scope.userId, code)).toBe(false);
    expect(await mfa.verify(scope.userId, result.recoveryCodes[0]!)).toBe(true);
    expect(await mfa.verify(scope.userId, result.recoveryCodes[0]!)).toBe(
      false,
    );
  });
  it("limits API tokens to selected accounts and rejects revoked tokens", async () => {
    const repository = new ApiTokensRepository(db);
    const created = await repository.create(scope, "Reports", [accountId], 7);
    const tokenScope = await repository.authenticate(created.token);
    expect(tokenScope.role).toBe("ANALYST");
    expect(tokenScope.accountIds).toEqual([accountId]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/accounts",
      headers: { authorization: "Bearer " + created.token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/users",
          headers: { authorization: "Bearer " + created.token },
        })
      ).statusCode,
    ).toBe(403);
    await repository.revoke(scope, created.id!);
    await expect(repository.authenticate(created.token)).rejects.toThrow(
      "unauthenticated",
    );
  });
  it("creates an XLSX file readable by a spreadsheet parser", async () => {
    const repository = new ReportingRepository(db);
    const job = await repository.requestExport(
      scope,
      accountId,
      {
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-31T00:00:00Z",
        timezone: "Asia/Tehran",
      },
      "xlsx",
    );
    await new ExportWorker(db, ".local/test-exports").next();
    const file = await repository.exportFile(scope, job.id);
    const Excel = (await import("exceljs")).default;
    const book = new Excel.Workbook();
    await book.xlsx.readFile(".local/test-exports/" + file.storage_key);
    expect(book.worksheets[0]!.getRow(1).getCell(1).value).toBe("day");
  });
});
import { ContactsRepository } from "../../packages/modules/contacts/infrastructure/contacts.repository.js";
describe("PN/LID identity and privacy", () => {
  it("links two identifiers into one inbox thread while retaining both message timelines", async () => {
    const pn = await messages.receive(
      incoming({ jid: "123@s.whatsapp.net", body: "from PN" }),
    );
    await messages.receive(incoming({ jid: "999@lid", body: "from LID" }));
    await new ContactsRepository(db).mapIdentity(
      accountId,
      "999@lid",
      "123@s.whatsapp.net",
    );
    const list = await conversations.list(scope, { limit: 10 });
    expect(list.items).toHaveLength(1);
    const page = await conversations.messages(scope, pn.conversationId!, {
      limit: 10,
    });
    expect(page.items).toHaveLength(2);
    const next = await messages.receive(
      incoming({ jid: "999@lid", body: "next LID" }),
    );
    expect(next.conversationId).toBe(pn.conversationId);
  });
  it("anonymizes the merged history and prevents queued replies", async () => {
    const pn = await messages.receive(
      incoming({ jid: "123@s.whatsapp.net", body: "private one" }),
    );
    await messages.receive(incoming({ jid: "999@lid", body: "private two" }));
    const contacts = new ContactsRepository(db);
    await contacts.mapIdentity(accountId, "999@lid", "123@s.whatsapp.net");
    const c = await conversations.get(scope, pn.conversationId!);
    await contacts.anonymize(scope, c.contact_id);
    const page = await conversations.messages(scope, c.id, { limit: 10 });
    expect(page.items.every((m) => m.body === "[حذف‌شده]")).toBe(true);
    expect((await conversations.get(scope, c.id)).mode).toBe("PAUSED");
    expect(
      await db.query("SELECT * FROM contact_identifiers WHERE account_id=$1", [
        accountId,
      ]),
    ).toHaveLength(0);
  });
});
