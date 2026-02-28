import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only run tests in the tests/ directory, excluding e2e specs (Playwright)
    include: ["tests/**/*.test.js"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
});
