import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import pg from "pg";
import argon2 from "argon2";
import { Database } from "../../packages/persistence/database.js";
import { migrate } from "../../infrastructure/scripts/migrate.js";
import { MessagingRepository } from "../../packages/modules/messaging/infrastructure/messaging.repository.js";
import { CredentialCipher } from "../../packages/security/cipher.js";
// @ts-expect-error the test deliberately runs the compiled production server
import { createApp } from "../../dist/apps/api/src/app.js";
const email = `ui-${randomUUID()}@example.test`,
  password = randomUUID();
const database = `wa_ui_test_${process.pid}`;
let db: Database;
let maintenance: pg.Pool;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let services: Awaited<ReturnType<typeof createApp>>["services"];
test.beforeAll(async () => {
  process.loadEnvFile(".env");
  const url = new URL(process.env.DATABASE_URL!);
  maintenance = new pg.Pool({ connectionString: url.toString() });
  await maintenance.query(`CREATE DATABASE ${database}`);
  url.pathname = "/" + database;
  db = new Database(url.toString());
  await migrate(db);
  const org = await db.orm
    .insert(
      (await import("../../packages/persistence/schema.js")).organizations,
    )
    .values({ name: "محیط آزمایش رابط" })
    .returning();
  await db.query(
    "INSERT INTO users(organization_id,email,display_name,password_hash,role) VALUES($1,$2,'مدیر آزمایش',$3,'ORG_ADMIN')",
    [org[0]!.id, email, await argon2.hash(password)],
  );
  const result = await createApp({
    NODE_ENV: "test",
    DATABASE_URL: url.toString(),
    REDIS_URL: process.env.REDIS_URL,
    MASTER_KEY: "c".repeat(64),
    PORT: 4011,
    APP_ORIGIN: "http://localhost:3001",
    OPENAI_MODEL: "fixture",
    STORAGE_PATH: ".local/test-exports",
    LOG_LEVEL: "silent",
  });
  app = result.app;
  services = result.services;
  await app.listen(4011, "127.0.0.1");
});
test.afterAll(async () => {
  await app?.close();
  await services?.close();
  await db?.close();
  await maintenance?.query(`DROP DATABASE ${database}`);
  await maintenance?.end();
});
test("Persian dashboard: login, create account and agent, receive a message, handoff and queue a reply", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("ایمیل", { exact: true }).fill(email);
  await page.getByLabel("رمز عبور", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ورود به پنل" }).click();
  await expect(
    page.getByRole("heading", { name: "سلام، مدیر آزمایش 👋" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "حساب‌های واتساپ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "افزودن حساب", exact: true })
    .first()
    .click();
  await page.getByLabel("نام حساب", { exact: true }).fill("پشتیبانی آزمایشی");
  await page.getByRole("button", { name: "ساخت حساب", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "پشتیبانی آزمایشی", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "دستیارهای هوشمند", exact: true })
    .click();
  await page.getByRole("button", { name: "دستیار جدید", exact: true }).click();
  await page.getByLabel("نام دستیار", { exact: true }).fill("راهنمای مشتری");
  await page.getByRole("button", { name: "ذخیره نسخه", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "راهنمای مشتری", exact: true }),
  ).toBeVisible();
  const [account] = await db.query<{ id: string }>(
    "SELECT id FROM wa_accounts",
  );
  const received = await new MessagingRepository(
    db,
    new CredentialCipher("c".repeat(64)),
  ).receive({
    accountId: account!.id,
    externalId: randomUUID(),
    jid: "123@lid",
    participant: "",
    fromMe: false,
    body: "سلام، درباره خدمات راهنمایی می‌خواهم.",
    timestamp: new Date(),
    history: false,
    displayName: "مشتری آزمایشی",
  });
  expect(received.duplicate).toBe(false);
  await page.getByRole("button", { name: "صندوق گفتگو", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "مشتری آزمایشی" })
    .first()
    .click();
  await expect(page.locator(".message")).toContainText("درباره خدمات");
  await page.getByRole("button", { name: "انسانی", exact: true }).click();
  await expect(page.getByPlaceholder("پاسخ خود را بنویسید…")).toBeVisible();
  await page
    .getByPlaceholder("پاسخ خود را بنویسید…")
    .fill("سلام، خوشحال می‌شوم راهنمایی کنم.");
  await page.getByRole("button", { name: "ارسال پیام", exact: true }).click();
  await expect(page.locator(".message.pending")).toContainText(
    "سلام، خوشحال می‌شوم",
  );
  await mkdir(".local/screenshots", { recursive: true });
  await page.screenshot({
    path: ".local/screenshots/inbox.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "گزارش و تحلیل", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "روند روزانهٔ پیام‌ها" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "یکپارچه‌سازی‌ها", exact: true })
    .click();
  await expect(page.getByText("غیرفعال", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "نمای کلی", exact: true }).click();
  await page.screenshot({
    path: ".local/screenshots/dashboard.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "فهرست" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/screenshots/mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
