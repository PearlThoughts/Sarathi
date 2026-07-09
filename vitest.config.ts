import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["tests/**/*.bun.test.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
