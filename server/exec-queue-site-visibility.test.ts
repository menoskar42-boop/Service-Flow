import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// الباج: طلب «غيّر البورت» فضل «فى الطابور 0 من 1» أكتر من ٨ دقايق وصفحة البروفيجن
// ماتفتحتش، من غير أى سبب ظاهر على الشاشة. السبب إن الطابور بينفّذ **مهمة واحدة لكل
// موقع**، وكان فيه مهمة ماسكة provisioningportal — لكن اللى ماسك الموقع مكانش بيظهر
// فى أى قايمة: قايمة «الأولوية العليا» كانت بتعرض أولوية 1 و2 بس، وقايمة «المؤجّلة»
// أولوية 0 — فباتشات تحديث الملفات (أولوية 3) كانت **مخفية تماماً** رغم إنها بتاخد
// الموقع وبتتقدّم على أى طلب تانى عليه.
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const panel = readFileSync(
  new URL("../client/src/components/QueueReorderPanel.tsx", import.meta.url), "utf8");

test("daily-update batches (priority 3) are no longer hidden from the queue screen", () => {
  assert.match(routes, /HAVING MAX\(priority\) IN \(1, 2, 3\)/);
  assert.doesNotMatch(routes, /HAVING MAX\(priority\) IN \(1, 2\)\)/,
    "priority 3 batches must not be excluded from the preview list");
  assert.match(panel, /تحديث ملفات \(أعلى أولوية\)/);
});

test("the queue exposes which site is busy and what is waiting behind it", () => {
  const start = routes.indexOf('app.get("/api/exec-queue/sites"');
  assert.ok(start >= 0, "the busy-sites endpoint must exist");
  const ep = routes.slice(start, start + 2500);
  assert.match(ep, /requireSuperAdmin/);
  assert.match(ep, /COUNT\(\*\) FILTER \(WHERE e\.status='claimed'\)::int AS running/);
  assert.match(ep, /COUNT\(\*\) FILTER \(WHERE e\.status='pending' AND e\.paused_at IS NULL\)::int AS waiting/);
  assert.match(ep, /MIN\(e\.claimed_at\) FILTER \(WHERE e\.status='claimed'\)/);
  // الباتش الماسك للموقع لازم يرجع عشان يبقى فيه زر يفرّغ الموقع
  assert.match(ep, /MIN\(e\.batch_id\) FILTER \(WHERE e\.status='claimed'\) AS "batchId"/);
});

test("both batch lists carry their site so a waiting batch can name its blocker", () => {
  const matches = routes.match(/MIN\(COALESCE\(site, '10\.42\.187\.101'\)\) AS site/g) || [];
  assert.equal(matches.length, 2, "priority-preview and reorderable must both return the site");
});

test("the panel shows the busy site, the waiting count, and a way to free it", () => {
  assert.match(panel, /fetch\("\/api\/exec-queue\/sites", \{ credentials: "include" \}\)/);
  assert.match(panel, /المواقع المشغولة الآن/);
  assert.match(panel, /مستنى وراه:/);
  assert.match(panel, /title="تفريغ الموقع/);
  // شارة السبب على الباتش الواقف نفسه
  assert.match(panel, /مستنى: \{siteLabel\(busy\.site\)\} مشغول بـ/);
});

// شارة «عالق» على الموقع لازم تستخدم نفس مهلة الإنقاذ بتاعة السيرفر (مصدر واحد).
test("the stuck badge on a site reuses the shared rescue timeout", () => {
  assert.match(panel, /import \{ rescueMinutes \} from "@shared\/exec-timeouts";/);
  assert.match(panel, /const stuck = s\.running > 0 && \(s\.claimedMins \?\? 0\) >= stuckMinsFor\(s\.type \|\| ""\)/);
});
