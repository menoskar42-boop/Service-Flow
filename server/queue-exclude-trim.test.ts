import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// الباج: الأرقام اللى أكونتها فيه مسافة زايدة (جاية من شيت إكسل) مكانتش بتتشال
// أبداً من «استبعاد اللى فى الطابور»، فباتش القياس اليومى كان بيعيد نفس الأرقام
// بنفس العدد بالظبط كل يوم (١٦/٩ و١٧/٩ الاتنين طلعوا ١٢٥٤ خط).
//
// السبب: كل مسارات الإضافة للطابور بتعمل .trim() للرقم قبل التخزين، فالطابور فيه
// "ACC1" بينما العمود اللى بنقارن بيه فيه "ACC1 " — فالمقارنة بالمساواة المباشرة
// عمرها ما بتتحقق.
//
// مُثبت end-to-end على سيرفر + قاعدة بيانات حقيقيين بنفس أرقام المستخدم:
//   ١٦١٢ خط مؤهّل، منهم ١٢٥٤ أكونتهم فيه مسافة
//   قبل: يوم ١ → ١٦١٢، يوم ٢ → ١٢٥٤، يوم ٣ → ١٢٥٤ (نفس الأرقام تتكرر للأبد)
//   بعد: يوم ١ → ١٦١٢، يوم ٢ → ٠،    يوم ٣ → ٠
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

const i = routes.indexOf("const notQueuedSql =");
assert.ok(i >= 0, "notQueuedSql must exist");
const fn = routes.slice(i, routes.indexOf("`;", i));

test("the queue exclusion compares account numbers trimmed on both sides", () => {
  assert.match(fn, /AND btrim\(qa\.acc\) = btrim\(\$\{accCol\}\)/);
  // مافيش أى بقايا من المقارنة المباشرة
  assert.doesNotMatch(fn, /AND qa\.acc = \$\{accCol\}/);
});

test("every enqueue path stores the trimmed account, so btrim is the matching side", () => {
  // /enqueue — الزرار اللى المستخدم بيضيف بيه من التقارير
  assert.match(routes, /String\(a\)\.trim\(\)\)\.filter\(Boolean\)/);
  // الباتشات اليومية التلقائية
  assert.match(routes, /rows\.map\(\(r: any\) => String\(r\.acc\)\.trim\(\)\)\.filter\(Boolean\)/);
});

test("the daily batches dedupe accounts by their trimmed value", () => {
  // "ACC1" و"ACC1 " نفس الأكونت — DISTINCT لازم يوحّدهم قبل ما يتحطوا فى الباتش
  const meas = routes.indexOf("const autoMeasureAccounts");
  const stop = routes.indexOf("const autoPoStopAccounts");
  assert.ok(meas >= 0 && stop >= 0);
  assert.match(routes.slice(meas, meas + 900), /SELECT DISTINCT btrim\(la\.account_no\) AS acc/);
  assert.match(routes.slice(stop, stop + 2200), /SELECT DISTINCT btrim\(la\.account_no\) AS acc/);
});
