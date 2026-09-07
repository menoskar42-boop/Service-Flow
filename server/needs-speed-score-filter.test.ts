import assert from "node:assert/strict";
import { promisify } from "node:util";
import { randomBytes, scrypt } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { createServer } from "node:http";
import test from "node:test";

const scryptAsync = promisify(scrypt);

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const reportStart = routes.indexOf(
  'app.get(["/api/phone-lines/needs-speed", "/api/phone-lines/needs-speed-lowscore"',
);
const reportEnd = routes.indexOf(
  "  // GET /api/phone-lines/needs-po-stop",
  reportStart,
);
assert.ok(reportStart >= 0, "the needs-speed report endpoint must exist");
assert.ok(reportEnd > reportStart, "the needs-speed report endpoint must be bounded");
const reportRoute = routes.slice(reportStart, reportEnd);

const clientReport = readFileSync(
  new URL("../client/src/components/NeedsSpeedReport.tsx", import.meta.url),
  "utf8",
);

test("score bounds reach both paged and full-range report requests", () => {
  assert.match(
    clientReport,
    /if \(scoreFrom\.trim\(\)\) params\.set\("scoreFrom", scoreFrom\.trim\(\)\)/,
  );
  assert.match(
    clientReport,
    /if \(scoreTo\.trim\(\)\) params\.set\("scoreTo", scoreTo\.trim\(\)\)/,
  );
  assert.match(
    clientReport,
    /queryKey: \[endpoint,[\s\S]*scoreFrom, scoreTo,[\s\S]*page/,
    "score bounds must invalidate the paged table query",
  );
  assert.match(
    clientReport,
    /fetch\(`\$\{endpoint\}\?\$\{buildParams\(\)\}`/,
    "the table must use the paged parameter builder",
  );
  assert.match(
    clientReport,
    /new URLSearchParams\(\s*forExport \? \{ page: "1", limit: "20000" \} : \{ page: String\(page\), limit: String\(PAGE_SIZE\) \}/,
    "the full-range and paged requests must share one parameter builder",
  );
});


test("inclusive score bounds are applied to the count and page queries", () => {
  assert.match(
    reportRoute,
    /scoreFrom = "", scoreTo = ""/,
    "the endpoint must accept both score bounds",
  );
  assert.match(reportRoute, /m\.score >= \$\$\{params\.length\}/);
  assert.match(reportRoute, /m\.score <= \$\$\{params\.length\}/);

  const scoreFilterEnd = reportRoute.indexOf("const whereNoQ");
  const countQuery = reportRoute.indexOf("const totalRes = await pool.query");
  const pageQuery = reportRoute.indexOf("const dataRes = await pool.query");
  assert.ok(scoreFilterEnd >= 0 && countQuery > scoreFilterEnd);
  assert.ok(pageQuery > countQuery);

  const querySection = reportRoute.slice(countQuery, pageQuery + 500);
  assert.match(querySection, /SELECT COUNT\(\*\)::int AS c \$\{joinClause\} \$\{where\}/);
  assert.match(querySection, /\$\{joinClause\} \$\{where\}/);
  assert.match(
    reportRoute,
    /LIMIT \$\$\{params\.length - 1\} OFFSET \$\$\{params\.length\}/,
    "the paged query must add pagination after the shared filtered parameter list",
  );
});

test("Excel, PDF, measurement, and speed-raise actions use the filtered range", () => {
  const fullRangeRequests = clientReport.match(
    /fetch\(`\$\{endpoint\}\?\$\{buildParams\(true\)\}`/g,
  ) ?? [];
  assert.equal(
    fullRangeRequests.length,
    4,
    "DZS measurement, speed raise, Excel, and PDF must all request the same full filtered range",
  );
  assert.match(clientReport, /onClick=\{handleMeasureDZS\}/);
  assert.match(clientReport, /onClick=\{\(\) => handleRaiseSpeed\("raise"\)\}/);
  assert.match(clientReport, /onClick=\{\(\) => handleRaiseSpeed\("stop"\)\}/);
  assert.match(clientReport, /const handleExport = async \(\) =>/);
  assert.match(clientReport, /const handleExportPDF = async \(\) =>/);
});

test("the needs-speed endpoint applies inclusive score bounds to real rows, counts, and pages", async (t) => {
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
  const testUsername = `needs-speed-score-test-${suffix}`;
  const testPassword = `needs-speed-score-password-${suffix}`;
  const phones = {
    from: `needs-speed-score-${suffix}-from`,
    to: `needs-speed-score-${suffix}-to`,
    below: `needs-speed-score-${suffix}-below`,
    above: `needs-speed-score-${suffix}-above`,
  };
  const allPhones = Object.values(phones);
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  let baseUrl = "";

  const deleteFixtures = async () => {
    await pool.query(`DELETE FROM case_138 WHERE full_phone = ANY($1::text[])`, [allPhones]);
    await pool.query(`DELETE FROM phone_ports WHERE phone_number = ANY($1::text[])`, [allPhones]);
    await pool.query(`DELETE FROM users WHERE username = $1`, [testUsername]);
  };

  try {
    await deleteFixtures();
    const salt = randomBytes(16).toString("hex");
    const passwordHash = await scryptAsync(testPassword, salt, 64) as Buffer;
    await pool.query(
      `INSERT INTO users (username, password, role) VALUES ($1, $2, 'super_admin')`,
      [testUsername, `${passwordHash.toString("hex")}.${salt}`],
    );
    await pool.query(
      `INSERT INTO phone_ports (phone_number, frame)
       SELECT phone, 'frame-score-test'
       FROM unnest($1::text[]) AS phone`,
      [allPhones],
    );
    await pool.query(
      `INSERT INTO case_138 (full_phone, score, current_speed, max_speed)
       VALUES
         ($1, 20, '5000', '10000'),
         ($2, 80, '5000', '10000'),
         ($3, 19, '5000', '10000'),
         ($4, 81, '5000', '10000')`,
      [phones.from, phones.to, phones.below, phones.above],
    );

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

    const fetchReport = async (page: number, limit: number) => {
      const params = new URLSearchParams({
        scoreFrom: "20",
        scoreTo: "80",
        page: String(page),
        limit: String(limit),
      });
      const response = await fetch(
        `${baseUrl}/api/phone-lines/needs-speed?${params}`,
        { headers: { cookie } },
      );
      assert.equal(response.status, 200);
      return await response.json() as {
        data: Array<Record<string, any>>;
        total: number;
        page: number;
        pageSize: number;
      };
    };

    const firstPage = await fetchReport(1, 1);
    const secondPage = await fetchReport(2, 1);
    assert.equal(firstPage.total, 2);
    assert.equal(secondPage.total, firstPage.total);
    assert.equal(firstPage.pageSize, 1);
    assert.equal(secondPage.pageSize, 1);
    assert.equal(firstPage.data.length + secondPage.data.length, firstPage.total);
    assert.deepEqual(
      new Set([
        firstPage.data[0]?.fullPhone,
        secondPage.data[0]?.fullPhone,
      ]),
      new Set([phones.from, phones.to]),
      "both inclusive score boundary rows should be present across the pages",
    );

    const fullRange = await fetchReport(1, 20000);
    assert.equal(fullRange.total, 2);
    assert.equal(fullRange.data.length, fullRange.total);
    assert.deepEqual(
      new Set(fullRange.data.map((row) => row.fullPhone)),
      new Set([phones.from, phones.to]),
      "the full-range request used by export/execution must use the same filtered range",
    );
  } finally {
    await new Promise<void>((resolve) => {
      if (!httpServer.listening) return resolve();
      httpServer.close(() => resolve());
    });
    await deleteFixtures();
    await pool.end();
  }
});