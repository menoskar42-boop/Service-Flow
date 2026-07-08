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
export function openProfileOptimization(
  accounts: (string | number | null | undefined)[],
  opts: POOptions = {},
): void {
  const accs = [...new Set(accounts.map((a) => String(a ?? "").trim()).filter(Boolean))];
  if (accs.length === 0) {
    alert(opts.stopOnly ? "لا توجد أرقام أكونت لإيقاف الـ Nightly PO" : "لا توجد أرقام أكونت لرفع السرعة");
    return;
  }
  const flags = opts.stopOnly ? "&sf_stop=1" : (opts.afterStop ? "&sf_after=1" : "");
  const url = `${PO_BASE}?lineId=${encodeURIComponent(accs[0])}#sf_po=${encodeURIComponent(accs.join(","))}${flags}`;
  window.open(url, "_blank");
}
