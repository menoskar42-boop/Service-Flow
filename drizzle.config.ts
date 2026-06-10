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
  // NOTE: every table is defined in shared/schema.ts AND created idempotently at
  // runtime by ensureSchema() in server/db.ts. A committed migration snapshot
  // (migrations/) gives the deploy step a baseline to diff against, so it stops
  // comparing the live production DB directly to the schema and never emits the
  // destructive DROP TABLE statements that previously wiped uploaded data.
});
