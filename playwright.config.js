import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.js",
  globalTeardown: "./tests/e2e/global-teardown.js",
  use: {
    headless: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  // Servers are managed via global setup for ephemeral ports — no webServer block needed
  timeout: 30_000,
  expect: { timeout: 10_000 },
});
