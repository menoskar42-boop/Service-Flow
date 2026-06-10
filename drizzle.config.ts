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
  // Drizzle must ONLY manage the two tables it actually owns (users, orders).
  // Every other table is created/maintained at runtime by ensureSchema() in
  // server/db.ts. Without this filter, `drizzle-kit push` sees those tables as
  // "unknown" and generates destructive DROP TABLE statements on publish,
  // wiping all uploaded data. Restricting the scope makes publishing safe.
  tablesFilter: ["users", "orders"],
});
