import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// «CVMSANInstallation» = الحالة الجديدة Convergent (العميل بيتعاقد على صوت وداتا فى
// نفس أمر الشغل) — أعلنتها إدارة الدعم الفنى 2026-09-15. دى **تركيب جديد** وبيتصرف
// لها كمية سلك.
//
// الباج: الاستيراد كان بيقارن بنص واحد ثابت:
//   serviceType = rawServiceType === "Fixed Voice Installation MSAN" ? "تركيب جديد" : "نقل"
// فأى نوع تانى — ومنه CVMSANInstallation — كان بيتحسب «نقل»، فيختفى من تقرير كمية
// السلك ويظهر غلط فى النقل.
//
// مُثبت end-to-end باستيراد ملف أوامر شغل حقيقى على سيرفر حقيقى:
//   Fixed Voice Installation MSAN → تركيب جديد (زى ما كان)
//   CVMSANInstallation            → تركيب جديد ✅
//   CV MSAN Installation          → تركيب جديد ✅ (المسافات مابتفرقش)
//   FVChPhoneNoNewLoc             → نقل        (مااتغيّرش)
// والتلاتة ظهروا فى «أوامر شغل بدون كمية سلك» بنوع تركيب.
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

test("the convergent type counts as a new installation in the work-orders sheet", () => {
  assert.match(routes, /const WO_SHEET_INSTALL_TYPES = \[\s*\n\s*"Fixed Voice Installation MSAN",\s*\n\s*"CVMSANInstallation",\s*\n\s*\]/);
  assert.match(routes, /const serviceType\s+= isWoSheetInstall\(rawServiceType\) \? "تركيب جديد" : "نقل";/);
  // المقارنة النصّية الثابتة القديمة اتشالت
  assert.doesNotMatch(routes, /rawServiceType === "Fixed Voice Installation MSAN"/);
});

test("matching ignores spacing and case", () => {
  assert.match(routes, /const woTypeKey = \(s: unknown\) => String\(s \?\? ""\)\.toLowerCase\(\)\.replace\(\/\\s\+\/g, ""\)/);
  assert.match(routes, /const WO_SHEET_INSTALL_KEYS = new Set\(WO_SHEET_INSTALL_TYPES\.map\(woTypeKey\)\)/);
});

test("it is also a WFM installation type", () => {
  const list = routes.slice(routes.indexOf("const INSTALL_TYPES = ["),
                            routes.indexOf("const INSTALL_TYPES_LC"));
  assert.match(list, /"CVMSANInstallation",/);
  assert.match(list, /"FVInstallationMSAN",/, "the existing types stay");
});

// النوع الجديد مايتلخبطش مع أوامر الرفع النهائى (اللى بتتحوّل لجدول تانى ومابتدخلش
// أوامر الشغل خالص).
test("it is not mistaken for a deactivation order", () => {
  const dea = routes.slice(routes.indexOf("const DEACTIVATION_WO_TYPES_LC"),
                           routes.indexOf("function isDeactivationWO"));
  assert.ok(!dea.toLowerCase().includes("installation"),
    "no deactivation prefix may match an installation type");
});
