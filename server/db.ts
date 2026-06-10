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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_orders (
      id serial PRIMARY KEY,
      central_name text NOT NULL,
      work_order_id bigint NOT NULL,
      phone_number text NOT NULL,
      service_type text NOT NULL,
      close_date timestamptz NOT NULL,
      item_name text,
      cable_quantity text,
      tech_name text NOT NULL,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id),
      CONSTRAINT work_orders_central_wo_uniq UNIQUE (central_name, work_order_id)
    )
  `);

  // Migrate uniqueness from work_order_id alone → (central_name, work_order_id).
  // The legacy global-unique constraint means we haven't migrated yet: wipe the
  // table once (old rows used wrong central names) so re-upload rebuilds cleanly.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_work_order_id_key') THEN
        DELETE FROM work_orders;
        ALTER TABLE work_orders DROP CONSTRAINT work_orders_work_order_id_key;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_central_wo_uniq') THEN
        ALTER TABLE work_orders ADD CONSTRAINT work_orders_central_wo_uniq UNIQUE (central_name, work_order_id);
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id),
      order_id integer REFERENCES orders(id),
      type text NOT NULL,
      message text NOT NULL,
      is_read boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
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

  // Normalize idu_no/odu_no: any line whose values don't match the canonical
  // (central, cabin_number) pair gets corrected automatically.
  // Canonical = earliest seeded row (lowest id) per cabin that has a non-null idu_no.
  await pool.query(`
    UPDATE phone_lines target
    SET idu_no = src.idu_no, odu_no = src.odu_no
    FROM (
      SELECT DISTINCT ON (central, cabin_number) central, cabin_number, idu_no, odu_no
      FROM phone_lines
      WHERE idu_no IS NOT NULL
      ORDER BY central, cabin_number, id ASC
    ) src
    WHERE target.central = src.central
      AND target.cabin_number = src.cabin_number
      AND (target.idu_no IS DISTINCT FROM src.idu_no OR target.odu_no IS DISTINCT FROM src.odu_no)
  `);

  // Normalize work order service_type to the two Arabic labels.
  // "Fixed Voice Installation MSAN" → "تركيب جديد"، أي قيمة أخرى → "نقل".
  // WHERE clause keeps it idempotent (already-normalized rows untouched).
  await pool.query(`
    UPDATE work_orders
    SET service_type = CASE
      WHEN service_type = 'Fixed Voice Installation MSAN' THEN 'تركيب جديد'
      ELSE 'نقل'
    END
    WHERE service_type NOT IN ('تركيب جديد', 'نقل')
  `);

  // maintenance_orders — أوامر شغل الأعطال (Work_Orders Excel)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_orders (
      id serial PRIMARY KEY,
      central_name text NOT NULL,
      work_order_id bigint NOT NULL,
      phone_number text NOT NULL,
      work_order_type text,
      stage text,
      status text,
      priority text,
      current_workspec text,
      notes text,
      description text,
      creation_date timestamptz,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id),
      CONSTRAINT maintenance_orders_central_wo_uniq UNIQUE (central_name, work_order_id)
    )
  `);

  // ticket_queue — شكاوى (TicketQueue Excel)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_queue (
      id serial PRIMARY KEY,
      ticket_id text NOT NULL,
      central_code text NOT NULL,
      central_name text NOT NULL,
      phone_number text,
      complaint_time timestamptz,
      tech_code text,
      line_type_code text,
      cabinet_no text,
      priority_code text,
      close_date timestamptz,
      operation_type text,
      complain_type_name text,
      status_code text,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id),
      CONSTRAINT ticket_queue_ticket_status_uniq UNIQUE (ticket_id, status_code)
    )
  `);

  // complaint_details — شيت التفاصيل (430D_Trial Excel)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_details (
      id serial PRIMARY KEY,
      complain_no text NOT NULL UNIQUE,
      sector text,
      region text,
      exchange_name text,
      central_name text,
      phone_number text,
      msan_id text,
      cabinet_no text,
      complain_time timestamptz,
      close_time timestamptz,
      close_code text,
      complain_side_name text,
      complain_type_name text,
      close_by text,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);

  // Reconcile ticket_queue unique constraint → composite (ticket_id, status_code).
  // Needed when the table was created earlier with a single-column unique.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_queue_ticket_id_key') THEN
        ALTER TABLE ticket_queue DROP CONSTRAINT ticket_queue_ticket_id_key;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_queue_ticket_status_uniq') THEN
        ALTER TABLE ticket_queue ADD CONSTRAINT ticket_queue_ticket_status_uniq UNIQUE (ticket_id, status_code);
      END IF;
    END $$;
  `);

  // Reconcile maintenance_orders unique → composite (central_name, work_order_id).
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_orders_work_order_id_key') THEN
        ALTER TABLE maintenance_orders DROP CONSTRAINT maintenance_orders_work_order_id_key;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_orders_central_wo_uniq') THEN
        ALTER TABLE maintenance_orders ADD CONSTRAINT maintenance_orders_central_wo_uniq UNIQUE (central_name, work_order_id);
      END IF;
    END $$;
  `);

  // remaining_complaints — شيت تفاصيل متبقى (snapshot, replaced each upload)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS remaining_complaints (
      id serial PRIMARY KEY,
      complain_no text NOT NULL UNIQUE,
      sector text,
      region text,
      exchange_name text,
      phone_number text,
      complain_time timestamptz,
      dispatch_time timestamptz,
      dispatch_user text,
      msan_id text,
      close_time timestamptz,
      close_code text,
      close_by text,
      status_code text,
      cabinet_no text,
      complain_type text,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);
}
