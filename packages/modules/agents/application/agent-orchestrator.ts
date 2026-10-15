import type {
  AgentRunStore,
  LlmProviderPort,
  LlmRequest,
} from "../domain/llm.port.js";
export class ProviderRegistry {
  private readonly providers = new Map<string, LlmProviderPort>();
  constructor(providers: LlmProviderPort[]) {
    for (const provider of providers)
      this.providers.set(provider.key, provider);
  }
  get(key: string): LlmProviderPort {
    const provider = this.providers.get(key);
    if (!provider) throw new Error("provider_not_configured");
    return provider;
  }
  list(): string[] {
    return [...this.providers.keys()];
  }
}
export class AgentOrchestrator {
  constructor(
    private readonly store: AgentRunStore,
    private readonly providers: ProviderRegistry,
  ) {}
  async run(conversationId: string, version: number): Promise<void> {
    const ctx = await this.store.claim(conversationId, version);
    if (!ctx) return;
    const started = Date.now();
    try {
      const result = await this.providers
        .get(ctx.provider)
        .generate(
          {
            model: ctx.model,
            messages: [
              { role: "system", content: ctx.prompt },
              ...ctx.messages,
            ],
            maxOutputTokens: ctx.maxOutputTokens,
          },
          AbortSignal.timeout(60000),
        );
      if (!result.text.trim()) throw new Error("empty_model_response");
      await this.store.complete(ctx, result, Date.now() - started);
    } catch (error) {
      await this.store.fail(
        ctx,
        error instanceof Error &&
          [
            "provider_not_configured",
            "empty_model_response",
            "llm_rate_limit",
            "llm_unavailable",
            "llm_auth_failed",
          ].includes(error.message)
          ? error.message
          : "llm_failed",
      );
    }
  }
  async simulate(provider: string, request: LlmRequest) {
    return this.providers
      .get(provider)
      .generate(request, AbortSignal.timeout(60000));
  }
}
