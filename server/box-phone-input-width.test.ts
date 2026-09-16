import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// خانة «رقم التليفون» فى جدول أرقام البكس كانت بتتزنق على شاشة الموبايل فالرقم
// يتقصّ (882656666 كان بيبان 88265666). خانات الجدول بتتقسّم العرض بالتساوى،
// فالحل إن الرقم ياخد عرض أدنى يكفّى ٩ أرقام والجدول يتزحلق أفقياً بدل ما يزنقه.
// ⚠️ لازم تبقى فى style.css: ده الملف الوحيد اللى الهيدر بيحمّله. custom.css
// موجود فى المجلد بس **مش مربوط بأى قالب**، فأى قاعدة تتحطّ هناك مابتشتغلش —
// وده اللى حصل فى أول محاولة للإصلاح.
const css = readFileSync(
  new URL("./maintenance/app/static/css/style.css", import.meta.url), "utf8");
const header = readFileSync(
  new URL("./maintenance/app/views/partials/header.ejs", import.meta.url), "utf8");

test("the rules live in the stylesheet the page actually loads", () => {
  assert.match(header, /href="\/static\/css\/style\.css"/);
  assert.doesNotMatch(header, /custom\.css/);
});

test("the phone field has a minimum width", () => {
  assert.match(css, /\.box-phone-input \{[\s\S]*?min-width: 10\.5rem;[\s\S]*?\}/);
  assert.match(css, /\.box-notes-input \{ min-width: 8rem; \}/);
  // من غير منع اللفّ، الخانة بتلفّ بدل ما الجدول يتزحلق
  assert.match(css, /\.box-phones-table td,\s*\n\.box-phones-table th \{ white-space: nowrap; \}/);
  // الزحلقة مان تعتمدش على .table-responsive بتاعة Bootstrap: الـ CDN ممكن يكون
  // محجوب على شبكة الفنى (فلتر الويب) فالصفحة تفضل من غير أى ستايل من Bootstrap.
  assert.match(css, /\.box-phones-wrap \{ overflow-x: auto;/);
});

// الجدولين (شاشة مراجعة البيانات وشاشة فنى الصيانة) لازم يتصرّفوا بنفس الطريقة.
for (const v of ["data_review/detail.ejs", "technician/detail.ejs"]) {
  test(`${v} uses the wide inputs`, () => {
    const src = readFileSync(new URL(`./maintenance/app/views/${v}`, import.meta.url), "utf8");
    assert.match(src, /<table class="table table-sm align-middle box-phones-table">/);
    assert.match(src, /<div class="table-responsive box-phones-wrap">/);
    // بنفحص بالسطر: قيمة الخانة فيها وسم EJS (`%>`) فأى regex بتقف عند أول `>`
    // كانت بتقطع الوسم قبل ما توصل للـ class — وده كان بيدّى نتيجة غلط.
    const lines = src.split("\n");
    const phoneLines = lines.filter((l) => l.includes('name="phone"'));
    assert.ok(phoneLines.length >= 2, `${v}: expected the row and the add inputs`);
    for (const l of phoneLines) {
      assert.ok(l.includes("box-phone-input"), `${v}: a phone input is still narrow → ${l.trim()}`);
    }
    for (const l of lines.filter((l) => l.includes('<input name="notes"'))) {
      assert.ok(l.includes("box-notes-input"), `${v}: a notes input is still narrow → ${l.trim()}`);
    }
  });
}
