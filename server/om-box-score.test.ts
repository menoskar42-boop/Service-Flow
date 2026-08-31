import assert from "node:assert/strict";
import test from "node:test";
import { matchesBoxScoreFilter } from "@shared/om-box-score";

test("box score filter keeps only broken boxes below the requested score", () => {
  assert.equal(matchesBoxScoreFilter(true, 12.5, true, "20"), true);
  assert.equal(matchesBoxScoreFilter(true, 20, true, "20"), false);
  assert.equal(matchesBoxScoreFilter(false, 12.5, true, "20"), false);
  assert.equal(matchesBoxScoreFilter(true, null, true, "20"), false);
});

test("box score filter without a limit can show all broken boxes", () => {
  assert.equal(matchesBoxScoreFilter(true, null, true, ""), true);
  assert.equal(matchesBoxScoreFilter(false, null, false, ""), true);
});