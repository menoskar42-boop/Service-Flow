import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requestExecPreempt } from "../client/src/lib/exec-queue";

const client = readFileSync(
  new URL("../client/src/components/ExecutorButton.tsx", import.meta.url),
  "utf8",
);
const queueLib = readFileSync(
  new URL("../client/src/lib/exec-queue.ts", import.meta.url),
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
  assert.match(completionBranch, /requestExecPreempt\(job\.id\)/);
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

test("a lost preempt response is reconciled after the server accepts the request", async () => {
  let serverAccepted = false;
  const outcome = await requestExecPreempt(73, async (input, init) => {
    if (init?.method === "POST") {
      serverAccepted = true;
      // حاكي تنفيذ الخادم ثم انقطاع الشبكة قبل وصول Response للمتصفح.
      throw new Error("network response lost");
    }
    assert.equal(input, "/api/exec-queue/73/preempt");
    return new Response(JSON.stringify({
      ok: true, accepted: true, status: "done", result: "preempted",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  assert.equal(serverAccepted, true);
  assert.equal(outcome, "response_lost");
});

test("an explicit rejected preempt response is not treated as accepted", async () => {
  const outcome = await requestExecPreempt(74, async (_input, init) => {
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({ ok: false, accepted: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  assert.equal(outcome, "send_failed");
});

test("completion handling leaves an uncertain preempt claimed for recovery", () => {
  assert.match(client, /requestExecPreempt\(job\.id\)/);
  assert.match(client, /result === "preempt_pending"/);
  const pendingBranch = client.slice(
    client.indexOf('} else if (result === "preempt_pending")'),
    client.indexOf('} else if (result === "canceled")', client.indexOf('} else if (result === "preempt_pending")')),
  );
  assert.doesNotMatch(pendingBranch, /fetch\([^)]*done/);
  assert.match(queueLib, /method: "GET"/);
  assert.match(routes, /app\.get\("\/api\/exec-queue\/:id\/preempt"/);
});