// ============================================================================
// server/box-fault-ticket.ts
// فتح تكت «بوكس معطل» تلقائياً على برنامج الكوابل لما الفنى يسجّل السبب ده —
// سواء من قسم الطلبات أو من متعذرات OM.
//
// القواعد (باتفاق المستخدم):
//  • نوع العطل ثابت: «لا توجد حراره على الخالى» — بنطابقه من قاعدة البيانات نفسها
//    (الاسم مكتوب بأكتر من صيغة، فمابنكتبوش من دماغنا).
//  • تاريخ إنشاء التكت = تاريخ رد الفنى، مش وقت التشغيل.
//  • «تم الفتح بواسطة» = «اسم الفنى-المصدر» (اسلام-OM / اسلام-طلبات).
//  • مابنفتحش تكت لو البكس مغطّى بتكت **مفتوحة** بالفعل — والتغطية بتتحسب بعد
//    **فكّ النطاقات**: تكت على «1:5» بتغطى بكس 4 ضمنياً. نفس منطق تقرير أعطال
//    الشبكة الأرضية (parseTicketBoxes).
// ============================================================================
import { pool } from "./db";

export interface OpenBoxTicketInput {
  central: string;        // اسم السنترال زى ما الفنى اختاره
  cabinet: string;        // رقم الكابينة (من دروب ليست — موحّد بين النظامين)
  box: string;            // رقم البكس (من دروب ليست)
  techName: string;       // اسم الفنى اللى سجّل «بوكس معطل»
  source: "OM" | "طلبات"; // مصدر التسجيل — بيتكتب فى «تم الفتح بواسطة»
  respondedAt: Date | string | null; // تاريخ رد الفنى = تاريخ إنشاء التكت
  refKey?: string;        // مرجع (رقم الطلب / مسلسل المتعذر) للتتبّع فى الملاحظات
}

export type OpenBoxTicketResult =
  | { ok: true; created: true; ticketNumber: string; ticketId: string }
  | { ok: true; created: false; reason: "covered"; ticketNumber: string }
  | { ok: false; reason: string };

// توحيد اسم السنترال للمطابقة بين النظامين (نفس منطق routes.ts)
const normCentral = (s: unknown) =>
  String(s ?? "").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();

// فكّ بكسيات التكت: «1:5» → 1..5 | «1&15» → 1,15 | «4» → 4
export function expandBoxes(boxStr: unknown): string[] {
  const s = String(boxStr ?? "").trim();
  if (!s) return [];
  if (s.includes(":")) {
    const [a, b] = s.split(":").map((x) => parseInt(x.replace(/[^0-9]/g, ""), 10));
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const out: string[] = [];
      for (let i = lo; i <= hi && i - lo < 1000; i++) out.push(String(i));
      return out;
    }
  }
  if (/[&،,]/.test(s)) return s.split(/[&،,]/).map((x) => x.replace(/[^0-9]/g, "")).filter(Boolean);
  const single = s.replace(/[^0-9]/g, "");
  return single ? [single] : [];
}

/** التكت المفتوحة اللى بتغطى البكس ده (بعد فكّ النطاقات) — أو null */
export async function findCoveringOpenTicket(
  central: string, cabinet: string, box: string,
): Promise<{ ticketNumber: string; box: string } | null> {
  const wantBox = String(box ?? "").replace(/[^0-9]/g, "");
  if (!wantBox) return null;
  const { rows } = await pool.query(
    `SELECT t.ticket_number AS "ticketNumber", t.box, c.name AS central, cb.number AS cabinet
       FROM tickets t
       JOIN centrals c ON c.id = t.central_id
       JOIN cables   cb ON cb.id = t.cable_id
      WHERE t.status = 'open'`);
  const wantCentral = normCentral(central), wantCab = String(cabinet ?? "").trim();
  for (const r of rows) {
    if (normCentral(r.central) !== wantCentral) continue;
    if (String(r.cabinet ?? "").trim() !== wantCab) continue;
    if (expandBoxes(r.box).includes(wantBox)) return { ticketNumber: r.ticketNumber, box: String(r.box) };
  }
  return null;
}

/**
 * بيفتح التكت لو مش مغطّاة. بيرجّع نتيجة واضحة فى كل الحالات — مابيرميش استثناء
 * عشان فشل فتح التكت مايمنعش تسجيل رد الفنى نفسه.
 */
export async function openBoxFaultTicket(inp: OpenBoxTicketInput): Promise<OpenBoxTicketResult> {
  const central = String(inp.central ?? "").trim();
  const cabinet = String(inp.cabinet ?? "").trim();
  const box = String(inp.box ?? "").replace(/[^0-9]/g, "");
  if (!central || !cabinet || !box) return { ok: false, reason: "بيانات ناقصة (سنترال/كابينة/بكس)" };

  // مغطّاة بتكت مفتوحة؟ (بعد فكّ النطاقات)
  const covering = await findCoveringOpenTicket(central, cabinet, box);
  if (covering) return { ok: true, created: false, reason: "covered", ticketNumber: covering.ticketNumber };

  // السنترال والكابينة — موحّدين بين النظامين، فالمطابقة بالاسم/الرقم
  const { rows: cRows } = await pool.query(
    `SELECT c.id AS central_id, cb.id AS cable_id
       FROM centrals c JOIN cables cb ON cb.central_id = c.id
      WHERE regexp_replace(btrim(c.name), '\\s*-\\s*', '-', 'g') = regexp_replace(btrim($1), '\\s*-\\s*', '-', 'g')
        AND btrim(cb.number) = btrim($2)
      LIMIT 1`, [central, cabinet]);
  if (!cRows.length) return { ok: false, reason: `الكابينة ${cabinet} فى ${central} مش موجودة فى برنامج الكوابل` };

  // نوع العطل — بنطابقه من الجدول نفسه (الاسم مكتوب «لا توجد حراره على الخالى»)
  const { rows: fRows } = await pool.query(
    `SELECT id, name FROM fault_types
      WHERE name ~ 'حرار' AND name ~ 'خال'
      ORDER BY length(name) LIMIT 1`);
  if (!fRows.length) return { ok: false, reason: "نوع العطل «لا توجد حراره على الخالى» مش موجود فى برنامج الكوابل" };

  // حساب الإنشاء: حساب الفنى فى الكوابل لو مربوط، وإلا أى حساب أدمن
  const { rows: uRows } = await pool.query(
    `SELECT id FROM cfm_users
      WHERE id = (SELECT cfm_user_id FROM users WHERE full_name = $1 OR username = $1 LIMIT 1)
      UNION ALL SELECT id FROM cfm_users WHERE role = 'admin'
      LIMIT 1`, [inp.techName]);
  if (!uRows.length) return { ok: false, reason: "مفيش حساب فى برنامج الكوابل نفتح بيه التكت" };

  const at = inp.respondedAt ? new Date(inp.respondedAt) : new Date();
  const createdAt = isNaN(at.getTime()) ? new Date() : at;
  const year = createdAt.getFullYear();

  // رقم التكت: نفس صيغة البرنامج TKT-YYYY-NNN. بنحسبه ونضيف فى نفس الاستعلام مع
  // إعادة محاولة لو حصل تسابق على نفس الرقم (unique).
  const label = `${String(inp.techName ?? "").trim() || "غير معروف"}-${inp.source}`;
  const notes = [
    `اتفتحت تلقائياً من Service-Flow (${inp.source === "OM" ? "متعذرات OM" : "الطلبات"})`,
    inp.refKey ? `المرجع: ${inp.refKey}` : "",
    `الفنى: ${inp.techName}`,
  ].filter(Boolean).join(" — ");

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO tickets
           (ticket_number, central_department, central_id, cable_id, cabinet, box,
            fault_type_id, notes, status, created_by, opened_by_label, created_at, updated_at)
         SELECT 'TKT-' || $1 || '-' || lpad(
                  (COALESCE(MAX(NULLIF(regexp_replace(ticket_number, '^TKT-' || $1 || '-', ''), '')::int), 0) + 1)::text, 3, '0'),
                $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11, now()
           FROM tickets WHERE ticket_number LIKE 'TKT-' || $1 || '-%'
         RETURNING id, ticket_number AS "ticketNumber"`,
        [String(year), central, cRows[0].central_id, cRows[0].cable_id, cabinet, box,
         fRows[0].id, notes, uRows[0].id, label, createdAt]);
      return { ok: true, created: true, ticketNumber: rows[0].ticketNumber, ticketId: rows[0].id };
    } catch (e: any) {
      // 23505 = تعارض على رقم التكت (حد تانى أنشأ فى نفس اللحظة) → نعيد المحاولة
      if (e?.code === "23505" && attempt < 4) continue;
      return { ok: false, reason: e?.message || "فشل إنشاء التكت" };
    }
  }
  return { ok: false, reason: "فشل إنشاء التكت بعد عدة محاولات" };
}
