import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EXEC_BATCH_REFRESH_DELAY_MS,
  EXEC_BATCH_REFRESH_KEY,
  EXEC_MEASURE_STALL_MS,
  type ExecQueueStorage,
  refreshDueExecBatch,
  recoverTimedOutMeasure,
} from "../client/src/lib/exec-queue";

const client = readFileSync(
  new URL("../client/src/components/ExecutorButton.tsx", import.meta.url),
  "utf8",
);
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

class MemoryStorage implements ExecQueueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

type JobStatus = "pending" | "claimed" | "done" | "stale";
type FakeJob = {
  id: number;
  batchId: string;
  accounts: string[];
  status: JobStatus;
  result?: string;
};

test("measurement timeout survives reload and resumes only unfinished work", async () => {
  assert.equal(EXEC_MEASURE_STALL_MS, 3 * 60 * 1000);
  assert.equal(EXEC_BATCH_REFRESH_DELAY_MS, 60 * 1000);
  assert.match(client, /const STALL_MS = EXEC_MEASURE_STALL_MS/);
  assert.match(client, /requestExecPreempt\(id\)/);
  assert.match(client, /fetch\("\/api\/exec-queue\/requeue"/);
  assert.match(client, /refreshDueExecBatch\(/);

  const batchId = "batch-restart-test";
  const completedAccount = "100";
  const remainingAccounts = ["200", "300"];
  const jobs: FakeJob[] = [
    {
      id: 41,
      batchId,
      accounts: [completedAccount, ...remainingAccounts],
      status: "claimed",
    },
    {
      id: 42,
      batchId,
      accounts: [completedAccount],
      status: "done",
      result: "done",
    },
  ];
  const storage = new MemoryStorage();
  const events: string[] = [];
  const reloads: string[] = [];
  const busy = new Set<number>();
  const completed = new Set<number>();
  const startedAt = 1_800_000_000_000;
  let now = startedAt + EXEC_MEASURE_STALL_MS;
  let nextJobId = 43;

  // هذا نموذج صغير لنفس التحويلات الذرية التى تستخدمها endpoints الباتش:
  // preempt يقفل الأصل ويضيف المتبقى، وrequeue لا يلمس done.
  const preempt = async (jobId: number): Promise<{ ok: boolean }> => {
    const job = jobs.find((candidate) => candidate.id === jobId);
    assert.ok(job);
    assert.equal(job.status, "claimed");
    job.status = "done";
    job.result = "preempted";
    jobs.push({
      id: nextJobId++,
      batchId: job.batchId,
      accounts: remainingAccounts,
      status: "pending",
    });
    events.push("preempt");
    return { ok: true };
  };

  const timeoutResult = await recoverTimedOutMeasure({
    jobId: 41,
    batchId,
    preempt,
    busy,
    completed,
    now: () => now,
    storage,
    reload: () => reloads.push("timeout"),
  });

  assert.equal(timeoutResult, "handled");
  assert.deepEqual(events, ["preempt"]);
  assert.deepEqual(reloads, ["timeout"]);
  assert.deepEqual(
    JSON.parse(storage.getItem(EXEC_BATCH_REFRESH_KEY) || "{}"),
    { [batchId]: now + EXEC_BATCH_REFRESH_DELAY_MS },
  );
  assert.equal(jobs.find((job) => job.id === 41)?.status, "done");
  assert.equal(jobs.find((job) => job.id === 42)?.status, "done");
  assert.deepEqual(
    jobs.filter((job) => job.status === "pending").flatMap((job) => job.accounts),
    remainingAccounts,
  );

  // إعادة تحميل الصفحة لا تفقد الموعد لأن العلامة محفوظة فى localStorage.
  now += EXEC_BATCH_REFRESH_DELAY_MS;
  const refreshResult = await refreshDueExecBatch({
    storage,
    now: () => now,
    requeue: async (requestedBatchId) => {
      assert.equal(requestedBatchId, batchId);
      const active = jobs.filter(
        (job) => job.batchId === requestedBatchId && ["pending", "claimed", "stale"].includes(job.status),
      );
      for (const job of active) job.status = "pending";
      events.push("requeue");
      return { ok: true, requeued: active.length };
    },
    beforeReload: () => reloads.push("before-requeue-reload"),
    reload: () => reloads.push("requeue"),
  });

  assert.deepEqual(refreshResult, {
    status: "handled",
    batchId,
    requeued: 1,
  });
  assert.deepEqual(events, ["preempt", "requeue"]);
  assert.deepEqual(reloads, ["timeout", "before-requeue-reload", "requeue"]);
  assert.equal(storage.getItem(EXEC_BATCH_REFRESH_KEY), "{}");
  assert.equal(jobs.find((job) => job.id === 42)?.status, "done");
  assert.deepEqual(
    jobs.filter((job) => job.status === "pending").flatMap((job) => job.accounts),
    remainingAccounts,
  );

  const claimed = jobs.find((job) => job.status === "pending");
  assert.ok(claimed);
  claimed.status = "claimed";
  events.push("claim");
  assert.deepEqual(events, ["preempt", "requeue", "claim"]);
  assert.equal(jobs.find((job) => job.id === 42)?.status, "done");
  assert.deepEqual(
    jobs.filter((job) => job.status === "pending" || job.status === "claimed")
      .flatMap((job) => job.accounts)
      .sort(),
    remainingAccounts.sort(),
  );
  assert.equal(
    jobs.some((job) => (job.status === "pending" || job.status === "claimed") && job.accounts.includes(completedAccount)),
    false,
  );
});

test("batch restart endpoints preserve the preempt, requeue, claim contract", () => {
  const preemptStart = routes.indexOf('app.post("/api/exec-queue/:id/preempt"');
  const requeueStart = routes.indexOf('app.post("/api/exec-queue/requeue"');
  const claimStart = routes.indexOf('app.post("/api/exec-queue/claim"');
  assert.ok(claimStart >= 0 && preemptStart >= 0 && requeueStart >= 0);
  assert.ok(claimStart < requeueStart && requeueStart < preemptStart);

  const requeueRoute = routes.slice(
    requeueStart,
    routes.indexOf('app.post("/api/exec-queue/pause"', requeueStart),
  );
  assert.match(requeueRoute, /SET status = 'pending'/);
  assert.match(requeueRoute, /WHERE batch_id = \$1 AND status IN \('claimed', 'stale', 'pending'\)/);
  assert.doesNotMatch(requeueRoute, /status IN \('done'/);

  const preemptRoute = routes.slice(
    preemptStart,
    routes.indexOf('app.get("/api/exec-queue/position"', preemptStart),
  );
  assert.match(preemptRoute, /WHERE id = \$1 AND status = 'claimed'/);
  assert.match(preemptRoute, /if \(remaining\.length\)/);
});