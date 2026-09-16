import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// تقرير «متابعة التصحيحات»: الخانة اللى الفنى بيدخّلها هى **الصحيحة** فعلاً،
// فالعنوان بقى «(الصحيح)» بدل «(المُدخَل)» فى الكابينة والبكس والترمنال.
// العنوان لازم يفضل متطابق بين رأس الجدول وأعمدة التصدير (Excel/PDF) — لو اتغيّر
// فى واحد بس، التصدير بيطلع بعناوين مختلفة عن اللى على الشاشة.
const src = readFileSync(
  new URL("../client/src/components/LineDataCorrectionsReport.tsx", import.meta.url), "utf8");

for (const f of ["السنترال", "الكابينة", "البكس", "الترمنال"]) {
  test(`${f} is labelled as the correct value, in both the table and the exports`, () => {
    assert.equal((src.match(new RegExp(`${f} \\(الصحيح\\)`, "g")) || []).length, 2,
      "one in COLS (exports) and one in the table header");
    assert.ok(!src.includes(`${f} (المُدخَل)`), `${f} still uses the old label`);
  });
}

test("the review column keeps its label", () => {
  for (const f of ["السنترال", "الكابينة", "البكس", "الترمنال"]) {
    assert.equal((src.match(new RegExp(`${f} \\(المراجعة\\)`, "g")) || []).length, 2);
  }
});

// الترتيب: الأربعة «الصحيح» ورا بعض، وبعدهم الأربعة «المراجعة» — بدل ما يبقوا
// متبادلين عمود وعمود. والترتيب ده لازم يبقى واحد فى التلات أماكن: أعمدة التصدير،
// رؤوس الجدول، وخانات الصف — أى اختلاف معناه إن البيانات بتتحطّ تحت عمود غلط.
test("the correct columns all come before the review columns", () => {
  const order = (hay: string, needles: string[]) => needles.map((x) => hay.indexOf(x));
  const asc = (a: number[]) => a.every((v, i) => v > 0 && (i === 0 || v > a[i - 1]));

  const cols = src.slice(src.indexOf("const COLS = ["), src.indexOf("];", src.indexOf("const COLS = [")));
  assert.ok(asc(order(cols, ["السنترال (الصحيح)", "الكابينة (الصحيح)", "البكس (الصحيح)",
    "الترمنال (الصحيح)", "السنترال (المراجعة)", "الكابينة (المراجعة)", "البكس (المراجعة)",
    "الترمنال (المراجعة)"])), "export columns are out of order");

  const head = src.slice(src.indexOf("<TableHead"), src.indexOf("</TableRow>", src.indexOf("<TableHead")));
  assert.ok(asc(order(head, ["السنترال (الصحيح)", "الكابينة (الصحيح)", "البكس (الصحيح)",
    "الترمنال (الصحيح)", "السنترال (المراجعة)", "الكابينة (المراجعة)", "البكس (المراجعة)",
    "الترمنال (المراجعة)"])), "table headers are out of order");

  // خانات الصف: الأربع مقارنات الأول، وبعدها الأربع خانات بتاعة المراجعة
  const body = src.slice(src.indexOf("shown.map((r, i) =>"));
  assert.ok(asc(order(body, ["cmpCell(r.central", "cmpCell(r.cabinNumber", "cmpCell(r.boxNumber",
    "cmpCell(r.dpTerminal", "r.fetchedCentral ||", "r.fetchedCabin ||", "r.fetchedBox ||",
    "r.fetchedTerminal ||"])), "row cells are out of order");

  // وصفوف التصدير بنفس الترتيب
  const rows = src.slice(src.indexOf("const exportRows"), src.indexOf("const handleExportExcel"));
  assert.ok(asc(order(rows, ["r.central ??", "r.cabinNumber ??", "r.boxNumber ??", "r.dpTerminal ??",
    "r.fetchedCentral ??", "r.fetchedCabin ??", "r.fetchedBox ??", "r.fetchedTerminal ??"])),
    "export rows are out of order");
});
