import { createServer } from "node:http";
import { once } from "node:events";
import { describe, it, expect } from "vitest";
import { OpenAiAdapter } from "../../packages/adapters/llm-openai/openai.adapter.js";
import { LocalLlmAdapter } from "../../packages/adapters/llm-local/local.adapter.js";
import { normalizeMessage } from "../../packages/adapters/whatsapp-baileys/normalizer.js";
describe("OpenAI-compatible provider contract", () => {
  it("parses content and usage; local models share the interface", async () => {
    const received: { url?: string; auth?: string; body?: unknown }[] = [];
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      received.push({
        url: req.url,
        auth: req.headers.authorization,
        body: JSON.parse(body),
      });
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "سلام" } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no_port");
    try {
      const endpoint = `http://127.0.0.1:${address.port}`;
      const request = {
        model: "fixture",
        messages: [{ role: "user" as const, content: "hello" }],
        maxOutputTokens: 100,
      };
      for (const provider of [
        new OpenAiAdapter("test-only", endpoint + "/v1/chat/completions"),
        new LocalLlmAdapter(endpoint + "/v1"),
      ])
        expect(await provider.generate(request)).toEqual({
          text: "سلام",
          inputTokens: 12,
          outputTokens: 4,
        });
      expect(received[0]?.auth).toBe("Bearer test-only");
      expect(received[1]?.auth).toBeUndefined();
      expect(received[1]?.url).toBe("/v1/chat/completions");
    } finally {
      server.close();
    }
  });
  it("does not invent token usage when provider omits it", async () => {
    const server = createServer((_req, res) =>
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no_port");
    try {
      const result = await new OpenAiAdapter(
        "",
        `http://127.0.0.1:${address.port}`,
      ).generate({ model: "fixture", messages: [], maxOutputTokens: 30 });
      expect(result.inputTokens).toBeNull();
      expect(result.outputTokens).toBeNull();
    } finally {
      server.close();
    }
  });
});
describe("Baileys normalized text contract", () => {
  it("supports device JIDs and LIDs; records history explicitly", () => {
    const normalized = normalizeMessage(
      "a",
      {
        key: { id: "m1", remoteJid: "123:2@s.whatsapp.net", fromMe: false },
        message: { conversation: "سلام" },
        messageTimestamp: 1791972000,
      },
      true,
    );
    expect(normalized?.jid).toBe("123@s.whatsapp.net");
    expect(normalized?.history).toBe(true);
    expect(
      normalizeMessage(
        "a",
        {
          key: { id: "m2", remoteJid: "987@lid" },
          message: { extendedTextMessage: { text: "text" } },
          messageTimestamp: 1791972000,
        },
        false,
      )?.jid,
    ).toBe("987@lid");
  });
  it("ignores unsupported group, newsletter and non-text payloads", () => {
    for (const jid of ["123@g.us", "123@newsletter", "status@broadcast"])
      expect(
        normalizeMessage(
          "a",
          {
            key: { id: "m", remoteJid: jid },
            message: { conversation: "x" },
            messageTimestamp: 1,
          },
          false,
        ),
      ).toBeNull();
    expect(
      normalizeMessage(
        "a",
        {
          key: { id: "m", remoteJid: "1@s.whatsapp.net" },
          message: { imageMessage: {} },
          messageTimestamp: 1,
        },
        false,
      ),
    ).toBeNull();
  });
});
