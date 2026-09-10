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

test("phone lookup keeps the tools open to everyone who reaches it", () => {
  assert.match(lookup, /const canUseTools = true;/);
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
