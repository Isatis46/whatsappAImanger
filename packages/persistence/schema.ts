import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Tehran"),
  automationEnabled: boolean("automation_enabled").notNull().default(true),
});
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  target: text("target").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow(),
});

// SQL migrations are authoritative for composite foreign keys, partial indexes and checks.
// Drizzle models cover the operational tables used for typed CRUD; locking queries use SQL.
import { integer, jsonb, bigint, primaryKey } from "drizzle-orm/pg-core";
export const waAccounts = pgTable("wa_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  name: text("name").notNull(),
  displayPhone: text("display_phone"),
  timezone: text("timezone").notNull().default("Asia/Tehran"),
  status: text("status").notNull().default("CREATED"),
  enabled: boolean("enabled").notNull().default(false),
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  allowCloud: boolean("allow_cloud").notNull().default(false),
  agentId: uuid("agent_id"),
  version: integer("version").notNull().default(1),
  lastError: text("last_error"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  active: boolean("active").notNull().default(true),
});
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  remoteJid: text("remote_jid").notNull(),
  mode: text("mode").notNull().default("AI"),
  status: text("status").notNull().default("OPEN"),
  version: integer("version").notNull().default(1),
  assignedTo: uuid("assigned_to"),
  mergedInto: uuid("merged_into"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  externalId: text("external_id"),
  direction: text("direction").notNull(),
  source: text("source").notNull(),
  body: text("body").notNull(),
  history: boolean("history").notNull().default(false),
  eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("RECEIVED"),
});
export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  accountId: uuid("account_id"),
  eventType: text("event_type").notNull(),
  eventVersion: integer("event_version").notNull().default(1),
  aggregateId: uuid("aggregate_id").notNull(),
  payload: jsonb("payload").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});
export const inboxReceipts = pgTable(
  "inbox_receipts",
  {
    accountId: uuid("account_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.dedupeKey] })],
);
export const sessionLeases = pgTable("wa_session_leases", {
  accountId: uuid("account_id").primaryKey(),
  workerId: text("worker_id").notNull(),
  fencingToken: bigint("fencing_token", { mode: "number" })
    .notNull()
    .default(1),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
});
