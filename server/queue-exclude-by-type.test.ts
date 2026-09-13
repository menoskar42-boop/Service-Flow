import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// «استبعاد اللى فى الطابور» فى التقارير بقى **قائمة بالنوع** بدل زرار تشغيل/إطفاء:
// قياس | إيقاف PO | رفع سرعة. الزرار القديم كان بيستبعد التلاتة مع بعض، فرقم
// مستنى قياس كان بيختفى من تقرير «تحتاج إيقاف PO» رغم إن الإيقاف مالوش دعوة بالقياس.
//
// مُثبت end-to-end على سيرفر حقيقى — أربع أرقام كلها مؤهّلة للتقرير، كل واحد فى
// الطابور بنوع مختلف:
//   بدون      → الأربعة ظاهرين (0 مستبعَد)
//   measure   → A_MEAS بس اتشال (1)
//   stop      → A_STOP بس اتشال (1)
//   raise     → A_RAISE بس اتشال (1)
//   1 (قديم)  → التلاتة اتشالوا (3) — التوافق الخلفى شغّال
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const sel = readFileSync(
  new URL("../client/src/components/QueueExcludeSelect.tsx", import.meta.url), "utf8");

const REPORTS = ["WithAccountReport", "RegularizedFaultsRangeReport",
                 "ComplaintNoMeasureReport", "NeedsSpeedReport"];

test("the server reads the excluded types from the query", () => {
  const i = routes.indexOf("const excludeQueuedTypes");
  assert.ok(i >= 0, "excludeQueuedTypes must exist");
  const fn = routes.slice(i, routes.indexOf("\n};", i));
  assert.match(fn, /if \(!v\) return null;/);
  // التوافق الخلفى: الروابط القديمة ?excludeQueued=1 لسه معناها كل الأنواع
  assert.match(fn, /if \(v === "1" \|\| v === "true"\) return QUEUE_EXCLUDE_TYPES;/);
  // أى نوع مش من التلاتة بيتفلتر — مافيش أى نص من المستخدم بيدخل الـ SQL
  assert.match(fn, /\(QUEUE_EXCLUDE_TYPES as readonly string\[\]\)\.includes\(x\)/);
  assert.match(routes, /const QUEUE_EXCLUDE_TYPES = \["measure", "raise", "stop"\] as const;/);
});

test("every report call site passes the chosen types through", () => {
  // مافيش أى موضع فاضل بيستبعد من غير ما يحدّد النوع
  assert.doesNotMatch(routes, /excludeQueuedOn\(/, "the old boolean helper must be gone");
  const calls = [...routes.matchAll(/notQueuedSql\("[^"]+",\s*(queuedTypes|qTypes|\["(measure|stop)"\])\)/g)];
  assert.ok(calls.length >= 7, `expected every call site to pass types, found ${calls.length}`);
});

test("the dropdown offers exactly the three reasons plus off", () => {
  assert.match(sel, /value: "",\s*label: "بدون استبعاد من الطابور"/);
  assert.match(sel, /value: "measure", label: "استبعاد من الطابور: قياس"/);
  assert.match(sel, /value: "stop",\s*label: "استبعاد من الطابور: إيقاف PO"/);
  assert.match(sel, /value: "raise",\s*label: "استبعاد من الطابور: رفع سرعة"/);
  assert.match(sel, /export type QueueExcludeValue = "" \| "measure" \| "stop" \| "raise";/);
});

for (const r of REPORTS) {
  test(`${r} uses the shared dropdown and sends the type`, () => {
    const src = readFileSync(new URL(`../client/src/components/${r}.tsx`, import.meta.url), "utf8");
    assert.match(src, /import \{ QueueExcludeSelect, type QueueExcludeValue \} from "@\/components\/QueueExcludeSelect";/);
    assert.match(src, /<QueueExcludeSelect/);
    assert.match(src, /useState<QueueExcludeValue>/);
    // القيمة نفسها هى اللى بتتبعت — مش "1"
    assert.match(src, /set\("excludeQueued", excludeQueued\)/);
    assert.doesNotMatch(src, /set\("excludeQueued", "1"\)/);
    // الزرار القديم اتشال
    assert.doesNotMatch(src, /variant=\{excludeQueued \? "default" : "outline"\}/);
  });
}

// التقرير ده كان الاستبعاد مفعّل فيه افتراضياً — يفضل مفعّل بس بنوع «قياس».
test("the never-measured report still defaults to excluding queued measures", () => {
  const src = readFileSync(
    new URL("../client/src/components/WithAccountReport.tsx", import.meta.url), "utf8");
  assert.match(src, /useState<QueueExcludeValue>\(neverMeasured \? "measure" : ""\)/);
});
