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

  assert.match(helper, /e\.type IN \('measure','raise','stop'\)/);
  assert.match(helper, /qa\.acc = \$\{accCol\}/);
  assert.match(helper, /e\.status IN \('pending','claimed'\)/);
  assert.match(
    helper,
    /e\.batch_id IN \(SELECT b\.batch_id FROM exec_jobs b[\s\S]*?b\.status IN \('pending','claimed'\)/,
    "a line must remain excluded when another task in its batch is still active",
  );
  assert.match(helper, /b\.batch_id IS NOT NULL/);
});

test("the with-account report applies the shared rule and reports the excluded count", () => {
  assert.match(accountReport, /const queuedClause = excludeQueuedOn\(req\) \? ` AND \$\{notQueuedSql\("la\.account_no"\)\}` : ""/);
  assert.match(accountReport, /beforeExclRes/);
  assert.match(accountReport, /queuedExcluded = beforeExclRes \? Math\.max\(0, .* - total\)/);
  assert.match(accountReport, /queuedExcluded/);

  assert.match(withAccountClient, /params\.set\("excludeQueued", "1"\)/);
  assert.match(withAccountClient, /setExcludeQueued/);
  assert.match(withAccountClient, /الطابور مستبعَد/);
});