const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (err) => {
  console.error('pg pool idle error (non-fatal):', err.message);
});

function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
  async all(sql, params = []) {
    const r = await pool.query(toPositional(sql), params);
    return r.rows;
  },
  async get(sql, params = []) {
    const r = await pool.query(toPositional(sql), params);
    return r.rows[0] || null;
  },
  async run(sql, params = []) {
    return pool.query(toPositional(sql), params);
  },
  async transaction(fn) {
    const client = await pool.connect();
    const q = (sql, params = []) => client.query(toPositional(sql), params);
    try {
      await client.query('BEGIN');
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

async function migrate() {
  try {
    await pool.query(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS data BYTEA`);
  } catch {}
  try { await pool.query(`ALTER TABLE boxes ADD COLUMN IF NOT EXISTS latitude REAL`); } catch {}
  try { await pool.query(`ALTER TABLE boxes ADD COLUMN IF NOT EXISTS longitude REAL`); } catch {}
  try { await pool.query(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS extra_type TEXT`); } catch {}
  try { await pool.query(`ALTER TABLE inspection_items ADD COLUMN IF NOT EXISTS extra_distance REAL`); } catch {}
  try { await pool.query(`ALTER TABLE inspections ALTER COLUMN date SET DEFAULT CURRENT_DATE`); } catch {}
  try { await pool.query(`UPDATE inspections SET date = CURRENT_DATE WHERE date IS NULL`); } catch {}
  try { await pool.query(`ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS rejection_reason TEXT`); } catch {}
  try { await pool.query(`ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS prelim_confirmed_at TIMESTAMP`); } catch {}
  try { await pool.query(`ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS prelim_confirmed_by INTEGER`); } catch {}
  try { await pool.query(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'photo'`); } catch {}
  try { await pool.query(`UPDATE photos SET media_type = 'photo' WHERE media_type IS NULL`); } catch {}
  try { await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS worker_code TEXT`); } catch {}
  try { await pool.query(`UPDATE users SET worker_code = '180769' WHERE full_name ILIKE '%خالد عبد الرحمن%' AND worker_code IS NULL`); } catch {}

  // cabinet_codes lookup table (Exchange + Cabinet → cabinet code + technician info)
  try {
    await pool.query(`
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
    const { rows: cc } = await pool.query('SELECT COUNT(*) AS c FROM cabinet_codes');
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
        ['الغنايم-نجع العمدة','shlter','NGOAT','خارج حياه كريمه','محمد عبد المجيد محمد رشدى','222081','11-2-76-01'],
      ];
      for (const [en, cn, ec, dl, at, wc, cc_val] of cabData) {
        await pool.query(
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

migrate().catch(console.error);
initialize().catch(console.error);

module.exports = db;
