import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// فنى إزالة الأعطال كان بياخد **نفس دور فنى الصيانة** فى برنامج الصيانة، فكان
// بيشوف كل مهام الصيانة (ارتفاع البكس، الغطاء، الخوصة…) وهى مش شغله أصلاً.
// بقى زى الشئون الخارجية (inspector)، وشغل مراجعة بيانات البكس اتفصل فى شاشة
// مستقلة /data-review مفلترة بكباينه هو.
//
// مُثبت end-to-end على سيرفر حقيقى بقاعدة بيانات حقيقية:
//   سامى (كابينة 1-8) → بوكس 11 بس | حسن (كابينة 2-1) → بوكس 22 بس | الأدمن → الاتنين
//   سامى يفتح بوكس حسن → بيترجّع للقائمة | POST رقم على بوكس حسن → 0 صف اتكتب
//   سامى يفتح /technician → 302 (مبقاش فنى صيانة)
//   وبعد «تمت المراجعة» البكس ظهر فى تقرير Service-Flow باسم سامى.
const app = readFileSync(new URL("./maintenance/app/app.js", import.meta.url), "utf8");
const dr = readFileSync(new URL("./maintenance/app/routes/data_review.js", import.meta.url), "utf8");
const shared = readFileSync(new URL("../shared/roles-access.ts", import.meta.url), "utf8");

test("a fault-removal tech is no longer a maintenance tech", () => {
  assert.match(app, /tech: "inspector",/);
  assert.match(shared, /tech: "inspector",/);
  // فنى الصيانة نفسه مااتغيّرش
  assert.match(app, /maintenance_tech: "technician",/);
  assert.match(shared, /maintenance_tech: "technician",/);
});

// من غير worker_code فى الجلسة الفلترة كانت بترجّع فاضية دايماً (اتصاد فى التجربة).
test("the maintenance session carries the worker code", () => {
  assert.match(app, /RETURNING id, username, role, full_name, worker_code/);
  assert.match(app, /worker_code: row\.worker_code \|\| null/);
});

test("the scope is the technician's own cabinets, and admin sees all", () => {
  assert.match(dr, /if \(user\.role === 'admin' \|\| user\.role === 'technician'\s*\n\s*\|\| SEES_ALL_SF_ROLES\.includes\(String\(user\.sf_role \|\| ''\)\)\)/);
  // مالوش كود عامل → مايشوفش حاجة (مش يشوف الكل)
  assert.match(dr, /if \(!code\) return \{ clause: ' AND 1 = 0', params: \[\] \}/);
  assert.match(dr, /FROM public\.cabinet_technicians ct/);
  // المطابقة موحّدة: «1/8» فى الصيانة = «1-8» فى جدول الفنيين
  assert.match(dr, /\$\{CENTRAL_N\('ct\.central_name'\)\} = \$\{CENTRAL_N\('e\.name'\)\}/);
  assert.match(dr, /\$\{CAB_N\('ct\.cabin_number'\)\} = \$\{CAB_N\('c\.number'\)\}/);
});

// الحماية على السيرفر مش فى الواجهة بس: كل كتابة بتعدّى على allowedTask الأول.
test("every write re-checks the scope server-side", () => {
  const chunks = dr.split("router.post(").slice(1);
  assert.ok(chunks.length >= 4, `expected the phone + done routes, found ${chunks.length}`);
  for (const c of chunks) {
    const name = c.slice(0, c.indexOf("'", 1) + 1);
    assert.match(c, /const task = await allowedTask\(req\.session\.user, req\.params\.id\);/,
      `${name} must re-check access`);
    assert.match(c, /if \(!task\) return res\.redirect\('\/data-review'\);/);
  }
  // والقراءة كمان — فتح بكس مش بتاعك بيرجّعك للقائمة
  assert.match(dr, /router\.get\('\/:id', requireLogin[\s\S]{0,200}?allowedTask\(req\.session\.user, req\.params\.id\)/);
});

test("finishing the review writes the same flag the Service-Flow report reads", () => {
  assert.match(dr, /INSERT INTO maintenance_item_status \(task_id, item_key, is_done, done_at, done_by\)\s*\n\s*VALUES \(\?, 'data_review', 1, now\(\), \?\)/);
  const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  assert.match(routes, /FROM maintenance\.maintenance_item_status mis/);
  assert.match(routes, /WHERE mis\.item_key = 'data_review'/);
});

test("data review is its own screen, separate from the maintenance tasks", () => {
  assert.match(app, /app\.use\("\/data-review", require\("\.\/routes\/data_review"\)\)/);
  const header = readFileSync(
    new URL("./maintenance/app/views/partials/header.ejs", import.meta.url), "utf8");
  assert.match(header, /href="\/data-review"/);
  // الشاشة دى مافيهاش أى بند من بنود الصيانة
  const detail = readFileSync(
    new URL("./maintenance/app/views/data_review/detail.ejs", import.meta.url), "utf8");
  for (const item of ["box_height", "box_cover", "connector_fix", "electricity_conflict"]) {
    assert.ok(!detail.includes(item), `the data-review screen must not show ${item}`);
  }
});

// الشئون الخارجية (ومنها مهندس الكوابل) بتشوف **كل** البكسيات المحتاجة مراجعة،
// والفنى كباينه بس — والاتنين بياخدوا نفس دور inspector فى الصيانة، فالتفرقة
// بـ sf_role (دور Service-Flow الأصلى) مش بدور الصيانة.
// مُثبت end-to-end: سامى (فنى) → بوكس 11 بس | مهندس الكوابل (external) → 11 و22.
test("external affairs reviews every box, the technician only their own", () => {
  assert.match(dr, /const SEES_ALL_SF_ROLES = \['external', 'super_admin', 'admin', 'maintenance_tech'\];/);
  // فنى الصيانة مالوش كباين فى cabinet_technicians، فلو اتفلتر بيها الشاشة تطلع فاضية
  assert.match(dr, /user\.role === 'technician'/);
  assert.match(app, /sf_role: req\.user\.role,/);
  const list = readFileSync(
    new URL("./maintenance/app/views/data_review/list.ejs", import.meta.url), "utf8");
  assert.match(list, /seesAll/);
  assert.match(dr, /seesAll: scope\.clause === ''/);
});

// مراجعة الأرقام مالهاش دعوة بدورة الصيانة (بدء العمل ← صورة بعد الصيانة ←
// إكمال ← موافقة المراقب). الفحص اللى اتفتح **تلقائياً** عشان المراجعة بس بيتقفل
// على طول، والفحص اللى عمله فاحص حقيقى بيكمّل دورته عادى.
// مُثبت end-to-end: بكس 11 (auto) → المهمة completed والبكس رجع pending_inspection.
//                   بكس 22 (فحص حقيقى فيه غطاء مكسور) → المهمة فضلت pending.
test("finishing a review closes an auto-created task on the spot", () => {
  assert.match(dr, /async function finishDataReview\(taskId, userId\)/);
  assert.match(dr, /if \(!insp \|\| !Number\(insp\.auto_created\)\) return \{ closed: false \};/,
    "a real inspection must never be closed by a data review");
  // ⚠️ تراجُع حقيقى: قفل مهمة **بدأ فيها** فنى الصيانة كان بيخفى زراير رفع الصور
  // (ظاهرة وقت in_progress بس) — فالفنى يصوّر قبل/بعد الصيانة والصور مش بتتضاف.
  assert.match(dr, /if \(String\(insp\.status\) !== 'pending'\) return \{ closed: false \};/,
    "a task the technician already started must stay open");
  assert.match(dr, /UPDATE maintenance_tasks SET status='completed', completed_at=now\(\)/);
  // ولو الفحص التلقائى فيه بند تانى محتاج شغل، المهمة مابتتقفلش
  assert.match(dr, /ii\.value IN \('bad','yes'\) AND ii\.item_key <> 'data_review'/);
  // البكس يرجع زى ما كان بس لو مافيش فحص حقيقى مفتوح عليه
  assert.match(dr, /COALESCE\(i2\.auto_created, 0\) = 0\s*\n\s*AND t2\.status <> 'completed'/);
  assert.match(dr, /UPDATE boxes SET status='pending_inspection'[\s\S]{0,80}?AND status = 'needs_maintenance'/);
});

// الطريقين (شاشة المراجعة وشاشة فنى الصيانة) لازم يتصرّفوا بنفس الطريقة.
test("both screens share one finish path", () => {
  const tech = readFileSync(
    new URL("./maintenance/app/routes/technician.js", import.meta.url), "utf8");
  assert.match(tech, /if \(req\.params\.itemKey === 'data_review'\)/);
  assert.match(tech, /const \{ finishDataReview \} = require\('\.\/data_review'\);/);
  assert.match(dr, /module\.exports\.finishDataReview = finishDataReview;/);
});

// زراير رفع الصور فى شاشة فنى الصيانة ظاهرة وقت in_progress بس — فأى حاجة بتقفل
// المهمة بتخفيها. الاختبار ده بيثبّت الربط عشان مايتكسرش تانى.
test("the photo uploader only exists while the task is in progress", () => {
  const detail = readFileSync(
    new URL("./maintenance/app/views/technician/detail.ejs", import.meta.url), "utf8");
  assert.match(detail, /<% if \(task\.status === 'in_progress'\) \{ %>\s*\n<script>/,
    "the uploader script is gated on in_progress");
  assert.match(detail, /رفع صور وفيديو بعد الصيانة/);
});

// فنى إزالة الأعطال شغله فى برنامج الصيانة هو مراجعة بيانات البكس بس — فبيفتح
// عليها على طول. باقى المستخدمين الافتراضى بتاعهم مااتغيّرش.
// مُثبت end-to-end على سيرفر حقيقى:
//   tech → /data-review | maintenance_tech → /technician
//   external / admin / super_admin → /boxes
test("the fault-removal technician lands on the data review screen", () => {
  const root = app.slice(app.indexOf('app.get("/", (req, res)'), app.indexOf('app.use((err'));
  assert.match(root, /if \(String\(req\.session\.user\.sf_role \|\| ""\) === "tech"\) return res\.redirect\("\/data-review"\);/);
  // الشرط بتاعه لازم ييجى **قبل** شرط دور الصيانة عشان مايتسبقش
  assert.ok(root.indexOf('"/data-review"') < root.indexOf('"/technician"'),
    "the tech rule must be checked before the maintenance-tech rule");
  // الافتراضى القديم زى ما هو
  assert.match(root, /if \(req\.session\.user\.role === "technician"\) return res\.redirect\("\/technician"\);/);
  assert.match(root, /return res\.redirect\("\/boxes"\);/);
});
