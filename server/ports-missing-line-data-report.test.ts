import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const start = routes.indexOf('app.get("/api/reports/ports-missing-line-data"');
const end = routes.indexOf('app.get("/api/reports/lines-without-port"', start);
assert.ok(start >= 0, "the MSAN ports missing-data endpoint must exist");
assert.ok(end > start, "the missing-data endpoint must have a bounded handler");
const route = routes.slice(start, end);

const client = readFileSync(
  new URL("../client/src/components/PortsMissingLineDataReport.tsx", import.meta.url),
  "utf8",
);

test("reports current MSAN ports with incomplete technical or subscriber data", () => {
  assert.match(route, /FROM phone_ports pp/);
  assert.match(route, /LEFT JOIN phone_lines pl ON pl\.full_phone = pp\.phone_number/);
  assert.match(route, /LEFT JOIN line_subscriber_info si ON si\.phone_number = pp\.phone_number/);
  assert.match(route, /pl\.full_phone IS NULL/);
  assert.match(route, /pl\.cabin_number::text/);
  assert.match(route, /pl\.box_number::text/);
  assert.match(route, /si\.sub_name::text/);
  assert.match(route, /si\.sub_add::text/);
  assert.match(route, /MAX\(uploaded_at\)/);
});

test("keeps search, pagination, and both export paths in the new report", () => {
  assert.match(route, /const \{ search = "", page = "1", limit = "50" \}/);
  assert.match(route, /LIMIT \$\$\{dataParams\.length - 1\} OFFSET \$\$\{dataParams\.length\}/);
  assert.match(client, /\/api\/reports\/ports-missing-line-data/);
  assert.match(client, /handleExportExcel/);
  assert.match(client, /handleExportPDF/);
});