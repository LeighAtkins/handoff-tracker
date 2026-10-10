import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);

/**
 * Runs against the web app with freshly seeded fake data (global-setup reseeds).
 * Locally it reuses a running `pnpm dev`; in CI it starts the production build.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./global-setup.ts",
  // The dev server compiles pages on first visit, which can take a few seconds.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.CI ? "pnpm --filter @handoff/web start" : "pnpm --filter @handoff/web dev",
    cwd: "..",
    url: `http://localhost:${port}/stuck`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
