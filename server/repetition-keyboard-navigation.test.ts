import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const report = readFileSync(
  new URL("../client/src/components/RepetitionStatsReport.tsx", import.meta.url),
  "utf8",
);
const hook = readFileSync(
  new URL("../client/src/hooks/use-horizontal-keyboard-scroll.ts", import.meta.url),
  "utf8",
);

test("repetition details focus after loading and move horizontally with keyboard arrows", () => {
  assert.match(report, /useHorizontalKeyboardScroll\(repDetailOpen && !!repDetailData\)/);
  assert.match(report, /ref=\{repDetailScroll\.ref\}/);
  assert.match(report, /onKeyDown=\{repDetailScroll\.onKeyDown\}/);
  assert.match(hook, /event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"/);
  assert.match(hook, /event\.currentTarget\.scrollBy\(/);
  assert.match(hook, /behavior: "smooth"/);
  assert.match(hook, /focus\(\{ preventScroll: true \}\)/);
  assert.match(hook, /input, textarea, select, button, a/);
});