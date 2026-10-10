import { defineConfig } from "vitest/config";

// The domain is the part reviewers read first, and it is cheap to test, so coverage is enforced.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: { lines: 100, functions: 100, branches: 95, statements: 100 },
    },
  },
});
