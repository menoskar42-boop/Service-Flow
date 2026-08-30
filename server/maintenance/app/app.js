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
const SF_ROLE_TO_MAINT = {
  super_admin: "admin",
  admin: "admin",
  external: "inspector",
  tech: "technician",
  maintenance_tech: "technician",
};
app.use(async (req, res, next) => {
  try {
    if (!req.session.user && req.user && req.user.username) {
      const mrole = SF_ROLE_TO_MAINT[req.user.role];
      if (mrole) {
        // مهم: جداول الصيانة (inspections/maintenance_tasks/photos…) بتربط بـ users.id (integer FK).
        // فبنعمل upsert لصف حقيقى فى users بتاعت الصيانة ونستخدم الـ id الرقمى فى الجلسة — عشان
        // الكتابة تشتغل. الباسورد ماركر مش صالح للّوجين (الدخول عبر SSO فقط). SF هو مصدر الدور.
        const uname = String(req.user.username);
        // الاسم الظاهر: نفس «الاسم فى برنامج الكوابل» المخزّن فى users.full_name (fullName بالـ camelCase
        // من drizzle) → فيظهر فنى الصيانة باسمه الحقيقى فى برنامج الصيانة. fallback لاسم المستخدم.
        const fullName = req.user.fullName || req.user.full_name || req.user.name || uname;
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
