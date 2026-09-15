import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// «ازاى الرقم ظهر ٣ مرات بتواريخ إغلاق مختلفة؟» — اتحلّت بملف WFM الحقيقى اللى
// المستخدم رفعه: الرقم 88-2650848 عليه **٣ أوامر شغل منفصلة** نوعها
// «VAS Activation/Deactivation» (تفعيل/إلغاء خدمة مضافة) اتقفلوا 16:51 و16:52
// و16:57 نفس اليوم. دى مش نقل ولا تركيب ومابتستهلكش سلك.
//
// الباج: قاعدة الاستيراد «أى نوع مش تركيب = نقل» كانت بتدخّلهم على إنهم نقل،
// فيفضلوا فى «أوامر شغل بدون كمية سلك» للأبد مستنيين كمية سلك مش هتيجى أبداً.
//
// مُثبت باستيراد التلات ملفات الحقيقية على سيرفر حقيقى:
//   قبل: 87 صف (79 تركيب + 8 نقل، منهم ٣ VAS للرقم ده)
//   بعد: 84 صف (79 تركيب + 5 نقل — كلهم FV Change Phone No New Location، نقل حقيقى)
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

test("the non-cable work order types are listed", () => {
  const list = routes.slice(routes.indexOf("const NO_CABLE_WO_TYPES_LC"),
                            routes.indexOf("const WO_SHEET_INSTALL_TYPES"));
  for (const t of ["vas activation/deactivation",
                   "fv change phone number availability and validation",
                   "fixed voice manual survey"]) {
    assert.ok(list.includes(`"${t}"`), `${t} must be listed`);
  }
  // النقل الحقيقى مايتشالش
  assert.ok(!list.includes("fv change phone no new location"),
    "a real transfer still needs a cable quantity");
});

test("the no-cable report filters them out", () => {
  const start = routes.indexOf('app.get("/api/reports/work-orders-no-cable"');
  const ep = routes.slice(start, start + 2500);
  assert.match(ep, /lower\(btrim\(COALESCE\(w\.work_order_type_raw, ''\)\)\) <> ALL\(ARRAY\[/);
  assert.match(ep, /NO_CABLE_WO_TYPES_LC\.map/);
  // الشروط الأصلية زى ما هى
  assert.match(ep, /\^88\[0-9\]\{7\}\$/);
  assert.match(ep, /w\.close_category IS NULL OR w\.close_category = 'Success'/);
});

// نفس الاستبعاد على **تقرير أوامر الشغل** — الأنواع دى مش نقل ولا تركيب فمالهاش
// مكان هناك كمان. مُثبت على نفس ملفات WFM الحقيقية: 154 → 151 صف (التلات أوامر
// VAS بتوع 88-2650848 اتشالوا)، و144 تركيب + 7 نقل حقيقى فضلوا زى ما هم.
test("the work-orders report filters them out too", () => {
  const start = routes.indexOf('app.get("/api/work-orders", requireAuth');
  const ep = routes.slice(start, start + 2000);
  assert.match(ep, /lower\(btrim\(COALESCE\(w\.work_order_type_raw, ''\)\)\) <> ALL\(ARRAY\[/);
  assert.match(ep, /NO_CABLE_WO_TYPES_LC\.map/);
});

// ⚠️ اسم الفنى = **فنى الإغلاق** من الشيت، ومايتبدلش بفنى المنطقة أبداً.
// مُثبت على بيانات حقيقية: أمر نقل قافله «حسن» على خط كابينته بتاعة «اسلام»
// → التقريرين الاتنين عرضوا «حسن».
// والاسم اللى مش من الخمسة («انور عبد الفتاح») فضل زى ما هو وtechKnown=false
// (يعنى لسه قابل للتعديل والتسجيل التلقائى) — المنطق ده مااتلمسش.
test("the displayed technician stays the closing technician", () => {
  const start = routes.indexOf('app.get("/api/work-orders", requireAuth');
  const ep = routes.slice(start, start + 3000);
  assert.match(ep, /COALESCE\(NULLIF\(btrim\(ovr\.tech_name\), ''\), w\.tech_name\) AS "techName"/);
  // مافيش أى fallback لفنى المنطقة فى اسم الفنى نفسه
  assert.doesNotMatch(ep.slice(0, ep.indexOf('AS "techName"')), /areaTechSql/);
});
