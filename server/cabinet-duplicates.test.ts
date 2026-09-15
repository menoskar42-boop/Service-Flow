import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// باجّين ظهروا مع بعض فى برنامج الصيانة:
// (١) كباين مكرّرة: تكامل «بوكس مليان» كان بيدوّر على الكابينة **بالنص الخام**،
//     والمتعذرات بتكتبها بشرطة مايلة («2/1») وبرنامج الصيانة متخزّن فيه «2-1» —
//     فسنترال دير الجنادلة بقى ١٢ كابينة بدل ٦.
// (٢) الأرقام بتتقلب فى العرض: قاعدة bidi رقم W2 بتحوّل أى رقم **بعد حرف عربى**
//     لـ«رقم عربى» (AN)، والشرطة اللى بينهم بتاخد اتجاه السطر (RTL) — فـ«كابينة 2-1»
//     كانت بتتعرض «كابينة 1-2». والرقم لوحده فى خانة الجدول بيتعرض صح، فالقائمة
//     والجدول كانوا متناقضين وكأن الفلتر بيرجّع كابينة تانية.
const integration = readFileSync(
  new URL("./maintenance/app/routes/integration.js", import.meta.url), "utf8");
const boxes = readFileSync(
  new URL("./maintenance/app/routes/boxes.js", import.meta.url), "utf8");
const css = readFileSync(
  new URL("./maintenance/app/static/css/custom.css", import.meta.url), "utf8");
const cabNormShared = readFileSync(
  new URL("../shared/cab-norm.ts", import.meta.url), "utf8");

test("the integration matches an existing cabinet before creating one", () => {
  // السنترال والكابينة والبكس — التلاتة بيتقارنوا موحّدين قبل الإنشاء
  assert.match(integration, /const hit = exs\.find\(\(r\) => centralNorm\(r\.name\) === centralNorm\(central\)\)/);
  assert.match(integration, /const hit = cabs\.find\(\(r\) => cabNorm\(r\.number\) === cabNorm\(cabinet\)\)/);
  assert.match(integration, /const hit = bxs\.find\(\(r\) => boxNorm\(r\.number\) === boxNorm\(box\)\)/);
});

test("the maintenance normalizers mirror shared/cab-norm", () => {
  // نفس القواعد: كل أشكال الفاصل → شرطة، المسافات حوالين الشرطة بتتشال،
  // والبكس أرقام بس من غير أصفار بادئة.
  for (const src of [integration, boxes]) {
    assert.match(src, /\[\\\\\/_\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\]/,
      "every separator must fold into '-'");
    assert.match(src, /replace\(\/\\s\*-\\s\*\/g, ["']-["']\)/,
      "spaces around the dash must collapse");
  }
  assert.match(integration, /const d = toAsciiDigits\(s\)\.replace\(\/\[\^0-9\]\/g, ""\);\s*\n\s*return d \? String\(parseInt\(d, 10\)\) : "";/);
  // المصدر المشترك لسه موجود — الملفين CommonJS فمينفعش يستوردوا منه
  assert.match(cabNormShared, /export const normCab/);
  assert.match(cabNormShared, /export const normBox/);
});

test("the merge moves every box and never drops an inspection", () => {
  const fn = boxes.slice(boxes.indexOf("router.post('/cabinets/duplicates/merge'"),
                         boxes.indexOf("module.exports"));
  // بوكس بنفس الرقم فى الأصلية → ننقل الفحوصات والصور وبعدين نمسح المكرّر
  assert.match(fn, /UPDATE inspections SET box_id = \? WHERE box_id = \?/);
  assert.match(fn, /UPDATE photos SET box_id = \? WHERE box_id = \?/);
  assert.match(fn, /DELETE FROM boxes WHERE id = \?/);
  // بوكس مالوش شبيه → بيتنقل للكابينة الأصلية بدل ما يتمسح
  assert.match(fn, /UPDATE boxes SET cabinet_id = \? WHERE id = \?/);
  // الترتيب: المسح بعد النقل — لو اتعكس الفحوصات كانت هتتمسح بالـ CASCADE
  assert.ok(fn.indexOf("UPDATE inspections SET box_id") < fn.indexOf("DELETE FROM boxes WHERE id"),
    "inspections must move before the duplicate box is deleted");
  // الأصلية = الأكتر بوكسات وعند التساوى الأقدم
  assert.match(boxes, /sort\(\(a, b\) => b\.box_count - a\.box_count \|\| a\.id - b\.id\)/);
});

test("the merge page is admin only and reachable from the cabinets page", () => {
  assert.match(boxes, /router\.get\('\/cabinets\/duplicates', adminOnly/);
  assert.match(boxes, /router\.post\('\/cabinets\/duplicates\/merge', adminOnly/);
  const list = readFileSync(
    new URL("./maintenance/app/views/boxes/cabinet_list.ejs", import.meta.url), "utf8");
  assert.match(list, /href="\/boxes\/cabinets\/duplicates"/);
});

test("numbers are isolated from the page's RTL direction", () => {
  assert.match(css, /\.n \{[\s\S]*?unicode-bidi: isolate;[\s\S]*?direction: ltr;[\s\S]*?\}/);
  // كل رقم بيتعرض بعد كلمة عربية لازم يبقى معزول
  const views = ["technician/list.ejs", "boxes/list.ejs", "inspector/list.ejs",
                 "reports/maintenance.ejs", "reports/comprehensive.ejs"];
  for (const v of views) {
    const src = readFileSync(new URL(`./maintenance/app/views/${v}`, import.meta.url), "utf8");
    const bare = src.match(/(?:كابينة|بوكس)\s+<%[=-]/g) || [];
    assert.equal(bare.length, 0,
      `${v} still renders a number straight after Arabic text (${bare.length} sites)`);
  }
});
