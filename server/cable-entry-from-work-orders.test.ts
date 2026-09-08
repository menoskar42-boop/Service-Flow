import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const entryTab = readFileSync(
  new URL("../client/src/components/WorkOrdersNoCableEntry.tsx", import.meta.url), "utf8");
const section = readFileSync(
  new URL("../client/src/components/DataCompletionSection.tsx", import.meta.url), "utf8");

const noCableStart = routes.indexOf('app.get("/api/reports/work-orders-no-cable"');
const noCableEnd = routes.indexOf('app.get("/api/reports/installations-by-tech"', noCableStart);
assert.ok(noCableStart >= 0 && noCableEnd > noCableStart, "the no-cable report endpoint must be bounded");
const noCable = routes.slice(noCableStart, noCableEnd);

// الربط بين إدخال كمية السلك وأمر الشغل بيتم بـ (رقم التليفون + نوع أمر الشغل).
// لو التاب بعتت نوع مختلف عن اللى السيرفر بيربط بيه، الكمية تتخزّن بس أمر الشغل
// يفضل «بدون كمية سلك» للأبد — فالتطبيقين لازم يفضلوا متطابقين.
test("the entry tab derives the work-order type exactly as the server links it", () => {
  assert.match(
    noCable,
    /ce\.work_order_type = CASE WHEN trim\(w\.service_type\) = 'نقل' THEN 'نقل' ELSE 'تركيب' END/,
    "the server links a cable entry to a work order by phone + derived type",
  );
  assert.match(
    entryTab,
    /String\(serviceType \?\? ""\)\.trim\(\) === "نقل" \? "نقل" : "تركيب"/,
    "the tab must derive the same type instead of asking the user to pick one",
  );
});

// الكمية بتتحفظ على نفس endpoint الإدخال اليدوى — مفيش مسار تانى للبيانات.
test("the tab saves through the existing cable-entries endpoint", () => {
  assert.match(entryTab, /apiRequest\("POST", "\/api\/cable-entries"/);
  // وبيبطّل الكاش للتلاتة عشان الصف يختفى من هنا ويظهر هناك فوراً
  for (const key of ["/api/reports/work-orders-no-cable", "/api/cable-entries", "/api/work-orders"]) {
    assert.ok(entryTab.includes(`queryKey: ["${key}"]`), `must invalidate ${key}`);
  }
});

test("the tab is mounted inside the data-completion section", () => {
  assert.match(section, /import \{ WorkOrdersNoCableEntry \}/);
  assert.match(section, /tab === "orders" \? <WorkOrdersNoCableEntry \/>/);
});
