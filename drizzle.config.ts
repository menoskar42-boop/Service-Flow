import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // IMPORTANT: tablesFilter "!*" tells drizzle-kit to manage ZERO tables in push/generate mode.
  // All schema creation/alteration is handled exclusively by ensureSchema() in server/db.ts,
  // which only ever uses CREATE TABLE IF NOT EXISTS and ALTER TABLE ADD COLUMN IF NOT EXISTS.
  // This prevents Replit's automatic deploy-time schema diffing from generating DROP statements
  // when Replit's AI agent modifies schema.ts in its internal workspace.
  tablesFilter: ["!*"],
});
