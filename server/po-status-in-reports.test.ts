import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// «حالة تحسين البروفايل» (case_138.po_status) بتتعرض جنب الاسكور فى كل التقارير
// اللى بتعرض قياس خط، وفى «بحث برقم التليفون».
//
// مُثبت على سيرفر + قاعدة بيانات حقيقيين: كل الـ endpoints رجّعت 200 (يعنى الأعمدة
// موجودة فعلاً — عمود ناقص كان هيرمى 500)، واللى فيها بيانات رجّعت النص كامل:
//   /api/phone-lines، /with-account، /needs-po-stop، /lookup، /reports/current-faults
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const comp = new URL("../client/src/components/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, comp), "utf8");

test("every lastMeasScore the server sends comes with its poStatus", () => {
  const scores = routes.match(/^\s*[A-Za-z0-9_]+\.score\s*AS "lastMeasScore",/gm) ?? [];
  const allPos = routes.match(/^\s*[A-Za-z0-9_]+\.po_status\s*AS "poStatus",/gm) ?? [];
  // «بحث برقم التليفون» بيسمّى الاسكور "score" مش "lastMeasScore" — بيتفحص لوحده تحت
  const lookupOne = '              c.po_status AS "poStatus",\n';
  const pos = allPos.filter((x) => x !== lookupOne.replace(/\n$/, ""));
  assert.ok(scores.length >= 13, `expected the known score columns, got ${scores.length}`);
  assert.equal(pos.length, scores.length,
    "كل تقرير بيعرض الاسكور لازم يعرض حالة البروفايل معاه");
  // ونفس الـ alias فى كل زوج (c138p.score ↔ c138p.po_status مش alias تانى)
  const alias = (s: string) => s.trim().split(".")[0];
  assert.deepEqual(scores.map(alias), pos.map(alias));
});

test("بحث برقم التليفون sends it too", () => {
  assert.match(routes, /c\.po_status AS "poStatus",/);
  assert.match(routes, /SELECT c2\.full_phone, c2\.current_speed, c2\.max_speed, c2\.score, c2\.po_status,/);
  const lookup = read("PhoneLookupReport.tsx");
  assert.match(lookup, /poStatus: string \| null;/);
  assert.match(lookup, /\["حالة تحسين البروفايل", <PoStatusCell value=\{line\.poStatus\} \/>\]/);
  // فى التصديرين كمان (قاعدة #7)
  assert.match(lookup, /"حالة تحسين البروفايل": line\.poStatus \?\? "",/);
  assert.match(lookup, /poStatusShort\(line\.poStatus\)/);
});

test("the shared badge keeps the long AXON text out of the tables", () => {
  const cell = read("PoStatusCell.tsx");
  // «PO is not currently running» لازم تتفحص قبل «PO is running» — الأولى بتحتوى التانية
  const notIdx = cell.indexOf("PO\\s+is\\s+not\\s+currently\\s+running");
  const runIdx = cell.indexOf("\\bPO\\s+is\\s+running");
  assert.ok(notIdx >= 0 && runIdx >= 0 && notIdx < runIdx,
    "ترتيب الفحص غلط — «مش شغّال» هتتقرا «شغّال»");
  // النص الكامل بيفضل متاح فى الـ tooltip
  assert.match(cell, /title=\{String\(value \|\| ""\)\}/);
});

test("every report that shows the score also shows the new column", () => {
  // التقارير اللى بتعرض اسكور خط — الجدول والتصدير
  const WITH_TABLE = ["NeedsSpeedReport", "ComplaintNoMeasureReport", "OpenTicketLinesReport",
                      "RepeatedWithinMonthReport", "WithAccountReport", "RegularizedFaultsRangeReport"];
  for (const f of WITH_TABLE) {
    const s = read(`${f}.tsx`);
    assert.match(s, /<TableHead[^>]*>حالة PO<\/TableHead>/, `${f}: عمود الجدول ناقص`);
    assert.match(s, /<PoStatusCell value=\{[a-z]\.poStatus\} \/>/, `${f}: خانة الجدول ناقصة`);
  }
  // التصدير (إكسل) — النص الكامل مش الشارة
  const WITH_EXCEL = ["NeedsSpeedReport", "ComplaintNoMeasureReport", "OpenTicketLinesReport",
                      "RepeatedWithinMonthReport", "WithAccountReport", "RegularizedFaultsRangeReport",
                      "CurrentFaultsReport", "RegularizedFaultsReport", "PhoneLinesReport"];
  for (const f of WITH_EXCEL) {
    assert.match(read(`${f}.tsx`), /"حالة تحسين البروفايل": [a-z]\.poStatus \?\? "",/, `${f}: عمود الإكسل ناقص`);
  }
});

test("the printed PDF tables keep their column count", () => {
  for (const f of ["CurrentFaultsReport", "RegularizedFaultsRangeReport",
                   "RegularizedFaultsReport", "RepeatedWithinMonthReport"]) {
    const s = read(`${f}.tsx`);
    const th = (s.match(/<th>حالة PO<\/th>/g) ?? []).length;
    const td = (s.match(/<td>\$\{esc\(poStatusShort\(/g) ?? []).length;
    assert.ok(th > 0, `${f}: مفيش عمود PO فى الطباعة`);
    assert.equal(th, td, `${f}: عدد أعمدة الهيدر (${th}) مش مساوى للصفوف (${td})`);
  }
});

test("no report imports the badge without using it", () => {
  for (const f of readdirSync(comp).filter((x) => x.endsWith(".tsx"))) {
    const s = read(f);
    if (!s.includes('from "./PoStatusCell"')) continue;
    if (f === "PoStatusCell.tsx") continue;
    assert.ok(/poStatus/.test(s.replace(/^import .*PoStatusCell.*$/m, "")),
      `${f}: بيستورد الشارة من غير ما يستخدمها`);
  }
});
