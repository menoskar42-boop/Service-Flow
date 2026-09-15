import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// «جلب من WFM» بقى بيشتغل تلقائياً مرتين كل يوم: ١١ ص و٢ م بتوقيت القاهرة.
// نفس اللى بيعمله الزر: مهمة wfmreport فى الطابور، وسكربت التامبر منكى بيكمّل لوحده.
//
// مُثبت end-to-end على سيرفر حقيقى (كانت الساعة ٣ م بتوقيت القاهرة — يعنى
// الميعادين فاتوا):
//   • اتحطّت **مهمة واحدة** بميعاد 14:00 — مش اتنين ورا بعض.
//   • ٣ نبضات ورا بعض → المهمة فضلت واحدة.
//   • مسحنا المهمة وعملنا نبضة → ماتضافتش تانى (الميعاد اتعمل خلاص).
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const start = routes.indexOf("const runWfmFetch");
assert.ok(start >= 0, "runWfmFetch must exist");
const fn = routes.slice(start, routes.indexOf("// GET /api/exec-queue/wfm-fetch"));

test("it runs at 11:00 and 14:00 Cairo", () => {
  assert.match(routes, /const WFM_FETCH_HOURS = \[11, 14\];/);
  assert.match(fn, /const \{ date, hour \} = cairoNow\(\);/);
});

// لو السيرفر كان نايم ووصحى بعد الميعادين، بيتعوّض **أحدث** ميعاد بس —
// مش الاتنين ورا بعض على الفاضى.
test("a missed slot is made up once, not twice", () => {
  assert.match(fn, /const due = \[\.\.\.WFM_FETCH_HOURS\]\.filter\(\(h\) => hour >= h\)\.pop\(\);/);
  assert.match(fn, /if \(due == null\) return;/);
  assert.match(fn, /const slot = `\$\{date\}:\$\{due\}`;/);
});

test("the slot is claimed once, atomically", () => {
  assert.match(fn, /WHERE app_state\.value IS DISTINCT FROM \$1\s*\n\s*RETURNING value/);
  assert.match(fn, /if \(!claim\.rowCount\) \{ wfmFetchSlotDone = slot; return; \}/);
});

// الملف واحد — مايتجابش مرتين مع بعض
test("it skips when a fetch is already queued", () => {
  assert.match(fn, /SELECT id FROM exec_jobs WHERE type = 'wfmreport' AND status IN \('pending','claimed'\) LIMIT 1/);
  assert.match(fn, /if \(dup\.length\) \{[\s\S]{0,140}?return; \}/);
});

test("the queued job matches what the button sends", () => {
  assert.match(fn, /INSERT INTO exec_jobs \(type, accounts, requested_by, note, priority, batch_id, site, requested_from\)/);
  assert.match(fn, /VALUES \('wfmreport', \$1::jsonb, 'auto'/);
  assert.match(fn, /JSON\.stringify\(\["-"\]\)/, "the site-wide key, same as SITE_WIDE_KEY in the client");
  assert.match(fn, /SITE_OF_TYPE\["wfmreport"\] \|\| "wfm\.te\.eg"/);
});

test("it is driven by the tick, boot and heartbeat", () => {
  assert.match(routes, /void runWfmFetch\("boot"\);/);
  assert.match(routes, /void runWfmFetch\("tick"\);/);
  assert.match(routes, /void runWfmFetch\("heartbeat"\);/);
  assert.match(routes, /app\.get\("\/api\/exec-queue\/wfm-fetch", requireAuth, requireSuperAdmin/);
});
