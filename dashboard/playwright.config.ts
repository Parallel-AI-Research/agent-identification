import { execSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

// Runs against the local Supabase stack, so test accounts never reach a hosted project. CI runs
// the browsers in a container without the Supabase CLI, so it passes the stack's key in instead.
function localPublishableKey(): string {
  const stack = Object.fromEntries(
    execSync("supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .map((line) => /^([A-Z_]+)="?([^"]*)"?$/.exec(line.trim()))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  );
  return stack.PUBLISHABLE_KEY ?? stack.ANON_KEY ?? "";
}
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || localPublishableKey();
const supabaseUrl = "http://127.0.0.1:54321";
const collectorUrl = "http://127.0.0.1:4310";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "npm run dev:collector",
      cwd: "..",
      url: `${collectorUrl}/health`,
      reuseExistingServer: !process.env.CI,
      env: { AGENT_ID_DEMO: "true", SUPABASE_URL: supabaseUrl },
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:3100/sign-in",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        COLLECTOR_URL: collectorUrl,
        SITE_URL: "http://127.0.0.1:3100",
      },
    },
  ],
});
