// ============================================================================
// server/box-full-inspection.ts
// «بوكس مليان» → طلب مراجعة بيانات البكس على موقع الصيانة.
//
// لما الفنى يرد «بوكس مليان» — من متعذرات OM أو من قسم الطلبات — بنبعت البكس
// لموقع الصيانة عشان:
//   • لو فيه فحص **غير مكتمل** للبكس → يتضاف عليه بند «مراجعة بيانات البكس».
//   • لو مافيش → يتفتح فحص جديد كل بنوده بملاحظات، وفنى الصيانة بيخلّصه بالطريقة
//     المعتادة.
//   • وبنبعت معاه أرقام التليفونات اللى على البكس من بيان التليفونات (لو موجودة)،
//     وفنى الصيانة بيعدّلها/يحذف منها ويضيف عليها.
//   • «تم الفتح بواسطة» = «اسم الفنى-OM» أو «اسم الفنى-طلبات» حسب جهة الفتح —
//     نفس اصطلاح تكت «بوكس معطل» (box-fault-ticket.ts).
//
// الفشل هنا **مايمنعش** تسجيل رد الفنى أبداً — بنرجّع النتيجة وبس.
// ============================================================================
import { pool } from "./db";

const MAINT_BASE = process.env.MAINTENANCE_API_BASE
  || `http://127.0.0.1:${process.env.PORT || 5000}/maintenance`;
// نفس التوكن الافتراضى الموجود فى routes/integration.js بتاع موقع الصيانة
const INTEGRATION_TOKEN = process.env.INTEGRATION_TOKEN || "sf-integration-2026-GHNAT-overlap-Qz7m";

export interface BoxFullInput {
  central: string;
  cabinet: string;
  box: string;
  techName: string;
  source: "OM" | "طلبات";
  /** مرجع للتتبّع: «طلب #123» أو «متعذر 456» */
  refKey?: string;
}

export type BoxFullResult =
  | { ok: true; inspectionId: number; created: boolean; phonesSent: number }
  | { ok: false; reason: string };

/**
 * أرقام التليفونات اللى على البكس من **بيان التليفونات** — نفس المصدر اللى كل
 * التقارير بتقرا منه (وبيشمل تصحيحات البيان لأنها بتتكتب فيه).
 * بنرجّع الرقم الكامل مع الترمنال كملاحظة عشان تساعد فنى الصيانة.
 */
export async function boxPhones(central: string, cabinet: string, box: string):
  Promise<{ phone: string; notes: string }[]> {
  const { rows } = await pool.query(
    `SELECT COALESCE(pl.full_phone, '88' || pl.tel_no) AS phone,
            COALESCE(NULLIF(btrim(pl.dp_terminal), ''), '') AS terminal
       FROM phone_lines pl
      WHERE btrim(pl.central) = btrim($1)
        AND btrim(pl.cabin_number) = btrim($2)
        AND btrim(pl.box_number) = btrim($3)
      ORDER BY NULLIF(regexp_replace(COALESCE(pl.dp_terminal, ''), '\\D', '', 'g'), '')::int
               NULLS LAST, pl.tel_no
      LIMIT 500`,
    [central, cabinet, box]);
  return rows.map((r: any) => ({
    phone: String(r.phone || "").trim(),
    notes: r.terminal ? `ترمنال ${r.terminal}` : "",
  })).filter((r) => r.phone);
}

/** بيبعت طلب مراجعة بيانات البكس لموقع الصيانة (ومعاه أرقام البكس). */
export async function requestBoxDataReview(input: BoxFullInput): Promise<BoxFullResult> {
  const central = String(input.central || "").trim();
  const cabinet = String(input.cabinet || "").trim();
  const box     = String(input.box || "").trim();
  if (!central || !cabinet || !box) return { ok: false, reason: "بيانات البكس ناقصة" };

  let phones: { phone: string; notes: string }[] = [];
  try { phones = await boxPhones(central, cabinet, box); } catch { /* الأرقام إضافية */ }

  const openedBy = `${String(input.techName || "").trim() || "غير معروف"}-${input.source}`;
  try {
    const res = await fetch(`${MAINT_BASE}/api/integration/box-data-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Integration-Token": INTEGRATION_TOKEN },
      body: JSON.stringify({
        central, cabinet, box, openedBy, origin: input.source,
        originRef: input.refKey || null, phones,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const why = await res.text().catch(() => "");
      return { ok: false, reason: `موقع الصيانة رجّع ${res.status}: ${why.slice(0, 160)}` };
    }
    const j: any = await res.json();
    return { ok: true, inspectionId: j?.inspectionId, created: !!j?.created, phonesSent: phones.length };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "تعذّر الاتصال بموقع الصيانة" };
  }
}
