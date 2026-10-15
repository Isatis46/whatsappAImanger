import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  MASTER_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  PORT: z.coerce.number().default(4000),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  OPENAI_API_KEY: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  LOCAL_LLM_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),
  LOCAL_LLM_MODEL: z.string().optional(),
  STORAGE_PATH: z.string().default(".local/exports"),
  LOG_LEVEL: z.string().default("info"),
});
export type Config = z.infer<typeof schema>;
export function readConfig(): Config {
  return schema.parse(process.env);
}
