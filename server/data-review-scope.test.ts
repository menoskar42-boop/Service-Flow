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
  assert.match(dr, /if \(user\.role === 'admin'\) return \{ clause: '', params: \[\] \}/);
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
