require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const path = require('path');
const DATA_DIR = require('./utils/datadir');

const fs = require('fs');
const db = require('./database');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/static', express.static(path.join(__dirname, 'static')));

// Serve uploads: filesystem first (multi-path fallback), then PostgreSQL BYTEA
const UPLOAD_CANDIDATES = [
  path.join(DATA_DIR, 'uploads'),
  path.join('/data', 'uploads'),
  path.join(__dirname, '.local_data', 'uploads'),
  path.join(__dirname, 'uploads'),
];
app.get('/uploads/:filename', async (req, res) => {
  const { filename } = req.params;
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).end();
  }
  for (const dir of UPLOAD_CANDIDATES) {
    const filepath = path.join(dir, filename);
    if (fs.existsSync(filepath)) return res.sendFile(filepath);
  }
  try {
    const photo = await db.get('SELECT data FROM photos WHERE filename = ?', [filename]);
    if (photo && photo.data) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      return res.send(photo.data);
    }
  } catch {}
  res.status(404).end();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Public JSON APIs (server-to-server, no session) — mounted before session middleware
// Integration router is mounted first (more specific prefix) so its own token
// middleware handles /api/integration/* instead of the generic /api token check.
app.use('/api/integration', require('./routes/integration'));
app.use('/api', require('./routes/api'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000 });

app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 },
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  if (req.session.flash) delete req.session.flash;
  next();
});

app.use('/auth', require('./routes/auth'));
app.use('/boxes', require('./routes/boxes'));
app.use('/inspector', require('./routes/inspector'));
app.use('/technician', require('./routes/technician'));
app.use('/reports/service-flow', require('./routes/service_flow'));
app.use('/reports', require('./routes/reports'));
app.use('/admin', require('./routes/admin'));

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  if (req.session.user.role === 'technician') return res.redirect('/technician');
  return res.redirect('/boxes');
});

// TEMP: insert missing boxes - remove after use
app.get('/admin-insert-missing-boxes-xK9mQ2', async (req, res) => {
  try {
    await db.run(`
      INSERT INTO boxes (cabinet_id, number, status)
      SELECT s.cabinet_id, s.n::TEXT, 'pending_inspection'
      FROM (
        WITH box_ranges AS (
          SELECT c.id AS cabinet_id,
                 MAX(CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END) AS max_num
          FROM cabinets c
          LEFT JOIN boxes b ON b.cabinet_id = c.id
          GROUP BY c.id
          HAVING MAX(CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END) > 0
        ),
        series AS (
          SELECT cabinet_id, generate_series(1, max_num) AS n FROM box_ranges
        ),
        existing AS (
          SELECT cabinet_id, number::INTEGER AS n FROM boxes WHERE number ~ '^[0-9]+$'
        )
        SELECT s.cabinet_id, s.n
        FROM series s
        LEFT JOIN existing ex ON ex.cabinet_id = s.cabinet_id AND ex.n = s.n
        WHERE ex.n IS NULL
      ) s
    `);
    const countRow = await db.get(`SELECT COUNT(*) as c FROM boxes WHERE status = 'pending_inspection'`);
    res.json({ success: true, message: 'تمت إضافة البكسيات الناقصة بنجاح', pending_boxes: countRow.c });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message, err.stack);
  if (res.headersSent) return next(err);
  res.status(500).render('error', { title: 'خطأ في الخادم', message: 'حدث خطأ غير متوقع. حاول مرة أخرى.' });
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'الصفحة غير موجودة', message: '404 - الصفحة التي تبحث عنها غير موجودة.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Server running at http://localhost:${PORT} — approval workflow active`);
});
