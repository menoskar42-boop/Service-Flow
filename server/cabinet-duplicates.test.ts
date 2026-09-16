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
// ⚠️ style.css هو الملف الوحيد اللى الهيدر بيحمّله — custom.css موجود بس مش
// مربوط بأى قالب، فأى قاعدة تتحطّ هناك مابتشتغلش.
const css = readFileSync(
  new URL("./maintenance/app/static/css/style.css", import.meta.url), "utf8");
const cabNormShared = readFileSync(
  new URL("../shared/cab-norm.ts", import.meta.url), "utf8");

test("the integration matches an existing cabinet before creating one", () => {
  // السنترال والكابينة والبكس — التلاتة بيتقارنوا موحّدين قبل الإنشاء
  assert.match(integration, /const hit = exs\.find\(\(r\) => centralNorm\(r\.name\) === centralNorm\(central\)\)/);
  assert.match(integration, /const hit = cabs\.find\(\(r\) => cabNorm\(r\.number\) === cabNorm\(cabinet\)\)/);
  // البكس: تطابق نصّى تام الأول، وبعده تطابق رقمى بس لو الاتنين أرقام صافية
  assert.match(integration, /const hit = bxs\.find\(\(r\) => String\(r\.number\)\.trim\(\) === String\(box\)\.trim\(\)\)/);
  assert.match(integration, /boxNorm\(r\.number\) === boxNorm\(box\)/);
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
  // الكلاس ده كان موجود أصلاً فى style.css — direction: ltr + unicode-bidi
  // بيعزلوا الرقم عن اتجاه السطر فمايتقلبش.
  assert.match(css, /\.n \{ direction: ltr; unicode-bidi: \w+;/);
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

// ⚠️ <option> محتواه **نص فقط** — المتصفح بيرمى أى وسم جوّاه، فـ<bdi> ماكانتش
// بتشتغل هناك والقائمة فضلت تعرض «كابينة 8-1» والجدول «1-8». البديل النصّى LRM.
test("dropdowns use a plain directional mark, never a tag", () => {
  const views = ["boxes/list.ejs", "technician/list.ejs", "inspector/list.ejs",
                 "reports/maintenance.ejs", "reports/comprehensive.ejs"];
  for (const v of views) {
    const src = readFileSync(new URL(`./maintenance/app/views/${v}`, import.meta.url), "utf8");
    for (const line of src.split("\n")) {
      if (!line.includes("<option")) continue;
      assert.ok(!line.includes("<bdi"), `${v}: <bdi> inside <option> is dropped by the browser`);
      if (/<%=\s*[a-z]\.number\s*%>/i.test(line)) {
        assert.ok(line.includes("&lrm;"), `${v}: a cabinet number in <option> needs &lrm;`);
      }
    }
  }
});

// «بوكس 14» و«بوكس 14 مناول» بوكسين مختلفين فى نفس الكابينة — الدمج مايلزقهمش.
test("a plain-number box is never merged into a named one", () => {
  for (const src of [boxes, integration]) {
    assert.match(src, /const isPlainNum = \(s\) => \/\^\[0-9\\u0660-\\u0669\]\+\$\/\.test/);
  }
  assert.match(boxes, /list\.find\(\(k\) => String\(k\.number\)\.trim\(\) === String\(b\.number\)\.trim\(\)\)/,
    "an exact match wins first");
  assert.match(boxes, /isPlainNum\(k\.number\) && isPlainNum\(b\.number\)/);
  assert.match(integration, /isPlainNum\(r\.number\) && isPlainNum\(box\)/);
});
