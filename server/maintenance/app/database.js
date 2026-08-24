const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// جداول الصيانة بتعيش فى **نفس قاعدة Service-Flow** (توفير الاستضافة) بس فى **سكيما منفصلة**
// اسمها maintenance — فمفيش تعارض مع جداول Service-Flow (زى users). بنضبط search_path على
// كل اتصال (عبر startup option) فالتطبيق يشتغل بأسماء الجداول العادية من غير تعديل استعلامات.
const MAINT_SCHEMA = (process.env.MAINTENANCE_DB_SCHEMA || 'maintenance').replace(/[^a-zA-Z0-9_]/g, '') || 'maintenance';
const pool = new Pool({
  connectionString: process.env.MAINTENANCE_DATABASE_URL || process.env.DATABASE_URL,
  options: `-c search_path=${MAINT_SCHEMA},public`,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (err) => {
  console.error('pg pool idle error (non-fatal):', err.message);
});
// احتياطى للـ search_path لو الـ startup option اتجاهل (بعض الـ poolers): نضبطه على كل اتصال جديد.
pool.on('connect', (client) => {
  client.query(`SET search_path TO ${MAINT_SCHEMA}, public`).catch(() => {});
});

function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ⚠️ مهم جداً مع Neon pooled endpoint (PgBouncer transaction pooling):
// الـ `SET search_path` على مستوى الجلسة (pool.on('connect')) **لا يبقى** بين الاستعلامات،
// لأن كل استعلام قد يقع على backend مختلف. فلازم نضبط الـ search_path داخل **نفس المعاملة**
// بتاعة كل استعلام عبر `SET LOCAL` — كده الاستعلام + الـ SET يشتغلوا على نفس الـ backend مضمون،
// وكل جداول الصيانة تتقرأ/تتكتب فى سكيما maintenance وليس public.
const SP_SQL = `SET LOCAL search_path TO ${MAINT_SCHEMA}, public`;

// ينفّذ استعلام واحد داخل معاملة صغيرة بعد ضبط search_path (SET LOCAL) — مضمون تحت أى وضع pooling.
async function sp(sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SP_SQL);
    const r = await client.query(sql, params);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

const db = {
  async all(sql, params = []) {
    const r = await sp(toPositional(sql), params);
    return r.rows;
  },
  async get(sql, params = []) {
    const r = await sp(toPositional(sql), params);
    return r.rows[0] || null;
  },
  async run(sql, params = []) {
    return sp(toPositional(sql), params);
  },
  async transaction(fn) {
    const client = await pool.connect();
    const q = (sql, params = []) => client.query(toPositional(sql), params);
    try {
      await client.query('BEGIN');
      await client.query(SP_SQL); // نفس الـ backend طوال المعاملة → search_path مضمون
      const result = await fn(q);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
};

// إنشاء كل جداول الصيانة (idempotent) — عشان التطبيق يبنى نفسه على أى قاعدة فاضية جديدة
// (بعد ما نلغى Repl الصيانة ونستخدم قاعدة مستقلة عبر MAINTENANCE_DATABASE_URL). منقول حرفياً
// من هيكل قاعدة الصيانة الأصلية (بـ SERIAL بدل sequences منفصلة). الترتيب حسب الـ FKs.
async function createSchema() {
  // كل الـ DDL يمر عبر sp() عشان الجداول تتخلق جوه سكيما maintenance مش public (مهم جداً مع الـ pooler).
  await sp(`CREATE SCHEMA IF NOT EXISTS ${MAINT_SCHEMA}`);
  await sp(`CREATE TABLE IF NOT EXISTS exchanges (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await sp(`CREATE TABLE IF NOT EXISTS cabinets (
    id SERIAL PRIMARY KEY,
    exchange_id INTEGER NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    UNIQUE(exchange_id, number)
  )`);
  await sp(`CREATE TABLE IF NOT EXISTS boxes (
    id SERIAL PRIMARY KEY,
    cabinet_id INTEGER NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_inspection'
      CHECK (status IN ('pending_inspection','inspected','needs_maintenance','in_progress','pending_approval','completed')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    latitude REAL,
    longitude REAL,
    UNIQUE(cabinet_id, number)
  )`);
  await sp(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','inspector','technician')),
    full_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    worker_code TEXT
  )`);
  await sp(`CREATE TABLE IF NOT EXISTS inspections (
    id SERIAL PRIMARY KEY,
    box_id INTEGER NOT NULL REFERENCES boxes(id),
    inspector_id INTEGER NOT NULL REFERENCES users(id),
    date DATE DEFAULT CURRENT_DATE,
    general_notes TEXT DEFAULT '',
    is_archived INTEGER DEFAULT 0,
    latitude REAL,
    longitude REAL
  )`);
  await sp(`CREATE TABLE IF NOT EXISTS inspection_items (
    id SERIAL PRIMARY KEY,
    inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('good_bad','yes_no')),
    value TEXT NOT NULL,
    notes TEXT DEFAULT '',
    extra_type TEXT,
    extra_distance REAL,
    UNIQUE(inspection_id, item_key)
  )`);
  await sp(`CREATE TABLE IF NOT EXISTS maintenance_tasks (
    id SERIAL PRIMARY KEY,
    inspection_id INTEGER NOT NULL REFERENCES inspections(id),
    technician_id INTEGER REFERENCES users(id),
    notes TEXT DEFAULT '',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','pending_approval','completed')),
    rejection_reason TEXT,
    prelim_confirmed_at TIMESTAMP,
    prelim_confirmed_by INTEGER
  )`);
  await sp(`CREATE TABLE IF NOT EXISTS maintenance_item_status (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    is_done INTEGER DEFAULT 0,
    done_at TIMESTAMPTZ,
    done_by INTEGER REFERENCES users(id),
    UNIQUE(task_id, item_key)
  )`);
  await sp(`CREATE TABLE IF NOT EXISTS photos (
    id SERIAL PRIMARY KEY,
    box_id INTEGER NOT NULL REFERENCES boxes(id),
    inspection_id INTEGER REFERENCES inspections(id),
    photo_type TEXT NOT NULL CHECK (photo_type IN ('before','after')),
    filename TEXT NOT NULL,
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TIMESTAMPTZ DEFAULT now(),
    taken_at TIMESTAMPTZ,
    latitude REAL,
    longitude REAL,
    data BYTEA,
    media_type TEXT DEFAULT 'photo'
  )`);
}

async function migrate() {
  try {
    await sp(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS data BYTEA`);
  } catch {}
  try { await sp(`ALTER TABLE boxes ADD COLUMN IF NOT EXISTS latitude REAL`); } catch {}
  try { await sp(`ALTER TABLE boxes ADD COLUMN IF NOT EXISTS longitude REAL`); } catch {}
  try { await sp(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS extra_type TEXT`); } catch {}
  try { await sp(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS extra_distance REAL`); } catch {}
  try { await sp(`ALTER TABLE inspections ALTER COLUMN date SET DEFAULT CURRENT_DATE`); } catch {}
  try { await sp(`UPDATE inspections SET date = CURRENT_DATE WHERE date IS NULL`); } catch {}
  try { await sp(`ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS rejection_reason TEXT`); } catch {}
  try { await sp(`ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS prelim_confirmed_at TIMESTAMP`); } catch {}
  try { await sp(`ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS prelim_confirmed_by INTEGER`); } catch {}
  try { await sp(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'photo'`); } catch {}
  try { await sp(`UPDATE photos SET media_type = 'photo' WHERE media_type IS NULL`); } catch {}
  try { await sp(`ALTER TABLE users ADD COLUMN IF NOT EXISTS worker_code TEXT`); } catch {}
  try { await sp(`UPDATE users SET worker_code = '180769' WHERE full_name ILIKE '%خالد عبد الرحمن%' AND worker_code IS NULL`); } catch {}

  // إضافة حالة 'pending_approval' لـ CHECK constraints (كانت ناقصة → زر «اكتملت المهمة» كان بيفشل
  // لأن الإكمال بيحوّل الحالة لـ pending_approval بانتظار تأكيد المراقب). idempotent: drop ثم add.
  try {
    await sp(`ALTER TABLE boxes DROP CONSTRAINT IF EXISTS boxes_status_check`);
    await sp(`ALTER TABLE boxes ADD CONSTRAINT boxes_status_check CHECK (status IN ('pending_inspection','inspected','needs_maintenance','in_progress','pending_approval','completed'))`);
  } catch {}
  try {
    await sp(`ALTER TABLE maintenance_tasks DROP CONSTRAINT IF EXISTS maintenance_tasks_status_check`);
    await sp(`ALTER TABLE maintenance_tasks ADD CONSTRAINT maintenance_tasks_status_check CHECK (status IN ('pending','in_progress','pending_approval','completed'))`);
  } catch {}

  // cabinet_codes lookup table (Exchange + Cabinet → cabinet code + technician info)
  try {
    await sp(`
      CREATE TABLE IF NOT EXISTS cabinet_codes (
        id              SERIAL PRIMARY KEY,
        exchange_name   TEXT NOT NULL,
        cabinet_number  TEXT NOT NULL,
        exchange_code   TEXT,
        decent_life     TEXT,
        area_technician TEXT,
        worker_code     TEXT,
        cabinet_code    TEXT,
        UNIQUE(exchange_name, cabinet_number)
      )
    `);
  } catch {}
  try {
    const { rows: cc } = await sp('SELECT COUNT(*) AS c FROM cabinet_codes');
    if (parseInt(cc[0].c) === 0) {
      const cabData = [
        ['الغنايم','1-8','GHNAT','خارج حياه كريمه','اسلام عبد العال هريدى','347817','11-2-26-24'],
        ['الغنايم','2-1','GHNAT','خارج حياه كريمه','اسلام عبد العال هريدى','347817','11-2-26-118'],
        ['الغنايم','2-2','GHNAT','خارج حياه كريمه','اسلام عبد العال هريدى','347817','11-2-26-119'],
        ['الغنايم','2-3','GHNAT','خارج حياه كريمه','اسلام عبد العال هريدى','347817','11-2-26-119'],
        ['الغنايم','2-4','GHNAT','خارج حياه كريمه','اسلام عبد العال هريدى','347817','11-2-26-120'],
        ['الغنايم','2-5','GHNAT','خارج حياه كريمه','اسلام عبد العال هريدى','347817','11-2-26-120'],
        ['الغنايم','2-6','GHNAT','خارج حياه كريمه','اسلام عبد العال هريدى','347817','11-2-26-121'],
        ['الغنايم','2-7','GHNAT','خارج حياه كريمه','اسلام عبد العال هريدى','347817','11-2-26-121'],
        ['الغنايم','2-8','GHNAT','خارج حياه كريمه','اسلام عبد العال هريدى','347817','11-2-26-24'],
        ['الغنايم','3-1','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-07'],
        ['الغنايم','3-2','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-07'],
        ['الغنايم','3-3','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-07'],
        ['الغنايم','3-4','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-07'],
        ['الغنايم','3-5','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-08'],
        ['الغنايم','3-6','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-08'],
        ['الغنايم','3-7','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-08'],
        ['الغنايم','3-8','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-08'],
        ['الغنايم','4-1','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-10'],
        ['الغنايم','4-2','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-10'],
        ['الغنايم','4-3','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-11'],
        ['الغنايم','4-4','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-11'],
        ['الغنايم','4-5','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-12'],
        ['الغنايم','4-6','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-12'],
        ['الغنايم','4-7','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-13'],
        ['الغنايم','4-8','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-13'],
        ['الغنايم','5-1','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-114'],
        ['الغنايم','5-2','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-114'],
        ['الغنايم','5-3','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-15'],
        ['الغنايم','5-4','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-15'],
        ['الغنايم','5-5','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-15'],
        ['الغنايم','5-6','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-115'],
        ['الغنايم','5-7','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-115'],
        ['الغنايم','5-8','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-16'],
        ['الغنايم','6-1','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-116'],
        ['الغنايم','6-2','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-117'],
        ['الغنايم','6-3','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-117'],
        ['الغنايم','6-4','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-16'],
        ['الغنايم','6-5','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-21'],
        ['الغنايم','6-6','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-21'],
        ['الغنايم','6-7','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-16'],
        ['الغنايم','7-1','GHNAT','خارج حياه كريمه','اسلام عبد العال هريدى','347817','11-2-26-102'],
        ['الغنايم','7-2','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-18'],
        ['الغنايم','7-3','GHNAT','خارج حياه كريمه','حسن عبد الفتاح يعقوب','213192','11-2-26-06'],
        ['الغنايم','8-1','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-19'],
        ['الغنايم','8-2','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-05'],
        ['الغنايم','8-3','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-20'],
        ['الغنايم','8-4','GHNAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-25'],
        ['الغنايم-العزايزة','sheltr','AMZAT','خارج حياه كريمه','اسلام عبد العال هريدى','347817','11-2-26-01'],
        ['الغنايم-دير الجنادله','1-1','DRGAT','خارج حياه كريمه','محمود يعقوب','332590','11-2-227-23'],
        ['الغنايم-دير الجنادله','1-2','DRGAT','خارج حياه كريمه','سامى','188898','11-2-227-21'],
        ['الغنايم-دير الجنادله','2-1','DRGAT','خارج حياه كريمه','سامى','188898','11-2-227-22'],
        ['الغنايم-دير الجنادله','2-2','DRGAT','خارج حياه كريمه','سامى','188898','11-2-227-20'],
        ['الغنايم-دير الجنادله','3-1','DRGAT','خارج حياه كريمه','محمود يعقوب','332590','11-2-227-01'],
        ['الغنايم-دير الجنادله','3-2','DRGAT','خارج حياه كريمه','محمود يعقوب','332590','11-2-227-01'],
        ['الغنايم-نجع العمدة','shlter','NGOAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-26-26'],
      ];
      for (const [en, cn, ec, dl, at, wc, cc_val] of cabData) {
        await sp(
          `INSERT INTO cabinet_codes(exchange_name,cabinet_number,exchange_code,decent_life,area_technician,worker_code,cabinet_code)
           VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [en, cn, ec, dl, at, wc, cc_val]
        );
      }
      console.log('✓ Seeded cabinet_codes (55 rows)');
    }
  } catch (e) { console.error('cabinet_codes seed error:', e.message); }
}

async function initialize() {
  const row = await db.get('SELECT COUNT(*) as c FROM users');
  if (parseInt(row.c) > 0) return;
  const users = [
    { username: 'admin',      password: 'admin',      role: 'admin',      full_name: 'مدير النظام' },
    { username: 'inspector',  password: 'inspector',  role: 'inspector',  full_name: 'مراقب الشؤون الخارجية' },
    { username: 'technician', password: 'technician', role: 'technician', full_name: 'فني الصيانة' },
  ];
  for (const u of users) {
    const hash = bcrypt.hashSync(u.password, 10);
    await db.run('INSERT INTO users (username,password,role,full_name) VALUES (?,?,?,?)', [u.username, hash, u.role, u.full_name]);
  }
  console.log('✓ Seeded 3 test users');
}

// إنشاء الجداول أولاً (لو القاعدة فاضية جديدة) ثم الترقيات ثم البيانات الأولية.
(async () => {
  try {
    await createSchema();
    await migrate();
    await initialize();
  } catch (e) { console.error('[maintenance] db init error:', e.message); }
})();

module.exports = db;
module.exports.MAINT_SCHEMA = MAINT_SCHEMA;
