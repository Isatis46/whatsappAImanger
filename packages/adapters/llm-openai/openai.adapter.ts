import { z } from "zod";
import type {
  LlmProviderPort,
  LlmRequest,
  LlmResponse,
} from "../../modules/agents/domain/llm.port.js";
const responseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});
export class OpenAiAdapter implements LlmProviderPort {
  readonly key: string = "openai";
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "https://api.openai.com/v1/chat/completions",
  ) {}
  async generate(
    request: LlmRequest,
    signal?: AbortSignal,
  ): Promise<LlmResponse> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_completion_tokens: request.maxOutputTokens,
      }),
      signal: signal ?? AbortSignal.timeout(60000),
      redirect: "error",
    });
    if (!res.ok)
      throw new Error(
        res.status === 401
          ? "llm_auth_failed"
          : res.status === 429
            ? "llm_rate_limit"
            : "llm_unavailable",
      );
    const data = responseSchema.parse(await res.json());
    return {
      text: data.choices[0]!.message.content ?? "",
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
    };
  }
}
