import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// تعديل اسم الفنى من **تقرير أوامر الشغل** — للسوبر أدمن بس.
//
// الباج اللى الاختبارات دى بتحرسه: التعديل كان بيتسجّل فعلاً فى
// work_order_tech_overrides (من التعديل اليدوى أو تلقائياً لما فنى يسجّل كمية سلك)،
// لكن /api/work-orders كان بيقرا w.tech_name **من غير أى جوين على جدول التعديلات** —
// فالتقرير يفضل عارض «انور عبد الفتاح» مع إن الاسم اتغيّر لـ«محمد عبدالعزيز طه احمد».
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const report = readFileSync(
  new URL("../client/src/components/WorkOrdersReport.tsx", import.meta.url), "utf8");

const start = routes.indexOf('app.get("/api/work-orders"');
assert.ok(start >= 0, "the work-orders endpoint must exist");
const end = routes.indexOf("app.", routes.indexOf("res.json(", start));
const ep = routes.slice(start, end > start ? end : start + 6000);

test("the work-orders endpoint returns the overridden technician name", () => {
  assert.match(ep, /LEFT JOIN work_order_tech_overrides ovr\s*\n\s*ON ovr\.central_name = w\.central_name AND ovr\.work_order_id = w\.work_order_id/);
  assert.match(ep, /COALESCE\(NULLIF\(btrim\(ovr\.tech_name\), ''\), w\.tech_name\) AS "techName"/);
  assert.match(ep, /btrim\(w\.tech_name\) AS "sheetTechName"/);
  assert.match(ep, /\(ovr\.tech_name IS NOT NULL\) AS "techEdited"/);
  assert.match(ep, /AS "techKnown"/);
});

// «معروف» = كود العامل (مطابقة تامة) وإلا الاسم المعدَّل وإلا اسم الشيت — نفس ترتيب
// الـ endpoint التانى، عشان الاسمين مايختلفوش بين التقريرين.
test("known-technician detection uses the worker code first, then the effective name", () => {
  assert.match(ep, /canonicalTechSql\(`COALESCE\(\s*\n\s*\(SELECT tn\.tech_name FROM technician_names tn/);
  assert.match(ep, /NULLIF\(btrim\(ovr\.tech_name\), ''\), w\.tech_name\)`\)\} IS NOT NULL AS "techKnown"/);
});

test("only the super admin gets the tech-name dropdown in the work-orders report", () => {
  assert.match(report, /const canEditTech = user\?\.role === ROLES\.SUPER_ADMIN;/);
  assert.match(report, /apiRequest|fetch\("\/api\/work-order-tech"/);
  assert.match(report, /method: "PUT"/);
});

// اسم من الفنيين الخمسة مايتعدّلش — لا دروب ليست تظهر ولا السيرفر بيقبل.
test("a known technician name stays read-only in the report", () => {
  assert.match(report, /o\.techKnown \|\| !canEditTech \?/);
  assert.match(report, /TECHNICIAN_NAMES\.map/);
  assert.match(report, /import \{ TECHNICIAN_NAMES \} from "@shared\/technicians";/);
});

// التعديل بيتعرض ومعاه الاسم الأصلى فى الملف — عشان يبان إن الاسم اتغيّر.
test("the sheet name stays visible next to an edited name", () => {
  assert.match(report, /o\.techEdited && o\.sheetTechName && o\.sheetTechName !== o\.techName/);
  assert.match(report, /فى الملف:/);
});

// الحفظ بيحدّث التقريرين — تقرير أوامر الشغل و«بدون كمية سلك».
test("saving a name refreshes both reports", () => {
  assert.match(report, /invalidateQueries\(\{ queryKey: \["\/api\/work-orders"\] \}\)/);
  assert.match(report, /invalidateQueries\(\{ queryKey: \["\/api\/reports\/work-orders-no-cable"\] \}\)/);
});
