import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// زر «بيان الخط» جنب كل رقم فى «أوامر شغل بدون كمية سلك»: بيفتح نافذة فيها الاسم
// والعنوان + البيانات الفنية + **كود كابينة المسان الحالى** — عشان الفنى يفتكر الخط
// ويقدّر كمية السلك من غير ما يسيب الشاشة.
const dlg = readFileSync(
  new URL("../client/src/components/LineInfoDialog.tsx", import.meta.url), "utf8");
const report = readFileSync(
  new URL("../client/src/components/WorkOrdersNoCableEntry.tsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

// ⚠️ اتصاد بالتجربة: الرد شكله { found, line } — القراءة الأولى كانت بترجّع الغلاف
// نفسه فكل الخانات كانت بتطلع «-».
test("the dialog reads the lookup response shape correctly", () => {
  assert.match(dlg, /return j\?\.found && j\?\.line \? \(j\.line as LookupLine\) : null;/);
  const start = routes.indexOf('app.get("/api/phone-lines/lookup"');
  const ep = routes.slice(start, routes.indexOf('app.get("/api/phone-lines/', start + 50));
  assert.match(ep, /res\.json\(\{ found: true, line \}\)/, "the endpoint wraps the row in { found, line }");
  assert.match(ep, /if \(!line \|\| !line\.hasData\) return res\.json\(\{ found: false \}\)/);
});

test("it shows the customer, the MSAN code and the technical data", () => {
  for (const f of ["subName", "subAdd", "msanCode", "cabinNumber", "boxNumber", "dpTerminal",
                   "iduNo", "oduNo", "primaryBlockNo", "cabinetIn", "secBlockNo", "cabinetOut",
                   "port", "len"]) {
    assert.match(dlg, new RegExp(`d\\.${f}\\b`), `the dialog must show ${f}`);
  }
  assert.match(dlg, /كود كابينة المسان/);
});

// البيان بيتحمّل أول ما النافذة تتفتح — مش مع كل صف فى الجدول.
test("the lookup only runs when the dialog opens", () => {
  assert.match(dlg, /enabled: open && !!phone,/);
});

test("the report puts the button next to every phone number", () => {
  assert.match(report, /import \{ LineInfoDialog \} from "@\/components\/LineInfoDialog";/);
  assert.match(report, /setInfoPhone\(String\(r\.phoneNumber\)\)/);
  assert.match(report, /<LineInfoDialog\s*\n\s*phone=\{infoPhone \?\? ""\}\s*\n\s*open=\{!!infoPhone\}/);
});

// الفنى لازم يقدر يفتحها — الـ endpoint مقفول على المبيعات بس.
test("a technician may call the lookup", () => {
  const ep = routes.slice(routes.indexOf('app.get("/api/phone-lines/lookup"'), routes.indexOf('app.get("/api/phone-lines/lookup"') + 300);
  assert.match(ep, /requireAuth/);
  assert.match(ep, /req\.user\?\.role === ROLES\.SALES\) return res\.status\(403\)/);
  assert.doesNotMatch(ep, /ROLES\.TECH\) return res\.status\(403\)/);
});
