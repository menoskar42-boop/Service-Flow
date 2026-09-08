// ── الفنيين الخمسة المسجّلين + كل صيغ أسمائهم ────────────────────────────────
// الملف ده اتعمل بعد باج حقيقى: أمر شغل مكتوب فيه «حسن عبدالفتاح حموده» كان بيتحسب
// اسم **غير معروف** لأن المقارنة كانت حرفية مع «حسن»، فالتقرير كان بيسمح بتغيير اسم
// فنى مسجّل. وكمان «سامى» اسمه فى الملفات «محمد عبدالعزيز طه احمد» — مافيش أى مقارنة
// نصية ممكن توصل بينهم، فلازم قائمة أسماء صريحة.
//
// القاعدة: الاسم اللى بيطابق أى فنى هنا **مايتغيّرش** من أى حد. أى اسم تانى (عامل
// مقاول، اسم مكتوب غلط، فاضى…) هو اللى بيبقى قابل للتعديل — من المستخدمين، أو
// تلقائياً لما فنى يسجّل كمية السلك فيتسجّل اسمه هو.

export interface Technician {
  /** الاسم المعتمد اللى بيتخزّن ويتعرض. */
  name: string;
  /** باقى الصيغ اللى الاسم بييجى بيها فى الملفات (الاسم الرباعى، لقب…). */
  aliases: string[];
}

export const TECHNICIANS: Technician[] = [
  { name: "حسن",         aliases: ["حسن عبد الفتاح حموده"] },
  { name: "محمد",        aliases: ["محمد عبدالمجيد محمد رشدى"] },
  { name: "سامى",        aliases: ["محمد عبدالعزيز طه احمد"] },
  { name: "اسلام",       aliases: ["اسلام عبدالعال هريدى حسن"] },
  { name: "محمود يعقوب", aliases: ["محمود احمد يعقوب"] },
];

/** كل صيغ الاسم للفنى الواحد (المعتمد + الألقاب). */
export const variantsOf = (t: Technician): string[] => [t.name, ...t.aliases];

/**
 * تطبيع للمقارنة: تطبيع عربى (أ/ا، ة/ه، ى/ي، حروف صغيرة) + **شيل كل المسافات**.
 * شيل المسافات هو اللى بيخلّى «عبد الفتاح» تساوى «عبدالفتاح» — وده أكتر اختلاف
 * بيحصل بين الملفات.
 * ⚠️ لازم يفضل مطابق لـ techNormSql() فى السيرفر.
 */
export const techNorm = (raw: unknown): string =>
  String(raw ?? "")
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىي]/g, "ي")
    .replace(/[ؤئ]/g, "ء")
    .replace(/[ً-ْـ]/g, "")   // تشكيل وتطويل
    .replace(/\s+/g, "")
    .trim();

/**
 * الاسم ده لأى فنى من الخمسة؟ بيرجّع الاسم المعتمد أو null.
 * المقارنة ببادئة من الاتجاهين: «اسلام عبدالعال هريدى» (من الشيت) تطابق
 * «اسلام عبدالعال هريدى حسن» (الاسم الرباعى)، و«حسن» تطابق «حسن عبد الفتاح حموده».
 * ملاحظة: اسم زى «محمد» لوحده بيطابق أول فنى فى الترتيب (محمد) — الترتيب ثابت
 * فالنتيجة ثابتة، والاسم فى الحالتين «معروف» يعنى مش قابل للتعديل وده المطلوب.
 */
export const matchTechnician = (raw: unknown): string | null => {
  const v = techNorm(raw);
  if (v.length < 3) return null;              // «م» أو «حس» مايكفوش للمطابقة
  // كل الصيغ مرتّبة من الأطول للأقصر — الأطول (الأكثر تحديداً) بتتجرّب الأول.
  const all = TECHNICIANS.flatMap((t) => variantsOf(t).map((variant) => ({ n: techNorm(variant), name: t.name })))
    .filter((x) => x.n.length >= 3)
    .sort((a, b) => b.n.length - a.n.length);

  // (1) تطابق تام — أوضح دليل. «محمد عبدالعزيز طه احمد» = سامى، و«محمد» لوحده = محمد.
  const exact = all.find((x) => x.n === v);
  if (exact) return exact.name;
  // (2) المكتوب **بداية** اسم كامل معروف: «اسلام عبدالعال هريدى» ← «اسلام عبدالعال هريدى حسن».
  //     الأطول الأول عشان «محمد عبدالعزيز طه» تروح لسامى مش لمحمد.
  const isPrefixOfKnown = all.find((x) => x.n.startsWith(v));
  if (isPrefixOfKnown) return isPrefixOfKnown.name;
  // (3) المكتوب **أطول** من اسم معروف: «حسن عبد الفتاح حموده احمد» ← «حسن».
  const startsWithKnown = all.find((x) => v.startsWith(x.n));
  if (startsWithKnown) return startsWithKnown.name;
  return null;
};

export const isKnownTechnician = (raw: unknown): boolean => matchTechnician(raw) !== null;

/** أسماء الاختيار فى الدروب ليست (الأسماء المعتمدة بس). */
export const TECHNICIAN_NAMES: string[] = TECHNICIANS.map((t) => t.name);

// ── مولّدات SQL ──────────────────────────────────────────────────────────────
// نفس التطبيع بالظبط جوّه الداتابيز: sf_ar_norm بتعمل التطبيع العربى، وبنشيل
// المسافات بعدها. لازم يفضل مطابق لـ techNorm() فوق.
export const techNormSql = (expr: string): string =>
  `replace(sf_ar_norm(COALESCE(${expr}::text, '')), ' ', '')`;

const sqlLit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * تعبير SQL بيرجّع الاسم المعتمد للفنى (أو NULL لو الاسم مش لأى واحد فيهم) —
 * نفس منطق matchTechnician بالظبط.
 */
export const canonicalTechSql = (expr: string): string => {
  const e = techNormSql(expr);
  // نفس ترتيب matchTechnician بالظبط: تطابق تام (الأطول أولاً) ← المكتوب بداية اسم
  // معروف ← المكتوب أطول من اسم معروف. الترتيب هو اللى بيخلّى «محمد عبدالعزيز طه احمد»
  // تروح لسامى مش لمحمد (الاتنين بيبدأوا بـ«محمد»).
  const all = TECHNICIANS
    .flatMap((t) => variantsOf(t).map((variant) => ({ n: techNorm(variant), name: t.name })))
    .filter((x) => x.n.length >= 3)
    .sort((a, b) => b.n.length - a.n.length);
  const branch = (cond: (n: string) => string) =>
    all.map((x) => `WHEN ${cond(sqlLit(x.n))} THEN ${sqlLit(x.name)}`).join("\n        ");
  return `(CASE WHEN length(${e}) < 3 THEN NULL ELSE (CASE
        ${branch((n) => `${e} = ${n}`)}
        ${branch((n) => `${n} LIKE ${e} || '%'`)}
        ${branch((n) => `${e} LIKE ${n} || '%'`)}
        ELSE NULL END) END)`;
};
