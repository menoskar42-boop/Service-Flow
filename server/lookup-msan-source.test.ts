import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const lookupStart = routes.indexOf('app.get("/api/phone-lines/lookup"');
const lookupEnd = routes.indexOf('app.post("/api/line-mobiles"', lookupStart);
assert.ok(lookupStart >= 0, "the phone lookup endpoint must exist");
assert.ok(lookupEnd > lookupStart, "the phone lookup endpoint must be bounded");
const lookupRoute = routes.slice(lookupStart, lookupEnd);

// كود الكابينة (MSAN) لازم يجى من جدول المنافذ — ده الجدول الوحيد اللى «تحديث البورت»
// (port-change/ingest) وتحديث ملف البورتات بيكتبوا فيه. لما كان بيجى من
// cabinet_technicians (المشتق من الكابينة النحاسية للخط) كان تغيير البورت بيتخزّن صح
// وشاشة «بحث برقم التليفون» تفضل عارضة الكود القديم للأبد.
test("the phone lookup reads the MSAN code from phone_ports, not from cabinet_technicians", () => {
  assert.match(
    lookupRoute,
    /COALESCE\(NULLIF\(btrim\(pp\.msan_code\), ''\), ctc\.cabin_code\) AS "msanCode"/,
    "phone_ports must win, with cabinet_technicians only as a fallback",
  );
  assert.doesNotMatch(
    lookupRoute,
    /^\s*ctc\.cabin_code AS "msanCode"/m,
    "the old cabinet_technicians-only source must be gone",
  );
});

// الفنى والتغطية قاعدتهم مختلفة: فنى المنطقة بيتحدد من كابينة الخط (cabinet_technicians)
// مش من الأمسان — فالإصلاح فوق مالوش أى أثر عليهم.
test("technician name and coverage still resolve through cabinet_technicians", () => {
  assert.match(lookupRoute, /LEFT JOIN msan_tech_overrides mto ON mto\.cabin_code = ctc\.cabin_code/);
  assert.match(lookupRoute, /COALESCE\(mto\.tech_name, ctc\.ct_tech, ''\) AS "techName"/);
  assert.match(lookupRoute, /ctc\.cabin_code IS NOT NULL AND btrim\(ctc\.cabin_code\) <> ''/);
});

// نتيجة تغيير البورت لازم تتكتب فى phone_ports عشان الشاشة تشوفها.
test("a completed port change writes the new MSAN and frame into phone_ports", () => {
  const ingestStart = routes.indexOf('app.post("/api/port-change/ingest"');
  const ingestEnd = routes.indexOf('app.get("/api/port-change/list"', ingestStart);
  assert.ok(ingestStart >= 0 && ingestEnd > ingestStart, "the port-change ingest endpoint must be bounded");
  const ingest = routes.slice(ingestStart, ingestEnd);
  assert.match(ingest, /INSERT INTO phone_ports \(phone_number, frame, msan_code, port_type, uploaded_at\)/);
  assert.match(ingest, /msan_code = COALESCE\(NULLIF\(EXCLUDED\.msan_code,''\), phone_ports\.msan_code\)/);
});
