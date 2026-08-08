import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/infrastructure/postgres/knowledge-schema.ts",
    "./src/infrastructure/postgres/product-model-schema.ts",
  ],
  out: "./drizzle",
  strict: true,
  verbose: true,
});
