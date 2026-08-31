import assert from "node:assert/strict";
import test from "node:test";
import { expandBoxes } from "@shared/cab-norm";

test("expandBoxes supports ranges and ampersand/star lists", () => {
  assert.deepEqual(expandBoxes("2:6"), ["2", "3", "4", "5", "6"]);
  assert.deepEqual(expandBoxes("2&6"), ["2", "6"]);
  assert.deepEqual(expandBoxes("2*6"), ["2", "6"]);
  assert.deepEqual(expandBoxes("2:4*6&6"), ["2", "3", "4", "6"]);
});