import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const reportStart = routes.indexOf('app.get("/api/phone-lines/no-mobile-complaints"');
const reportEnd = routes.indexOf('app.post("/api/line-mobile-checked"', reportStart);
assert.ok(reportStart >= 0, "the no-mobile complaints endpoint must exist");
assert.ok(reportEnd > reportStart, "the no-mobile complaints endpoint must have a bounded handler");
const reportRoute = routes.slice(reportStart, reportEnd);

const clientReport = readFileSync(
  new URL("../client/src/components/NoMobileComplaintsReport.tsx", import.meta.url),
  "utf8",
);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("merges a complaint found in details and remaining into one row", () => {
  const key = `COALESCE(NULLIF(btrim("ticketId"), ''), "source" || ':' || "recordId")`;
  assert.match(
    reportRoute,
    new RegExp(`SELECT DISTINCT ON \\(${escapeRegExp(key)}\\) \\*`),
  );
  assert.match(
    reportRoute,
    new RegExp(`ORDER BY ${escapeRegExp(key)},`),
  );

  const details = reportRoute.indexOf("FROM complaint_details cd");
  const remaining = reportRoute.indexOf("FROM remaining_complaints rc");
  assert.ok(details >= 0 && remaining > details, "both complaint sources must feed the same CTE");
  assert.match(reportRoute, /WHEN 'تفاصيل' THEN 0\s+WHEN 'متبقى' THEN 1/);
});

test("excludes lines with a mobile from every supported source", () => {
  const mobileSet = routes.match(
    /const HAS_MOBILE_SET = `([\s\S]*?)`;/,
  )?.[1];
  assert.ok(mobileSet, "the shared mobile source set must exist");
  assert.match(mobileSet, /FROM line_mobiles lm/);
  assert.match(mobileSet, /FROM maintenance_orders mo/);
  assert.match(mobileSet, /FROM ftth_orders_current fo/);

  assert.match(
    reportRoute,
    /NOT EXISTS \(SELECT 1 FROM \$\{HAS_MOBILE_SET\} hm WHERE hm\.ph = \$\{sp\('e\."fullPhone"'\)\}\)/,
  );
  assert.match(
    mobileSet,
    /NULLIF\(btrim\(lm\.mobile\), ''\) IS NOT NULL/,
  );
  assert.match(
    mobileSet,
    /mo\.mobile !~ '\[A-Za-z=\/\]' AND mo\.mobile ~ '\[0-9\]\{5,\}'/,
  );
  assert.match(
    mobileSet,
    /fo\.customer_mobile !~ '\[A-Za-z=\/\]' AND fo\.customer_mobile ~ '\[0-9\]\{5,\}'/,
  );
});

test("uses the same date and report filters for totals and paged rows", () => {
  for (const condition of [
    "dateFrom", "dateTo", "central", "cabin", "box", "phoneFrom", "phoneTo", "search",
  ]) {
    assert.match(reportRoute, new RegExp(`\\b${condition}\\b`), `${condition} must be handled by the API`);
  }

  assert.match(reportRoute, /const totalRes = await pool\.query\(`\$\{sourceSql\} SELECT COUNT\(\*\)::int AS c FROM enriched e \$\{where\}`/);
  assert.match(reportRoute, /const dataRes = await pool\.query\(\s+`\$\{sourceSql\}[\s\S]+?FROM enriched e\s+\$\{where\}/);
  assert.match(reportRoute, /LIMIT \$\$\{params\.length - 1\} OFFSET \$\$\{params\.length\}/);

  assert.match(clientReport, /new URLSearchParams\(\{ page: String\(page\), limit: String\(PAGE_SIZE\) \}\)/);
  for (const parameter of [
    "dateFrom", "dateTo", "central", "cabin", "box", "phoneFrom", "phoneTo", "search",
  ]) {
    assert.match(clientReport, new RegExp(`params\\.set\\("${parameter}"`), `${parameter} must reach the API`);
  }
  assert.match(
    clientReport,
    /const totalPages = data \? Math\.ceil\(data\.total \/ PAGE_SIZE\) : 1/,
  );
});
