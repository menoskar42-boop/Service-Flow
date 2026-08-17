// ============================================================================
// shared/name-match.ts — نسبة تشابه الأسماء العربية (بدون أى إضافة على قاعدة البيانات).
//
// الأسماء بتتكتب بصيغ مختلفة بين قسم الطلبات ومتعذرات OM: همزات (أ/ا/إ)، تاء
// مربوطة (ة/ه)، ياء (ى/ي)، تشكيل، مسافات زيادة، و«عبد الله» مقابل «عبدالله».
// arNorm بيحلّ الحروف، والباقى بيتحلّ هنا:
//
//   • بنقسّم الاسم لكلمات وبنشيل الكلمات اللى مالهاش قيمة تمييزية («عبد» لوحدها،
//     «محمد» متكرّرة جداً بس بنسيبها لأنها بتفرّق فعلاً فى الأسماء القصيرة).
//   • بنلزّق «عبد» بالكلمة اللى بعدها (عبد الله → عبدالله) عشان الصيغتين يتطابقوا.
//   • التشابه = مقياس Dice على **مجموعة الكلمات** مش على النص كامل — عشان اختلاف
//     ترتيب الكلمات أو زيادة/نقصان اسم فى النص مايكسرش المطابقة، وده الشائع فى
//     الأسماء الرباعية («أحمد محمد على حسن» مقابل «أحمد محمد على»).
//   • للكلمات اللى مش متطابقة بالظبط بنسمح بتشابه حرفى عالى (Dice على الحروف
//     الثنائية) عشان الأخطاء الإملائية البسيطة («ابراهيم» / «إبراهيم»).
//
// النتيجة رقم من 0 لـ 1. العتبة الافتراضية 0.7 (اللى المستخدم طلبها).
// ============================================================================

import { arNorm } from "./ar-norm";

/** كلمات بتتشال لأنها مش مميِّزة (ألقاب/وصلات) */
const STOP_WORDS = new Set(["بن", "بنت", "ال", "الحاج", "الحاجه", "الشيخ", "دكتور", "د", "م", "مهندس"]);

/** يرجّع كلمات الاسم بعد التطبيع ولزق «عبد» بما بعدها */
export function nameTokens(s: unknown): string[] {
  const norm = arNorm(s).replace(/[^\p{L}\p{N}\s]/gu, " ");
  const raw = norm.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    // «عبد» + الاسم اللى بعدها = كلمة واحدة (عبد الله / عبدالله)
    if ((w === "عبد" || w === "عبدال") && i + 1 < raw.length) {
      out.push((w + raw[i + 1]).replace(/^عبدال/, "عبدال"));
      i++;
      continue;
    }
    if (STOP_WORDS.has(w)) continue;
    if (w.length < 2) continue;
    out.push(w);
  }
  return out;
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

/**
 * نسبة تشابه اسمين (0 → 1).
 * Dice على مجموعة الكلمات: 2×(الكلمات المشتركة) ÷ (مجموع عدد الكلمات).
 */
export function nameSimilarity(a: unknown, b: unknown): number {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;

  // كل كلمة فى الأول بتتطابق مع **كلمة واحدة بحد أقصى** فى التانى (مطابقة جشعة)
  const used = new Array(tb.length).fill(false);
  let matched = 0;
  for (const wa of ta) {
    let bestIdx = -1, bestScore = 0;
    for (let j = 0; j < tb.length; j++) {
      if (used[j]) continue;
      const sc = wa === tb[j] ? 1 : bigramDice(wa, tb[j]);
      if (sc > bestScore) { bestScore = sc; bestIdx = j; }
    }
    if (bestIdx >= 0 && bestScore >= WORD_MATCH_MIN) { used[bestIdx] = true; matched++; }
  }
  return (2 * matched) / (ta.length + tb.length);
}

/** العتبة الافتراضية للتطابق (المستخدم طلب 70%) */
export const NAME_MATCH_THRESHOLD = 0.7;
