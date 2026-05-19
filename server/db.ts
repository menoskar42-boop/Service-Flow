import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readFileSync } from "fs";
import { join } from "path";
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS phone_lines (
      id serial PRIMARY KEY,
      tel_no text NOT NULL,
      central text NOT NULL,
      idu_no text,
      odu_no text,
      cabin_number text,
      primary_block_no text,
      cabinet_in text,
      sec_block_no text,
      cabinet_out text,
      box_number text,
      dp_terminal text,
      port text,
      len text,
      fiber_block text,
      fiber_out text,
      tel_num_txt text,
      full_phone text NOT NULL UNIQUE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS phone_line_edits (
      id serial PRIMARY KEY,
      phone_line_id integer NOT NULL REFERENCES phone_lines(id),
      full_phone text NOT NULL,
      central text NOT NULL,
      old_cabin_number text,
      new_cabin_number text,
      old_box_number text,
      new_box_number text,
      old_dp_terminal text,
      new_dp_terminal text,
      status text NOT NULL DEFAULT 'pending',
      edited_by_id integer NOT NULL REFERENCES users(id),
      edited_by_name text NOT NULL,
      edited_at timestamptz NOT NULL DEFAULT now(),
      confirmed_by_id integer REFERENCES users(id),
      confirmed_by_name text,
      confirmed_at timestamptz,
      rolled_back_by_id integer REFERENCES users(id),
      rolled_back_by_name text,
      rolled_back_at timestamptz
    )
  `);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM phone_lines");
  const EXPECTED_MIN = 10000;
  if (rows[0].c < EXPECTED_MIN) {
    if (rows[0].c > 0) {
      console.log(`phone_lines has ${rows[0].c} rows (< ${EXPECTED_MIN}); topping up from seed files`);
    }
    let allLines: any[] = [];
    for (let i = 1; i <= 8; i++) {
      try {
        const raw = readFileSync(
          join(process.cwd(), `server/phone-lines-seed-${i}.json`),
          "utf-8",
        );
        allLines = allLines.concat(JSON.parse(raw));
      } catch {
        // chunk file not present — skip
      }
    }
    if (allLines.length === 0) {
      console.warn("No phone-lines-seed files found; phone_lines table left empty");
      return;
    }
    const BATCH = 500;
    for (let start = 0; start < allLines.length; start += BATCH) {
      const chunk = allLines.slice(start, start + BATCH);
      const placeholders = chunk
        .map((_, ci) => {
          const o = ci * 17;
          return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12},$${o + 13},$${o + 14},$${o + 15},$${o + 16},$${o + 17})`;
        })
        .join(",");
      const values = chunk.flatMap((r) => [
        r.telNo || "",
        r.central || "",
        r.iduNo || null,
        r.oduNo || null,
        r.cabinNumber || null,
        r.primaryBlockNo || null,
        r.cabinetIn || null,
        r.secBlockNo || null,
        r.cabinetOut || null,
        r.boxNumber || null,
        r.dpTerminal || null,
        r.port || null,
        r.len || null,
        r.fiberBlock || null,
        r.fiberOut || null,
        r.telNumTxt || null,
        r.fullPhone || "",
      ]);
      await pool.query(
        `INSERT INTO phone_lines (tel_no, central, idu_no, odu_no, cabin_number, primary_block_no, cabinet_in, sec_block_no, cabinet_out, box_number, dp_terminal, port, len, fiber_block, fiber_out, tel_num_txt, full_phone)
         VALUES ${placeholders}
         ON CONFLICT (full_phone) DO NOTHING`,
        values,
      );
    }
    const { rows: after } = await pool.query("SELECT COUNT(*)::int AS c FROM phone_lines");
    console.log(`Phone lines: was ${rows[0].c}, now ${after[0].c} (seed had ${allLines.length})`);
  }
}
