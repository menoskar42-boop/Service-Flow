import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// تقرير «تحتاج إيقاف PO» والباتش اليومى (٩ ص) بياخدوا بس الخطوط اللى الـ PO بتاعها
// **لسه شغّال أو حالته مش معروفة**. اللى حالته بتقول إنه واقف خلاص (الشارة الخضرا
// «اكتمل …» والصفرا «مش شغّال»/«ماتعملش») مالوش لازمة — الإيقاف اتعمل عليه فعلاً.
//
// مُثبت end-to-end على سيرفر + قاعدة بيانات حقيقيين: ٥ خطوط كلها مؤهّلة للتقرير
// والفرق الوحيد بينها هو حالة البروفايل —
//   ACC1 فاضية                         → دخلت ✓
//   ACC2 «PO is running…»              → دخلت ✓
//   ACC3 «PO is not currently running.PO was completed on …» → اتشالت ✓
//   ACC4 «PO is not currently running.» → اتشالت ✓
//   ACC5 «never been optimized»         → اتشالت ✓
// النتيجة: التقرير رجّع 2 (ACC1, ACC2)، والباتش اليومى فتح بنفس الـ 2 بالظبط.
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

const i = routes.indexOf("const poNotStoppedSql =");
assert.ok(i >= 0, "poNotStoppedSql must exist");
const fn = routes.slice(i, routes.indexOf("`;", i));

test("the rule is written as an explicit negation, not a match on 'running'", () => {
  // «PO is not currently running» بتحتوى «running» — فالتطابق على «running» لوحده
  // كان هيدخّل الخطوط الواقفة بالغلط. لازم يفضل نفى صريح.
  assert.match(fn, /NOT \(/);
  assert.match(fn, /PO\\\\s\+is\\\\s\+not\\\\s\+\(currently\\\\s\+\)\?running/);
  assert.match(fn, /never\\\\s\+\(been\\\\s\+\)\?\(run\|optimi\[sz\]ed\)/);
  // الفاضى والمش-معروف بيدخلوا
  assert.match(fn, /IS NULL OR btrim\(\$\{col\}\) = ''/);
});

test("the report and the 9am batch use the exact same rule", () => {
  const uses = routes.match(/\$\{poNotStoppedSql\("[^"]+"\)\}/g) ?? [];
  assert.equal(uses.length, 2, "لازم يتنادى مرتين بالظبط: التقرير + الباتش اليومى");
  // التقرير
  const rep = routes.indexOf('app.get("/api/phone-lines/needs-po-stop"');
  assert.ok(rep >= 0);
  assert.match(routes.slice(rep, rep + 3000), /\$\{poNotStoppedSql\("latest\.po_status"\)\}/);
  // الباتش اليومى
  const auto = routes.indexOf("const autoPoStopAccounts");
  assert.ok(auto >= 0);
  const body = routes.slice(auto, auto + 2600);
  assert.match(body, /\$\{poNotStoppedSql\("m\.po_status"\)\}/);
  // و الـ CTE بتاعته لازم تكون بتختار العمود أصلاً
  assert.match(body, /c\.full_phone, c\.score, c\.po_status, c\.uploaded_at,/);
});
