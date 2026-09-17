import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// v10.22: أداة القياس بقت تسجّل «Profile Optimization Status» جنب الـ Dispatch Score.
// السلسلة كاملة: السكربت يقراه من شاشة ClearView → يحطّه فى الـ CSV → يبعته مع القياس
// → السيرفر يخزّنه فى case_138.po_status.
//
// قراية الشاشة نفسها متأكَّد منها فى Chromium على نسخة من الشاشتين اللى بعتهم المستخدم:
//   «PO is not currently running.PO was completed on 2026-08-04 05:27:48 The last …»
//   «PO is running. Currently, the line profile is being optimized. Wait a few days …»
// والرفع متأكَّد منه على سيرفر + قاعدة بيانات حقيقيين (inserted:2 والعمود اتقرا زى ما هو).
const script = readFileSync(new URL("../dzs-expresse-v10.user.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
const db     = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

test("the script reads the status and keeps an early copy of it", () => {
  assert.match(script, /function findProfileOptimizationStatus\(\)/);
  assert.match(script, /findValueCellByLabel\("Profile Optimization Status"\)/);
  // الإملاء البريطانى كمان — الشاشة اتغيّرت قبل كده
  assert.match(script, /findValueCellByLabel\("Profile Optimisation Status"\)/);
  // بيتلمّ بدرى زى الاسكور والسرعة عشان مايضيعش لو الشاشة اتغيّرت بعد الـ real-time
  assert.match(script, /if \(po\) earlyPo = po;/);
  assert.match(script, /const po = findProfileOptimizationStatus\(\) \|\| earlyPo;/);
  // وحتى فى الحالات الخاصة (خارج الخدمة/104…) بيتسجّل لو الشاشة عرضته
  assert.match(script, /saveResult\(CURRENT_LINE_ID, score, "", "", "-", findProfileOptimizationStatus\(\) \|\| earlyPo\)/);
});

test("the status never breaks the CSV: one line, no semicolons, and a matching column", () => {
  // فاصل الـ CSV هو ";" — لازم يتشال من النص
  assert.match(script, /function cleanOneLine\(t\) \{[\s\S]*?replace\(\/;\/g, "،"\)/);
  assert.match(script, /replace\(\/\\s\+\/g, " "\)/);
  // العمود اتضاف فى الهيدر وفى الصف — والعدد لازم يبقى واحد
  const header = script.match(/const header = \[([^\]]+)\]\.join\(SEP\);/);
  const row = script.match(/const rows = results\.map\(r => \[([\s\S]*?)\]\.join\(SEP\)\)/);
  assert.ok(header && row, "CSV header and row must exist");
  assert.match(header[1], /"حالة تحسين البروفايل"/);
  assert.match(row[1], /r\.poStatus \|\| ""/);
  const headerCols = header[1].split(",").length;
  const rowCols = row[1].split(",").map((s) => s.trim()).filter(Boolean).length;
  assert.equal(rowCols, headerCols, "عدد أعمدة الصف لازم يساوى عدد أعمدة الهيدر");
});

test("the script sends it and the server stores it", () => {
  assert.match(script, /poStatus: rec\.poStatus,/);
  assert.match(routes, /const poStatus = \(it\.poStatus \?\? ""\)\.toString\(\)/);
  assert.match(routes, /account_no, measured_by, po_status, complain_time, source\)/);
  assert.match(routes, /VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9, now\(\), 'dzs'\)/);
});

test("the new column exists in both the schema and ensureSchema (قاعدة #8)", () => {
  assert.match(schema, /poStatus: text\("po_status"\)/);
  assert.match(db, /ALTER TABLE case_138 ADD COLUMN IF NOT EXISTS po_status text/);
});
