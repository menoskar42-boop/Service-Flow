import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

// معيار «محتاجة رفع سرعة» لازم يفضل **تعريف واحد** — التقرير نفسه، وتقريرا «خرجت بعد
// القياس»، وتقرير «تحتاج إيقاف PO» (بالعكس) كلهم بيتفرّعوا منه. لما كان مكتوب بالنص
// ٣ مرات كان أى تعديل لازم يتعمل ٣ مرات وإلا التقارير تتناقض.
test("the speed-raise criterion is defined once and reused everywhere", () => {
  assert.match(routes, /const needsSpeedSql = \(a: string\) => `\(/);
  assert.match(routes, /const qualifies = needsSpeedSql;/,
    "the needs-speed handler must reuse the shared criterion");
  assert.match(routes, /: needsSpeedSql\("latest"\)\}/,
    "the main (non low-score) path must reuse the shared criterion");
  assert.match(routes, /AND NOT COALESCE\(\$\{needsSpeedSql\("latest"\)\}, false\)/,
    "needs-po-stop must be the exact inverse of the shared criterion");
  // مفيش أى نسخة مكتوبة بالنص فاضلة
  assert.doesNotMatch(routes, /cur_n \/ \w+\.mx_n < 0\.6 AND \w+\.score > 15/,
    "no hand-copied 0.6 variant of the criterion may remain");
});

// حدود الميجابت بالـ Kbps (الاصطلاح فى الملف: القيم العشرية × 1024).
test("the megabit thresholds use the file's own Kbps convention", () => {
  assert.match(routes, /const SPEED_20M = 20 \* 1024;/);
  assert.match(routes, /const SPEED_30M = 30 \* 1024;/);
});

test("above 30 Mbps no speed raise is requested, whatever the ratio or score", () => {
  assert.match(
    routes,
    /AND NOT \(COALESCE\(\$\{a\}\.cur_n, 0\) > \$\{SPEED_30M\}\)/,
    "the 30 Mbps cap must sit at the top level so it also overrides the low-score branch",
  );
  // لازم يكون **برّه** الفرعين — لو اتحط جوّه فرع النسبة، خط اسكوره < 16 كان
  // هيعدّى من الفرع التانى رغم إن سرعته أعلى من 30 ميجا.
  const helper = routes.slice(routes.indexOf("const needsSpeedSql ="), routes.indexOf("const needsSpeedSql =") + 1600);
  const capAt = helper.indexOf("> ${SPEED_30M}");
  const branchesAt = helper.indexOf("AND ((${a}.mx_n > 0");
  assert.ok(capAt >= 0 && branchesAt > capAt, "the cap must precede the two branches");
});

test("above 20 Mbps the ratio bar tightens from 60% to 31%", () => {
  assert.match(
    routes,
    /cur_n \/ \$\{a\}\.mx_n < \(CASE WHEN COALESCE\(\$\{a\}\.cur_n, 0\) > \$\{SPEED_20M\} THEN 0\.31 ELSE 0\.6 END\)/,
  );
});

// «اسكور منخفض وسرعة عالية» تقرير تشخيصى مستقل — بيدوّر على السرعات العالية أصلاً،
// فحد الـ 30 ميجا مايتطبّقش عليه وإلا التقرير يفضى.
test("the low-score/high-speed report keeps its own criterion", () => {
  assert.match(routes, /latest\.score < 16\s*\n\s*AND latest\.cur_n >= 10000/);
});
