import { defineConfig } from "drizzle-kit";

// Runtime uses inline DDL in server/src/db/client.ts (openDb).
// This config is only for generating real migration files with drizzle-kit later.
export default defineConfig({
  schema: "./server/src/db/schema.ts",
  out: "./server/src/db/migrations",
  dialect: "sqlite",
});
