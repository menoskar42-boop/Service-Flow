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
  // Core tables (users, orders) — historically created by drizzle-kit push, now
  // also created here so ensureSchema is self-sufficient on a fresh database.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      username text NOT NULL UNIQUE,
      password text NOT NULL,
      role text NOT NULL,
      suspended boolean NOT NULL DEFAULT false,
      created_at timestamp DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id serial PRIMARY KEY,
      customer_name text NOT NULL,
      customer_phone text NOT NULL,
      customer_address text NOT NULL,
      national_id text,
      serial_number text,
      sales_id integer NOT NULL REFERENCES users(id),
      sales_name text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      is_feasible boolean,
      rejection_reason text,
      cabin_number text,
      box_number text,
      nearest_box_distance text,
      additional_notes text,
      central_name text,
      tech_id integer REFERENCES users(id),
      tech_name text,
      tech_response_at timestamp,
      external_id integer REFERENCES users(id),
      external_name text,
      external_response_at timestamp,
      is_feasible_external boolean,
      external_rejection_reason text,
      external_cabin_number text,
      external_box_number text,
      external_nearest_box_distance text,
      external_additional_notes text,
      external_central_name text,
      contract_status text NOT NULL DEFAULT 'لم يتم التعاقد',
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

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

  // Seed + normalize phone_lines / work_orders. Wrapped in try/catch so a failure
  // here (e.g. missing seed files) can NEVER abort ensureSchema — every CREATE
  // TABLE below must still run so the whole schema is always rebuilt, exactly the
  // way work_orders already is (it survives because it is created before this).
  try {
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
      // Don't abort ensureSchema here — the remaining CREATE TABLE statements
      // (ticket_queue, complaint_details, …) MUST still run even when the seed
      // files are absent, otherwise a dropped/empty DB never gets rebuilt.
      console.warn("No phone-lines-seed files found; phone_lines table left empty");
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
  } catch (e) {
    console.warn("phone_lines seeding/normalization skipped (schema creation continues):", e);
  }

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
      onu text,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id),
      CONSTRAINT ticket_queue_ticket_status_uniq UNIQUE (ticket_id, status_code)
    )
  `);
  await pool.query(`ALTER TABLE ticket_queue ADD COLUMN IF NOT EXISTS onu text`);

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
      status_code text,
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

  // remaining_complaints — شيت تفاصيل متبقى (hist + sod + current)
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS remaining_complaints_sod (
      id serial PRIMARY KEY,
      complain_no text NOT NULL UNIQUE,
      sector text, region text, exchange_name text, phone_number text,
      complain_time timestamptz, dispatch_time timestamptz, dispatch_user text,
      msan_id text, close_time timestamptz, close_code text, close_by text,
      status_code text, cabinet_no text, complain_type text,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS remaining_complaints_current (
      id serial PRIMARY KEY,
      complain_no text NOT NULL UNIQUE,
      sector text, region text, exchange_name text, phone_number text,
      complain_time timestamptz, dispatch_time timestamptz, dispatch_user text,
      msan_id text, close_time timestamptz, close_code text, close_by text,
      status_code text, cabinet_no text, complain_type text,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);

  // complaint_details sod + current companion tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_details_sod (
      id serial PRIMARY KEY,
      complain_no text NOT NULL UNIQUE,
      sector text, region text, exchange_name text, phone_number text,
      msan_id text, cabinet_no text, complain_time timestamptz, close_time timestamptz,
      close_code text, status_code text, complain_side_name text, complain_type_name text, close_by text,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_details_current (
      id serial PRIMARY KEY,
      complain_no text NOT NULL UNIQUE,
      sector text, region text, exchange_name text, phone_number text,
      msan_id text, cabinet_no text, complain_time timestamptz, close_time timestamptz,
      close_code text, status_code text, complain_side_name text, complain_type_name text, close_by text,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);

  // cable_entries — استكمال بيانات: كمية السلك التى يضيفها الفنى يدوياً
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cable_entries (
      id serial PRIMARY KEY,
      phone_local text NOT NULL,
      phone_full text NOT NULL,
      work_order_type text NOT NULL,
      cable_quantity text NOT NULL,
      created_by_id integer REFERENCES users(id),
      created_by_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT cable_entries_phone_type_uniq UNIQUE (phone_local, work_order_type)
    )
  `);
  // قفل التعديل بعد الطباعة
  await pool.query(`ALTER TABLE cable_entries ADD COLUMN IF NOT EXISTS printed_at timestamptz`);
  await pool.query(`ALTER TABLE cable_entries ADD COLUMN IF NOT EXISTS edit_unlocked_at timestamptz`);

  // manual_close_by — فنى الإغلاق المُضاف يدوياً (مرجعية أولى لشكوى فنى إغلاقها غير معروف)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS manual_close_by (
      id serial PRIMARY KEY,
      complain_no text NOT NULL UNIQUE,
      tech_name text NOT NULL,
      assigned_by_id integer REFERENCES users(id),
      assigned_by_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // msan_tech_overrides — إسناد يدوى لفنى كود كابينة MSAN غير معروف (أدمن)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS msan_tech_overrides (
      id serial PRIMARY KEY,
      cabin_code text NOT NULL UNIQUE,
      tech_name text NOT NULL,
      assigned_by_id integer REFERENCES users(id),
      assigned_by_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // time_till_now — المدة المحسوبة مسبقاً من ملف 430D (except status 135)
  await pool.query(`ALTER TABLE complaint_details          ADD COLUMN IF NOT EXISTS time_till_now numeric`);
  await pool.query(`ALTER TABLE complaint_details_sod      ADD COLUMN IF NOT EXISTS time_till_now numeric`);
  await pool.query(`ALTER TABLE complaint_details_current  ADD COLUMN IF NOT EXISTS time_till_now numeric`);
  await pool.query(`ALTER TABLE remaining_complaints       ADD COLUMN IF NOT EXISTS time_till_now numeric`);
  await pool.query(`ALTER TABLE remaining_complaints_sod   ADD COLUMN IF NOT EXISTS time_till_now numeric`);
  await pool.query(`ALTER TABLE remaining_complaints_current ADD COLUMN IF NOT EXISTS time_till_now numeric`);

  // time_till_now_full — المدة الكلية من ملف 430D (Time untill now بدون استبعاد 135/138)
  // الفرق (full − time_till_now) = الوقت الذى قضته الشكوى على الحالة 135/138.
  await pool.query(`ALTER TABLE complaint_details          ADD COLUMN IF NOT EXISTS time_till_now_full numeric`);
  await pool.query(`ALTER TABLE complaint_details_sod      ADD COLUMN IF NOT EXISTS time_till_now_full numeric`);
  await pool.query(`ALTER TABLE complaint_details_current  ADD COLUMN IF NOT EXISTS time_till_now_full numeric`);
  await pool.query(`ALTER TABLE remaining_complaints       ADD COLUMN IF NOT EXISTS time_till_now_full numeric`);
  await pool.query(`ALTER TABLE remaining_complaints_sod   ADD COLUMN IF NOT EXISTS time_till_now_full numeric`);
  await pool.query(`ALTER TABLE remaining_complaints_current ADD COLUMN IF NOT EXISTS time_till_now_full numeric`);

  // status_code — حالة الشكوى من ملف 430D (شيت التفاصيل) — مثل DSL-160 / 173 …
  await pool.query(`ALTER TABLE complaint_details          ADD COLUMN IF NOT EXISTS status_code text`);
  await pool.query(`ALTER TABLE complaint_details_sod      ADD COLUMN IF NOT EXISTS status_code text`);
  await pool.query(`ALTER TABLE complaint_details_current  ADD COLUMN IF NOT EXISTS status_code text`);

  // ftth_subscribers — ملخص مشتركين FTTH/ADSL (full replace each upload)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ftth_subscribers (
      id serial PRIMARY KEY,
      sector text,
      region text,
      main_ex text,
      sub_ex text,
      fcc_code text,
      type text,
      msan_gpon_code text,
      fbb_subs integer,
      fv_subs integer,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);

  // Ticket snapshot/FTTH tables (start-of-day + current, per type).
  // Columns mirror ticket_queue. ticket_ftth is the FTTH historical table.
  const ticketTables = ["ticket_dsl_sod", "ticket_dsl_current", "ticket_ftth", "ticket_ftth_sod", "ticket_ftth_current"];
  // SOD + FTTH-historical tables accumulate (ON CONFLICT DO NOTHING) → need the
  // composite unique key. The *_current tables are always full-replaced (plain
  // INSERT) so they must NOT carry the constraint (the file may hold dup keys).
  const ticketNeedUniq = new Set(["ticket_ftth", "ticket_dsl_sod", "ticket_ftth_sod"]);
  for (const t of ticketTables) {
    const uniq = ticketNeedUniq.has(t) ? `,\n      CONSTRAINT ${t}_uniq UNIQUE (ticket_id, status_code)` : "";
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${t} (
        id serial PRIMARY KEY,
        ticket_id text NOT NULL,
        central_code text,
        central_name text,
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
        onu text,
        uploaded_at timestamptz NOT NULL DEFAULT now(),
        uploaded_by_id integer REFERENCES users(id)${uniq}
      )
    `);
    // idempotent: tables created before onu existed
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS onu text`);
  }

  // WFM work-order snapshot tables (start-of-day + current). Mirror maintenance_orders.
  // wfm_sod accumulates same-day uploads (ON CONFLICT DO NOTHING) → needs the
  // composite unique key. wfm_current is full-replaced so it stays unconstrained.
  for (const t of ["wfm_sod", "wfm_current"]) {
    const uniq = t === "wfm_sod" ? `,\n        CONSTRAINT ${t}_central_wo_uniq UNIQUE (central_name, work_order_id)` : "";
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${t} (
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
        uploaded_by_id integer REFERENCES users(id)${uniq}
      )
    `);
  }

  // أعمدة بيانات العميل من شيت أوامر الشغل (تظهر فى تقارير التركيبات/المعاينات).
  // إضافية (ADD COLUMN IF NOT EXISTS) — آمنة ولا تُسقط بيانات. تُطبّق على الجدول
  // التاريخى ولقطتى بداية اليوم/الحالى.
  for (const t of ["maintenance_orders", "wfm_sod", "wfm_current"]) {
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS mobile text`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS customer_name text`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS address text`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS reference_no text`);
    // رقم الكابينة المستخرج من "اسم السنترال" فى شيت أوامر الشغل (GHNAT/7-3 → 7-3)
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS exch_cabinet text`);
  }

  // Idempotent: add the SOD unique constraints to tables created before this
  // change (CREATE TABLE IF NOT EXISTS won't alter an existing table). Existing
  // SOD rows may already hold duplicate keys (old plain-INSERT replace), so we
  // dedup first (keep lowest id per key) before adding the constraint.
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_dsl_sod_uniq') THEN
        DELETE FROM ticket_dsl_sod a USING ticket_dsl_sod b
          WHERE a.id > b.id AND a.ticket_id = b.ticket_id
            AND COALESCE(a.status_code,'') = COALESCE(b.status_code,'');
        ALTER TABLE ticket_dsl_sod ADD CONSTRAINT ticket_dsl_sod_uniq UNIQUE (ticket_id, status_code);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_ftth_sod_uniq') THEN
        DELETE FROM ticket_ftth_sod a USING ticket_ftth_sod b
          WHERE a.id > b.id AND a.ticket_id = b.ticket_id
            AND COALESCE(a.status_code,'') = COALESCE(b.status_code,'');
        ALTER TABLE ticket_ftth_sod ADD CONSTRAINT ticket_ftth_sod_uniq UNIQUE (ticket_id, status_code);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wfm_sod_central_wo_uniq') THEN
        DELETE FROM wfm_sod a USING wfm_sod b
          WHERE a.id > b.id AND a.central_name = b.central_name
            AND a.work_order_id = b.work_order_id;
        ALTER TABLE wfm_sod ADD CONSTRAINT wfm_sod_central_wo_uniq UNIQUE (central_name, work_order_id);
      END IF;
    END $$;
  `);

  // ftth_orders — ملف Order (متعذرات OM). تاريخي + حالي + بداية السنة + أرشيف سنوي.
  for (const t of ["ftth_orders", "ftth_orders_current", "ftth_orders_soy", "ftth_orders_archive"]) {
    const uniq = t === "ftth_orders" ? `,\n      CONSTRAINT ${t}_uniq UNIQUE (service_order_id)` : "";
    const archCol = t === "ftth_orders_archive" ? "archived_year integer," : "";
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${t} (
        id serial PRIMARY KEY,
        ${archCol}
        service_order_id text NOT NULL,
        customer_order_id text,
        product text,
        service_number text,
        customer_name text,
        order_status text,
        order_create_time timestamptz,
        exchange_name text,
        service_type text,
        msan_code text,
        area_code text,
        customer_mobile text,
        current_activity text,
        error_name text,
        governorate text,
        line_type text,
        fcc_exchange text,
        serial_number text,
        service_name text,
        raw jsonb,
        uploaded_at timestamptz NOT NULL DEFAULT now(),
        uploaded_by_id integer REFERENCES users(id)${uniq}
      )
    `);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS serial_number text`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS service_name text`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS install_address text`);
  }

  // phone_ports — منافذ MSAN، مفتاحها رقم التليفون (upsert على كل رفعة)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS phone_ports (
      id serial PRIMARY KEY,
      phone_number text NOT NULL UNIQUE,
      area_code text,
      msan_code text,
      frame text,
      shelf text,
      slot text,
      port_number text,
      port_type text,
      voice_status text,
      data_status text,
      operator text,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);
  await pool.query(`ALTER TABLE phone_ports ADD COLUMN IF NOT EXISTS onu text`);

  // case_138 — حاله 138 (DSL fault cases, full replace each upload)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS case_138 (
      id serial PRIMARY KEY,
      central_name text,
      phone_short text,
      complain_no text,
      score integer,
      current_speed text,
      max_speed text,
      full_phone text,
      account_no text,
      status_code text,
      cabinet_no text,
      box_no text,
      complain_type_name text,
      complain_time timestamptz,
      customer_name text,
      dispatch_time timestamptz,
      tech_code text,
      close_date timestamptz,
      onu text,
      fault_type text,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);

  // cabinet_technicians — الفنيين بأرقام الكباين (full replace each upload)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cabinet_technicians (
      id serial PRIMARY KEY,
      central_name text,
      cabin_number text,
      worker_code text,
      haya_karima text,
      region_name text,
      active text,
      central_finish text,
      village_code text,
      cabin_code text,
      idu text,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);

  // technician_names — أسماء الفنيين بأكواد العمال (full replace each upload)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS technician_names (
      id serial PRIMARY KEY,
      worker_code text NOT NULL,
      tech_name text NOT NULL,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);

  // إسناد ثابت: كود الكابينة 11-2-26-02 يتبع نفس فنى الكابينة 11-2-26-102.
  // (يُنفَّذ بعد إنشاء cabinet_technicians + technician_names، ولا يستبدل أى إسناد يدوى لاحق.)
  await pool.query(`
    INSERT INTO msan_tech_overrides (cabin_code, tech_name, assigned_by_name)
    SELECT '11-2-26-02', string_agg(DISTINCT tn.tech_name, ' , '), 'system'
    FROM cabinet_technicians ct
    JOIN technician_names tn ON tn.worker_code = ct.worker_code
    WHERE ct.cabin_code = '11-2-26-102'
    HAVING string_agg(DISTINCT tn.tech_name, ' , ') IS NOT NULL
    ON CONFLICT (cabin_code) DO NOTHING
  `);

  // regularized_daily — الأرشيف اليومى للمنتظمات (أعطال/تركيبات/معاينات).
  // يُكتب تلقائياً كل ليلة الساعة 11 (cron داخلى + تعويض عند الصحيان).
  // مفتاح فريد (category, item_key) يمنع تكرار نفس العنصر:
  //   - faults:        item_key = رقم الشكوى (ticket_id)
  //   - installations/surveys: item_key = اسم السنترال | رقم أمر الشغل
  // العنصر يُسجَّل مرة واحدة بتاريخ أول يوم انتظم فيه (ON CONFLICT DO NOTHING).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS regularized_daily (
      id serial PRIMARY KEY,
      snapshot_date date NOT NULL,
      category text NOT NULL,
      item_key text NOT NULL,
      central_name text,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT regularized_daily_cat_key_uniq UNIQUE (category, item_key)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS regularized_daily_cat_date_idx ON regularized_daily (category, snapshot_date)`);

  // إدخال يدوى لكابينة TB07 (الغنايم) على حسن عبد الفتاح يعقوب — خارج حياة كريمة
  // يُنفَّذ مرة واحدة فقط إذا لم تكن الكابينة موجودة بالفعل
  await pool.query(`
    INSERT INTO cabinet_technicians (central_name, cabin_number, worker_code, haya_karima)
    SELECT 'الغنايم', 'TB07', tn.worker_code, 'لا'
    FROM technician_names tn
    WHERE tn.tech_name ILIKE '%حسن عبد الفتاح%'
      AND NOT EXISTS (
        SELECT 1 FROM cabinet_technicians
        WHERE central_name = 'الغنايم' AND cabin_number = 'TB07'
      )
    LIMIT 1
  `);

  // line_accounts — أرقام الأكونت للخطوط (مزامنة من شيت 138 + إدخال يدوى)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS line_accounts (
      id serial PRIMARY KEY,
      full_phone text NOT NULL UNIQUE,
      account_no text NOT NULL,
      source text NOT NULL DEFAULT 'manual',
      updated_by_id integer REFERENCES users(id),
      updated_by_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // بذر مبدئى من case_138 الموجودة — للخطوط الغير موجودة فى line_accounts فقط
  await pool.query(`
    INSERT INTO line_accounts (full_phone, account_no, source)
    SELECT DISTINCT ON (full_phone) full_phone, account_no, 'case_138'
    FROM case_138
    WHERE full_phone IS NOT NULL AND full_phone != ''
      AND account_no IS NOT NULL AND account_no != ''
    ORDER BY full_phone, id DESC
    ON CONFLICT (full_phone) DO NOTHING
  `);

  // line_account_edits — سجل تاريخى لكل تعديل على رقم الأكونت
  await pool.query(`
    CREATE TABLE IF NOT EXISTS line_account_edits (
      id serial PRIMARY KEY,
      full_phone text NOT NULL,
      old_account_no text,
      new_account_no text NOT NULL,
      edited_by_id integer REFERENCES users(id),
      edited_by_name text,
      edited_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS line_account_edits_full_phone_idx
      ON line_account_edits (full_phone)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS line_account_edits_edited_at_idx
      ON line_account_edits (edited_at DESC)
  `);

  // lines_no_account — خطوط معلَّمة يدوياً بأنها "بدون رقم أكونت" (لا يوجد لها أكونت)
  // تُخفى من تقرير الخطوط بدون أكونت دون تسجيل رقم أكونت لها.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lines_no_account (
      full_phone text PRIMARY KEY,
      marked_by_id integer REFERENCES users(id),
      marked_by_name text,
      marked_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}
