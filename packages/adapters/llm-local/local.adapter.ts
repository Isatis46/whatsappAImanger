import { OpenAiAdapter } from "../llm-openai/openai.adapter.js";
export class LocalLlmAdapter extends OpenAiAdapter {
  override readonly key = "local";
  constructor(baseUrl: string) {
    super("", `${baseUrl.replace(/\/$/, "")}/chat/completions`);
  }
}
