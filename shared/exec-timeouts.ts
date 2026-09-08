// ── مهل طابور التنفيذ — المصدر الوحيد ────────────────────────────────────────
// الملف ده اتعمل بعد باج حقيقى: مهمة «إيقاف PO» مهلتها الفعلية على جهاز التنفيذ
// **٣٠ ثانية**، لكن السيرفر كان مستنيها ٢٠ دقيقة قبل ما يرجّعها للطابور (الافتراضى
// العام). النتيجة: الباتش يقف و«جارٍ التنفيذ من ١٣ دقيقة» ومفيش أى إنقاذ تلقائى.
// المهل كانت مكتوبة بالنص فى ٣ أماكن (جهاز التنفيذ، الإنقاذ فى السيرفر، شارة
// «عالق» فى شاشة الطابور)، فأى تعديل كان لازم يتعمل ٣ مرات وإلا يفضلوا متناقضين.

/** المهلة الفعلية لتنفيذ النوع على جهاز التنفيذ (بالدقايق). */
export const EXEC_RUN_MINUTES: Record<string, number> = {
  measure: 3,       // ٣ دقايق للخط الواحد
  raise: 8,         // بحد أقصى ٨ دقايق (بيعدّى أول ما يتأكد)
  stop: 0.5,        // ٣٠ ثانية
  subinfo: 3,       // دخول FCC + بحث + قراءة
  c360: 20,         // بيلفّ على كل الأرقام جوّه نفس التاب
  portchange: 15,   // المستخدم بيراجع ويضغط Submit بنفسه
  portcheck: 5,
  ports: 30,        // رفعة ملف البورتات كامل
  wfmcancel: 6,
  wfmreport: 20,
  fccdaily: 20,
  wfmdaily: 20,
  ossdaily: 20,
  weoas: 30,
};

/**
 * المهلة اللى بعدها السيرفر يعتبر المهمة عالقة ويرجّعها للطابور (بالدقايق).
 * لازم تفضل **أكبر من** EXEC_RUN_MINUTES لنفس النوع — وإلا هنقطع مهمة لسه شغّالة
 * ونفتح تاب جديد فوق القديم (ده اللى كان بيخنق المتصفح). فيه اختبار بيثبّت الشرط ده.
 */
export const EXEC_RESCUE_MINUTES: Record<string, number> = {
  measure: 4,       // مضبوطة يدوياً: الإنقاذ جوّه تاب جهاز التنفيذ بيبدأ بعد ٣ دقايق،
                    // ودى حدّ خادمى احتياطى لو التاب متجمّد ومابعتش أى إشارة.
  stop: 5,
  subinfo: 8,
  portcheck: 12,
  wfmcancel: 15,
  raise: 20,
  portchange: 35,
  c360: 45,
  wfmreport: 45,
  ports: 60,
  fccdaily: 60,
  wfmdaily: 60,
  ossdaily: 60,
  weoas: 60,
};

/** النوع اللى مش فى الجدول (نوع جديد اتضاف ونُسى) بياخد المهلة العامة. */
export const DEFAULT_RESCUE_MINUTES = 20;

export const rescueMinutes = (type: string): number =>
  EXEC_RESCUE_MINUTES[type] ?? DEFAULT_RESCUE_MINUTES;

/**
 * تعبير SQL بيرجّع مهلة الإنقاذ لكل نوع (يُستخدم فى expireOrphanedExecJobs).
 * أسماء الأنواع ثوابت من عندنا — ومع كده بنفلترها بتعبير نمطى قبل ما تتحط فى الاستعلام.
 */
export const rescueIntervalSql = (typeExpr: string): string => {
  const cases = Object.entries(EXEC_RESCUE_MINUTES)
    .filter(([t]) => /^[a-z0-9_]+$/i.test(t))
    .map(([t, m]) => `WHEN ${typeExpr} = '${t}' THEN interval '${m} minutes'`)
    .join("\n        ");
  return `(CASE\n        ${cases}\n        ELSE interval '${DEFAULT_RESCUE_MINUTES} minutes' END)`;
};
