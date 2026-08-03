// تطبيع النص العربى للبحث — نسخة JavaScript مطابقة تماماً لدالة sf_ar_norm() فى قاعدة
// البيانات (تُنشأ فى ensureSchema() داخل server/db.ts). أى تعديل هنا لازم يتعمل هناك كمان.
//
// الغرض: البحث ميبقاش حرفياً. «ايمن» تلاقى «أيمن»، «يحيى» تلاقى «يحيي»، «فاطمه» تلاقى «فاطمة».
//   آ أ إ ٱ → ا  |  ى ئ → ي  |  ؤ → و  |  ة → ه
//   يشيل التشكيل (ً ٌ ٍ َ ُ ِ ّ ْ) والتطويل (ـ) والألف الخنجرية (ٰ)
//   يحوّل الأرقام العربية/الفارسية (٠١٢… / ۰۱۲…) لأرقام لاتينية
//   + lowercase للحروف اللاتينية

const MAP: Record<string, string> = {
  "آ": "ا", "أ": "ا", "إ": "ا", "ٱ": "ا", // آ أ إ ٱ → ا
  "ى": "ي", "ئ": "ي",                                          // ى ئ → ي
  "ؤ": "و",                                                              // ؤ → و
  "ة": "ه",                                                              // ة → ه
};

// تشكيل (064B–0652) + تطويل (0640) + ألف خنجرية (0670) → تُحذف
const STRIP = /[ً-ْـٰ]/g;

export function arNorm(s: unknown): string {
  return String(s ?? "")
    .replace(STRIP, "")
    .replace(/[آأإٱىئؤة]/g, (c) => MAP[c] ?? c)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))  // ٠١٢…
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))  // ۰۱۲…
    .toLowerCase();
}

/** هل النص المطبَّع للـ needle موجود جوّه النص المطبَّع للـ haystack؟ (بحث محلى فى الواجهة) */
export function arIncludes(haystack: unknown, needle: string): boolean {
  return arNorm(haystack).includes(needle);
}
