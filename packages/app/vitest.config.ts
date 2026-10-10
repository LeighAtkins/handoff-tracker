import { defineConfig } from "vitest/config";

// Use cases are tested against a real Postgres (a separate handoff_test database), because
// most of what they do is transactions, constraints and audit writes.
export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
  },
});
