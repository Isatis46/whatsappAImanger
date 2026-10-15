export type IncomingMessage = {
  accountId: string;
  externalId: string;
  jid: string;
  participant: string;
  fromMe: boolean;
  body: string;
  timestamp: Date;
  history: boolean;
  displayName: string;
  raw?: string;
};
export class ReplyEligibilityPolicy {
  accepts(input: IncomingMessage, now: Date): boolean {
    const age = now.getTime() - input.timestamp.getTime();
    return (
      !input.fromMe &&
      !input.history &&
      !!input.body.trim() &&
      age >= -60000 &&
      age <= 5 * 60 * 1000
    );
  }
}
export type SendOutcome =
  | { kind: "ACCEPTED"; externalMessageId: string }
  | { kind: "UNKNOWN"; reason: string }
  | { kind: "REJECTED"; code: string };
export interface ChannelGatewayPort {
  sendText(accountId: string, jid: string, body: string): Promise<SendOutcome>;
}
export interface MessageIngestionPort {
  receive(
    input: IncomingMessage,
  ): Promise<{
    duplicate: boolean;
    conversationId?: string;
    messageId?: string;
  }>;
  receipt(
    accountId: string,
    externalId: string,
    status: "DELIVERED" | "READ",
  ): Promise<void>;
}
