import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/bin.ts"],
      thresholds: {
        perFile: true,
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
