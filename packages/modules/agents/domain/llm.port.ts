export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type LlmRequest = {
  model: string;
  messages: LlmMessage[];
  maxOutputTokens: number;
};
export type LlmResponse = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
};
export interface LlmProviderPort {
  readonly key: string;
  generate(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse>;
}
export interface AgentRunStore {
  claim(conversationId: string, version: number): Promise<RunContext | null>;
  complete(
    context: RunContext,
    result: LlmResponse,
    latencyMs: number,
  ): Promise<void>;
  fail(context: RunContext, code: string): Promise<void>;
}
export type RunContext = {
  runId: string;
  conversationId: string;
  version: number;
  provider: string;
  model: string;
  prompt: string;
  messages: LlmMessage[];
  maxOutputTokens: number;
  inputPrice: number | null;
  outputPrice: number | null;
};
