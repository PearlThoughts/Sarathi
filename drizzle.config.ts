import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/postgres/knowledge-schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
