import { Queue } from "bullmq";
export function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    maxRetriesPerRequest: null,
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
  };
}
export function eventQueue(url: string, name = "wa-events") {
  return new Queue(name, {
    connection: redisConnection(url),
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: "exponential", delay: 1500 },
      removeOnComplete: { age: 86400, count: 10000 },
      removeOnFail: { age: 7 * 86400, count: 5000 },
    },
  });
}
