// فتح صفحة Customer360 لجلب أرقام الأكونت لمجموعة خطوط بدون أكونت.
// سكربت التامبر منكى (customer360-account-grabber.user.js) بيقرأ الأرقام من الـ hash،
// يستنى تسجيل الدخول + حل البازل، يقرأ رقم الأكونت ويحفظه فى الموقع تلقائياً.
const C360_LOGIN_URL = "https://customer360.te.eg/Authentication/Login";

/** يفتح Customer360 ومعاه قائمة أرقام التليفون الكاملة فى الـ hash للسكربت يقراها. */
export function openCustomer360(fullPhones: string[]): void {
  const phones = [...new Set(fullPhones.map((p) => String(p ?? "").trim()).filter(Boolean))];
  if (phones.length === 0) {
    alert("لا توجد أرقام تليفون لجلب الأكونت لها");
    return;
  }
  const url = `${C360_LOGIN_URL}#sf_phones=${encodeURIComponent(phones.join(","))}`;
  // noreferrer/noopener: نفتح كأننا افتحنا الرابط مباشرة (من غير referrer لموقعنا) — بوابة te.eg
  // بتعلّق (تفضل تحمّل) لو الطلب جالها referrer خارجى من الموقع. الـ hash بيوصل عادى للسكربت.
  window.open(url, "_blank", "noopener,noreferrer");
}
