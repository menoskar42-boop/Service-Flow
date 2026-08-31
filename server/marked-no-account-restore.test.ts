import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const reportStart = routes.indexOf('app.get("/api/reports/regularized-faults-range"');
const reportEnd = routes.indexOf('app.get("/api/reports/repeated-within-month"', reportStart);
assert.ok(reportStart >= 0, "the regularized faults range endpoint must exist");
assert.ok(reportEnd > reportStart, "the regularized faults range endpoint must have a bounded handler");
const reportRoute = routes.slice(reportStart, reportEnd);

test("automatically restores marked lines found in the regularized range", () => {
  assert.match(reportRoute, /const regularizedPhones = rows[\s\S]*?phoneShort/);
  assert.match(reportRoute, /DELETE FROM lines_no_account na/);
  assert.match(reportRoute, /USING unnest\(\$1::text\[\]\) AS candidate\(phone\)/);
  assert.match(
    reportRoute,
    /\$\{sp\("na\.full_phone"\)\} = \$\{sp\("candidate\.phone"\)\}/,
  );
  assert.match(reportRoute, /req\.user\?\.role !== ROLES\.SALES/);
});

test("does not place automatic restoration in the neighboring installations report", () => {
  const installationsStart = routes.indexOf('app.get("/api/reports/installations-by-tech"');
  assert.ok(installationsStart >= 0, "an installations report must exist");
  const beforeRegularized = routes.slice(installationsStart, reportStart);
  assert.doesNotMatch(beforeRegularized, /regularizedPhones|DELETE FROM lines_no_account na/);
});