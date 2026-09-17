import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// كل المهام المجدولة فى السيرفر (الباتشات اليومية ٩ ص، جلب WFM ١١ ص و٢ م، لقطة
// المنتظم ١١ م) بتقرر تشتغل امتى من `cairoNow().hour`. الباج: `hour12: false` مش
// مضمون يدّى 0 عند منتصف الليل — على كذا نسخة ICU بيتحوّل لدورة h24 فيرجّع "24"،
// فشرط «لسه بدرى» (hour < 9) يفشل والباتش اليومى يتفتح ٠٠:٠٠ بدل ٩ الصبح.
// وده اللى ظهر فعلاً فى تواريخ الباتشات عند المستخدم: 00:00 و00:04.
const src = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const i = src.indexOf("function cairoNow() {");
assert.ok(i >= 0, "cairoNow must exist");
const body = src.slice(i, src.indexOf("\n}", i) + 2)
  .replace(/\(t: string\)/g, "(t)").replace(/\(p: any\)/g, "(p)");

/** بيشغّل cairoNow الحقيقية على لحظة معيّنة، مع إمكانية تقليد ICU اللى بيدّى h24. */
function cairoNowAt(iso: string, forceH24: boolean) {
  const OrigFmt = Intl.DateTimeFormat;
  const Patched: any = function (loc: any, opts: any) {
    const o = { ...opts };
    if (forceH24 && (o.hourCycle === "h23" || o.hour12 === false)) { delete o.hour12; o.hourCycle = "h24"; }
    return new OrigFmt(loc, o);
  };
  Patched.prototype = OrigFmt.prototype;
  const RealDate = Date;
  const FixedDate: any = class extends RealDate {
    constructor(...a: any[]) { super(...((a.length ? a : [iso]) as [any])); }
  };
  return new Function("Intl", "Date", body + "; return cairoNow;")(
    { ...Intl, DateTimeFormat: Patched }, FixedDate) as () => { date: string; hour: number };
}

const MIDNIGHT_CAIRO = "2026-09-16T21:00:00Z";  // ٠٠:٠٠ يوم ١٧/٩ بتوقيت القاهرة
const NINE_AM_CAIRO  = "2026-09-17T06:00:00Z";  // ٠٩:٠٠ يوم ١٧/٩ بتوقيت القاهرة

test("midnight in Cairo is hour 0 — even on an ICU that reports 24", () => {
  for (const forceH24 of [false, true]) {
    const r = cairoNowAt(MIDNIGHT_CAIRO, forceH24)();
    assert.equal(r.hour, 0, `hour must be 0 at midnight (forceH24=${forceH24})`);
    assert.equal(r.date, "2026-09-17");
    // ده الشرط الحقيقى اللى بيحكم الباتش اليومى
    assert.ok(r.hour < 9, "الباتش اليومى مايتفتحش نص الليل");
  }
});

test("nine in the morning still runs the daily batches", () => {
  for (const forceH24 of [false, true]) {
    const r = cairoNowAt(NINE_AM_CAIRO, forceH24)();
    assert.equal(r.hour, 9);
    assert.ok(r.hour >= 9, "الباتش اليومى يتفتح ٩ الصبح");
  }
});

test("the hour cycle is pinned explicitly, not left to hour12", () => {
  const fn = src.slice(i, src.indexOf("\n}", i));
  assert.match(fn, /hourCycle: "h23"/);
  assert.doesNotMatch(fn, /hour12: false/);
  assert.match(fn, /if \(hour === 24\) hour = 0;/);
});
