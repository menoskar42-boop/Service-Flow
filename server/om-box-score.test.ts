import assert from "node:assert/strict";
import { promisify } from "node:util";
import { randomBytes, scrypt } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import test from "node:test";
import { boxAverageFromAggregate, boxAverageFromAggregates, matchesBoxScoreFilter } from "@shared/om-box-score";

const scryptAsync = promisify(scrypt);

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

test("box average combines measured lines from multiple boxes", () => {
  assert.deepEqual(boxAverageFromAggregates([
    { sum: 20, measured: 2 },
    { sum: 15, measured: 1 },
    null,
  ]), {
    avgScore: 11.7,
    measuredCount: 3,
  });
});

test("box score filter keeps broken boxes at or below the requested score", () => {
  assert.equal(matchesBoxScoreFilter(true, 12.5, true, "20"), true);
  assert.equal(matchesBoxScoreFilter(true, 20, true, "20"), true);
  assert.equal(matchesBoxScoreFilter(true, 20.1, true, "20"), false);
  assert.equal(matchesBoxScoreFilter(false, 12.5, true, "20"), false);
  assert.equal(matchesBoxScoreFilter(true, null, true, "20"), false);
});

test("box score filter without a limit can show all broken boxes", () => {
  assert.equal(matchesBoxScoreFilter(true, null, true, ""), true);
  assert.equal(matchesBoxScoreFilter(false, null, false, ""), true);
});

test("OM report enriches only broken-box rows from latest valid Service-Flow scores", async (t) => {
  // `npm test` بيحط عنوان نائب (no-db.invalid) لو مفيش قاعدة، عشان استيراد
  // server/db مايرميش وباقى اختبارات الوحدات تعدّى. الاختبار ده محتاج قاعدة
  // حقيقية فبيتخطّى فى الحالة دى بدل ما يحاول يتصل ويفشل.
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.includes("no-db.invalid")) {
    t.skip("DATABASE_URL is not configured");
    return;
  }

  const [{ pool }, { registerRoutes }] = await Promise.all([
    import("./db"),
    import("./routes"),
  ]);
  const suffix = `${process.pid}_${Date.now()}`;
  const serials = {
    measured: `om-score-test-${suffix}-measured`,
    empty: `om-score-test-${suffix}-empty`,
    otherReason: `om-score-test-${suffix}-other`,
  };
  const phones = {
    first: `om-score-phone-${suffix}-1`,
    second: `om-score-phone-${suffix}-2`,
    invalid: `om-score-phone-${suffix}-3`,
    empty: `om-score-phone-${suffix}-4`,
  };
  const allPhones = Object.values(phones);
  const allSerials = Object.values(serials);
  const testUsername = `om-score-test-user-${suffix}`;
  const testPassword = `om-score-test-password-${suffix}`;
  const central = "OM Score Central";
  const cabin = "C-1";
  const box = "B-1";

  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  let baseUrl = "";

  const deleteFixtures = async () => {
    await pool.query(`DELETE FROM case_138 WHERE full_phone = ANY($1::text[])`, [allPhones]);
    await pool.query(`DELETE FROM line_account_edits WHERE full_phone = ANY($1::text[])`, [allPhones]);
    await pool.query(`DELETE FROM line_accounts WHERE full_phone = ANY($1::text[])`, [allPhones]);
    await pool.query(`DELETE FROM phone_lines WHERE full_phone = ANY($1::text[])`, [allPhones]);
    await pool.query(`DELETE FROM om_responses WHERE serial_number = ANY($1::text[])`, [allSerials]);
    await pool.query(`DELETE FROM ftth_orders_current WHERE serial_number = ANY($1::text[])`, [allSerials]);
    await pool.query(`DELETE FROM users WHERE username = $1`, [testUsername]);
  };

  try {
    await deleteFixtures();
    const salt = randomBytes(16).toString("hex");
    const passwordHash = await scryptAsync(testPassword, salt, 64) as Buffer;
    await pool.query(
      `INSERT INTO users (username, password, role) VALUES ($1, $2, 'admin')`,
      [testUsername, `${passwordHash.toString("hex")}.${salt}`],
    );
    await pool.query(
      `INSERT INTO ftth_orders_current
         (service_order_id, customer_order_id, customer_name, order_create_time,
          fcc_exchange, service_name, serial_number, msan_code)
       VALUES
         ($1, $2, 'Measured box', now(), 'GHNAT', 'FV Survey', $3, 'MSAN-TEST'),
         ($4, $5, 'Empty box', now(), 'GHNAT', 'FV Survey', $6, 'MSAN-TEST'),
         ($7, $8, 'Other reason', now(), 'GHNAT', 'FV Survey', $9, 'MSAN-TEST')`,
      [
        `so-${suffix}-1`, `co-${suffix}-1`, serials.measured,
        `so-${suffix}-2`, `co-${suffix}-2`, serials.empty,
        `so-${suffix}-3`, `co-${suffix}-3`, serials.otherReason,
      ],
    );
    await pool.query(
      `INSERT INTO om_responses
         (serial_number, status, rejection_reason, central_name, cabin_number, box_number)
       VALUES
         ($1, 'not_feasible', 'بوكس معطل', $2, $3, $4),
         ($5, 'not_feasible', 'بوكس معطل', 'No Score Central', 'C-2', 'B-2'),
         ($6, 'not_feasible', 'بوكس مليان', $2, $3, $4)`,
      [serials.measured, central, cabin, box, serials.empty, serials.otherReason],
    );
    await pool.query(
      `INSERT INTO phone_lines
         (tel_no, central, cabin_number, box_number, full_phone)
       VALUES
         ($1, $2, $3, $4, $1),
         ($5, $2, $3, $4, $5),
         ($6, $2, $3, $4, $6),
         ($7, 'No Score Central', 'C-2', 'B-2', $7)`,
      [
        phones.first, central, cabin, box,
        phones.second, phones.invalid, phones.empty,
      ],
    );
    await pool.query(
      `INSERT INTO line_accounts (full_phone, account_no)
       SELECT phone, 'account-' || phone
       FROM unnest($1::text[]) AS phone`,
      [allPhones],
    );
    await pool.query(
      `INSERT INTO case_138 (full_phone, score)
       VALUES
         ($1, 20), ($1, 90),
         ($2, 80),
         ($3, 10), ($3, 150)`,
      [phones.first, phones.second, phones.invalid],
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

    const report = await fetch(`${baseUrl}/api/ftth-orders?bucket=current`, {
      headers: { cookie },
    });
    assert.equal(report.status, 200);
    const rows = await report.json() as Array<Record<string, any>>;
    const bySerial = new Map(rows.map((row) => [row.serialNumber, row]));

    assert.equal(bySerial.get(serials.measured)?.boxAvgScore, 85);
    assert.equal(bySerial.get(serials.measured)?.boxMeasuredCount, 2);
    assert.equal(bySerial.get(serials.empty)?.boxAvgScore, null);
    assert.equal(bySerial.get(serials.empty)?.boxMeasuredCount, 0);
    assert.equal(bySerial.get(serials.otherReason)?.boxAvgScore, null);
    assert.equal(bySerial.get(serials.otherReason)?.boxMeasuredCount, 0);

    const fetchMeasuredBox = async () => {
      const response = await fetch(`${baseUrl}/api/ftth-orders?bucket=current`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      const reportRows = await response.json() as Array<Record<string, any>>;
      const measuredRow = reportRows.find((row) => row.serialNumber === serials.measured);
      assert.ok(measuredRow, "measured order should be present in the report");
      return measuredRow;
    };

    // Deleting a line-account link must immediately remove that line from the
    // cached box aggregate.
    const deletedLink = await fetch(`${baseUrl}/api/line-accounts/${phones.second}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(deletedLink.status, 200);
    assert.deepEqual(await deletedLink.json(), { ok: true });
    const afterIndividualDelete = await fetchMeasuredBox();
    assert.equal(afterIndividualDelete.boxAvgScore, 90);
    assert.equal(afterIndividualDelete.boxMeasuredCount, 1);

    // Re-adding the link through the individual endpoint must invalidate the
    // cache again and restore the line to the aggregate.
    const restoredLink = await fetch(`${baseUrl}/api/line-accounts/${phones.second}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ accountNo: `restored-account-${phones.second}` }),
    });
    assert.equal(restoredLink.status, 200);
    assert.deepEqual(await restoredLink.json(), { ok: true, restored: false });
    const afterIndividualRestore = await fetchMeasuredBox();
    assert.equal(afterIndividualRestore.boxAvgScore, 85);
    assert.equal(afterIndividualRestore.boxMeasuredCount, 2);

    // Exercise the bulk save path as well: after another deletion, a bulk
    // insert must not serve the stale one-line aggregate.
    const deletedAgain = await fetch(`${baseUrl}/api/line-accounts/${phones.second}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(deletedAgain.status, 200);
    const afterSecondDelete = await fetchMeasuredBox();
    assert.equal(afterSecondDelete.boxAvgScore, 90);
    assert.equal(afterSecondDelete.boxMeasuredCount, 1);

    const bulkRestore = await fetch(`${baseUrl}/api/line-accounts/bulk`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        entries: [{ fullPhone: phones.second, accountNo: `bulk-account-${phones.second}` }],
      }),
    });
    assert.equal(bulkRestore.status, 200);
    assert.deepEqual(await bulkRestore.json(), { ok: true, saved: 1, duplicates: [] });
    const afterBulkRestore = await fetchMeasuredBox();
    assert.equal(afterBulkRestore.boxAvgScore, 85);
    assert.equal(afterBulkRestore.boxMeasuredCount, 2);

    // The first report populated the short-lived aggregate cache. A newer
    // Service-Flow measurement must invalidate it before the next report.
    const measurementUpdate = await fetch(`${baseUrl}/api/case-138/measurements`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dzs-token": "sf-dzs-138-ingest-2026",
      },
      body: JSON.stringify({
        items: [{ fullPhone: phones.first, accountNo: `account-${phones.first}`, score: 40 }],
      }),
    });
    assert.equal(measurementUpdate.status, 200);
    assert.deepEqual(await measurementUpdate.json(), { inserted: 1 });

    const refreshedReport = await fetch(`${baseUrl}/api/ftth-orders?bucket=current`, {
      headers: { cookie },
    });
    assert.equal(refreshedReport.status, 200);
    const refreshedRows = await refreshedReport.json() as Array<Record<string, any>>;
    const refreshedBySerial = new Map(refreshedRows.map((row) => [row.serialNumber, row]));
    assert.equal(refreshedBySerial.get(serials.measured)?.boxAvgScore, 60);
    assert.equal(refreshedBySerial.get(serials.measured)?.boxMeasuredCount, 2);
  } finally {
    await new Promise<void>((resolve) => {
      if (!httpServer.listening) return resolve();
      httpServer.close(() => resolve());
    });
    await deleteFixtures();
    await pool.end();
  }
});