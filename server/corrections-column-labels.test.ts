import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// تقرير «متابعة التصحيحات»: الخانة اللى الفنى بيدخّلها هى **الصحيحة** فعلاً،
// فالعنوان بقى «(الصحيح)» بدل «(المُدخَل)» فى الكابينة والبكس والترمنال.
// العنوان لازم يفضل متطابق بين رأس الجدول وأعمدة التصدير (Excel/PDF) — لو اتغيّر
// فى واحد بس، التصدير بيطلع بعناوين مختلفة عن اللى على الشاشة.
const src = readFileSync(
  new URL("../client/src/components/LineDataCorrectionsReport.tsx", import.meta.url), "utf8");

for (const f of ["الكابينة", "البكس", "الترمنال"]) {
  test(`${f} is labelled as the correct value, in both the table and the exports`, () => {
    assert.equal((src.match(new RegExp(`${f} \\(الصحيح\\)`, "g")) || []).length, 2,
      "one in COLS (exports) and one in the table header");
    assert.ok(!src.includes(`${f} (المُدخَل)`), `${f} still uses the old label`);
  });
}

test("the review column keeps its label", () => {
  for (const f of ["الكابينة", "البكس", "الترمنال"]) {
    assert.equal((src.match(new RegExp(`${f} \\(المراجعة\\)`, "g")) || []).length, 2);
  }
});
