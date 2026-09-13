import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// القاعدة المطلوبة صراحةً:
//   • «بحث برقم التليفون» → القياس/رفع السرعة/الإيقاف **لكل المستخدمين**.
//   • أى **تقرير** تانى → **السوبر أدمن بس** — أزرار الشريط (باتش) وكمان زر القياس
//     اللى جنب رقم الأكونت فى كل صف.
// الباج: زر الصف مكانش متلفّ بأى حارس فى ٧ تقارير، فمسئول البيانات كان شايف القياس
// فى «خطوط أسكورها أعلى من 100» و«اسكور 103».
const rd = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const hook = rd("../client/src/lib/use-speed-tools.ts");
const lookup = rd("../client/src/components/PhoneLookupReport.tsx");

// كل تقرير فيه زر قياس لصف واحد
const ROW_MEASURE_REPORTS = [
  "ComplaintNoMeasureReport.tsx",
  "CurrentFaultsReport.tsx",
  "NeedsSpeedReport.tsx",
  "PhoneLinesReport.tsx",
  "RegularizedFaultsRangeReport.tsx",
  "RegularizedFaultsReport.tsx",
  "WithAccountReport.tsx",
];

test("report speed tools are limited to the super admin", () => {
  assert.match(hook, /return alwaysShow \|\| user\?\.role === ROLES\.SUPER_ADMIN;/);
  // الأدوار دى كانت بتشوف الأزرار وماعادتش
  assert.doesNotMatch(hook, /useSpeedToolsVisible[\s\S]*?ROLES\.ADMIN/);
  assert.doesNotMatch(hook, /useSpeedToolsVisible[\s\S]*?ROLES\.EXTERNAL/);
});

// ⚠️ الاختبار ده اتقلب بعد باج حقيقى: خلّينا canUseTools = true عشان «القياس يظهر
// لكل المستخدمين فى بحث برقم التليفون»، فالفنى محمد بقى يقدر يقيس خط تابع لحسن عبد
// الفتاح. الطلب كان معناه «فى صفحة البحث مش فى التقارير» — مش إلغاء قيد خطوط الفنى.
test("a technician can only use the tools on their own lines", () => {
  assert.doesNotMatch(lookup, /const canUseTools = true;/,
    "the per-technician restriction must never be flattened to true again");
  assert.match(lookup, /const canUseTools =\s*\n\s*isSuper \|\|\s*\n\s*user\?\.role === ROLES\.ADMIN \|\|\s*\n\s*user\?\.role === ROLES\.EXTERNAL \|\|\s*\n\s*!!line\?\.ownedByMe;/);
});

// خط زميل مغطَّى بتصريح = مسموح **بس** لو عليه عطل على الشاشة أو اتنظّم النهاردة
// (محمود بيقيس خطوط سامى اللى على الشاشة فقط). المنطق ده فى ownedByMe على السيرفر.
test("coverage only opens a colleague's line while it has a live fault", () => {
  const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const i = routes.indexOf('-- ownedByMe: خطوطى أنا');
  assert.ok(i >= 0, "the ownedByMe expression must stay documented");
  const expr = routes.slice(i, routes.indexOf('AS "ownedByMe"', i));
  assert.match(expr, /\$4::text\[\]/, "own worker codes");
  assert.match(expr, /\$5::text\[\]/, "covered colleagues' worker codes");
  assert.match(expr, /FROM ticket_dsl_current tc/, "covered lines need a live ticket");
  assert.match(expr, /FROM manual_faults mf/);
});

for (const f of ROW_MEASURE_REPORTS) {
  test(`the per-row measure button in ${f} is behind the super-admin guard`, () => {
    const src = rd("../client/src/components/" + f);
    const i = src.indexOf("onClick={() => openDZSSingle(");
    assert.ok(i >= 0, "the per-row measure button must exist");
    // الحارس لازم يكون قبل الزر مباشرةً — إمّا {showSpeedTools && ( أو داخل شرط الصف
    const before = src.slice(Math.max(0, i - 400), i);
    assert.match(before, /showSpeedTools/,
      "the row button must not render without showSpeedTools");
    assert.match(src, /const showSpeedTools = useSpeedToolsVisible\(\);/);
  });
}
