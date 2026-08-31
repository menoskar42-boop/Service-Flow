// ============================================================================
// shared/cab-norm.ts — توحيد أسماء السناتر وأرقام الكباين والبكسيات، وفكّ نطاقات
// البكسيات. مصدر واحد يستخدمه السيرفر (تكتات «بوكس معطل») والواجهة (برنامج
// الكوابل) عشان الطرفين يحسبوا نفس الحساب بالظبط.
//
// المبادئ (نفس اللى فى تقارير «بوكس معطل/مليان»):
//   • أرقام عربية/فارسية → إنجليزية.
//   • كل أشكال الفاصل (/ \ _ – —) → شرطة واحدة، والمسافات حواليها تتشال.
//   • «2/2» = «2-2» = «2 - 2».
// ============================================================================

/** أرقام عربية/فارسية → إنجليزية */
export const toAsciiDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
   .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** توحيد اسم السنترال */
export const normCentral = (s: unknown): string =>
  String(s ?? "").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();

/** توحيد رقم الكابينة */
export const normCab = (s: unknown): string =>
  toAsciiDigits(String(s ?? ""))
    .replace(/[\\\/_‐‑‒–—―]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** رقم البكس كأرقام فقط (بعد تحويل الأرقام العربية) — بدون أصفار بادئة:
 *  «05» و«5» نفس البكس، ومن غير التوحيد ده التغطية والتطابق كانوا بيفشلوا. */
export const normBox = (s: unknown): string => {
  const d = toAsciiDigits(String(s ?? "")).replace(/[^0-9]/g, "");
  return d ? String(parseInt(d, 10)) : "";
};

/** فكّ بكسيات التكت: «1:5» → 1..5 | «1&15» → 1,15 | «1*15» → 1,15 | «1:5&8» → 1..5,8 | «4» → 4
 *  الفواصل (& ، , ، . ، *) بتتفك الأول وبعدين النطاق جوه كل جزء — قبل كده «1:5&8» كانت
 *  بتتقرا 1..58 فتكت واحدة تمنع 57 بكس ملهومش دعوة. */
export function expandBoxes(boxStr: unknown): string[] {
  const s = toAsciiDigits(String(boxStr ?? "")).trim();
  if (!s) return [];
  const out: string[] = [];
  for (const part of s.split(/[&*،,.]/)) {
    const seg = part.trim();
    if (!seg) continue;
    if (seg.includes(":")) {
      const [a, b] = seg.split(":").map((x) => parseInt(x.replace(/[^0-9]/g, ""), 10));
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        for (let i = lo; i <= hi && i - lo < 1000; i++) out.push(String(i));
        continue;
      }
    }
    const one = normBox(seg);
    if (one) out.push(one);
  }
  return Array.from(new Set(out));
}

/** مفتاح موحّد للبكس: سنترال|كابينة|بكس */
export const boxKey = (central: unknown, cabinet: unknown, box: unknown): string =>
  `${normCentral(central)}|${normCab(cabinet)}|${normBox(box)}`;
