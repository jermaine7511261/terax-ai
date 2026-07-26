import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "src-tauri"],
    globals: true,
    environment: "node",
    testTimeout: 30000,
    reporters: ["default", "json"],
    outputFile: {
      json: "./test-results.json",
    },
    coverage: {
      provider: "v8",
      include: ["src/modules/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "src-tauri/**"],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
