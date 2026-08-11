// فتح بوابة AXON Expresse لتشغيل Profile Optimization (رفع السرعة) لمجموعة أرقام أكونت.
// سكربت التامبر منكى (dzs-profile-optimization.user.js) بيقرأ الأرقام من الـ hash (#sf_po=)،
// يسجّل الدخول لو لزم، ويشغّل «Start Realtime PO» لكل رقم بالتتابع.
// منفصل تماماً عن تدفّق القياس (sf_accounts) — السكربتان لا يتعارضان (حارس PO_ACTIVE).
const PO_BASE = "https://10.42.187.101:8080/expresse/profileOptimization";

interface POOptions {
  /** إيقاف الـ Nightly PO فقط (يرجّع Not Started) بدون Start Realtime PO. */
  stopOnly?: boolean;
  /** بعد رفع السرعة لكل الأرقام، نفّذ مرحلة الإيقاف لكلهم (رفع سرعة + إيقاف). */
  afterStop?: boolean;
}

/**
 * يفتح تاب رفع السرعة ومعاه قائمة أرقام الأكونت فى الـ hash للسكربت يقراها.
 * - stopOnly: إيقاف الـ nightly فقط.
 * - afterStop: رفع سرعة لكل الأرقام ثم إيقاف الـ nightly الناتج لكلهم.
 * - بدون الاتنين: رفع سرعة فقط.
 */
// ⚠️ بترجّع النافذة (مش void). السبب: جهاز التنفيذ محتاج مرجع النافذة عشان (1) يعرف
// إن السكربت خلّص لما التاب يتقفل، و(2) يقفل التاب بنفسه بعد ما الخط يخلص. من غير
// المرجع ده كان تاب AXON بيفضل مفتوح للأبد (السكربت بيقول «تقدر تقفل التاب» ومابيقفلش
// نفسه)، والمهمة تفضل «جارٍ التنفيذ» لحد ما المهلة الكاملة تعدّى — فالمستخدم مضطر
// يقفل الصفحة بإيده ويعمل إعادة تشغيل للباتش عشان يكمّل.
export function openProfileOptimization(
  accounts: (string | number | null | undefined)[],
  opts: POOptions = {},
): Window | null {
  const accs = [...new Set(accounts.map((a) => String(a ?? "").trim()).filter(Boolean))];
  if (accs.length === 0) {
    alert(opts.stopOnly ? "لا توجد أرقام أكونت لإيقاف الـ Nightly PO" : "لا توجد أرقام أكونت لرفع السرعة");
    return null;
  }
  const flags = opts.stopOnly ? "&sf_stop=1" : (opts.afterStop ? "&sf_after=1" : "");
  const url = `${PO_BASE}?lineId=${encodeURIComponent(accs[0])}#sf_po=${encodeURIComponent(accs.join(","))}${flags}`;
  // نفس اسم نافذة القياس (dzs_measure) — القياس/رفع السرعة/الإيقاف كلهم يعيدوا استخدام **نفس النافذة**
  // (النافذة الجديدة تحلّ محل القديمة) فمفيش نوافذ متعددة ولا تداخل.
  return window.open(url, "dzs_measure");
}
