// SPDX-License-Identifier: MIT
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 90 },
    },
  },
});
