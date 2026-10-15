import { ensure } from "../../../core/errors.js";
export type ConversationMode = "AI" | "HUMAN" | "ASSIST" | "PAUSED";
export class Conversation {
  constructor(
    readonly id: string,
    private mode: ConversationMode,
    private version: number,
    private status: "OPEN" | "CLOSED" = "OPEN",
  ) {}
  transition(mode: ConversationMode, expectedVersion: number): void {
    ensure(this.version === expectedVersion, "version_conflict", 409);
    ensure(this.status === "OPEN", "conversation_closed", 409);
    this.mode = mode;
    this.version++;
  }
  canAutoReply(expectedVersion: number): boolean {
    return (
      this.status === "OPEN" &&
      this.mode === "AI" &&
      this.version === expectedVersion
    );
  }
  get currentMode(): ConversationMode {
    return this.mode;
  }
  get currentVersion(): number {
    return this.version;
  }
}
