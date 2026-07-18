// نسخة مدمجة من تطبيق «smart-box-maintenance» — تُصدَّر كـ Express app عشان يتركّب تحت
// مسار /maintenance جوّه سيرفر Service-Flow (بدل ما يكون تطبيق منفصل).
// الفروق عن server.js الأصلى:
//   - شِلنا dotenv و app.listen (السيرفر الأساسى هو اللى بيسمع على البورت).
//   - الـ DB من MAINTENANCE_DATABASE_URL (قاعدة بيانات الصيانة المنفصلة) — عشان جدول users
//     وغيره مايتعارضش مع جداول Service-Flow.
//   - طبقة base-path عشان الروابط/التحويلات تشتغل تحت البادئة من غير تعديل القوالب.
//   - اسم كوكى جلسة مستقل (maint.sid) ومسارها /maintenance عشان ماتصادمش جلسة Service-Flow.
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");
const DATA_DIR = require("./utils/datadir");
const db = require("./database");
const basePath = require("./basepath");

const BASE_PATH = (process.env.MAINTENANCE_BASE_PATH || "/maintenance").replace(/\/+$/, "");
const MAINT_DB_URL = process.env.MAINTENANCE_DATABASE_URL || process.env.DATABASE_URL;
const MAINT_SCHEMA = db.MAINT_SCHEMA || "maintenance"; // نفس سكيما الصيانة المستخدمة فى database.js

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// طبقة البادئة أولاً — عشان تلفّ res.redirect/res.send قبل أى راوت.
app.use(basePath(BASE_PATH));
app.locals.base = BASE_PATH;

app.use("/static", express.static(path.join(__dirname, "static")));

// خدمة الصور: من الملفات (مسارات احتياطية) ثم من عمود BYTEA فى PostgreSQL.
const UPLOAD_CANDIDATES = [
  path.join(DATA_DIR, "uploads"),
  path.join("/data", "uploads"),
  path.join(__dirname, ".local_data", "uploads"),
  path.join(__dirname, "uploads"),
];
app.get("/uploads/:filename", async (req, res) => {
  const { filename } = req.params;
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return res.status(400).end();
  }
  for (const dir of UPLOAD_CANDIDATES) {
    const filepath = path.join(dir, filename);
    if (fs.existsSync(filepath)) return res.sendFile(filepath);
  }
  try {
    const photo = await db.get("SELECT data FROM photos WHERE filename = ?", [filename]);
    if (photo && photo.data) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000");
      return res.send(photo.data);
    }
  } catch (e) { /* تجاهل */ }
  res.status(404).end();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// APIs عامة (server-to-server، من غير جلسة) — قبل الـ session.
app.use("/api/integration", require("./routes/integration"));
app.use("/api", require("./routes/api"));

const pool = new Pool({ connectionString: MAINT_DB_URL, options: `-c search_path=${MAINT_SCHEMA},public`, max: 3, connectionTimeoutMillis: 5000 });
pool.on("connect", (client) => { client.query(`SET search_path TO ${MAINT_SCHEMA}, public`).catch(() => {}); });

app.use(session({
  name: "maint.sid", // اسم مستقل عن جلسة Service-Flow
  store: new pgSession({ pool, schemaName: MAINT_SCHEMA, createTableIfMissing: true }),
  secret: process.env.MAINTENANCE_SESSION_SECRET || process.env.SESSION_SECRET || "maint-dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { path: BASE_PATH || "/", maxAge: 8 * 60 * 60 * 1000 },
}));

// SSO موحّد: تطبيق الصيانة مركّب جوّه سيرفر Service-Flow، والـ passport بتاعه بيملأ req.user
// (مستخدم الطلبات) قبل ما نوصل هنا. لو مفيش جلسة صيانة والمستخدم داخل Service-Flow بدور له وصول
// للصيانة → نسجّله تلقائياً بالدور المقابل (من غير شاشة لوجين تانية ولا حساب فى قاعدة الصيانة).
// نفس مفاتيح shared/roles-access.ts (SF_ROLE_TO_MAINT) — مكرّرة هنا لأن ده ملف CJS مستقل.
const SF_ROLE_TO_MAINT = { super_admin: "admin", admin: "admin", external: "inspector", maintenance_tech: "technician" };
app.use(async (req, res, next) => {
  try {
    if (!req.session.user && req.user && req.user.username) {
      const mrole = SF_ROLE_TO_MAINT[req.user.role];
      if (mrole) {
        // مهم: جداول الصيانة (inspections/maintenance_tasks/photos…) بتربط بـ users.id (integer FK).
        // فبنعمل upsert لصف حقيقى فى users بتاعت الصيانة ونستخدم الـ id الرقمى فى الجلسة — عشان
        // الكتابة تشتغل. الباسورد ماركر مش صالح للّوجين (الدخول عبر SSO فقط). SF هو مصدر الدور.
        const uname = String(req.user.username);
        const fullName = req.user.name || req.user.full_name || uname;
        const workerCode = req.user.worker_code || req.user.workerCode || null;
        const row = await db.get(
          `INSERT INTO users (username, password, role, full_name, worker_code, is_active)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT (username) DO UPDATE SET
             role = EXCLUDED.role,
             full_name = EXCLUDED.full_name,
             worker_code = COALESCE(EXCLUDED.worker_code, users.worker_code)
           RETURNING id, username, role, full_name`,
          [uname, "sso:" + uname, mrole, fullName, workerCode],
        );
        if (row && row.id != null) {
          req.session.user = { id: row.id, username: row.username, full_name: row.full_name, role: row.role, sso: true };
        }
      }
    }
  } catch (e) { console.error("[maintenance] SSO upsert failed:", e.message); }
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  if (req.session.flash) delete req.session.flash;
  next();
});

// endpoint تشخيصى مؤقت: يقول قاعدة أنهى التطبيق المنشور بيقرأها فعلاً وكام بوكس فيها —
// عشان نميّز هل المشكلة search_path ولا إن الميجريشن اتعمل على dev DB والمنشور على prod DB.
// متاح لأى مستخدم داخل الصيانة فقط (لا يكشف غير أعداد صفوف). يتشال بعد ما نحل المشكلة.
app.get("/__whoami", async (req, res) => {
  if (!req.session.user) return res.status(404).end();
  const out = { schema: MAINT_SCHEMA };
  try {
    const info = await db.get("SELECT current_database() AS db, current_user AS usr, current_setting('search_path') AS sp");
    out.current_database = info.db; out.current_user = info.usr; out.search_path = info.sp;
  } catch (e) { out.info_error = e.message; }
  try { out.maintenance_boxes_qualified = (await db.get("SELECT count(*)::int AS n FROM maintenance.boxes")).n; }
  catch (e) { out.maintenance_boxes_qualified = "ERR: " + e.message; }
  try { out.boxes_via_search_path = (await db.get("SELECT count(*)::int AS n FROM boxes")).n; }
  catch (e) { out.boxes_via_search_path = "ERR: " + e.message; }
  try { out.public_boxes = (await db.get("SELECT count(*)::int AS n FROM public.boxes")).n; }
  catch (e) { out.public_boxes = "ERR: " + e.message; }
  res.json(out);
});

// ===== endpoint استيراد مؤقت: ينسخ بيانات الصيانة من قاعدة المصدر (الصيانة القديمة) إلى
// قاعدة التطبيق الحالية (= prod لما يتنفّذ على الموقع المنشور). idempotent وresumable:
// كل الصفوف INSERT ... ON CONFLICT (id) DO NOTHING بنفس الـ id، والصور تُستأنف من آخر id.
// المصدر يُقرأ من Secret اسمه MAINTENANCE_MIGRATE_SOURCE (مايتكتبش فى الكود إطلاقاً).
// متاح لمدير الصيانة فقط. يتشال بعد نجاح النقل. =====
const MIGRATE_TABLES = [
  { t: "exchanges",               cols: ["id","name","created_at"] },
  { t: "cabinets",                cols: ["id","exchange_id","number"] },
  { t: "boxes",                   cols: ["id","cabinet_id","number","status","created_at","updated_at","latitude","longitude"] },
  { t: "users",                   cols: ["id","username","password","role","full_name","email","is_active","created_at","worker_code"] },
  { t: "inspections",             cols: ["id","box_id","inspector_id","date","general_notes","is_archived","latitude","longitude"] },
  { t: "inspection_items",        cols: ["id","inspection_id","item_key","item_type","value","notes","extra_type","extra_distance"] },
  { t: "maintenance_tasks",       cols: ["id","inspection_id","technician_id","notes","started_at","completed_at","status","rejection_reason","prelim_confirmed_at","prelim_confirmed_by"] },
  { t: "maintenance_item_status", cols: ["id","task_id","item_key","is_done","done_at","done_by"] },
];

app.get("/__import", async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") return res.status(404).end();
  const SRC = process.env.MAINTENANCE_MIGRATE_SOURCE;
  if (!SRC) return res.status(400).json({ error: "ضع Secret اسمه MAINTENANCE_MIGRATE_SOURCE = رابط قاعدة الصيانة القديمة، ثم Republish وأعد فتح هذا الرابط." });
  const srcPool = new Pool({ connectionString: SRC, max: 2, connectionTimeoutMillis: 15000 });
  const out = { tables: {}, photos: {} };
  const qmark = (n) => Array.from({ length: n }, () => "?").join(",");
  try {
    // الجداول الخفيفة (بترتيب الـ FKs) — تُنسخ بالكامل فى دفعات.
    for (const { t, cols } of MIGRATE_TABLES) {
      try {
        const srcRows = (await srcPool.query(`SELECT ${cols.join(",")} FROM public.${t}`)).rows;
        const BATCH = 500;
        for (let i = 0; i < srcRows.length; i += BATCH) {
          const chunk = srcRows.slice(i, i + BATCH);
          const vals = [];
          const ph = chunk.map((r) => { cols.forEach((c) => vals.push(r[c])); return `(${qmark(cols.length)})`; }).join(",");
          await db.run(`INSERT INTO ${MAINT_SCHEMA}.${t} (${cols.join(",")}) VALUES ${ph} ON CONFLICT (id) DO NOTHING`, vals);
        }
        out.tables[t] = { source: srcRows.length, target: (await db.get(`SELECT count(*)::int AS n FROM ${MAINT_SCHEMA}.${t}`)).n };
      } catch (e) { out.tables[t] = { error: e.message }; }
    }
    // الصور (BYTEA ثقيلة) — تُنسخ مستأنفة من آخر id فى الهدف، بحد أقصى للطلب الواحد لتفادى الـ timeout.
    const pcols = ["id","box_id","inspection_id","photo_type","filename","uploaded_by","uploaded_at","taken_at","latitude","longitude","data","media_type"];
    const srcTotal = (await srcPool.query(`SELECT count(*)::int AS n FROM public.photos`)).rows[0].n;
    let lastId = (await db.get(`SELECT COALESCE(MAX(id),0)::int AS n FROM ${MAINT_SCHEMA}.photos`)).n;
    let copiedNow = 0; const CAP = 500;
    while (copiedNow < CAP) {
      const rows = (await srcPool.query(`SELECT ${pcols.join(",")} FROM public.photos WHERE id > $1 ORDER BY id LIMIT 25`, [lastId])).rows;
      if (!rows.length) break;
      const vals = [];
      const ph = rows.map((r) => { pcols.forEach((c) => vals.push(r[c])); return `(${qmark(pcols.length)})`; }).join(",");
      await db.run(`INSERT INTO ${MAINT_SCHEMA}.photos (${pcols.join(",")}) VALUES ${ph} ON CONFLICT (id) DO NOTHING`, vals);
      lastId = rows[rows.length - 1].id; copiedNow += rows.length;
    }
    const tgtPhotos = (await db.get(`SELECT count(*)::int AS n FROM ${MAINT_SCHEMA}.photos`)).n;
    out.photos = { source: srcTotal, target: tgtPhotos, remaining: Math.max(0, srcTotal - tgtPhotos), copiedThisRun: copiedNow };
    // ضبط الـ sequences بعد الإدخال بأرقام صريحة.
    for (const { t } of MIGRATE_TABLES.concat([{ t: "photos" }])) {
      try { await db.run(`SELECT setval(pg_get_serial_sequence('${MAINT_SCHEMA}.${t}','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM ${MAINT_SCHEMA}.${t}),1))`); } catch {}
    }
    out.done = out.photos.remaining === 0;
    out.note = out.done ? "اكتمل النقل. افتح /maintenance/boxes للتأكد ثم احذف Secret واطلب إزالة الـ endpoints."
                        : "باقى صور — أعد فتح نفس الرابط لاستئناف نسخ باقى الصور.";
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message, partial: out });
  } finally {
    try { await srcPool.end(); } catch {}
  }
});

app.use("/auth", require("./routes/auth"));
app.use("/boxes", require("./routes/boxes"));
app.use("/inspector", require("./routes/inspector"));
app.use("/technician", require("./routes/technician"));
app.use("/reports/service-flow", require("./routes/service_flow"));
app.use("/reports", require("./routes/reports"));
app.use("/admin", require("./routes/admin"));

app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/auth/login");
  if (req.session.user.role === "technician") return res.redirect("/technician");
  return res.redirect("/boxes");
});

app.use((err, req, res, next) => {
  console.error("[maintenance] Unhandled error:", err.message, err.stack);
  if (res.headersSent) return next(err);
  res.status(500).render("error", { title: "خطأ في الخادم", message: "حدث خطأ غير متوقع. حاول مرة أخرى." });
});

app.use((req, res) => {
  res.status(404).render("error", { title: "الصفحة غير موجودة", message: "404 - الصفحة التي تبحث عنها غير موجودة." });
});

module.exports = app;
