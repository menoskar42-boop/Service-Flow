import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// كل رقم ليه **تصحيح واحد سارى** = الأحدث. الرقم اللى اتعمله تصحيح على بكس 51
// وبعدين على 52 → الـ 52 هو اللى يظهر، والـ 51 يروح «التصحيحات السابقة».
// والشاشة بتفتح على «عدم التطابق فقط» — ده شغل مسئول البيانات.
//
// مُثبت end-to-end على سيرفر حقيقى بنفس حالة الصورة:
//   scope=latest      → بكس 52 (الرقم المكرر) + الرقم التانى   ← الـ 51 اختفى
//   scope=superseded  → بكس 51 بس
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const rep = readFileSync(
  new URL("../client/src/components/LineDataCorrectionsReport.tsx", import.meta.url), "utf8");

const start = routes.indexOf('app.get("/api/line-data-corrections"');
const ep = routes.slice(start, routes.indexOf('app.post("/api/line-data-corrections/:id/review"'));

// «الأحدث» = **تاريخ الإدخال** (created_at) — مش رقم الصف ولا ترتيب الحفظ.
// مُثبت بالحالة الصعبة على سيرفر حقيقى: الصف الأحدث بتاريخ الإدخال (22:35) اتحفظ
// **الأول** فأخد id أصغر (id=1)، والأقدم (21:45) أخد id=2:
//   السارى   → id=1 بكس 51 ✅   (لو الترتيب كان بالـ id كان هيطلع غلط)
//   السابقة  → id=2 بكس 52 ✅
// created_at معرَّف NOT NULL DEFAULT now() فمافيش صف من غير تاريخ يتصدّر الترتيب.
test("only the newest correction per phone is current", () => {
  assert.match(ep, /const LATEST_PER_PHONE = `c\.id = \(SELECT c2\.id FROM line_data_corrections c2/);
  assert.match(ep, /WHERE c2\.phone_full = c\.phone_full/, "grouped by the full phone number");
  assert.match(ep, /ORDER BY c2\.created_at DESC, c2\.id DESC LIMIT 1/,
    "created_at first — the id only breaks a same-instant tie");
  // العمود اللى بيتعرض كـ«تاريخ الإدخال» هو نفسه اللى الترتيب بيتم عليه
  assert.match(ep, /\(c\.created_at AT TIME ZONE 'Africa\/Cairo'\) AS "createdAt"/);
  const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
  assert.match(db, /created_at timestamptz NOT NULL DEFAULT now\(\)/);
});

test("the superseded ones are a separate view, never mixed in", () => {
  assert.match(ep, /const scopeCond = scope === "superseded" \? `NOT \(\$\{LATEST_PER_PHONE\}\)` : LATEST_PER_PHONE;/);
  assert.match(ep, /WHERE \$\{scopeCond\} \$\{mine\}/);
  // الافتراضى هو السارى
  assert.match(ep, /const scope = String\(\(req\.query as Record<string, string>\)\.scope \|\| "latest"\)/);
});

test("the report opens on mismatches only", () => {
  assert.match(rep, /const \[onlyMismatch, setOnlyMismatch\] = useState\(true\);/);
  // والزرار لسه بيسمح بعرض الكل
  assert.match(rep, /onClick=\{\(\) => setOnlyMismatch\(\(v\) => !v\)\}/);
  assert.match(rep, /عدم التطابق فقط \(\$\{mismatchCount\}\)/);
});

test("the scope reaches the server and refetches when switched", () => {
  assert.match(rep, /const \[scope, setScope\] = useState<"latest" \| "superseded">\("latest"\);/);
  assert.match(rep, /queryKey: \["\/api\/line-data-corrections", dateFrom, dateTo, scope\]/,
    "the scope must be in the query key or switching would show stale rows");
  assert.match(rep, /p\.set\("scope", scope\)/);
  assert.match(rep, /التصحيحات السابقة/);
});
