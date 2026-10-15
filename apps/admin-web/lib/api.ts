let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  operationId?: string,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...(operationId ? { "Idempotency-Key": operationId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({ code: "network_error" }));
  if (!response.ok) throw new Error(data.code ?? "request_failed");
  return data as T;
}
export const errors: Record<string, string> = {
  mfa_enrollment_required:
    "ابتدا از بخش تنظیمات، ورود دومرحله‌ای را فعال کنید.",
  mfa_required: "کد برنامهٔ احراز هویت را وارد کنید.",
  mfa_invalid: "کد احراز هویت نادرست یا قبلاً استفاده شده است.",
  invalid_credentials: "ایمیل یا رمز عبور درست نیست.",
  unauthenticated: "لطفاً دوباره وارد شوید.",
  version_conflict:
    "اطلاعات تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.",
  invalid_input: "مقادیر واردشده را بررسی کنید.",
  provider_not_configured:
    "کلید یا نشانی ارائه‌دهنده هنوز در محیط سرور تنظیم نشده است.",
  human_mode_required:
    "برای پاسخ دستی، گفتگو را به حالت انسانی یا دستیار ببرید.",
  record_conflict: "رکورد تکراری یا ارجاع نامعتبر است.",
  csrf_invalid: "نشست را تازه کنید و دوباره تلاش کنید.",
  account_forbidden: "به این حساب دسترسی ندارید.",
  forbidden: "این عملیات برای نقش شما مجاز نیست.",
  conversation_closed: "گفتگو بسته شده است.",
  llm_auth_failed: "احراز هویت ارائه‌دهنده ناموفق بود.",
};
export function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : "request_failed";
  return errors[code] ?? `انجام درخواست ممکن نشد (${code}).`;
}
export interface User {
  userId: string;
  organizationId: string;
  role: string;
  displayName: string;
  email: string;
  csrfToken: string;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  accountIds: string[];
}
export interface Account {
  id: string;
  name: string;
  status: string;
  timezone: string;
  enabled: boolean;
  aiEnabled: boolean;
  allowCloud: boolean;
  agentId: string | null;
  version: number;
  lastError: string | null;
  lastSeenAt: string | null;
}
export interface Agent {
  id: string;
  name: string;
  version: number;
  prompt: string;
  provider: string;
  model: string;
  maxOutputTokens: number;
  debounceSeconds: number;
  inputPrice: string | null;
  outputPrice: string | null;
}
export interface Conversation {
  id: string;
  contactId: string;
  accountId: string;
  accountName: string;
  contactName: string;
  mode: string;
  status: string;
  version: number;
  preview: string;
  unreadCount: number;
  lastMessageAt: string;
  tags: string[];
  assignedTo: string | null;
}
export interface Message {
  id: string;
  direction: string;
  source: string;
  body: string;
  status: string;
  history: boolean;
  eventTime: string;
}
export interface MessagePage {
  activities: {
    id: string;
    kind: string;
    body: string | null;
    createdAt: string;
  }[];
  items: Message[];
  nextCursor: string | null;
  pending: (Message & { errorCode?: string })[];
  drafts: { id: string; reply: string; version: number }[];
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface Overview {
  accountId: string;
  period: { from: string; to: string; timezone: string };
  metrics: {
    inboundMessages: number;
    outboundMessages: number;
    activeConversations: number;
    historyMessages: number;
    dataAsOf: string | null;
  };
  ai: {
    runs: number;
    failures: number;
    cancelled: number;
    inputTokens: string | null;
    outputTokens: string | null;
    costMinor: string | null;
    latencyMs: number | null;
    currency: string;
  };
  conversations: { newConversations: number; handedOff: number };
  response: { sampleCount: number; p50Ms: number | null; p95Ms: number | null };
  delivery: {
    accepted: number;
    delivered: number;
    unknown: number;
    failed: number;
  };
}
export interface SystemHealth {
  workers: { kind: string; lastSeenAt: string; healthy: boolean }[];
  queues: Record<string, number>;
  outbound: { unknown: number; queued: number };
  openaiConfigured: boolean;
}
export function number(value: number | string | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
}
export function time(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}
export function date(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}
export function localMidnight(date: string, zone: string): string {
  const target = Date.parse(date + "T00:00:00Z");
  let result = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(result));
    const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
    const displayed = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    result += target - displayed;
  }
  return new Date(result).toISOString();
}
