import {
  normalizeMessageContent,
  jidNormalizedUser,
  isJidGroup,
  isJidBroadcast,
  isJidNewsletter,
  BufferJSON,
  type WAMessage,
} from "@whiskeysockets/baileys";
import type { IncomingMessage } from "../../modules/messaging/domain/reply-policy.js";
export function normalizeMessage(
  accountId: string,
  message: WAMessage,
  history: boolean,
): IncomingMessage | null {
  const jid = message.key.remoteJid;
  if (
    !jid ||
    !message.key.id ||
    isJidGroup(jid) ||
    isJidBroadcast(jid) ||
    isJidNewsletter(jid)
  )
    return null;
  const content = normalizeMessageContent(message.message);
  const body = content?.conversation ?? content?.extendedTextMessage?.text;
  if (!body) return null;
  const timestamp = Number(message.messageTimestamp) * 1000;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return {
    accountId,
    jid: jidNormalizedUser(jid),
    participant: message.key.participant
      ? jidNormalizedUser(message.key.participant)
      : "",
    externalId: message.key.id,
    fromMe: message.key.fromMe ?? false,
    body: body.slice(0, 10000),
    history,
    timestamp: new Date(timestamp),
    displayName: message.pushName ?? "",
    raw: JSON.stringify(message.message, BufferJSON.replacer),
  };
}
