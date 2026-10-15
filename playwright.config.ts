import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 45000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      ...(existsSync("/usr/bin/chromium")
        ? { executablePath: "/usr/bin/chromium" }
        : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm --dir apps/admin-web exec next dev -p 3001",
    env: {
      API_INTERNAL_URL: "http://127.0.0.1:4011",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
  },
});
