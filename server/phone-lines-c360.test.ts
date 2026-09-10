import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// زر «أكونت Customer360» فى بيان التليفونات: بيجيب/يحدّث رقم الأكونت لأرقام
// **الفلتر الحالى**. ومعاه إصلاح لازم: عمود الأكونت كان بيقرا من آخر قياس فقط
// (case_138)، فالخط اللى ماتقاسش عمره كان بيفضل «بدون أكونت» حتى بعد ما
// Customer360 يجيب أكونته — يعنى الزر كان هيشتغل والنتيجة ماتظهرش.
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const report = readFileSync(
  new URL("../client/src/components/PhoneLinesReport.tsx", import.meta.url), "utf8");

const start = routes.indexOf('app.get("/api/phone-lines", requireAuth');
assert.ok(start >= 0, "the phone-lines endpoint must exist");
const ep = routes.slice(start, routes.indexOf('app.get("/api/phone-lines/', start));

test("the account column falls back to the Customer360 store", () => {
  assert.match(ep, /LEFT JOIN line_accounts la ON la\.full_phone = k\.full_phone/);
  assert.match(ep,
    /COALESCE\(NULLIF\(btrim\(c138p\.account_no\), ''\), NULLIF\(btrim\(la\.account_no\), ''\)\) AS "accountNo"/);
  // القياس لازم يفضل الأول — الإضافة مالهاش حق تغيّر أكونت خط متقاس
  const coalesce = ep.match(/COALESCE\(NULLIF\(btrim\(c138p\.account_no\)[^\n]*/)?.[0] ?? "";
  assert.ok(coalesce.indexOf("c138p") < coalesce.indexOf("la.account_no"),
    "case_138 must stay ahead of line_accounts");
});

test("the button runs on the filtered range, not the visible page", () => {
  const i = report.indexOf("const handleC360");
  assert.ok(i >= 0, "handleC360 must exist");
  const fn = report.slice(i, i + 3200);
  // نفس فلاتر التصدير بالظبط
  for (const f of ["central", "cabin", "box", "phoneFrom", "phoneTo", "search"]) {
    assert.match(fn, new RegExp(`params\\.set\\("${f}"`), `the ${f} filter must be forwarded`);
  }
  assert.match(fn, /limit: "20000"/);
  assert.match(fn, /openCustomer360\(phones\)/);
});

test("it refuses to run with no filter at all", () => {
  const fn = report.slice(report.indexOf("const handleC360"), report.indexOf("const openDZSSingle"));
  assert.match(fn, /const hasFilter = !!\(central \|\| cabin \|\| box \|\| phoneFrom\.trim\(\) \|\| phoneTo\.trim\(\) \|\| search\.trim\(\)\)/);
  assert.match(fn, /if \(!hasFilter\)/);
});

test("it defaults to the numbers that have no account", () => {
  const fn = report.slice(report.indexOf("const handleC360"), report.indexOf("const openDZSSingle"));
  assert.match(fn, /const missing = all\.filter\(\(r\) => !String\(r\.accountNo \?\? ""\)\.trim\(\)\)/);
  assert.match(fn, /let pick = missing;/);
  // Customer360 بيلفّ على كل الأرقام فى تاب واحد → تحذير قبل العدد الكبير
  assert.match(fn, /phones\.length > 200 &&/);
});

test("the table refreshes once the accounts come back", () => {
  const fn = report.slice(report.indexOf("const handleC360"), report.indexOf("const openDZSSingle"));
  assert.match(fn, /invalidateQueries\(\{ queryKey: \["\/api\/phone-lines"\] \}\)/);
});

test("the button sits with the other queue tools", () => {
  assert.match(report, /أكونت Customer360/);
  assert.match(report, /import \{ openCustomer360 \} from "@\/lib\/customer360";/);
});
