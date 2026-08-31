import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { phoneNormSql } from "./phone-norm";
import { phoneLookupKey } from "../client/src/lib/mobile-lookup";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const lookupStart = routes.indexOf('app.post("/api/phone-lines/mobile-lookup"');
const lookupEnd = routes.indexOf('app.get("/api/phone-lines/no-mobile-complaints"', lookupStart);

assert.ok(lookupStart >= 0, "the mobile lookup endpoint must exist");
assert.ok(lookupEnd > lookupStart, "the mobile lookup endpoint must have a bounded handler");
const lookupRoute = routes.slice(lookupStart, lookupEnd);

test("mobile lookup encodes manual, work-order, then FTTH priority", () => {
  const manual = lookupRoute.indexOf("SELECT lm.mobile AS m, 0 AS pr");
  const maintenance = lookupRoute.indexOf("SELECT mo.mobile AS m, 1 AS pr");
  const wfm = lookupRoute.indexOf("SELECT wc.mobile AS m, 1 AS pr");
  const ftth = lookupRoute.indexOf("SELECT fo.customer_mobile AS m, 2 AS pr");

  assert.ok(manual >= 0, "manual mobile source must be included");
  assert.ok(maintenance > manual, "maintenance work orders must follow manual values");
  assert.ok(wfm > maintenance, "current WFM work orders must share the work-order priority");
  assert.ok(ftth > wfm, "FTTH requests must follow work-order values");
  assert.match(lookupRoute, /ORDER BY x\.pr\s+LIMIT 1/);
});

test("mobile lookup matches full and short phone forms with one normalization rule", () => {
  const fullPhone = "88-280-1234";
  const shortPhone = "2801234";
  assert.equal(phoneLookupKey(fullPhone), shortPhone);
  assert.equal(phoneLookupKey(shortPhone), shortPhone);

  const normalizationSql = phoneNormSql("phone");
  assert.match(normalizationSql, /regexp_replace\(regexp_replace\(COALESCE\(phone::text, ''\)/);
  assert.match(normalizationSql, /'\^0\+'/);
  assert.match(normalizationSql, /LIKE '88%'/);
  assert.match(normalizationSql, /length\([\s\S]*\) > 7 THEN substring\([\s\S]* FROM 3\)/);

  for (const expression of ["p", "lm.full_phone", "mo.phone_number", "wc.phone_number", "fo.service_number"]) {
    assert.match(
      lookupRoute,
      new RegExp(`\\$\\{phoneNormSql\\("${expression.replace(".", "\\.")}"\\)\\}`),
      `${expression} must use the shared phone normalization`,
    );
  }
});

test("mobile lookup ignores blank, encoded, and too-short mobile values", () => {
  assert.match(lookupRoute, /WHERE NULLIF\(btrim\(x\.m\), ''\) IS NOT NULL/);
  assert.match(lookupRoute, /x\.m !~ '\[A-Za-z=\/\]' AND x\.m ~ '\[0-9\]\{5,\}'/);

  for (const source of ["mo.mobile", "wc.mobile", "fo.customer_mobile"]) {
    assert.match(
      lookupRoute,
      new RegExp(`${source.replace(".", "\\.")} !~ '\\[A-Za-z=\\/\\]' AND ${source.replace(".", "\\.")} ~ '\\[0-9\\]\\{5,\\}'`),
      `${source} must reject encoded or invalid values before priority selection`,
    );
  }
});