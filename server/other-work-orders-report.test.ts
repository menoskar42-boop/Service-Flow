import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// تقرير «أوامر شغل أخرى (بدون سلك)» — الأنواع اللى اتشالت من أوامر الشغل ومن
// «بدون كمية سلك» (تفعيل/إلغاء خدمة، التحقق من إتاحة رقم، معاينة) بتظهر هنا.
// نفس القائمة بالظبط (NO_CABLE_WO_TYPES_LC) هى اللى بتستبعد هناك وبتضم هنا،
// فمفيش أمر بيضيع بين التقريرين ولا بيتكرر فيهم.
//
// مُثبت على التلات ملفات الحقيقية: أوامر الشغل 151 | أوامر أخرى 230
// (218 معاينة + 9 تحقق + 3 VAS) | المتكرر بين التقريرين = 0.
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const comp = readFileSync(
  new URL("../client/src/components/OtherWorkOrdersReport.tsx", import.meta.url), "utf8");
const dash = readFileSync(new URL("../client/src/pages/dashboard.tsx", import.meta.url), "utf8");

const start = routes.indexOf('app.get("/api/reports/other-work-orders"');
assert.ok(start >= 0, "the endpoint must exist");
const ep = routes.slice(start, start + 3200);

test("the report includes exactly the excluded types", () => {
  assert.match(ep, /lower\(btrim\(COALESCE\(w\.work_order_type_raw, ''\)\)\) = ANY\(ARRAY\[\$\{typeList\}\]\)/);
  assert.match(ep, /const typeList = NO_CABLE_WO_TYPES_LC\.map/);
  // المبيعات ممنوعة زى باقى تقارير أوامر الشغل
  assert.match(ep, /ROLES\.SALES \|\| req\.user\?\.role === ROLES\.SALES_ADMIN/);
});

test("filters are parameterised, never interpolated", () => {
  // نوع الأمر بييجى من المستخدم → لازم يتحطّ كبارامتر مش نص فى الاستعلام
  assert.match(ep, /params\.push\(type\.trim\(\)\.toLowerCase\(\)\); conds\.push\(`lower\(btrim\(COALESCE\(w\.work_order_type_raw, ''\)\)\) = \$\$\{params\.length\}`\)/);
  assert.match(ep, /params\.push\(dateFrom\)/);
  assert.match(ep, /params\.push\(arQ\(q\)\)/);
});

// اسم الفنى هنا كمان = فنى الإغلاق (مع التعديل اليدوى لو موجود)
test("it shows the closing technician", () => {
  assert.match(ep, /COALESCE\(NULLIF\(btrim\(ovr\.tech_name\), ''\), w\.tech_name\) AS "techName"/);
});

// القاعدة #7: كل تقرير فى قسم التقارير لازم يبقى فيه تصدير Excel وPDF
test("the report has both exports", () => {
  assert.match(comp, /const handleExportExcel = \(\) => \{/);
  assert.match(comp, /XLSX\.writeFile\(wb, `other-work-orders-/);
  assert.match(comp, /const handleExportPDF = \(\) => \{/);
  assert.match(comp, /printTablePDF\(\{ title: "أوامر شغل أخرى \(بدون سلك\)"/);
});

test("it is wired into the reports sidebar", () => {
  assert.match(dash, /\{ id: "other-work-orders", label: "أوامر شغل أخرى \(بدون سلك\)" \}/);
  assert.match(dash, /reportTab === "other-work-orders" && <OtherWorkOrdersReport \/>/);
  assert.match(dash, /import \{ OtherWorkOrdersReport \} from "@\/components\/OtherWorkOrdersReport";/);
  assert.match(dash, /\| "other-work-orders";/);
});
