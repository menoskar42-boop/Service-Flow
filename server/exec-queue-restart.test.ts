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

type LaneJob = FakeJob & {
  site: string;
  priority: number;
  queueOrder: number;
  createdAt: number;
};

// محاكاة صغيرة لقفل claim فى قاعدة البيانات: كل transaction تنتظر القفل
// قبل أن تفحص المواقع المشغولة، لذلك لا يمكن لطلبين متزامنين أن يريا نفس
// الموقع فارغاً. القفل لا يمنع المواقع المختلفة من المطالبة بالتتابع السريع
// ثم التشغيل معاً بعد انتهاء transaction.
class SiteClaimQueue {
  private claimTail = Promise.resolve();

  constructor(private readonly jobs: LaneJob[]) {}

  claim(): Promise<LaneJob | null> {
    const claim = this.claimTail.then(() => {
      const candidate = [...this.jobs]
        .filter((job) => {
          if (job.status !== "pending") return false;
          return !this.jobs.some(
            (running) =>
              running.status === "claimed" && running.site === job.site,
          );
        })
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            (a.queueOrder || Number.MAX_SAFE_INTEGER) -
              (b.queueOrder || Number.MAX_SAFE_INTEGER) ||
            a.createdAt - b.createdAt ||
            a.id - b.id,
        )[0];

      if (!candidate) return null;
      candidate.status = "claimed";
      return candidate;
    });
    this.claimTail = claim.then(
      () => undefined,
      () => undefined,
    );
    return claim;
  }

  complete(id: number): void {
    const job = this.jobs.find((candidate) => candidate.id === id);
    assert.ok(job);
    assert.equal(job.status, "claimed");
    job.status = "done";
  }
}

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

test("claims run different sites together, serialize one site, and preserve order", async () => {
  const jobs: LaneJob[] = [
    {
      id: 101,
      batchId: "batch-fcc",
      accounts: ["fcc-1"],
      status: "pending",
      site: "fcc.te.eg",
      priority: 0,
      queueOrder: 0,
      createdAt: 1,
    },
    {
      id: 102,
      batchId: "batch-fcc",
      accounts: ["fcc-2"],
      status: "pending",
      site: "fcc.te.eg",
      priority: 0,
      queueOrder: 0,
      createdAt: 2,
    },
    {
      id: 103,
      batchId: "batch-c360",
      accounts: ["c360-1"],
      status: "pending",
      site: "customer360.te.eg",
      priority: 0,
      queueOrder: 0,
      createdAt: 3,
    },
    {
      id: 104,
      batchId: "batch-fcc",
      accounts: ["fcc-3"],
      status: "pending",
      site: "fcc.te.eg",
      priority: 0,
      queueOrder: 0,
      createdAt: 4,
    },
  ];
  const queue = new SiteClaimQueue(jobs);

  // طلبا claim متزامنان: الأول يأخذ FCC، والثاني يستطيع أخذ C360
  // بدلاً من المهمة الثانية على FCC.
  const [fccFirst, c360First] = await Promise.all([queue.claim(), queue.claim()]);
  assert.equal(fccFirst?.id, 101);
  assert.equal(c360First?.id, 103);
  assert.deepEqual(
    new Set([fccFirst?.site, c360First?.site]),
    new Set(["fcc.te.eg", "customer360.te.eg"]),
  );
  assert.deepEqual(
    jobs.filter((job) => job.status === "claimed").map((job) => job.site),
    ["fcc.te.eg", "customer360.te.eg"],
  );
  assert.equal(
    jobs.filter((job) => job.status === "claimed" && job.site === "fcc.te.eg").length,
    1,
  );
  assert.equal(await queue.claim(), null);

  // لا تُسحب مهمة FCC الثانية قبل انتهاء الأولى، وبعد انتهائها تظل أقدم
  // مهمة مؤهلة هى التى تُطالب بها العملية التالية.
  queue.complete(101);
  const fccSecond = await queue.claim();
  assert.equal(fccSecond?.id, 102);
  assert.equal(fccSecond?.site, "fcc.te.eg");

  queue.complete(103);
  queue.complete(102);
  const fccThird = await queue.claim();
  assert.equal(fccThird?.id, 104);
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

test("claim endpoint serializes the site check without changing queue ordering", () => {
  const claimStart = routes.indexOf('app.post("/api/exec-queue/claim"');
  const doneStart = routes.indexOf('app.post("/api/exec-queue/:id/done"', claimStart);
  assert.ok(claimStart >= 0 && doneStart > claimStart);
  const claimRoute = routes.slice(claimStart, doneStart);

  assert.match(claimRoute, /withTx\(async \(tx\) =>/);
  assert.match(claimRoute, /SELECT pg_advisory_xact_lock\(872634501\)/);
  assert.match(
    claimRoute,
    /b\.status = 'claimed'[\s\S]*?COALESCE\(b\.site, '10\.42\.187\.101'\) = COALESCE\(e\.site, '10\.42\.187\.101'\)/,
  );
  assert.match(
    claimRoute,
    /ORDER BY e\.priority DESC,[\s\S]*?e\.queue_order[\s\S]*?e\.created_at, e\.id/,
  );
});