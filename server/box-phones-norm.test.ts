import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// الباج (مُثبت على قاعدة حقيقية): boxPhones كانت بتطابق **حرفياً**
//   btrim(pl.cabin_number) = btrim($2)
// والمتعذرات بتكتب الكابينة بشرطة مايلة («2/6») وبيان التليفونات بشرطة عادية
// («2-6») — فنص البكسيات رجعت **صفر أرقام**، وفنى الصيانة استلم فحص من غير أى رقم
// يراجعه. شوفناها بالعين فى نفس التشغيلة: «كابينة 4-6» → 6 أرقام، «كابينة 2/6» → 0.
const src = readFileSync(new URL("./box-full-inspection.ts", import.meta.url), "utf8");

const start = src.indexOf("export async function boxPhones");
assert.ok(start >= 0, "boxPhones must exist");
const fn = src.slice(start, src.indexOf("export async function requestBoxDataReview"));

test("the box phone lookup no longer matches the raw strings", () => {
  assert.doesNotMatch(fn, /btrim\(pl\.central\) = btrim\(\$1\)/);
  assert.doesNotMatch(fn, /btrim\(pl\.cabin_number\) = btrim\(\$2\)/);
  assert.doesNotMatch(fn, /btrim\(pl\.box_number\) = btrim\(\$3\)/);
});

test("both sides of every comparison go through the same normalizer", () => {
  assert.match(fn, /\$\{centralN\("pl\.central"\)\} = \$\{centralN\("\$1"\)\}/);
  assert.match(fn, /\$\{cabN\("pl\.cabin_number"\)\} = \$\{cabN\("\$2"\)\}/);
  assert.match(fn, /\$\{boxN\("pl\.box_number"\)\} = \$\{boxN\("\$3"\)\}/);
  // بكس فاضى مايجبش الكابينة كلها
  assert.match(fn, /\$\{boxN\("\$3"\)\} <> ''/);
});

test("the normalizers mirror shared/cab-norm", () => {
  // الكابينة: كل أشكال الفاصل (\ / _ وكل الشرطات) بتبقى شرطة واحدة
  assert.match(src, /const cabN = \(e: string\) =>/);
  assert.match(src, /\[\\\\\\\\\/_‐‑‒–—―\]/, "cabN must fold every separator into '-'");
  // السنترال: المسافات حوالين الشرطة بتتشال
  assert.match(src, /const centralN = \(e: string\) =>/);
  // البكس: أرقام بس من غير أصفار بادئة («05» = «5»)
  assert.match(src, /const boxN = \(e: string\) =>/);
  assert.match(src, /ltrim\(regexp_replace\(sf_ar_norm/);
  // sf_ar_norm بتتكفّل بالأرقام العربية وتوحيد ة\/ه وى\/ي
  for (const n of ["centralN", "cabN", "boxN"]) {
    const i = src.indexOf(`const ${n} = `);
    const body = src.slice(i, src.indexOf("\n\n", i));
    assert.match(body, /sf_ar_norm/, `${n} must normalise Arabic letters and digits`);
  }
});
