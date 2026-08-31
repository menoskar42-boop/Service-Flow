import assert from "node:assert/strict";
import test from "node:test";
import { boxAverageFromAggregate, matchesBoxScoreFilter } from "@shared/om-box-score";

test("box average uses valid latest-score aggregate values and rounds to one decimal", () => {
  assert.deepEqual(boxAverageFromAggregate({ sum: 37, measured: 3 }), {
    avgScore: 12.3,
    measuredCount: 3,
  });
  assert.deepEqual(boxAverageFromAggregate({ sum: 100, measured: 0 }), {
    avgScore: null,
    measuredCount: 0,
  });
  assert.deepEqual(boxAverageFromAggregate(undefined), {
    avgScore: null,
    measuredCount: 0,
  });
});

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