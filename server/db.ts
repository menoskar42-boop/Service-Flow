import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Idempotent runtime migrations: keep DB in sync with schema additions even
// when `npm run db:push` is not executed (e.g. Replit deploy).
export async function ensureSchema() {
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS serial_number text`);
}
