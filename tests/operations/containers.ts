import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

const execute = promisify(execFile);
const docker = async (...args: string[]) =>
  (await execute("docker", args)).stdout.trim();
const root = await mkdtemp(join(tmpdir(), "wa-container-test-"));
const name = `wa_container_test_${process.pid}`;
const prefix = `wa-smoke-${process.pid}`;
const network = "whatsapp-ai-dev_default";
const base = new URL(process.env.DATABASE_URL!);
const maintenance = new pg.Pool({ connectionString: base.toString() });
const containers: string[] = [];
let db: pg.Pool | undefined;
let created = false;
const started = performance.now();
async function start(suffix: string, args: string[]) {
  const container = `${prefix}-${suffix}`;
  await docker(
    "run",
    "-d",
    "--name",
    container,
    "--network",
    network,
    "--init",
    ...args,
  );
  containers.push(container);
  return container;
}
async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      /* bounded startup retry */
    }
    await delay(250);
  }
  throw new Error("container_readiness_timeout");
}
try {
  await maintenance.query(`CREATE DATABASE ${name}`);
  created = true;
  base.pathname = "/" + name;
  db = new pg.Pool({ connectionString: base.toString() });
  const internal = new URL(base);
  internal.hostname = "postgres";
  const redis = await start("redis", ["redis:7.4.7-alpine"]);
  const email = `${randomUUID()}@example.test`,
    password = randomUUID();
  const env = join(root, "runtime.env");
  await writeFile(
    env,
    Object.entries({
      NODE_ENV: "production",
      DATABASE_URL: internal.toString(),
      REDIS_URL: `redis://${redis}:6379`,
      MASTER_KEY: randomBytes(32).toString("hex"),
      APP_ORIGIN: "https://fixture.example.test",
      PORT: "4000",
      ADMIN_EMAIL: email,
      ADMIN_PASSWORD: password,
      ORGANIZATION_NAME: "Container fixture",
      LOG_LEVEL: "silent",
    })
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    { mode: 0o600 },
  );
  const server = "whatsapp-ai-server:0.1.0";
  for (const script of ["migrate", "bootstrap"])
    await docker(
      "run",
      "--rm",
      "--network",
      network,
      "--env-file",
      env,
      server,
      "node",
      `dist/infrastructure/scripts/${script}.js`,
    );
  const api = await start("api", [
    "--network-alias",
    "api",
    "--env-file",
    env,
    "-p",
    "127.0.0.1::4000",
    server,
  ]);
  const endpoint = "http://" + (await docker("port", api, "4000"));
  await waitFor(
    async () => (await fetch(endpoint + "/api/v1/health/ready")).ok,
  );
  const readiness = await (
    await fetch(endpoint + "/api/v1/health/ready")
  ).json();
  assert.equal(readiness.redis, true);
  const login = await fetch(endpoint + "/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 201);
  const cookie = login.headers.get("set-cookie")!;
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  const headers = { cookie: cookie.split(";")[0]! };
  const me = await (
    await fetch(endpoint + "/api/v1/auth/me", { headers })
  ).json();
  assert.equal(me.mfaRequired, true);
  assert.equal(
    (await fetch(endpoint + "/api/v1/accounts", { headers })).status,
    403,
  );
  assert.equal(
    (await fetch(endpoint + "/api/v1/settings", { headers })).status,
    200,
  );
  for (const kind of ["gateway", "jobs"])
    await start(kind, [
      "--env-file",
      env,
      server,
      "node",
      `dist/apps/${kind === "jobs" ? "job-worker" : "gateway-worker"}/src/main.js`,
    ]);
  await waitFor(
    async () =>
      (
        await db!.query(
          "SELECT DISTINCT kind FROM worker_heartbeats WHERE seen_at>now()-interval '10 seconds'",
        )
      ).rowCount === 2,
  );
  const web = await start("web", [
    "-p",
    "127.0.0.1::3000",
    "whatsapp-ai-web:0.1.0",
  ]);
  const webEndpoint = "http://" + (await docker("port", web, "3000"));
  await waitFor(async () => (await fetch(webEndpoint)).ok);
  const html = await (await fetch(webEndpoint)).text();
  assert.match(html, /هم‌صحبت/);
  assert.equal((await fetch(webEndpoint + "/api/v1/health/ready")).status, 200);
  for (const name of [api, web])
    assert.notEqual(await docker("exec", name, "id", "-u"), "0");
  const asset = html.match(/src="([^\"]+\.js[^\"]*)"/)?.[1];
  assert.ok(asset);
  assert.equal((await fetch(webEndpoint + asset)).status, 200);
  const result = {
    at: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - started),
    checks: [
      "container migrations",
      "container bootstrap",
      "API readiness",
      "Secure HttpOnly cookie",
      "production MFA gate",
      "gateway/jobs heartbeat",
      "standalone web",
      "web API proxy",
      "static JavaScript",
      "non-root users",
    ],
    note: "Temporary database and private Redis; no WhatsApp account or LLM provider configured.",
  };
  await mkdir(".local/validation", { recursive: true });
  await writeFile(
    ".local/validation/containers.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const container of containers.reverse()) {
    await docker("stop", "--time", "20", container).catch(() => {});
    await docker("rm", container).catch(() => {});
  }
  await db?.end();
  if (created) await maintenance.query(`DROP DATABASE ${name}`);
  await maintenance.end();
  await rm(root, { recursive: true, force: true });
}
