import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
const form = readFileSync(new URL("../client/src/components/LineDataCorrection.tsx", import.meta.url), "utf8");
const report = readFileSync(new URL("../client/src/components/LineDataCorrectionsReport.tsx", import.meta.url), "utf8");
const section = readFileSync(new URL("../client/src/components/DataCompletionSection.tsx", import.meta.url), "utf8");

// القاعدة #8: أى جدول/عمود جديد لازم يبقى فى schema.ts و ensureSchema فى نفس الكوميت.
test("the corrections table lives in both the schema and ensureSchema", () => {
  assert.match(schema, /export const lineDataCorrections = pgTable\("line_data_corrections"/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS line_data_corrections/);
  for (const col of ["requested_at", "resolved_at", "resolved_by_id", "resolved_by_name"]) {
    assert.match(db, new RegExp(`ALTER TABLE line_data_corrections ADD COLUMN IF NOT EXISTS \\$\\{col\\}|\\["${col}"`),
      `العمود ${col} لازم يتضاف فى ensureSchema`);
  }
  assert.doesNotMatch(db, /DROP TABLE line_data_corrections/);
});

test("the form requires only the phone number", () => {
  assert.match(routes, /if \(!local \|\| local\.length < 5\) return res\.status\(400\)/);
  assert.match(form, /canSend = phone\.trim\(\)\.length >= 5/);
  // السنترال والكابينة والبكس اختيارية — بتتخزّن NULL لو فاضية
  assert.match(routes, /NULLIF\(\$3,''\),NULLIF\(\$4,''\),NULLIF\(\$5,''\)/);
});

// ⚠️ لازم مانكتبش اللى الفنى دخّله فى البيان الفنى قبل المراجعة — وإلا مافيش حاجة نقارنها.
test("the technician's values are never written into the line data before the review", () => {
  const start = routes.indexOf('app.post("/api/line-data-corrections"');
  const end = routes.indexOf("app.get(\"/api/line-data-corrections\"", start);
  const ep = routes.slice(start, end > start ? end : start + 4000);
  assert.doesNotMatch(ep, /INSERT INTO line_subscriber_info/,
    "الكتابة فى البيان الفنى قبل المراجعة بتلغى المقارنة كلها");
  assert.match(ep, /INSERT INTO exec_jobs/, "الإرسال لازم يحطّ طلب مراجعة فى الطابور");
});

// الطابور هو التخزين: المهمة بتفضل pending لحد ما جهاز تنفيذ يسحبها.
test("the review request is queued server-side, so no executor is needed at send time", () => {
  const start = routes.indexOf('app.post("/api/line-data-corrections"');
  const ep = routes.slice(start, start + 4000);
  assert.match(ep, /VALUES \('subinfo', \$1::jsonb/);
  assert.doesNotMatch(ep, /isExecutorActive/, "مالوش علاقة بجهاز التنفيذ وقت الإرسال");
  // ومابيكرّرش طلب لسه فى الطابور
  assert.match(ep, /status IN \('pending','claimed'\)/);
});

// المقارنة مابتتحسبش غير لما نتيجة المراجعة تبقى أحدث من آخر طلب.
test("the comparison only counts once a newer review has landed", () => {
  assert.match(routes, /const CORR_READY = `\(si\.fetched_at IS NOT NULL AND si\.fetched_at > c\.requested_at\)`/);
});

// الفنى بعت الرقم بس من غير بيانات → مراجعة وخلاص، مافيش مقارنة.
test("a submission with no typed data is review-only, never a mismatch", () => {
  assert.match(routes, /const CORR_HAS_TYPED = /);
  // COALESCE على التلات خانات → NULL بس لما تكون التلاتة فاضيين
  assert.match(routes, /COALESCE\(NULLIF\(btrim\(c\.central\), ''\), NULLIF\(btrim\(c\.cabin_number\), ''\),/);
  assert.match(routes, /NULLIF\(btrim\(c\.box_number\), ''\), NULLIF\(btrim\(c\.dp_terminal\), ''\)\) IS NOT NULL\)/);
  // وشرط الاختلاف نفسه بيتجاهل الخانة الفاضية
  assert.match(routes, /NULLIF\(btrim\(c\.\$\{field\}\), ''\) IS NOT NULL/);
  assert.match(report, /!r\.hasTyped \? "مراجعة فقط"/);
});

// «تم التصحيح» بيبعت مراجعة تانية ويرجّع الصف لانتظار المقارنة من أول وجديد.
test("«تم التصحيح» re-requests the review and restarts the comparison", () => {
  const start = routes.indexOf('app.post("/api/line-data-corrections/:id/resolve"');
  assert.ok(start >= 0);
  const ep = routes.slice(start, start + 2500);
  assert.match(ep, /resolved_at = now\(\).*requested_at = now\(\)/s,
    "requested_at لازم يترجع عشان المقارنة تستنى النتيجة الجديدة");
  assert.match(ep, /INSERT INTO exec_jobs/);
  assert.match(ep, /ROLES\.DATA_MANAGER \|\| hasAdminAccess\(role\)/);
});

// السوبر أدمن بيشوف كل اللى الفنيين بعتوه، بتاريخ الإدخال وفلتر تاريخ وزر مراجعة.
test("the report gives the super admin every submission, with a date filter and a review button", () => {
  const start = routes.indexOf('app.get("/api/line-data-corrections"');
  const ep = routes.slice(start, start + 3000);
  assert.match(ep, /const seeAll = role === ROLES\.DATA_MANAGER \|\| hasAdminAccess\(role\)/);
  assert.match(ep, /c\.created_at AT TIME ZONE 'Africa\/Cairo'\)::date >= /);
  assert.match(ep, /c\.created_at AT TIME ZONE 'Africa\/Cairo'\)::date <= /);
  assert.match(routes, /app\.post\("\/api\/line-data-corrections\/:id\/review"/);
  assert.match(report, /act\(r, "review"\)/);
  assert.match(report, /act\(r, "resolve"\)/);
});

test("both tabs are mounted in the data-completion section", () => {
  assert.match(section, /import \{ LineDataCorrection \}/);
  assert.match(section, /import \{ LineDataCorrectionsReport \}/);
  assert.match(section, /label: "تصحيح بيانات"/);
  assert.match(section, /label: "متابعة التصحيحات"/);
});

// رقم الترمنال — إدخال حر (مش دروب ليست) واختيارى، وبيدخل المقارنة زى الباقى.
test("the DP terminal is a free-text optional field that joins the comparison", () => {
  const form = readFileSync(new URL("../client/src/components/LineDataCorrection.tsx", import.meta.url), "utf8");
  const rep = readFileSync(new URL("../client/src/components/LineDataCorrectionsReport.tsx", import.meta.url), "utf8");
  const dbSrc = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
  const schemaSrc = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
  // العمود فى schema.ts و ensureSchema (القاعدة #8)
  assert.match(schemaSrc, /dpTerminal: text\("dp_terminal"\)/);
  assert.match(dbSrc, /\["dp_terminal", "text"\]/);
  // إدخال حر: Input مش select
  assert.match(form, /<Input\s+value=\{terminal\}/);
  assert.doesNotMatch(form, /<select[^>]*value=\{terminal\}/);
  // اختيارى: مش داخل شرط الإرسال
  assert.match(form, /canSend = phone\.trim\(\)\.length >= 5/);
  assert.doesNotMatch(form, /terminal[^\n]*canSend/);
  // بيتخزّن كـ NULL لو فاضى، وبيدخل المقارنة و«فيه بيانات مكتوبة؟»
  assert.match(routes, /NULLIF\(\$6,''\),\$7,\$8\) RETURNING id/);
  assert.match(routes, /corrDiff\("dp_terminal", "dp_terminal"\)/);
  assert.match(routes, /NULLIF\(btrim\(c\.dp_terminal\), ''\)\) IS NOT NULL\)/);
  // وظاهر فى التقرير: المُدخَل جنب اللى رجع من المراجعة
  assert.match(rep, /cmpCell\(r\.dpTerminal, r\.fetchedTerminal, r\.reviewed\)/);
  assert.match(rep, /"الترمنال \(المُدخَل\)", "الترمنال \(المراجعة\)"/);
});

// زر «تصحيح بيان» فى «بحث برقم التليفون» — نفس الخانات بالظبط، والرقم متملّى من البحث.
test("the phone-lookup report opens the same form in a dialog", () => {
  const lookup = readFileSync(
    new URL("../client/src/components/PhoneLookupReport.tsx", import.meta.url), "utf8");
  const formSrc = readFileSync(
    new URL("../client/src/components/LineDataCorrection.tsx", import.meta.url), "utf8");
  // بيستخدم **نفس المكوّن** مش نسخة تانية — فالخانات مستحيل تختلف
  assert.match(lookup, /import \{ LineDataCorrection \} from "@\/components\/LineDataCorrection"/);
  assert.match(lookup, /<LineDataCorrection\s+compact\s+initialPhone=/);
  assert.match(lookup, /onSent=\{\(\) => setFixOpen\(false\)\}/);
  // الزر ظاهر لأى مستخدم فاتح التقرير (مافيش شرط دور عليه)
  assert.match(lookup, /\{line && \(\s*\n\s*<Button\s*\n\s*variant="outline"\s*\n\s*onClick=\{\(\) => setFixOpen\(true\)\}/);
  // الرقم بيتملى ويتقفل عشان يفضل نفس الرقم المعروض
  assert.match(formSrc, /readOnly=\{!!initialPhone\}/);
  assert.match(formSrc, /String\(initialPhone \?\? ""\)\.replace\(\/\\D\/g, ""\)\.replace\(\/\^88\/, ""\)/);
});
