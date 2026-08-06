import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readFileSync } from "fs";
import { join } from "path";
import * as schema from "@shared/schema";
import { phoneNormSql } from "./phone-norm";

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
  // ── sf_ar_norm(): تطبيع النص العربى للبحث ──
  // البحث كان حرفياً جداً: «ايمن» مكانش بيلاقى «أيمن»، و«يحيى» مكانش بيلاقى «يحيي».
  // الدالة دى بتوحّد الحروف قبل المقارنة:
  //   آ أ إ ٱ → ا | ى ئ → ي | ؤ → و | ة → ه
  //   تشيل التشكيل (ً ٌ ٍ َ ُ ِ ّ ْ) والتطويل (ـ) والألف الخنجرية (ٰ)
  //   تحوّل الأرقام العربية/الفارسية (٠١٢… ۰۱۲…) لأرقام لاتينية
  //   + lower() للحروف اللاتينية
  // لازم تفضل مطابقة تماماً لدالة arNorm() فى shared/ar-norm.ts (المستخدَمة فى الواجهة).
  // IMMUTABLE عشان تقدر تدخل فى index لو احتجنا لاحقاً.
  await pool.query(`
    CREATE OR REPLACE FUNCTION sf_ar_norm(t text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
      SELECT lower(translate(COALESCE(t, ''),
        E'\\u0622\\u0623\\u0625\\u0671\\u0649\\u0626\\u0624\\u0629'
        || E'\\u0660\\u0661\\u0662\\u0663\\u0664\\u0665\\u0666\\u0667\\u0668\\u0669'
        || E'\\u06F0\\u06F1\\u06F2\\u06F3\\u06F4\\u06F5\\u06F6\\u06F7\\u06F8\\u06F9'
        || E'\\u064B\\u064C\\u064D\\u064E\\u064F\\u0650\\u0651\\u0652\\u0640\\u0670',
        E'\\u0627\\u0627\\u0627\\u0627\\u064A\\u064A\\u0648\\u0647'
        || '0123456789' || '0123456789'))
    $fn$
  `);

  // Core tables (users, orders) — historically created by drizzle-kit push, now
  // also created here so ensureSchema is self-sufficient on a fresh database.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      username text NOT NULL UNIQUE,
      password text NOT NULL,
      role text NOT NULL,
      worker_code text,
      suspended boolean NOT NULL DEFAULT false,
      created_at timestamp DEFAULT now()
    )
  `);
  // 🆕 رقم العامل لحساب الفني (يربطه ببياناته فى التقارير)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS worker_code text`);
  // 🆕 الاسم الظاهر (نفس «الاسم فى برنامج الكوابل») — يُستخدم أيضاً فى برنامج الصيانة عبر SSO
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name text`);
  // 🆕 نسخة نصية من الباسورد (للسوبر أدمن) — تُملأ عند الإنشاء/التغيير فقط
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_plain text`);
  // 🆕 البوابة الموحّدة: ربط حساب الطلبات بحساب الكوابل المقابل (للى عنده حساب فى الموقعين)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cfm_user_id varchar`);
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
  // تعيين (assign): الأدمن بيسند طلباً قيد الانتظار لفنى محدد
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_tech_id integer`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_tech_name text`);

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
  await pool.query(`ALTER TABLE phone_lines ADD COLUMN IF NOT EXISTS raw_data jsonb`);

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
  // close_category (Success/Fail) — لفصل الأوامر الفاشلة فى تقرير منفصل.
  // creation_date — لحساب «التركيبات المتخطية 24 ساعة» (زمن الإغلاق = close_date − creation_date).
  await pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS close_category text`);
  await pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS creation_date timestamptz`);
  await pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS msan_code text`);
  await pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS work_order_type_raw text`);
  await pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS raw_data jsonb`);

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

  // manual_faults — الأعطال «خارج الشاشة» اليدوية (زر «الخط به عطل» + انتظام)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS manual_faults (
      id serial PRIMARY KEY,
      full_phone text,
      phone_short text,
      account_no text,
      central text,
      cabin_number text,
      box_number text,
      msan_code text,
      tech_name text,
      status text NOT NULL DEFAULT 'open',
      flagged_at timestamptz NOT NULL DEFAULT now(),
      flagged_by text,
      regularized_at timestamptz,
      regularized_by text,
      close_code text
    );
    CREATE INDEX IF NOT EXISTS manual_faults_status_idx ON manual_faults (status, flagged_at);
    CREATE INDEX IF NOT EXISTS manual_faults_phone_idx ON manual_faults (phone_short);
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
  await pool.query(`ALTER TABLE phone_ports ADD COLUMN IF NOT EXISTS row_no text`);
  await pool.query(`ALTER TABLE phone_ports ADD COLUMN IF NOT EXISTS column_no text`);

  // box_fault_tickets — ربط كل تكت «بوكس معطل» اتفتحت تلقائياً بالطلب/المتعذر اللى
  // جات منه. بيمنع فتح تكت مرتين لنفس المصدر، وبيغذّى تقرير «تم إصلاحها» بعدين.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS box_fault_tickets (
      id serial PRIMARY KEY,
      source text NOT NULL,               -- 'طلبات' | 'OM'
      ref_key text NOT NULL,              -- رقم الطلب أو مسلسل المتعذر
      central_name text,
      cabin_number text,
      box_number text,
      tech_name text,
      responded_at timestamptz,           -- تاريخ رد الفنى (= تاريخ إنشاء التكت)
      ticket_id text,                     -- id التكت فى برنامج الكوابل
      ticket_number text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source, ref_key)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS box_fault_tickets_ticket_idx ON box_fault_tickets (ticket_id)`);

  // تكتات الكوابل (جدول tickets بتاع برنامج الكوابل — نفس قاعدة البيانات): خانة اسم
  // معروض بديل لـ «تم الفتح بواسطة»، بتتملى للتكتات اللى Service-Flow بيفتحها تلقائياً
  // بصيغة «اسم الفنى-المصدر» (اسلام-OM / اسلام-طلبات).
  await pool.query(`ALTER TABLE IF EXISTS tickets ADD COLUMN IF NOT EXISTS opened_by_label text`);

  // removed_phone_ports — «جدول الخطوط المرفوعة»: أى رقم كان له بورت واختفى من الشيت
  // الجديد يتنقل هنا ببياناته كاملة بدل ما يتمسح خالص. لو رجع فى شيت بعدين بيرجع
  // لـ phone_ports ويتشال من هنا — فالجدول ده معناه «المرفوعة حالياً».
  await pool.query(`
    CREATE TABLE IF NOT EXISTS removed_phone_ports (
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
      onu text,
      row_no text,
      column_no text,
      last_uploaded_at timestamptz,          -- آخر مرة كان فيها موجود فى الشيت
      removed_at timestamptz NOT NULL DEFAULT now(),
      removed_source text                     -- sheet (رفع يدوى) | portal (رفع تلقائى)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS removed_phone_ports_msan_idx ON removed_phone_ports (msan_code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS removed_phone_ports_at_idx ON removed_phone_ports (removed_at DESC)`);

  // port_change_requests — متابعة طلبات تغيير البورت من Provisioning Portal.
  // كل Request ID يُسجَّل مرة واحدة (PRIMARY KEY). completed=true → اتحدّث بيان البورت من النتيجة؛
  // false → طلب لسه/فشل (زى FAIL_TO_RESERVE) يتعرض فى تقرير المتابعة.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS port_change_requests (
      request_id text PRIMARY KEY,
      phone_number text,
      old_msan text,
      new_msan text,
      new_frame text,
      port_type text,
      status text,
      reservation_code text,
      request_date text,
      completed boolean NOT NULL DEFAULT false,
      recorded_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS port_change_requests_phone_idx ON port_change_requests (phone_number)`);
  // مين طلب تغيير/تحديث البورت — بيتاخد من op_intents وقت وصول نتيجة السكربت (زى القياس ورفع السرعة)
  await pool.query(`ALTER TABLE port_change_requests ADD COLUMN IF NOT EXISTS requested_by text`);

  // app_settings — إعدادات عامة مشتركة (key/value) تثبت على السيرفر لكل المستخدمين لحد ما تتغيّر.
  // تُستخدم مثلاً لقائمة «الكباين المغلقة بورتات» عشان اللى يدخلها يثبت للجميع (مش localStorage محلى).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key text PRIMARY KEY,
      value text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by text
    )
  `);

  // dp_inventory — قائمة البكسيات (DP) من Network Inventory (المصدر الرسمى لبكسيات تقارير التفتيش)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dp_inventory (
      id serial PRIMARY KEY,
      central text NOT NULL,
      mdf_code text,
      cabinet_no text NOT NULL,
      dp_no text NOT NULL,
      dp_type text,
      capacity integer,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id),
      UNIQUE (central, cabinet_no, dp_no)
    )
  `);

  // tech_coverage_grants — منح تغطية دائمة (grantee له حق التصرف فى خطوط covered)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tech_coverage_grants (
      id serial PRIMARY KEY,
      grantee_tech_name text NOT NULL,
      covered_tech_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by text,
      UNIQUE (grantee_tech_name, covered_tech_name)
    )
  `);

  // shift_schedules — جدول ورديات الفنيين الأسبوعى (صف لكل أسبوع/فنى، days = 7 قيم jsonb)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shift_schedules (
      id serial PRIMARY KEY,
      week_start date NOT NULL,
      tech_name text NOT NULL,
      days jsonb NOT NULL DEFAULT '[]'::jsonb,
      covers jsonb NOT NULL DEFAULT '[]'::jsonb,
      notes text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by text,
      UNIQUE (week_start, tech_name)
    )
  `);
  await pool.query(`ALTER TABLE shift_schedules ADD COLUMN IF NOT EXISTS covers jsonb NOT NULL DEFAULT '[]'::jsonb`);

  // line_mobiles — أرقام موبايل مُدخَلة يدوياً لكل خط
  await pool.query(`
    CREATE TABLE IF NOT EXISTS line_mobiles (
      full_phone text PRIMARY KEY,
      mobile text NOT NULL,
      updated_by_id integer REFERENCES users(id),
      updated_by_name text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // wfm_task_cancels — سجل إلغاء إسناد المهام على WFM: مين طلبه وإمتى وعلى أى رقم.
  // بيتملى من سكربت التامبر منكى بعد ما الإلغاء يتم فعلاً (نفس أسلوب تسجيل القياس/رفع السرعة).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wfm_task_cancels (
      id serial PRIMARY KEY,
      phone_number text NOT NULL,
      work_order_id text,
      assignment_status text,
      requested_by text,
      canceled_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS wfm_task_cancels_phone_idx ON wfm_task_cancels (phone_number)`);

  // app_state — key/value عام للحالة (مثلاً وقت اكتمال آخر تشغيل كامل لتحديث البورتات)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key text PRIMARY KEY,
      value text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // line_subscriber_info — اسم وعنوان العميل (+ تاريخ ورقم أمر الشغل) المجلوب من FCC Complains
  // لأرقام البورتات. الأرقام اللى ليها صف هنا لا تُجلب تانى إلا بعد "مراجعة الاسم والعنوان".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS line_subscriber_info (
      phone_number text PRIMARY KEY,
      sub_name text,
      sub_add text,
      work_ord_date text,
      work_ord_no text,
      fetched_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // بيانات فنية مجلوبة من FCC (لو الرقم مالوش بيانات فى الملف) — أعمدة تُضاف للجداول الموجودة
  for (const [col, typ] of [
    ["central", "text"], ["cabin_number", "text"], ["box_number", "text"], ["dp_terminal", "text"],
    ["port_no", "text"], ["idu_no", "text"], ["odu_no", "text"], ["primary_block", "text"],
    ["sec_block", "text"], ["cabinet_in", "text"], ["cabinet_out", "text"], ["fiber_block", "text"],
    ["fiber_out", "text"], ["line_type", "text"],
  ] as const) {
    await pool.query(`ALTER TABLE line_subscriber_info ADD COLUMN IF NOT EXISTS ${col} ${typ}`);
  }

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

  // cabinet_capacity — سعة الكباين النحاسية من FCC Network Inventory (full replace each upload).
  // المفتاح المنطقى (central_name, cabin_number) للربط بـ cabinet_technicians. secondary_capacity
  // هى "السعة" المطلوبة فى شيت خطة الصيانة.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cabinet_capacity (
      id serial PRIMARY KEY,
      central_name text,
      exch_code text,
      exch_name text,
      cabin_number text,
      cabinet_type text,
      primary_capacity integer,
      secondary_capacity integer,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      uploaded_by_id integer REFERENCES users(id)
    )
  `);

  // sf_session — جدول جلسات دائم (connect-pg-simple) عشان الجلسات تبقى بعد إعادة
  // تشغيل/سكون الخدمة على Replit (MemoryStore كان بيتمسح فيعمل تسجيل خروج).
  // يُنشأ هنا مسبقاً (قبل تهيئة الجلسة) فنستخدمه بـ createTableIfMissing:false.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "sf_session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "sf_session_pkey" PRIMARY KEY ("sid")
    );
    CREATE INDEX IF NOT EXISTS "IDX_sf_session_expire" ON "sf_session" ("expire");
  `);

  // exec_jobs — طابور تنفيذ رفع السرعة/القياس/الإيقاف على «جهاز التنفيذ» المركزى.
  // أى مستخدم يضيف مهمة (type + accounts)، وجهاز التنفيذ (سوبر أدمن مفعّل الزر) يستلمها وينفّذها.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exec_jobs (
      id serial PRIMARY KEY,
      type text NOT NULL,
      accounts jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      requested_by text,
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      claimed_at timestamptz,
      done_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS exec_jobs_status_idx ON exec_jobs (status, created_at);
    -- فحص «الباتش خلص؟» بيتنفّذ لكل مرشّح لإعادة التنفيذ — من غير الفهرس ده بيعمل
    -- مسح كامل للجدول (آلاف الصفوف) لكل صف، وده اللى بيخنق قاعدة البيانات.
    CREATE INDEX IF NOT EXISTS exec_jobs_batch_idx ON exec_jobs (batch_id);
    CREATE INDEX IF NOT EXISTS exec_jobs_retry_idx ON exec_jobs (status, result, retry_round, done_at);
    ALTER TABLE exec_jobs ADD COLUMN IF NOT EXISTS result text;
    ALTER TABLE exec_jobs ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;
    ALTER TABLE exec_jobs ADD COLUMN IF NOT EXISTS batch_id text;
    -- ترتيب يدوى داخل نفس الأولوية (السوبر أدمن يرتّب باتشات الأولوية المتأخرة). 0 = افتراضى (الأقدم).
    ALTER TABLE exec_jobs ADD COLUMN IF NOT EXISTS queue_order bigint NOT NULL DEFAULT 0;
    -- إيقاف مؤقت (سوبر أدمن) — جهاز التنفيذ يتخطّى المهام دى (claim) لحد ما تتلغى، فيكمّل التالى فى الترتيب فوراً.
    ALTER TABLE exec_jobs ADD COLUMN IF NOT EXISTS paused_at timestamptz;
    -- عدد مرات إعادة المحاولة: المهمة اللى بتعلق فى claimed (التاب اتقفل/التنفيذ فشل من غير /done)
    -- بترجع pending وتتعاد لحد 3 مرات، وبعدها تتعلّم stale بدل ما تفضل تتكرر للأبد.
    ALTER TABLE exec_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
    -- «الموقع» اللى المهمة بتشتغل عليه — الطابور بينفّذ مهمة واحدة لكل موقع فى نفس الوقت،
    -- والمواقع المختلفة بتشتغل بالتوازى (مثلاً قياس DZS مع مراجعة FCC مع بعض).
    ALTER TABLE exec_jobs ADD COLUMN IF NOT EXISTS site text NOT NULL DEFAULT '10.42.187.101';
    -- بيانات إضافية للمهمة (مش أرقام): مثلاً كود الكابينة القديم/الجديد ونوع البورت لمهمة
    -- «غيّر البورت» — جهاز التنفيذ بيبنى بيها لينك البوابة الصحيح.
    ALTER TABLE exec_jobs ADD COLUMN IF NOT EXISTS params jsonb;
    -- إعادة التنفيذ التلقائية للخطوط اللى رجعت بإيرور: المهمة الأصلية retry_round=0،
    -- وإعادة التنفيذ retry_round=1 — فمابنعيدش تانى لو رجعت بإيرور مرة كمان.
    -- retried_at = ختم إن المهمة دى اتعمِلها إعادة خلاص (يمنع التكرار كل دورة سحب).
    ALTER TABLE exec_jobs ADD COLUMN IF NOT EXISTS retry_round integer NOT NULL DEFAULT 0;
    ALTER TABLE exec_jobs ADD COLUMN IF NOT EXISTS retried_at timestamptz;
  `);
  // ضبط الموقع للمهام القديمة: الموقع بقى **اسم الدومين** نفسه (نفس الدومين = مسار واحد).
  await pool.query(`
    UPDATE exec_jobs SET site = CASE type
      WHEN 'subinfo' THEN 'fcc.te.eg'
      WHEN 'c360' THEN 'customer360.te.eg'
      WHEN 'portchange' THEN 'provisioningportal.te.eg'
      WHEN 'portcheck' THEN 'provisioningportal.te.eg'
      WHEN 'ports' THEN 'provisioningportal.te.eg'
      WHEN 'wfmcancel' THEN 'wfm.te.eg'
      WHEN 'wfmreport' THEN 'wfm.te.eg'
      WHEN 'wfmdaily' THEN 'wfm.te.eg'
      WHEN 'fccdaily' THEN 'fcc.te.eg'
      WHEN 'ossdaily' THEN 'oss.te.eg'
      WHEN 'weoas' THEN 'we-oas.te.eg'
      ELSE '10.42.187.101' END
    WHERE site IN ('dzs', 'fcc', 'c360', 'prov', 'wfm', 'oss', 'weoas')`);

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
  // 🆕 لو الجدول اتعمل قبل ما نضيف central_name (زى prod القديمة) — CREATE TABLE IF NOT EXISTS
  // مبيضيفوش، فلازم ALTER صريح عشان الـ daily-snapshot ميقعش بـ «column central_name does not exist».
  await pool.query(`ALTER TABLE regularized_daily ADD COLUMN IF NOT EXISTS central_name text`);
  await pool.query(`CREATE INDEX IF NOT EXISTS regularized_daily_cat_date_idx ON regularized_daily (category, snapshot_date)`);

  // فهارس أداء لتسريع تقرير «محتاجة رفع سرعة» وتقارير الأعطال (كانت بطيئة جداً بعد تراكم الداتا).
  // التقارير بتعمل subquery/LATERAL لكل خط فى case_138 والشكاوى — من غير الفهارس دى كل صف بيعمل scan كامل.
  // idempotent (IF NOT EXISTS) — بتتبنى مرة عند تشغيل السيرفر وبتفضل موجودة بعدها.
  await pool.query(`CREATE INDEX IF NOT EXISTS case_138_full_phone_id_idx ON case_138 (full_phone, id DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS complaint_details_phone_time_idx ON complaint_details (phone_number, complain_time DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS remaining_complaints_phone_time_idx ON remaining_complaints (phone_number, complain_time DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS phone_lines_tel_no_idx ON phone_lines (tel_no)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS phone_lines_central_cabin_box_idx ON phone_lines (central, cabin_number, box_number)`);

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

  // line_po_events — آخر وقت رفع سرعة (Start Realtime PO) وآخر وقت إيقاف PO (Stop Nightly PO)
  // لكل رقم أكونت. يُحدَّث من سكربت رفع السرعة عبر /api/po-events/ingest، ويظهر كعمودين فى تقارير القياس.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS line_po_events (
      account_no text PRIMARY KEY,
      last_raise_at timestamptz,
      last_stop_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // مين عمل آخر قياس/رفع سرعة/إيقاف: نسجّل «نيّة» المستخدم وقت الضغط (op_intents)، ولما النتيجة
  // ترجع (القياس على case_138، والأحداث على line_po_events) نختم اسم صاحب الطلب فى الأعمدة دى.
  await pool.query(`ALTER TABLE case_138 ADD COLUMN IF NOT EXISTS measured_by text`);
  await pool.query(`ALTER TABLE line_po_events ADD COLUMN IF NOT EXISTS last_raise_by text`);
  await pool.query(`ALTER TABLE line_po_events ADD COLUMN IF NOT EXISTS last_stop_by text`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS op_intents (
      account text NOT NULL,
      op_type text NOT NULL,
      username text,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account, op_type)
    )
  `);

  // رقم محمول يدوى لمتعذرات OM — للأرقام اللى بتظهر بنجوم (مشفّرة) نقدر ندخّلها يدوياً.
  // المفتاح = المسلسل (serial_number) المميّز لكل متعذر.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS om_manual_mobiles (
      serial_number text PRIMARY KEY,
      mobile text,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // om_responses — رد الفنى على متعذر OM (نفس دورة الطلبات: يمكن التنفيذ / لا يمكن + سبب،
  // ثم تحويل للشئون الخارجية وردّها). المفتاح رقم المسلسل عشان الرد يصمد بعد إعادة رفع ملف
  // المتعذرات (ftth_orders_current بيتستبدل كل رفعة) — نفس أسلوب om_manual_mobiles.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS om_responses (
      serial_number text PRIMARY KEY,
      status text NOT NULL DEFAULT 'pending',
      is_feasible boolean,
      rejection_reason text,
      central_name text,
      cabin_number text,
      box_number text,
      nearest_box_distance text,
      additional_notes text,
      tech_id integer,
      tech_name text,
      responded_at timestamptz,
      external_id integer,
      external_name text,
      is_feasible_external boolean,
      external_rejection_reason text,
      external_response_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // فهارس على الرقم المطبَّع — بتخلّى مطابقة الشكوى بالخط تستخدم index بدل seq scan
  // (من غيرها الـ LATERAL بتاع الشكاوى بيعلّق تقارير القياسات).
  // التعبير مضمَّن مش دالة مخصصة — عشان migration النشر بتاع Replit بيطبّق الفهرس على prod
  // قبل ما السيرفر يشتغل، فأى دالة بنعملها احنا مابتبقاش موجودة لسه وقتها.
  for (const [tbl, col] of [
    ["complaint_details", "phone_number"],
    ["remaining_complaints", "phone_number"],
    ["ticket_dsl_current", "phone_number"],
    ["manual_faults", "phone_short"],
    ["manual_faults", "full_phone"],
    ["line_subscriber_info", "phone_number"],
  ] as const) {
    try {
      // نشيل النسخة القديمة اللى كانت بتعتمد على sf_phone_norm() — هى سبب فشل النشر
      await pool.query(`DROP INDEX IF EXISTS ${tbl}_${col}_norm_idx`);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS ${tbl}_${col}_pnorm_idx ON ${tbl} ((${phoneNormSql(col)}))`,
      );
    } catch { /* الجدول لسه مش موجود أو الفهرس بيتعمل — نكمّل */ }
  }
  // الدالة القديمة بقت بلا استخدام بعد ما الفهارس اللى كانت بتعتمد عليها اتشالت
  try { await pool.query(`DROP FUNCTION IF EXISTS sf_phone_norm(text)`); } catch {}

  // ===== Cable-Fault-Manager (CFM) — جداول برنامج الكوابل المدمج =====
  // كل جداول CFM بأسماءها الأصلية عدا users → cfm_users (لتجنّب التعارض مع users بتاعنا).
  // كتلة واحدة داخل try عشان أى فشل مايوقفش باقى ensureSchema. الأنواع مطابقة لـ shared/schema.ts بتاع CFM.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cfm_users (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        username text NOT NULL UNIQUE,
        password text NOT NULL,
        name text NOT NULL,
        role text NOT NULL,
        avatar text,
        is_initial_password boolean DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS centrals (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name text NOT NULL,
        code text NOT NULL UNIQUE,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS cables (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        central_id varchar NOT NULL REFERENCES centrals(id) ON DELETE CASCADE,
        number text NOT NULL,
        cable_number text,
        cabinet_number text,
        type text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        UNIQUE (central_id, number)
      );
      CREATE TABLE IF NOT EXISTS fault_types (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name text NOT NULL,
        category text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS work_types (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name text NOT NULL,
        associated_materials jsonb,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS task_types (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS contractors (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS excavation_workers (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name text NOT NULL,
        national_id text NOT NULL UNIQUE,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        ticket_number text NOT NULL UNIQUE,
        central_department text NOT NULL,
        central_id varchar NOT NULL REFERENCES centrals(id),
        cable_id varchar NOT NULL REFERENCES cables(id),
        cabinet text NOT NULL,
        box text NOT NULL,
        fault_type_id varchar NOT NULL REFERENCES fault_types(id),
        notes text,
        latitude double precision,
        longitude double precision,
        status text NOT NULL DEFAULT 'open',
        final_repair_id varchar,
        final_repair_description text,
        final_repair_repaired_at timestamp,
        final_repair_repaired_by varchar,
        closed_at timestamp,
        closed_by text,
        created_by varchar NOT NULL REFERENCES cfm_users(id),
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS ticket_number_idx ON tickets (ticket_number);
      CREATE INDEX IF NOT EXISTS status_idx ON tickets (status);
      CREATE TABLE IF NOT EXISTS measurement_entries (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        ticket_id varchar NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        reading text NOT NULL,
        distance double precision,
        direction text,
        notes text,
        performed_by text,
        created_by varchar NOT NULL REFERENCES cfm_users(id),
        recorded_at timestamp NOT NULL DEFAULT now(),
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS work_entries (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        ticket_id varchar NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        measurement_id varchar REFERENCES measurement_entries(id) ON DELETE CASCADE,
        items json NOT NULL,
        notes text,
        performed_by text NOT NULL,
        works_by text,
        contractor_id varchar REFERENCES contractors(id),
        created_by varchar NOT NULL REFERENCES cfm_users(id),
        recorded_at timestamp NOT NULL DEFAULT now(),
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS used_task_entries (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        ticket_id varchar NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        measurement_id varchar REFERENCES measurement_entries(id) ON DELETE CASCADE,
        items json NOT NULL,
        notes text,
        performed_by text NOT NULL,
        created_by varchar NOT NULL REFERENCES cfm_users(id),
        recorded_at timestamp NOT NULL DEFAULT now(),
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS inventory_transactions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        type text NOT NULL,
        task_type_id varchar NOT NULL REFERENCES task_types(id),
        quantity integer NOT NULL,
        date timestamp NOT NULL,
        ticket_id varchar REFERENCES tickets(id) ON DELETE SET NULL,
        notes text,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);
    // إيقاف تنشيط حساب الكوابل (زى users.suspended فى الطلبات) — يمنع دخول الكوابل المباشر
    await pool.query(`ALTER TABLE cfm_users ADD COLUMN IF NOT EXISTS suspended boolean DEFAULT false`);
  } catch (e) {
    console.error("[ensureSchema] CFM tables error:", (e as Error).message);
  }
}
