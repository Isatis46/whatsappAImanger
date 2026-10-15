import { describe, it, expect } from "vitest";
import { Conversation } from "../../packages/modules/conversations/domain/conversation.entity.js";
import {
  ReplyEligibilityPolicy,
  type IncomingMessage,
} from "../../packages/modules/messaging/domain/reply-policy.js";
import { messageDedupe } from "../../packages/modules/messaging/infrastructure/messaging.repository.js";
import { CredentialCipher } from "../../packages/security/cipher.js";
import { csvCell } from "../../packages/modules/reporting/infrastructure/export.worker.js";
import { localMidnight } from "../../apps/admin-web/lib/api.js";
import { periodSchema } from "../../packages/contracts/index.js";
import {
  AgentOrchestrator,
  ProviderRegistry,
} from "../../packages/modules/agents/application/agent-orchestrator.js";
import type {
  AgentRunStore,
  RunContext,
} from "../../packages/modules/agents/domain/llm.port.js";
const incoming: IncomingMessage = {
  accountId: "a",
  externalId: "x",
  jid: "person@lid",
  participant: "",
  fromMe: false,
  body: "hello",
  timestamp: new Date(),
  history: false,
  displayName: "Person",
};
describe("Conversation and messaging invariants", () => {
  it("invalidates an in-flight response on human handoff", () => {
    const c = new Conversation("c", "AI", 4);
    expect(c.canAutoReply(4)).toBe(true);
    c.transition("HUMAN", 4);
    expect(c.canAutoReply(4)).toBe(false);
    expect(c.currentVersion).toBe(5);
    expect(() => c.transition("AI", 4)).toThrow("version_conflict");
  });
  it.each(["HUMAN", "ASSIST", "PAUSED"] as const)(
    "%s never auto sends",
    (mode) => {
      expect(new Conversation("c", mode, 1).canAutoReply(1)).toBe(false);
    },
  );
  it("closed conversations cannot switch modes or send", () => {
    const c = new Conversation("c", "AI", 1, "CLOSED");
    expect(c.canAutoReply(1)).toBe(false);
    expect(() => c.transition("HUMAN", 1)).toThrow("conversation_closed");
  });
  it("history, own messages, stale and future messages never trigger AI", () => {
    const p = new ReplyEligibilityPolicy();
    const now = new Date();
    expect(p.accepts(incoming, now)).toBe(true);
    for (const patch of [
      { history: true },
      { fromMe: true },
      { timestamp: new Date(+now - 360000) },
      { timestamp: new Date(+now + 120000) },
      { body: " " },
    ])
      expect(p.accepts({ ...incoming, ...patch }, now)).toBe(false);
  });
  it("dedupe includes every protocol identity component", () => {
    const key = messageDedupe(incoming);
    expect(messageDedupe({ ...incoming, body: "changed" })).toBe(key);
    for (const patch of [
      { accountId: "b" },
      { jid: "other@lid" },
      { fromMe: true },
      { participant: "p@lid" },
      { externalId: "y" },
    ])
      expect(messageDedupe({ ...incoming, ...patch })).not.toBe(key);
  });
});
describe("Encryption and export safety", () => {
  const cipher = new CredentialCipher("a".repeat(64));
  it("uses random nonces and binds ciphertext to the account and key", () => {
    const a = cipher.encrypt("secret", "account-a"),
      b = cipher.encrypt("secret", "account-a");
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a, "account-a")).toBe("secret");
    expect(() => cipher.decrypt(a, "account-b")).toThrow();
    expect(() => cipher.decrypt(a.slice(0, -3) + "AAA", "account-a")).toThrow();
  });
  it.each([
    '=HYPERLINK("https://example.com")',
    "+cmd",
    "@SUM(A1)",
    "-1",
    "\tformula",
  ])("neutralizes spreadsheet formula %s", (value) => {
    expect(csvCell(value).startsWith("\"'")).toBe(true);
  });
  it("quotes CSV separators and quotes", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
});
describe("Reporting dates", () => {
  it("converts Tehran midnight without assuming the browser timezone", () => {
    expect(localMidnight("2026-10-15", "Asia/Tehran")).toBe(
      "2026-10-14T20:30:00.000Z",
    );
  });
  it("handles London DST boundaries", () => {
    expect(localMidnight("2026-03-30", "Europe/London")).toBe(
      "2026-03-29T23:00:00.000Z",
    );
    expect(localMidnight("2026-10-26", "Europe/London")).toBe(
      "2026-10-26T00:00:00.000Z",
    );
  });
  it("rejects invalid timezone and inverted report periods", () => {
    expect(() =>
      periodSchema.parse({
        from: "2026-10-15T00:00:00Z",
        to: "2026-10-14T00:00:00Z",
        timezone: "UTC",
      }),
    ).toThrow();
    expect(() =>
      periodSchema.parse({
        from: "2026-10-14T00:00:00Z",
        to: "2026-10-15T00:00:00Z",
        timezone: "not/a-zone",
      }),
    ).toThrow();
  });
});
describe("Agent orchestration", () => {
  it("persists a sanitized provider failure and does not create a response", async () => {
    const ctx = {
      runId: "r",
      conversationId: "c",
      version: 1,
      provider: "openai",
      model: "m",
      prompt: "p",
      messages: [],
      maxOutputTokens: 10,
      inputPrice: null,
      outputPrice: null,
    } satisfies RunContext;
    const outcomes: string[] = [];
    const store: AgentRunStore = {
      claim: async () => ctx,
      complete: async () => {
        outcomes.push("complete");
      },
      fail: async (_ctx, code) => {
        outcomes.push(code);
      },
    };
    await new AgentOrchestrator(
      store,
      new ProviderRegistry([
        {
          key: "openai",
          generate: async () => {
            throw new Error("sensitive content");
          },
        },
      ]),
    ).run("c", 1);
    expect(outcomes).toEqual(["llm_failed"]);
  });
});

import { base32, totp, verifyTotp } from "../../packages/security/totp.js";
describe("RFC 6238 MFA", () => {
  it("matches the SHA1 test vector and rejects replay", () => {
    const secret = base32(Buffer.from("12345678901234567890"));
    expect(totp(secret, 1, 8)).toBe("94287082");
    const code = totp(secret, 1);
    expect(verifyTotp(secret, code, -1, 59000)).toBe(1);
    expect(verifyTotp(secret, code, 1, 59000)).toBeNull();
    expect(verifyTotp(secret, "000000", -1, 59000)).toBeNull();
  });
});
