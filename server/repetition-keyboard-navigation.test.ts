import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const report = readFileSync(
  new URL("../client/src/components/RepetitionStatsReport.tsx", import.meta.url),
  "utf8",
);

test("repetition details focus after loading and move horizontally with keyboard arrows", () => {
  assert.match(report, /repDetailOpen && repDetailData/);
  assert.match(report, /focus\(\{ preventScroll: true \}\)/);
  assert.match(report, /\[repDetailOpen, repDetailData\]/);
  assert.match(report, /onKeyDown=\{handleRepDetailKeyDown\}/);
  assert.match(report, /event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"/);
  assert.match(report, /event\.currentTarget\.scrollBy\(/);
  assert.match(report, /behavior: "smooth"/);
});