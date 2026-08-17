// ============================================================================
// shared/name-match.ts — نسبة تشابه الأسماء العربية (بدون أى إضافة على قاعدة البيانات).
//
// الأسماء بتتكتب بصيغ مختلفة بين قسم الطلبات ومتعذرات OM: همزات (أ/ا/إ)، تاء
// مربوطة (ة/ه)، ياء (ى/ي)، تشكيل، مسافات زيادة، و«عبد الله» مقابل «عبدالله».
// arNorm بيحلّ الحروف، والباقى بيتحلّ هنا:
//
//   • بنقسّم الاسم لكلمات وبنشيل الكلمات اللى مالهاش قيمة تمييزية («عبد» لوحدها،
//     «محمد» متكرّرة جداً بس بنسيبها لأنها بتفرّق فعلاً فى الأسماء القصيرة).
//   • **توفيق المسافات**: لو كلمة فى جهة = كلمتين متلاصقين فى الجهة التانية بندمجهم
//     (عبد الله ↔ عبدالله، نور الدين ↔ نورالدين، ابو بكر ↔ ابوبكر) — من غير تعداد
//     بادئات بعينها، فأى اختلاف فى المسافات بيتحلّ لوحده.
//   • المقارنة **بالترتيب**: الأسماء المصرية مرتّبة (الاسم + الأب + الجد + العيلة)،
//     فالأقصر لازم يكون **بادئة** من الأطول. «محمد مختار عثمان» تطابق «محمد مختار»،
//     لكن «محمد مختار عثمان» **مش** تطابق «محمد مختار احمد» — الجد مختلف يعنى
//     شخص تانى. أقل تطابق مقبول اسمين متتاليين (ثنائى).
//   • للكلمات اللى مش متطابقة بالظبط بنسمح بتشابه حرفى عالى (Dice على الحروف
//     الثنائية) عشان الأخطاء الإملائية البسيطة («ابراهيم» / «إبراهيم»).
//
// النتيجة رقم من 0 لـ 1. العتبة الافتراضية 0.7 (اللى المستخدم طلبها).
// ============================================================================

import { arNorm } from "./ar-norm";

/** كلمات بتتشال لأنها مش مميِّزة (ألقاب/وصلات) */
const STOP_WORDS = new Set(["بن", "بنت", "ال", "الحاج", "الحاجه", "الشيخ", "دكتور", "د", "م", "مهندس"]);

/** يرجّع كلمات الاسم بعد التطبيع */
export function nameTokens(s: unknown): string[] {
  // مش بنستخدم \p{L} عشان الـ target هنا ES5 — نطاق الحروف العربية + اللاتينى + الأرقام
  const norm = arNorm(s).replace(/[^\u0600-\u06FF\u0750-\u077FA-Za-z0-9\s]/g, " ");
  return norm.split(/\s+/).filter((w) => w && w.length >= 2 && !STOP_WORDS.has(w));
}

/** Dice على الحروف الثنائية — للأخطاء الإملائية داخل الكلمة الواحدة */
function bigramDice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a), gb = grams(b);
  let inter = 0;
  for (const [g, n] of Array.from(ga.entries())) inter += Math.min(n, gb.get(g) ?? 0);
  const total = (a.length - 1) + (b.length - 1);
  return total ? (2 * inter) / total : 0;
}

/** الكلمتين تعتبروا نفس الكلمة؟ (تطابق تام أو تشابه حرفى عالى) */
const WORD_MATCH_MIN = 0.82;
/** عتبة أعلى للدمج — عشان مانلزقش كلمتين غلط */
const MERGE_MATCH_MIN = 0.9;

/**
 * توفيق المسافات: لو كلمة فى جهة = كلمتين (أو تلاتة) متلاصقين فى الجهة التانية،
 * بندمجهم. ده بيخلّى «عبد الله» تساوى «عبدالله»، و«نور الدين» تساوى «نورالدين»،
 * و«ابو بكر» تساوى «ابوبكر» — **من غير ما نعدّد بادئات بعينها**، فأى اختلاف
 * فى المسافات بين الاسمين بيتحلّ لوحده.
 */
function reconcile(a: string[], b: string[]): string[] {
  if (!b.length) return a;
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) {
    let merged: string | null = null;
    for (let n = 3; n >= 2 && !merged; n--) {
      if (i + n > a.length) continue;
      const cand = a.slice(i, i + n).join("");
      const hit = b.some((w) => w === cand || bigramDice(cand, w) >= MERGE_MATCH_MIN);
      if (hit) { merged = cand; i += n - 1; }
    }
    out.push(merged ?? a[i]);
  }
  return out;
}

/** أقل عدد أسماء متتالية لازم تتطابق عشان نقترح تطابق (ثنائى) */
const MIN_LEADING_NAMES = 2;

/**
 * نتيجة المقارنة التفصيلية — بيرجّع كمان عدد الأسماء المتطابقة عشان الواجهة
 * تقدر توضّح «تطابق ثلاثى» ولا «ثنائى».
 */
export function nameMatch(a: unknown, b: unknown): { score: number; matched: number; conflict: boolean } {
  let ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return { score: 0, matched: 0, conflict: false };
  // توفيق المسافات فى الاتجاهين
  ta = reconcile(ta, tb);
  tb = reconcile(tb, ta);

  // ⚠️ المقارنة **بالترتيب**: الأسماء المصرية مرتّبة (الاسم + الأب + الجد + العيلة)،
  // فاختلاف اسم فى نفس الموضع معناه شخص تانى مش نفس الشخص.
  //   محمد مختار عثمان  ↔ محمد مختار        → تطابق (الأقصر بادئة من الأطول)
  //   محمد مختار عثمان  ↔ محمد مختار احمد   → **مش** تطابق (الجد مختلف)
  // من غير القاعدة دى كان قياس Dice بيدّى 0.75 للحالة التانية لو الأسماء رباعية
  // (محمد مختار عثمان على ↔ محمد مختار احمد على) ويعتبرهم نفس الشخص بالغلط.
  const overlap = Math.min(ta.length, tb.length);
  let matched = 0;
  for (let i = 0; i < overlap; i++) {
    const same = ta[i] === tb[i] || bigramDice(ta[i], tb[i]) >= WORD_MATCH_MIN;
    if (!same) return { score: 0, matched: i, conflict: true };   // تعارض فى الترتيب
    matched++;
  }
  if (matched < MIN_LEADING_NAMES) return { score: 0, matched, conflict: false };

  // مفيش تعارض → الأقصر بادئة من الأطول. النتيجة بتعبّر عن قوة التطابق:
  // الاسمين متطابقين بالكامل = 1، وكل ما الفرق فى عدد الأسماء يكبر النتيجة تقلّ.
  // بأرضية تضمن إن التطابق الثنائى السليم يظهر عند العتبة الافتراضية (0.7).
  const dice = (2 * matched) / (ta.length + tb.length);
  const floor = matched >= 3 ? 0.75 : 0.70;
  return { score: Math.max(dice, floor), matched, conflict: false };
}

/** نسبة تشابه اسمين (0 → 1) */
export function nameSimilarity(a: unknown, b: unknown): number {
  return nameMatch(a, b).score;
}

/** العتبة الافتراضية للتطابق (المستخدم طلب 70%) */
export const NAME_MATCH_THRESHOLD = 0.7;
