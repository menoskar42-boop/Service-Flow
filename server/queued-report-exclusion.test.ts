import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const accountReportStart = routes.indexOf('app.get("/api/phone-lines/with-account"');
const accountReportEnd = routes.indexOf('app.get("/api/phone-lines/without-account"', accountReportStart);
assert.ok(accountReportStart >= 0, "the with-account report endpoint must exist");
assert.ok(accountReportEnd > accountReportStart, "the with-account report endpoint must have a bounded handler");
const accountReport = routes.slice(accountReportStart, accountReportEnd);

const withAccountClient = readFileSync(
  new URL("../client/src/components/WithAccountReport.tsx", import.meta.url),
  "utf8",
);

test("queue exclusion is based on active jobs and active batches", () => {
  const helperStart = routes.indexOf("const notQueuedSql");
  const helperEnd = routes.indexOf("\n\n//", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "the shared queue exclusion helper must exist");
  const helper = routes.slice(helperStart, helperEnd);

  // الأنواع بقت بارامتر (الباتشات اليومية بتستبعد بنوعها هى بس)، والافتراضى
  // للتقارير هو نفس التلاتة زى ما كان بالظبط.
  assert.match(helper, /types: readonly string\[\] = \["measure", "raise", "stop"\]/);
  assert.match(helper, /e\.type IN \(\$\{types\.map\(/);
  // btrim على الطرفين — الطابور بيخزّن الرقم بعد trim والعمود ممكن يكون فيه مسافة
  assert.match(helper, /btrim\(qa\.acc\) = btrim\(\$\{accCol\}\)/);
  assert.match(helper, /e\.status IN \('pending','claimed'\)/);
  assert.match(
    helper,
    /e\.batch_id IN \(SELECT b\.batch_id FROM exec_jobs b[\s\S]*?b\.status IN \('pending','claimed'\)/,
    "a line must remain excluded when another task in its batch is still active",
  );
  assert.match(helper, /b\.batch_id IS NOT NULL/);
});

test("the with-account report applies the shared rule and reports the excluded count", () => {
  // بقى بياخد النوع المختار من القائمة بدل زرار تشغيل/إطفاء
  assert.match(accountReport, /const queuedTypes = excludeQueuedTypes\(req\);/);
  assert.match(accountReport, /const queuedClause = queuedTypes \? ` AND \$\{notQueuedSql\("la\.account_no", queuedTypes\)\}` : ""/);
  assert.match(accountReport, /beforeExclRes/);
  assert.match(accountReport, /queuedExcluded = beforeExclRes \? Math\.max\(0, .* - total\)/);
  assert.match(accountReport, /queuedExcluded/);

  // الواجهة بقت بتبعت **النوع** المختار من القائمة بدل "1"، والعدّاد بقى جوّه
  // المكوّن المشترك QueueExcludeSelect بدل نص على الزرار.
  assert.match(withAccountClient, /params\.set\("excludeQueued", excludeQueued\)/);
  assert.match(withAccountClient, /<QueueExcludeSelect/);
  assert.match(withAccountClient, /excluded=\{data\?\.queuedExcluded \?\? null\}/);
});