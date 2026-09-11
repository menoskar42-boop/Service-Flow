import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const trigger = readFileSync(new URL("./box-full-inspection.ts", import.meta.url), "utf8");
const integration = readFileSync(
  new URL("./maintenance/app/routes/integration.js", import.meta.url), "utf8");
const technician = readFileSync(
  new URL("./maintenance/app/routes/technician.js", import.meta.url), "utf8");
const inspector = readFileSync(
  new URL("./maintenance/app/routes/inspector.js", import.meta.url), "utf8");
const dbjs = readFileSync(new URL("./maintenance/app/database.js", import.meta.url), "utf8");
const view = readFileSync(
  new URL("./maintenance/app/views/technician/detail.ejs", import.meta.url), "utf8");

// «بوكس مليان» لازم يشتغل من **الجهتين** — نفس اصطلاح تكت «بوكس معطل».
test("both box-full sources fire the maintenance data-review request", () => {
  assert.match(routes, /import \{ requestBoxDataReview, boxPhones \} from "\.\/box-full-inspection"/);
  // قسم الطلبات
  assert.match(routes, /rejectionReason === REJECTION_REASONS\.BOX_FULL/);
  assert.match(routes, /techName: user\.username, source: "طلبات",\s*\n\s*refKey: `طلب #\$\{id\}`/);
  // متعذرات OM
  assert.match(routes, /r0\.rejection_reason === REJECTION_REASONS\.BOX_FULL/);
  assert.match(routes, /source: "OM",\s*\n\s*refKey: `متعذر \$\{serialNumber\}`,\s*\n\s*\}\)\.then/);
  // الفشل مايمنعش تسجيل الرد (void + catch فى الـ then)
  assert.match(trigger, /return \{ ok: false, reason:/);
});

// «تم الفتح بواسطة» = اسم الفنى + جهة الفتح.
test("the opener is recorded as tech-name + source", () => {
  assert.match(trigger, /const openedBy = `\$\{String\(input\.techName \|\| ""\)\.trim\(\) \|\| "غير معروف"\}-\$\{input\.source\}`/);
  assert.match(integration, /opened_by_name/);
  assert.match(dbjs, /\['opened_by_name', 'TEXT'\]/);
});

// أرقام البكس مصدرها بيان التليفونات — وهو نفسه اللى تصحيح البيان بيتكتب فيه.
test("box phones come from phone_lines", () => {
  assert.match(trigger, /FROM phone_lines pl/);
  // ⚠️ اتغيّرت: المطابقة الحرفية اتشالت لأنها كانت بترجّع صفر أرقام لأى كابينة
  // مكتوبة بشرطة مايلة («2/6» مقابل «2-6») — التفاصيل فى box-phones-norm.test.ts
  assert.match(trigger, /\$\{boxN\("pl\.box_number"\)\} = \$\{boxN\("\$3"\)\}/);
});

// البند الجديد + الجدول + المهمة — من غير المهمة الفنى مايقدرش يعلّم البند مكتمل.
test("the maintenance side has the item, the phones table and a task", () => {
  assert.match(inspector, /\{ key: 'data_review',\s*label: 'مراجعة بيانات البكس',\s*type: 'yes_no'\s*\}/);
  assert.match(dbjs, /CREATE TABLE IF NOT EXISTS box_line_numbers/);
  assert.match(integration, /INSERT INTO maintenance_tasks \(inspection_id, status\) VALUES \(\?, 'pending'\)/);
  // فحص غير مكتمل → نضيف البند؛ مفيش فحص → ننشئ واحد كل بنوده بملاحظات
  assert.match(integration, /NOT EXISTS \(SELECT 1 FROM maintenance_tasks t\s*\n\s*WHERE t\.inspection_id = i\.id AND t\.status = 'completed'\)/);
  assert.match(integration, /for \(const \[key, type\] of CHECKLIST_KEYS\)/);
  assert.match(integration, /const notes = isTarget \? noteTxt :/);
});

// فنى الصيانة بيعدّل ويحذف ويضيف، وبيعلّم البند مكتمل بنفس الزرار المعتاد.
test("the technician can edit, delete and add phones", () => {
  assert.match(technician, /router\.post\('\/:id\/phones',/);
  assert.match(technician, /router\.post\('\/:id\/phones\/:phoneId',/);
  assert.match(technician, /router\.post\('\/:id\/phones\/:phoneId\/delete',/);
  assert.match(technician, /data_review:\s*'مراجعة بيانات البكس'/);
  assert.match(view, /id="box-phones"/);
  // زرار الإنهاء المعتاد موجود أصلاً — مابنعملش مسار تانى
  assert.match(technician, /router\.post\('\/:id\/items\/:itemKey\/toggle'/);
});

// التقرير بيقرا من سكيما maintenance مباشرةً (نفس القاعدة) — مافيش تزامن.
test("the reviewed report reads the maintenance schema directly", () => {
  assert.match(routes, /app\.get\("\/api\/reports\/box-full-reviewed"/);
  assert.match(routes, /FROM maintenance\.maintenance_item_status mis/);
  assert.match(routes, /WHERE mis\.item_key = 'data_review'/);
  assert.match(routes, /app\.get\("\/api\/reports\/box-full-reviewed\/:id\/phones"/);
  // ولو موقع الصيانة مش مركّب، التقرير بيرجّع فاضى مش خطأ
  assert.match(routes, /schema "maintenance" does not exist/);
});

// ⚠️ الفحوصات المتفتحة تلقائياً **مايظهروش فى قسم التقارير** (ارتفاع بكس سىء،
// يحتاج راس بكس…) — ولا يحجبوا آخر فحص حقيقى للبكس، وده كان أخطر أثر.
test("auto-created inspections stay out of the maintenance reports", () => {
  const reports = readFileSync(
    new URL("./maintenance/app/routes/reports.js", import.meta.url), "utf8");
  // (1) «آخر فحص للبكس» لازم يتجاهل الفحص التلقائى — وإلا بيحجب فحص حقيقى فيه مشاكل
  assert.match(reports, /SELECT MAX\(id\) FROM inspections WHERE box_id = b\.id AND COALESCE\(auto_created, 0\) = 0/);
  assert.match(reports, /SELECT id FROM inspections WHERE box_id = b\.id AND COALESCE\(auto_created, 0\) = 0 ORDER BY id DESC/);
  assert.match(reports, /EXISTS \(SELECT 1 FROM inspections WHERE box_id = b\.id AND COALESCE\(auto_created, 0\) = 0\)/);
  // (2) قوائم وتقارير الفحوصات بتستبعده
  assert.ok([...reports.matchAll(/COALESCE\(i\.auto_created, 0\) = 0/g)].length >= 8,
    "شرط الاستبعاد لازم يكون على تقارير الفحوصات كلها");
  // (3) بند مراجعة البيانات مش عيب فى البكس — مايتحسبش فى تقارير الأعطال
  assert.ok([...reports.matchAll(/ii\.item_key <> 'data_review'/g)].length >= 3);
});

// الفحص اللى عمله فاحص حقيقى **مايتعلّمش** تلقائى لما نضيف عليه البند —
// وإلا كان هيتشال من التقارير بالغلط.
test("adding the item to a real inspection never marks it auto-created", () => {
  assert.match(integration, /VALUES \(\?, \?, \?, \?, \?, \?, 1\) RETURNING id/,
    "auto_created = 1 بيتحطّ وقت الإنشاء بس");
  const addBranch = integration.slice(integration.indexOf("} else {"), integration.indexOf("// (3) الأرقام"));
  assert.doesNotMatch(addBranch, /auto_created\s*=|auto_created\)/,
    "فرع الفحص الموجود مايكتبش auto_created");
  assert.doesNotMatch(addBranch, /UPDATE inspections SET opened_by_name/,
    "ومايغيّرش origin للفحص الحقيقى");
});
