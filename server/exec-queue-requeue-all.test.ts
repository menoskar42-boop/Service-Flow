import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// «إعادة تشغيل الكل» — نفس زرار الباتش الواحد بس على كل اللى واقف دفعة واحدة
// (٤ باتشات تحديث ملفات بتقف مع بعض، فالضغط على كل واحد لوحده مضيعة وقت).
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const panel = readFileSync(
  new URL("../client/src/components/QueueReorderPanel.tsx", import.meta.url), "utf8");

const start = routes.indexOf('app.post("/api/exec-queue/requeue-all"');
assert.ok(start >= 0, "the requeue-all endpoint must exist");
const ep = routes.slice(start, start + 1400);

test("requeue-all is limited to the super admin", () => {
  assert.match(ep, /requireAuth, requireSuperAdmin/);
});

// الحدود دى هى كل الأمان فى الزرار ده — أى واحد يتكسر يبقى الزرار بيمسح شغل.
test("it revives only what is stuck, and never touches the rest", () => {
  assert.match(ep, /WHERE status IN \('claimed', 'stale'\) AND paused_at IS NULL/);
  // اللى اتنفّذ مايتعادش: مافيش 'done' فى شرط الاختيار
  assert.doesNotMatch(ep, /status IN \([^)]*'done'/);
  // الموقوف مؤقتاً بيفضل موقوف — مابنمسحش paused_at زى ما بيعمل زرار الباتش الواحد
  const setClause = ep.slice(ep.indexOf("SET "), ep.indexOf("WHERE"));
  assert.doesNotMatch(setClause, /paused_at/);
  // العدّاد بيتصفّر عشان الإنقاذ التلقائى يشتغل من أول وجديد
  assert.match(setClause, /attempts = 0/);
});

test("it reports how many jobs and how many batches came back", () => {
  assert.match(ep, /RETURNING batch_id/);
  assert.match(ep, /requeued: rows\.length, batches: batches\.size/);
});

test("the panel has one button for it, with a stuck counter", () => {
  assert.match(panel, /const requeueAll = async \(\) =>/);
  assert.match(panel, /fetch\("\/api\/exec-queue\/requeue-all", \{ method: "POST", credentials: "include" \}\)/);
  assert.match(panel, /إعادة تشغيل الكل/);
  assert.match(panel, /const stuckCount = \[\.\.\.priorityRows, \.\.\.rows\]\.filter\(\(b\) => isStuck\(b\)\)\.length/);
  // تأكيد قبل التنفيذ — العملية بترجّع شغل جارى لأوله
  assert.match(panel, /if \(!confirm\(msg\)\) return;\s*\n\s*setRequeuingAll\(true\)/);
});
