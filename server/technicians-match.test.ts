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

// الأسماء بتفضل **كاملة**، والمرجع هو **ملف أوامر الشغل** — فأى صيغة تانية للاسم
// بتترجم للاسم المعتمد، والشخص الواحد بيتعرض بنفس الاسم فى كل مكان.
test("every form of a technician displays as the one approved full name", () => {
  // جدول أسماء الفنيين مكتوب فيه «يعقوب»، وملف أوامر الشغل «حموده» — التانى هو الصح
  assert.equal(preferFullName("حسن عبد الفتاح يعقوب"), "حسن عبد الفتاح حموده");
  assert.equal(preferFullName("حسن عبدالفتاح حموده"), "حسن عبد الفتاح حموده");
  assert.equal(preferFullName("حسن"), "حسن عبد الفتاح حموده");
  assert.equal(preferFullName("سامى"), "محمد عبدالعزيز طه احمد");
  assert.equal(preferFullName("محمود يعقوب"), "محمود احمد يعقوب");
  assert.equal(preferFullName("اسلام عبد العال هريدى"), "اسلام عبدالعال هريدى حسن");
  assert.equal(preferFullName("محمد عبد المجيد محمد رشدى"), "محمد عبدالمجيد محمد رشدى");
  // اسم برّه الخمسة بيرجع زى ما هو — الأسماء الغريبة مابتتلمسش
  assert.equal(preferFullName("عبد الرحمن أحمد سلمان محمد"), "عبد الرحمن أحمد سلمان محمد");
  assert.equal(preferFullName("عامل مقاول"), "عامل مقاول");
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

// ── الاسم المختصر ولا الكامل؟ كل واحد فى مكانه ────────────────────────────────
// الأعطال والمتعذرات بتعرض «سامى»، وأوامر الشغل واستكمال البيانات بتعرض
// «محمد عبدالعزيز طه احمد». نفس الشخص، سياقين مختلفين.
test("short name for faults, full name for work orders", async () => {
  const { shortNameOf, preferFullName } = await import("../shared/technicians");
  assert.equal(shortNameOf("محمد عبدالعزيز طه احمد"), "سامى");
  assert.equal(preferFullName("سامى"), "محمد عبدالعزيز طه احمد");
  assert.equal(shortNameOf("حسن عبدالفتاح حموده"), "حسن");
  assert.equal(preferFullName("حسن"), "حسن عبد الفتاح حموده");
  // اسم برّه الخمسة بيعدّى زى ما هو فى الاتجاهين
  assert.equal(shortNameOf("عامل مقاول"), "عامل مقاول");
  assert.equal(preferFullName("عامل مقاول"), "عامل مقاول");
});

// تقارير الأعطال والمتعذرات **مامتلمستش** — لا بتستورد ولا بتستخدم تحويل الأسماء.
test("the faults and متعذرات reports are untouched by the full-name mapping", () => {
  const fullNameUses = [...routes.matchAll(/preferFullName\(|fullNameOf\(/g)].length;
  assert.ok(fullNameUses > 0, "التحويل مستخدم فعلاً فى سياق أوامر الشغل");
  // كل استخدام لازم يكون جوّه endpoint أوامر الشغل أو حفظ كمية السلك — مش فى تقارير الأعطال
  const woStart = routes.indexOf('app.put("/api/work-order-tech"');
  const cableStart = routes.indexOf('app.post("/api/cable-entries"');
  for (const m of routes.matchAll(/preferFullName\(|fullNameOf\(/g)) {
    const i = m.index ?? 0;
    const inWorkOrder = i > woStart && i < woStart + 4000;
    const inCable = i > cableStart && i < cableStart + 4000;
    assert.ok(inWorkOrder || inCable,
      `تحويل الاسم الكامل اتستخدم برّه سياق أوامر الشغل/كمية السلك (موضع ${i})`);
  }
});
