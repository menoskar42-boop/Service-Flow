import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// «أرقام لها شكاوى بدون رقم موبايل»: الرقم اللى فعلاً مالوش موبايل لازم يتشال من
// التقرير — زى ما بيحصل مع «معلَّمة بدون أكونت».
// الآلية (line_mobile_checked) كانت موجودة وشغّالة، بس الزرار كان **آخر عمود فى
// جدول بـ15 عمود** يعنى برّه الشاشة ومحدش بيوصله. اتنقل جنب زرار «إضافة» فى خانة
// رقم الموبايل — نفس المكان اللى المستخدم شغّال فيه.
const report = readFileSync(
  new URL("../client/src/components/NoMobileComplaintsReport.tsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

test("the mark button sits next to the add-mobile button", () => {
  const cell = report.slice(report.indexOf("<MobileValue"), report.indexOf("</span>", report.indexOf("<MobileValue")));
  assert.match(cell, /startEdit\(row\)/, "the add button stays");
  assert.match(cell, /markChecked\(row\.fullPhone\)/, "the mark button must be in the same cell");
  assert.match(cell, /مفيش موبايل/);
});

test("the old off-screen column is gone and colSpan follows", () => {
  assert.doesNotMatch(report, /<TableHead[^>]*>الفحص<\/TableHead>/);
  assert.match(report, /colSpan=\{14\}/);
  // زرار واحد بس — مش مكرر فى عمودين
  assert.equal((report.match(/markChecked\(row\.fullPhone\)/g) || []).length, 1);
});

test("marking uses the existing store the report already filters on", () => {
  assert.match(report, /fetch\("\/api\/line-mobile-checked", \{\s*\n\s*method: "POST"/);
  assert.match(routes, /NOT EXISTS \(SELECT 1 FROM line_mobile_checked mc WHERE \$\{sp\("mc\.full_phone"\)\} = \$\{sp\('e\."fullPhone"'\)\}\)/);
  // ومفيش طريق واحد للتعليم من غير طريق للتراجع
  assert.match(routes, /app\.delete\("\/api\/line-mobile-checked\/:fullPhone"/);
});
