import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchTechnician, preferFullName, canonicalTechSql, techNorm } from "../shared/technicians";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const tab = readFileSync(
  new URL("../client/src/components/WorkOrdersNoCableEntry.tsx", import.meta.url), "utf8");

// ⛔ الباج: «حسن عبدالفتاح حموده» كان بيتحسب اسم **غير معروف** فالتقرير بيسمح بتغييره،
// مع إنه حسن — واحد من الخمسة. والمقارنة كانت حرفية مع technician_names.
test("every real name form of the five technicians resolves", () => {
  const cases: [string, string][] = [
    ["حسن", "حسن"], ["حسن عبد الفتاح حموده", "حسن"], ["حسن عبدالفتاح حموده", "حسن"],
    ["محمد", "محمد"], ["محمد عبدالمجيد محمد رشدى", "محمد"], ["محمد عبد المجيد", "محمد"],
    ["سامى", "سامى"], ["سامي", "سامى"], ["محمد عبدالعزيز طه احمد", "سامى"],
    ["اسلام", "اسلام"], ["اسلام عبدالعال هريدى حسن", "اسلام"], ["اسلام عبدالعال هريدى", "اسلام"],
    ["إسلام عبدالعال", "اسلام"],
    ["محمود يعقوب", "محمود يعقوب"], ["محمود احمد يعقوب", "محمود يعقوب"],
  ];
  for (const [raw, want] of cases) {
    assert.equal(matchTechnician(raw), want, `«${raw}» المفروض ترجع «${want}»`);
  }
});

// «سامى» و«محمد» الاتنين اسمهم بيبدأ بـ«محمد» — الترتيب لازم يحسمها صح.
test("the nickname case does not collide with the other محمد", () => {
  assert.equal(matchTechnician("محمد عبدالعزيز طه احمد"), "سامى");
  assert.equal(matchTechnician("محمد عبدالعزيز طه"), "سامى");
  assert.equal(matchTechnician("محمد"), "محمد");
  assert.equal(matchTechnician("محمد عبدالمجيد"), "محمد");
});

test("anything else stays unknown, so only those rows are editable", () => {
  for (const raw of ["عامل مقاول", "شخص مجهول", "", "م", "احمد على", "اسم غلط خالص"]) {
    assert.equal(matchTechnician(raw), null, `«${raw}» المفروض تفضل غير معروفة`);
  }
});

// الأسماء بتفضل **كاملة** فى العمود وفى الدروب ليست. جدول أسماء الفنيين بتاعهم هو
// المرجع؛ إحنا بس بنكمّل الاسم لو الجدول عنده المختصر («سامى» ← «محمد عبدالعزيز طه احمد»).
test("names stay full — the registry wins, we only complete a short one", () => {
  assert.equal(preferFullName("حسن عبد الفتاح يعقوب"), "حسن عبد الفتاح يعقوب");
  assert.equal(preferFullName("محمد عبد المجيد محمد رشدى"), "محمد عبد المجيد محمد رشدى");
  assert.equal(preferFullName("سامى"), "محمد عبدالعزيز طه احمد");
  assert.equal(preferFullName("محمود يعقوب"), "محمود احمد يعقوب");
  assert.equal(preferFullName("اسلام عبد العال هريدى"), "اسلام عبدالعال هريدى حسن");
  // اسم برّه الخمسة بيرجع زى ما هو
  assert.equal(preferFullName("عبد الرحمن أحمد سلمان محمد"), "عبد الرحمن أحمد سلمان محمد");
});

test("the column shows the sheet name as-is, never the short key", () => {
  const start = routes.indexOf('app.get("/api/reports/work-orders-no-cable"');
  const report = routes.slice(start, routes.indexOf('app.post("/api/reports/work-orders-no-cable/request-line-data"', start));
  assert.match(report, /\$\{effName\} AS "techName"/, "الاسم بيتعرض زى ما هو");
  assert.doesNotMatch(report, /COALESCE\(\$\{knownName\}, \$\{effName\}\) AS "techName"/,
    "مايتستبدلش بالاسم المختصر");
});

test("the dropdown is built from the registry and shown in full", () => {
  assert.match(tab, /import \{ preferFullName \} from "@shared\/technicians"/);
  assert.match(tab, /registry\.map\(\(t\) => preferFullName\(t\.techName\)\)/);
});

// حسن اسمه بصيغتين مختلفتين فى بياناتهم — الاتنين لازم يتعرفوا.
test("both recorded forms of حسن resolve to the same technician", () => {
  assert.equal(matchTechnician("حسن عبدالفتاح حموده"), "حسن");
  assert.equal(matchTechnician("حسن عبد الفتاح يعقوب"), "حسن");
});

// القاعدة #8: العمود الجديد لازم يبقى فى schema.ts و ensureSchema فى نفس الكوميت.
test("the worker code column exists in both the schema and ensureSchema", () => {
  const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
  assert.match(db, /ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS worker_code text/);
  assert.match(schema, /workerCode: text\("worker_code"\)/);
  // والاستيراد بيخزّنه فعلاً
  assert.match(routes, /const iWorker    = findCol\("worker code", "كود العامل"/);
  assert.match(routes, /worker_code = COALESCE\(NULLIF\(EXCLUDED\.worker_code, ''\), work_orders\.worker_code\)/);
});

test("the report resolves the technician by worker code first, then by name", () => {
  const start = routes.indexOf('app.get("/api/reports/work-orders-no-cable"');
  const end = routes.indexOf('app.post("/api/reports/work-orders-no-cable/request-line-data"', start);
  assert.ok(start >= 0 && end > start);
  const report = routes.slice(start, end);
  assert.match(report, /const byWorkerCode = `\(SELECT tn\.tech_name FROM technician_names tn/);
  assert.match(report, /const knownName = `COALESCE\(\$\{canonicalTechSql\(byWorkerCode\)\}, \$\{canonicalTechSql\(effName\)\}\)`/);
  assert.match(report, /AS "needsLineData"/);
});

// البيان الفنى بيتطلب **بس** لما اسم الفنى مش واحد من الخمسة.
test("technical data is only requested for rows whose technician is unknown", () => {
  assert.match(routes, /NOT \$\{isKnown\} AND NOT \(lm\.central IS NOT NULL AND lm\.cabin IS NOT NULL\)\) AS "needsLineData"/);
  const qStart = routes.indexOf("async function queueMissingLineDataSubinfo");
  const qEnd = routes.indexOf("function startMissingLineDataScheduler", qStart);
  const q = routes.slice(qStart, qEnd);
  assert.match(q, /canonicalTechSql\("w\.tech_name"\)\} IS NULL/);
  assert.match(q, /opts\?\.force/, "الزر اليدوى بيتخطّى مهلة الـ 4 ساعات");
});

test("the generated SQL keeps the same precedence as the JS matcher", () => {
  const sql = canonicalTechSql("x");
  const samy = techNorm("محمد عبدالعزيز طه احمد");
  const mohamed = techNorm("محمد");
  // الأطول لازم يظهر قبل الأقصر فى فروع التطابق التام
  assert.ok(sql.indexOf(samy) < sql.indexOf(`= '${mohamed}'`),
    "الاسم الأطول (سامى) لازم يتجرّب قبل «محمد»");
});
