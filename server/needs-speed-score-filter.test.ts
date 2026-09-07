import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const reportStart = routes.indexOf(
  'app.get(["/api/phone-lines/needs-speed", "/api/phone-lines/needs-speed-lowscore"',
);
const reportEnd = routes.indexOf(
  "  // GET /api/phone-lines/needs-po-stop",
  reportStart,
);
assert.ok(reportStart >= 0, "the needs-speed report endpoint must exist");
assert.ok(reportEnd > reportStart, "the needs-speed report endpoint must be bounded");
const reportRoute = routes.slice(reportStart, reportEnd);

const clientReport = readFileSync(
  new URL("../client/src/components/NeedsSpeedReport.tsx", import.meta.url),
  "utf8",
);

test("score bounds reach both paged and full-range report requests", () => {
  assert.match(
    clientReport,
    /if \(scoreFrom\.trim\(\)\) params\.set\("scoreFrom", scoreFrom\.trim\(\)\)/,
  );
  assert.match(
    clientReport,
    /if \(scoreTo\.trim\(\)\) params\.set\("scoreTo", scoreTo\.trim\(\)\)/,
  );
  assert.match(
    clientReport,
    /queryKey: \[endpoint,[\s\S]*scoreFrom, scoreTo,[\s\S]*page/,
    "score bounds must invalidate the paged table query",
  );
  assert.match(
    clientReport,
    /fetch\(`\$\{endpoint\}\?\$\{buildParams\(\)\}`/,
    "the table must use the paged parameter builder",
  );
  assert.match(
    clientReport,
    /new URLSearchParams\(\s*forExport \? \{ page: "1", limit: "20000" \} : \{ page: String\(page\), limit: String\(PAGE_SIZE\) \}/,
    "the full-range and paged requests must share one parameter builder",
  );
});

test("inclusive score bounds are applied to the count and page queries", () => {
  assert.match(
    reportRoute,
    /scoreFrom = "", scoreTo = ""/,
    "the endpoint must accept both score bounds",
  );
  assert.match(reportRoute, /m\.score >= \$\$\{params\.length\}/);
  assert.match(reportRoute, /m\.score <= \$\$\{params\.length\}/);

  const scoreFilterEnd = reportRoute.indexOf("const whereNoQ");
  const countQuery = reportRoute.indexOf("const totalRes = await pool.query");
  const pageQuery = reportRoute.indexOf("const dataRes = await pool.query");
  assert.ok(scoreFilterEnd >= 0 && countQuery > scoreFilterEnd);
  assert.ok(pageQuery > countQuery);

  const querySection = reportRoute.slice(countQuery, pageQuery + 500);
  assert.match(querySection, /SELECT COUNT\(\*\)::int AS c \$\{joinClause\} \$\{where\}/);
  assert.match(querySection, /\$\{joinClause\} \$\{where\}/);
  assert.match(
    reportRoute,
    /LIMIT \$\$\{params\.length - 1\} OFFSET \$\$\{params\.length\}/,
    "the paged query must add pagination after the shared filtered parameter list",
  );
});

test("Excel, PDF, measurement, and speed-raise actions use the filtered range", () => {
  const fullRangeRequests = clientReport.match(
    /fetch\(`\$\{endpoint\}\?\$\{buildParams\(true\)\}`/g,
  ) ?? [];
  assert.equal(
    fullRangeRequests.length,
    4,
    "DZS measurement, speed raise, Excel, and PDF must all request the same full filtered range",
  );
  assert.match(clientReport, /onClick=\{handleMeasureDZS\}/);
  assert.match(clientReport, /onClick=\{\(\) => handleRaiseSpeed\("raise"\)\}/);
  assert.match(clientReport, /onClick=\{\(\) => handleRaiseSpeed\("stop"\)\}/);
  assert.match(clientReport, /const handleExport = async \(\) =>/);
  assert.match(clientReport, /const handleExportPDF = async \(\) =>/);
});