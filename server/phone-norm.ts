// تطبيع رقم التليفون للمطابقة بين الجداول — كتعبير SQL **مضمَّن** (مش دالة مخصصة).
//
// ليه مضمَّن ومش دالة؟ Replit وقت النشر بيقارن dev DB بـ prod DB ويولّد DDL يطبّقه على
// prod **قبل** ما السيرفر يشتغل. فلو الفهرس بيعتمد على دالة بنعملها احنا فى ensureSchema،
// الـ migration بيفشل بـ «function sf_phone_norm(text) does not exist» لأن الدالة لسه
// ماتعملتش. التعبير المضمَّن كله دوال Postgres مدمجة (regexp_replace/length/substring)
// فبيشتغل على أى قاعدة من غير أى تجهيز.
//
// القاعدة: أرقام فقط ← شيل الأصفار البادئة ← شيل بادئة 88 لو الطول > 7
// (الشرط الأخير بيحمى رقم محلى من 7 خانات بيبدأ بـ 88 من إنه يتقصّ بالغلط).
//
// ⚠️ لازم تعبير الفهرس (server/db.ts) وتعبير الاستعلام (server/routes.ts) يبقوا **نفس النص
// بالحرف**، وإلا الـ planner مش هيستخدم الفهرس وترجع مشكلة البطء. عشان كده الاتنين
// بينادوا الدالة دى.
export function phoneNormSql(expr: string): string {
  const d = `regexp_replace(regexp_replace(COALESCE(${expr}::text, ''), '[^0-9]', '', 'g'), '^0+', '')`;
  return `(CASE WHEN ${d} LIKE '88%' AND length(${d}) > 7 THEN substring(${d} FROM 3) ELSE ${d} END)`;
}
