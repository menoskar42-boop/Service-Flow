import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// الباتشات اليومية التلقائية — ٩ صباحاً بتوقيت القاهرة:
//   (١) إيقاف PO لأرقام تقرير «تحتاج إيقاف PO»
//   (٢) قياس للخطوط اللى ليها أكونت ولم تُقس + اللى آخر قياس ليها أقدم من ١٠ أيام
// كل واحد فيهم بيستبعد اللى فى الطابور، والأول كمان بيستبعد اللى اتعمله إيقاف
// خلال آخر ٣ أيام.
//
// اتأكدنا منها end-to-end على سيرفر حقيقى بقاعدة بيانات حقيقية قبل الكوميت:
//   إيقاف PO → ACC1 (قياس امبارح، نسبة 90%، آخر إيقاف من ١٠ أيام) + ACC8
//   واستُبعد: ACC2 (اتوقف امبارح)، ACC3 (قياس من ٥ أيام)، ACC4 (محتاج رفع سرعة)،
//             ACC5 (فى الطابور)، ACC6 (قياس من ٤ أيام)
//   قياس → ACC7 (قياس من ٢٠ يوم) + ACC9 (لم يُقس أبداً)
//   واستُبعد: ACC10 (فى الطابور)، وACC11/ACC12 (من غير فريم)
// وبعد ما الاستبعاد بقى **بنفس النوع بس**، جولة تانية أثبتت:
//   P_ONLY (ليه stop فى الطابور) → استُبعد من باتش الإيقاف ✅
//   BOTH   (ليه measure فى الطابور) → **اتضاف** لباتش الإيقاف ✅ (قبل كده كان بيتستبعد)
//   M_ONLY (ليه measure فى الطابور) → استُبعد من باتش القياس ✅
//   CLEAN  (مش فى الطابور) → اتضاف لباتش القياس ✅
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const panel = readFileSync(
  new URL("../client/src/components/QueueReorderPanel.tsx", import.meta.url), "utf8");

test("the schedule runs at 09:00 Cairo, once a day", () => {
  assert.match(routes, /const AUTO_BATCH_HOUR = 9;/);
  assert.match(routes, /if \(!ignoreHour && hour < AUTO_BATCH_HOUR\)/);
  // الحجز بجملة شرطية واحدة — مستحيل اتنين ينجحوا فى نفس اللحظة فيتفتح باتش مكرر
  assert.match(routes, /ON CONFLICT \(key\) DO UPDATE SET value = EXCLUDED\.value, updated_at = now\(\)\s*\n\s*WHERE app_state\.value IS DISTINCT FROM \$1\s*\n\s*RETURNING value/);
  assert.match(routes, /if \(!claim\.rowCount\) \{ autoBatchDay = date; return/);
});

test("a missed 9am is made up from the tick and from the executor heartbeat", () => {
  // الـ tick بقى بينده الباتشات اليومية وجلب WFM مع بعض
  assert.match(routes, /setInterval\(\(\) => \{[\s\S]{0,160}?runDailyAutoBatches\("tick"\)[\s\S]{0,160}?\}, 5 \* 60 \* 1000\)/);
  assert.match(routes, /setTimeout\(\(\) => \{[\s\S]{0,160}?runDailyAutoBatches\("boot"\)[\s\S]{0,160}?\}, 30_000\)/);
  // النبضة = أول ما جهاز التنفيذ يتفعّل بعد ٩، الباتش بيتفتح فوراً
  assert.match(routes, /void runDailyAutoBatches\("heartbeat"\);/);
});

const poFn = routes.slice(routes.indexOf("const autoPoStopAccounts"),
                          routes.indexOf("const autoMeasureAccounts"));

test("the PO-stop batch mirrors the report and drops recent stops and queued lines", () => {
  assert.match(poFn, /m\.score IS NOT NULL AND m\.score <= 100/);
  assert.match(poFn, /m\.uploaded_at >= now\(\) - interval '3 days'/);   // القياس خلال ٣ أيام
  assert.match(poFn, /NOT COALESCE\(\$\{needsSpeedSql\("m"\)\}, false\)/); // نفس دالة التقرير
  assert.match(poFn, /pe\.last_stop_at IS NULL\s*\n\s*OR pe\.last_stop_at < now\(\) - make_interval\(days => \$\{AUTO_PO_STOP_SKIP_DAYS\}\)/);
  // الاستبعاد **بنفس السبب بس**: إيقاف PO بيستبعد اللى ليه إيقاف فى الطابور،
  // ومابيستبعدش اللى ليه قياس — رقم مستنى قياس مالوش دعوة بإيقاف PO.
  assert.match(poFn, /\$\{notQueuedSql\("la\.account_no", \["stop"\]\)\}/);
  assert.match(poFn, /\$\{hasFrameSql\("m\.full_phone"\)\}/);
  assert.match(routes, /const AUTO_PO_STOP_SKIP_DAYS = 3;/);
});

const measFn = routes.slice(routes.indexOf("const autoMeasureAccounts"),
                            routes.indexOf("type AutoBatchResult"));

test("the measure batch covers never-measured plus stale, minus queued", () => {
  assert.match(routes, /const AUTO_MEASURE_STALE_DAYS = 10;/);
  // NULL = لم يُقس أبداً، والتانى = آخر قياس أقدم من ١٠ أيام — الشرطين مع بعض
  assert.match(measFn, /c138p\.uploaded_at IS NULL\s*\n\s*OR c138p\.uploaded_at < now\(\) - make_interval\(days => \$\{AUTO_MEASURE_STALE_DAYS\}\)/);
  assert.match(measFn, /\$\{notQueuedSql\("la\.account_no", \["measure"\]\)\}/);
  assert.match(measFn, /\$\{hasFrameSql\("la\.full_phone"\)\}/);
  assert.match(measFn, /la\.account_no IS NOT NULL AND la\.account_no <> ''/);
});

test("the batches are split per line and land at normal priority", () => {
  const enq = routes.slice(routes.indexOf("const enqueueAutoBatch"),
                           routes.indexOf("const autoPoStopAccounts"));
  assert.match(enq, /accounts\.map\(\(a\) => \{ params\.push\(JSON\.stringify\(\[a\]\)\)/, "job per line");
  assert.match(enq, /const params: any\[\] = \[type, "auto", note, 0, batchId, site/, "priority 0");
  assert.match(enq, /if \(!accounts\.length\) return \{ count: 0, batchId: null/);
});

test("the manual run ignores the hour and reports what it queued", () => {
  assert.match(routes, /const r = await runDailyAutoBatches\("manual", true\);/);
  assert.match(routes, /app\.get\("\/api\/exec-queue\/auto-batches", requireAuth, requireSuperAdmin/);
  assert.match(routes, /app\.post\("\/api\/exec-queue\/auto-batches\/run", requireAuth, requireSuperAdmin/);
});

test("the panel shows whether today's run happened", () => {
  assert.match(panel, /fetch\("\/api\/exec-queue\/auto-batches", \{ credentials: "include" \}\)/);
  assert.match(panel, /التشغيل اليومى \(٩ صباحاً\)/);
  assert.match(panel, /auto\?\.doneToday/);
  assert.match(panel, /runAuto\(!!auto\?\.doneToday\)/);
});

// ⚠️ اتحدّث: التقارير بقت هى كمان بتحدّد النوع (قائمة «استبعاد من الطابور»)،
// فالافتراضى بقى للتوافق الخلفى بس — الروابط القديمة ?excludeQueued=1.
test("the shared helper keeps an all-types default for old links", () => {
  assert.match(routes, /const notQueuedSql = \(accCol: string, types: readonly string\[\] = \["measure", "raise", "stop"\]\)/);
  assert.match(routes, /e\.type IN \(\$\{types\.map\(\(t\) => `'\$\{t\.replace\(\/'\/g, "''"\)\}'`\)\.join\(", "\)\}\)/);
  assert.match(routes, /if \(v === "1" \|\| v === "true"\) return QUEUE_EXCLUDE_TYPES;/);
});
