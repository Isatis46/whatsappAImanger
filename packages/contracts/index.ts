import { z } from "zod";
export const uuid = z.string().uuid();
export const timezone = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, "invalid_timezone");
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
  otp: z.string().max(16).optional(),
});
export const accountSchema = z.object({
  name: z.string().trim().min(1).max(100),
  timezone: timezone.default("Asia/Tehran"),
});
export const accountPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  timezone: timezone.optional(),
  aiEnabled: z.boolean().optional(),
  allowCloud: z.boolean().optional(),
  agentId: uuid.nullable().optional(),
  expectedVersion: z.number().int().positive(),
});
export const modeSchema = z.object({
  mode: z.enum(["AI", "HUMAN", "ASSIST", "PAUSED"]),
  expectedVersion: z.number().int().positive(),
  assignedTo: uuid.nullable().optional(),
});
export const sendSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  expectedVersion: z.number().int().positive(),
});
export const agentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(10).max(16000),
  provider: z.enum(["openai", "local"]).default("openai"),
  model: z.string().trim().min(1).max(100),
  maxOutputTokens: z.number().int().min(32).max(4096).default(650),
  debounceSeconds: z.number().int().min(0).max(30).default(4),
  inputPrice: z.number().nonnegative().nullable().default(null),
  outputPrice: z.number().nonnegative().nullable().default(null),
});
export const userSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(100),
  password: z.string().min(12).max(128),
  role: z.enum([
    "ORG_ADMIN",
    "SUPERVISOR",
    "AGENT",
    "ANALYST",
    "INTEGRATION_MANAGER",
    "AUDITOR",
  ]),
  accountIds: z.array(uuid).max(100).default([]),
});
export const periodSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    timezone: timezone.default("Asia/Tehran"),
  })
  .refine(
    (v) =>
      new Date(v.to) > new Date(v.from) &&
      +new Date(v.to) - +new Date(v.from) <= 366 * 86400000,
    "invalid_period_max_366_days",
  );
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
  cursor: z.string().max(200).optional(),
});
export type AgentInput = z.infer<typeof agentSchema>;
