import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(
  new URL("../client/src/components/ExecutorButton.tsx", import.meta.url),
  "utf8",
);
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

test("a successful timeout preempt is not submitted again during completion", () => {
  const timeoutBranch = client.slice(
    client.indexOf("if (Date.now() - measureStartedAt >= STALL_MS)"),
    client.indexOf("closeWin();\n        return stopped", client.indexOf("if (Date.now() - measureStartedAt >= STALL_MS")),
  );
  assert.match(timeoutBranch, /refreshAfterMeasureTimeout\(jobId, batchId\)/);
  assert.match(timeoutBranch, /"preempted_by_timeout"/);

  const completionBranch = client.slice(
    client.indexOf('if (result === "preempted")'),
    client.indexOf('} else if (result === "preempted_by_timeout")', client.indexOf('if (result === "preempted")')),
  );
  assert.match(completionBranch, /\/preempt/);
  assert.doesNotMatch(completionBranch, /preempted_by_timeout/);
  assert.match(client, /else if \(result === "preempted_by_timeout"\)/);
});

test("the preempt endpoint keeps its claimed-status duplicate guard", () => {
  const preemptStart = routes.indexOf('app.post("/api/exec-queue/:id/preempt"');
  const preemptEnd = routes.indexOf('app.get("/api/exec-queue/position"', preemptStart);
  assert.ok(preemptStart >= 0 && preemptEnd > preemptStart, "the preempt route must exist");
  const preemptRoute = routes.slice(preemptStart, preemptEnd);
  assert.match(
    preemptRoute,
    /UPDATE exec_jobs SET status = 'done'[\s\S]*?WHERE id = \$1 AND status = 'claimed'/,
  );
  assert.match(preemptRoute, /duplicate: true/);
});