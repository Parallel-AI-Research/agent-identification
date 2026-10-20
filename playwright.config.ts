import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4311",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "npm run dev:collector",
      url: "http://127.0.0.1:4310/health",
      reuseExistingServer: false,
      env: { AGENT_ID_DEMO: "true" },
    },
    {
      command: "npm run dev:examples",
      url: "http://127.0.0.1:4311/plain/",
      reuseExistingServer: false,
    },
  ],
});
