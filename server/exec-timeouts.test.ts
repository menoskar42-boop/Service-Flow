import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EXEC_RUN_MINUTES, EXEC_RESCUE_MINUTES, rescueMinutes, rescueIntervalSql, DEFAULT_RESCUE_MINUTES } from "../shared/exec-timeouts";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const panel = readFileSync(
  new URL("../client/src/components/QueueReorderPanel.tsx", import.meta.url), "utf8");
const executor = readFileSync(
  new URL("../client/src/components/ExecutorButton.tsx", import.meta.url), "utf8");

// ⛔ الباج الأصلى: «إيقاف PO» مهلته الفعلية ٣٠ ثانية والسيرفر كان مستنيه ٢٠ دقيقة
// (الافتراضى العام) قبل ما يرجّعه للطابور — فالباتش وقف ١٣ دقيقة من غير أى إنقاذ.
test("every job type is rescued after its own run time, never before", () => {
  for (const [type, run] of Object.entries(EXEC_RUN_MINUTES)) {
    const rescue = rescueMinutes(type);
    assert.ok(rescue > run,
      `${type}: مهلة الإنقاذ (${rescue}د) لازم تكون أكبر من مهلة التنفيذ (${run}د)`);
    // ومش أكبر من اللزوم: الإنقاذ مايستناش أكتر من ٤ أضعاف زمن التنفيذ + ٥ دقايق
    assert.ok(rescue <= run * 4 + 5,
      `${type}: مهلة الإنقاذ (${rescue}د) طويلة أوى مقارنة بزمن التنفيذ (${run}د)`);
  }
});

test("the stop job — the one that stalled — is rescued in minutes, not in twenty", () => {
  assert.equal(EXEC_RUN_MINUTES.stop, 0.5);
  assert.equal(rescueMinutes("stop"), 5);
  assert.ok(rescueMinutes("stop") < 13, "باتش واقف ١٣ دقيقة كان لازم يترجّع قبلها بكتير");
});

test("an unknown job type still falls back to the shared default", () => {
  assert.equal(rescueMinutes("nope"), DEFAULT_RESCUE_MINUTES);
});

// المهل كانت مكتوبة بالنص فى ٣ أماكن واتفرّقوا فعلاً — دلوقتى كلهم بيقروا من ملف واحد.
test("the server, the stuck badge and the executor all read the one source", () => {
  assert.match(routes, /import \{ rescueIntervalSql[^}]*\} from "@shared\/exec-timeouts"/);
  assert.match(routes, /const maxRunSql = rescueIntervalSql\("e\.type"\);/);
  assert.doesNotMatch(routes, /WHEN e\.type = 'measure'\s+THEN interval '4 minutes'/,
    "مافيش نسخة مكتوبة بالنص فاضلة فى السيرفر");
  assert.match(panel, /import \{ rescueMinutes \} from "@shared\/exec-timeouts"/);
  assert.match(panel, /const stuckMinsFor = rescueMinutes;/);
  assert.match(executor, /import \{ rescueMinutes \} from "@shared\/exec-timeouts"/);
});

// جهاز التنفيذ: النبضة وحدها مش كفاية — التاب ممكن يبقى حى والمهمة متعلّقة جوّاه.
test("the executor reloads a lane that outran its own timeout", () => {
  assert.match(executor, /const runningSince = new Map<string, \{ at: number; type: string \}>\(\);/);
  assert.match(executor, /runningSince\.set\(site, \{ at: Date\.now\(\), type: job\.type \}\);/);
  assert.match(executor, /runningSince\.delete\(site\);/);
  assert.match(executor, /Date\.now\(\) - r\.at > rescueMinutes\(r\.type\) \* 60 \* 1000/);
  // الفحص لازم يسبق فحص فجوة النبضة، وإلا التاب الحى مايتفحصش أصلاً
  const laneAt = executor.indexOf("const lane = stalledLane();");
  const gapAt = executor.indexOf("const gap = Date.now() - lastBeatOk;");
  assert.ok(laneAt >= 0 && gapAt > laneAt, "فحص المسار الواقف لازم يسبق فحص النبضة");
});

test("the generated SQL covers every configured type", () => {
  const sql = rescueIntervalSql("e.type");
  for (const [type, mins] of Object.entries(EXEC_RESCUE_MINUTES)) {
    assert.ok(sql.includes(`WHEN e.type = '${type}' THEN interval '${mins} minutes'`), `SQL ناقص ${type}`);
  }
  assert.ok(sql.includes(`ELSE interval '${DEFAULT_RESCUE_MINUTES} minutes'`));
  // مفيش أى حرف غريب ممكن يكسر الاستعلام
  assert.doesNotMatch(sql, /[;'"]\s*(DROP|DELETE|UPDATE|INSERT)/i);
});
