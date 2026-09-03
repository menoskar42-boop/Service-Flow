import assert from "node:assert/strict";
import { promisify } from "node:util";
import { randomBytes, scrypt } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { createServer } from "node:http";
import test from "node:test";
import {
  EXEC_BATCH_REFRESH_DELAY_MS,
  EXEC_BATCH_REFRESH_KEY,
  EXEC_MEASURE_STALL_MS,
  type ExecQueueStorage,
  refreshDueExecBatch,
  recoverTimedOutMeasure,
} from "../client/src/lib/exec-queue";

const scryptAsync = promisify(scrypt);

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

test("claim endpoint locks sites independently without changing queue ordering", () => {
  const claimStart = routes.indexOf('app.post("/api/exec-queue/claim"');
  const doneStart = routes.indexOf('app.post("/api/exec-queue/:id/done"', claimStart);
  assert.ok(claimStart >= 0 && doneStart > claimStart);
  const claimRoute = routes.slice(claimStart, doneStart);

  assert.match(claimRoute, /withTx\(async \(tx\) =>/);
  assert.doesNotMatch(claimRoute, /pg_advisory_xact_lock\(872634501\)/);
  assert.match(
    claimRoute,
    /pg_try_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/,
  );
  assert.match(claimRoute, /skippedSites/);
  assert.match(claimRoute, /<> ALL\(\$1::text\[\]\)/);
  assert.match(
    claimRoute,
    /b\.status = 'claimed'[\s\S]*?COALESCE\(b\.site, '10\.42\.187\.101'\) = COALESCE\(e\.site, '10\.42\.187\.101'\)/,
  );
  assert.match(
    claimRoute,
    /ORDER BY e\.priority DESC,[\s\S]*?e\.queue_order[\s\S]*?e\.created_at, e\.id/,
  );
});

test("PostgreSQL claims serialize one site and preserve the real queue order", async (t) => {
  // npm test supplies no-db.invalid when no database is configured so the
  // source-level queue tests can still run. This integration test must never
  // fall back to that placeholder.
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.includes("no-db.invalid")) {
    t.skip("DATABASE_URL is not configured for PostgreSQL integration tests");
    return;
  }

  const [{ pool }, { registerRoutes }] = await Promise.all([
    import("./db"),
    import("./routes"),
  ]);
  const suffix = `${process.pid}_${Date.now()}`;
  const testUsername = `exec-queue-test-${suffix}`;
  const testPassword = `exec-queue-password-${suffix}`;
  const batchId = `exec-queue-test-batch-${suffix}`;
  const siteA = `exec-queue-test-site-a-${suffix}`;
  const siteB = `exec-queue-test-site-b-${suffix}`;
  const siteC = `exec-queue-test-site-c-${suffix}`;
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  let baseUrl = "";

  const deleteFixtures = async () => {
    await pool.query(`DELETE FROM exec_jobs WHERE batch_id = $1`, [batchId]);
    await pool.query(`DELETE FROM users WHERE username = $1`, [testUsername]);
  };

  const postJson = async (
    path: string,
    cookie: string,
    body: Record<string, unknown> = {},
  ) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, `${path} should succeed`);
    return await response.json() as Record<string, any> | null;
  };

  try {
    await deleteFixtures();
    const salt = randomBytes(16).toString("hex");
    const passwordHash = await scryptAsync(testPassword, salt, 64) as Buffer;
    await pool.query(
      `INSERT INTO users (username, password, role) VALUES ($1, $2, 'super_admin')`,
      [testUsername, `${passwordHash.toString("hex")}.${salt}`],
    );

    // A1 must win by priority. The remaining A jobs exercise queue_order,
    // then created_at and id. B1 and C1 are inserted after the same-site
    // race so a separate concurrent wave can prove different sites proceed.
    const fixtures = [
      { key: "a1", site: siteA, priority: 3, queueOrder: 0, createdAt: "2020-01-01T00:00:01Z" },
      { key: "a2", site: siteA, priority: 2, queueOrder: 2, createdAt: "2020-01-01T00:00:04Z" },
      { key: "a3", site: siteA, priority: 2, queueOrder: 7, createdAt: "2020-01-01T00:00:03Z" },
      { key: "a4", site: siteA, priority: 2, queueOrder: 0, createdAt: "2020-01-01T00:00:00Z" },
      { key: "a5", site: siteA, priority: 2, queueOrder: 0, createdAt: "2020-01-01T00:00:00Z" },
    ];
    const ids = new Map<string, number>();
    const insertJob = async (fixture: {
      key: string;
      site: string;
      priority: number;
      queueOrder: number;
      createdAt: string;
    }) => {
      const { rows } = await pool.query(
        `INSERT INTO exec_jobs
           (type, accounts, status, requested_by, batch_id, site, priority, queue_order, created_at)
         VALUES ('measure', $1::jsonb, 'pending', $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          JSON.stringify([fixture.key]),
          testUsername,
          batchId,
          fixture.site,
          fixture.priority,
          fixture.queueOrder,
          fixture.createdAt,
        ],
      );
      ids.set(fixture.key, rows[0].id);
    };
    for (const fixture of fixtures) await insertJob(fixture);

    await registerRoutes(httpServer, app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const address = httpServer.address();
    assert.ok(address && typeof address !== "string");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const login = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: testUsername, password: testPassword }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie");
    assert.ok(setCookie, "login should return a session cookie");
    const cookie = setCookie.split(";")[0];

    const claim = () => postJson("/api/exec-queue/claim", cookie);
    const [firstClaim, secondClaim] = await Promise.all([claim(), claim()]);
    const sameSiteClaims = [firstClaim, secondClaim].filter(Boolean);
    assert.equal(sameSiteClaims.length, 1, "only one same-site claim should succeed");
    assert.deepEqual(
      sameSiteClaims.map((row) => row?.id),
      [ids.get("a1")],
      "the winning same-site claim should take the highest-priority A1",
    );

    const claimedRows = await pool.query(
      `SELECT id, status, site FROM exec_jobs WHERE batch_id = $1 ORDER BY id`,
      [batchId],
    );
    assert.deepEqual(
      claimedRows.rows
        .filter((row) => row.status === "claimed")
        .map((row) => row.id)
        .sort((a, b) => a - b),
      [ids.get("a1")],
    );
    assert.equal(
      claimedRows.rows.filter((row) => row.status === "pending").length,
      4,
      "the losing same-site claim must leave A2-A5 pending",
    );

    await postJson(`/api/exec-queue/${ids.get("a1")}/done`, cookie, { result: "done" });
    const nextA = await claim();
    assert.equal(nextA?.id, ids.get("a2"), "the next A claim should follow queue_order");

    await insertJob({ key: "b1", site: siteB, priority: 1, queueOrder: 0, createdAt: "2020-01-01T00:00:02Z" });
    await insertJob({ key: "c1", site: siteC, priority: 1, queueOrder: 0, createdAt: "2020-01-01T00:00:02Z" });
    const [differentSiteFirst, differentSiteSecond] = await Promise.all([claim(), claim()]);
    const differentSiteClaims = [differentSiteFirst, differentSiteSecond].filter(Boolean);
    assert.deepEqual(
      new Set(differentSiteClaims.map((row) => row?.site)),
      new Set([siteB, siteC]),
      "different sites should both be claimable in the same concurrent wave",
    );
    assert.deepEqual(
      new Set(differentSiteClaims.map((row) => row?.id)),
      new Set([ids.get("b1"), ids.get("c1")]),
    );

    await Promise.all([
      postJson(`/api/exec-queue/${ids.get("a2")}/done`, cookie, { result: "done" }),
      postJson(`/api/exec-queue/${ids.get("b1")}/done`, cookie, { result: "done" }),
      postJson(`/api/exec-queue/${ids.get("c1")}/done`, cookie, { result: "done" }),
    ]);

    // With A1 and A2 complete, the next A claims follow the production SQL's
    // priority DESC, queue_order ASC, created_at ASC, id ASC ordering.
    for (const key of ["a3", "a4", "a5"]) {
      const next = await claim();
      assert.equal(next?.id, ids.get(key), `next claim should be ${key}`);
      await postJson(`/api/exec-queue/${ids.get(key)}/done`, cookie, { result: "done" });
    }

    const finalRows = await pool.query(
      `SELECT status, COUNT(*)::int AS count
         FROM exec_jobs WHERE batch_id = $1 GROUP BY status ORDER BY status`,
      [batchId],
    );
    assert.deepEqual(finalRows.rows, [{ status: "done", count: 7 }]);
  } finally {
    await new Promise<void>((resolve) => {
      if (!httpServer.listening) return resolve();
      httpServer.close(() => resolve());
    });
    await deleteFixtures();
    await pool.end();
  }
});