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
import { normCab, normBox, normCentral, expandBoxes, toAsciiDigits } from "@shared/cab-norm";

export interface OpenBoxTicketInput {
  central: string;        // اسم السنترال زى ما الفنى اختاره
  cabinet: string;        // رقم الكابينة (من دروب ليست — موحّد بين النظامين)
  box: string;            // رقم البكس (من دروب ليست)
  techName: string;       // اسم الفنى اللى سجّل «بوكس معطل»
  source: "OM" | "طلبات"; // مصدر التسجيل — بيتكتب فى «تم الفتح بواسطة»
  respondedAt: Date | string | null; // تاريخ رد الفنى = تاريخ إنشاء التكت
  refKey?: string;        // مرجع (رقم الطلب / مسلسل المتعذر) للتتبّع فى الملاحظات
  serialNumber?: string;  // مسلسل المتعذر (مصدر OM)
  customerName?: string;  // اسم العميل (مصدر الطلبات)
  nationalId?: string;    // الرقم القومى (مصدر الطلبات)
}

export type OpenBoxTicketResult =
  | { ok: true; created: true; ticketNumber: string; ticketId: string }
  | { ok: true; created: false; reason: "covered"; ticketNumber: string }
  | { ok: false; reason: string };

// التوحيد وفكّ النطاقات مصدرهم shared/cab-norm.ts — نفس الحساب بالظبط فى الواجهة
// (عمود «متعذرات» فى برنامج الكوابل) وفى السيرفر هنا.
export { normCab, normBox, expandBoxes } from "@shared/cab-norm";

/** بيدوّر على السنترال/الكابينة فى برنامج الكوابل بمطابقة متسامحة مع شكل الفاصل */
export async function resolveCable(
  central: string, cabinet: string,
): Promise<{ centralId: string; cableId: string; cableNumber: string } | null> {
  const wantCentral = normCentral(central), wantCab = normCab(cabinet);
  if (!wantCentral || !wantCab) return null;
  const { rows } = await pool.query(
    `SELECT c.id AS central_id, c.name AS central_name, cb.id AS cable_id, cb.number AS cable_number
       FROM centrals c JOIN cables cb ON cb.central_id = c.id`);
  const inCentral = rows.filter((r: any) => normCentral(r.central_name) === wantCentral);
  // بنرجّع رقم الكابينة **زى ما هو مكتوب فى برنامج الكوابل** عشان التكت تطلع
  // بنفس الصيغة المعتمدة هناك، مش بصيغة الطلب القديم.
  const pick = (r: any) =>
    ({ centralId: r.central_id, cableId: r.cable_id, cableNumber: String(r.cable_number) });

  // (1) المطابقة العادية بعد التوحيد: «2/2» = «2-2»
  const exact = inCentral.find((r: any) => normCab(r.cable_number) === wantCab);
  if (exact) return pick(exact);

  // المحاولات الاحتياطية كلها بتتقبل **بس** لو رجّعت كابينة واحدة مافيش غيرها؛
  // لو فيه أكتر من احتمال مابنخمّنش ونسيبها متعذّرة بسببها ظاهر فى التقرير.
  const only = (list: any[]) => (list.length === 1 ? pick(list[0]) : null);

  // (2) الحروف: «العامر» مقصود بيها «العامرى» — بنوحّد ى/ي وأ/إ/آ→ا وة→ه ونشيل
  //     المسافات، وبعدين نقبل التطابق أو البداية المشتركة (اسم ناقص آخره).
  const foldAr = (s: unknown) =>
    normCab(s).replace(/[ىي]/g, "ي").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, "");
  const wantAr = foldAr(cabinet);
  if (wantAr && /[^0-9-]/.test(wantAr)) {
    const hit = only(inCentral.filter((r: any) => foldAr(r.cable_number) === wantAr))
      ?? only(inCentral.filter((r: any) => {
        const got = foldAr(r.cable_number);
        // got فاضى كان بينجح فى wantAr.startsWith("") ويطابق أى كابينة اسمها فاضى
        if (!got) return false;
        return got.startsWith(wantAr) || wantAr.startsWith(got);
      }));
    if (hit) return hit;
  }

  // (3) الأرقام: بعض الطلبات القديمة الفاصل نفسه ناقص فيها — «11» مقصود بيها «1-1»
  const digits = (s: unknown) => normCab(s).replace(/[^0-9]/g, "");
  const wantDigits = digits(cabinet);
  if (wantDigits) {
    const hit = only(inCentral.filter((r: any) => digits(r.cable_number) === wantDigits));
    if (hit) return hit;
  }
  return null;
}

/** التكت المفتوحة اللى بتغطى البكس ده (بعد فكّ النطاقات) — أو null */
export async function findCoveringOpenTicket(
  central: string, cabinet: string, box: string,
): Promise<{ ticketId: string; ticketNumber: string; box: string } | null> {
  const wantBox = normBox(box);
  if (!wantBox) return null;
  const { rows } = await pool.query(
    `SELECT t.id AS "ticketId", t.ticket_number AS "ticketNumber", t.box, c.name AS central, cb.number AS cabinet
       FROM tickets t
       JOIN centrals c ON c.id = t.central_id
       JOIN cables   cb ON cb.id = t.cable_id
      WHERE t.status = 'open'`);
  // بنمرّ على نفس مطابقة الكابينة المتسامحة الأول («11» = «1-1»، «العامر» =
  // «العامرى») — من غير كده ممكن نفتح تكت مكرر على بكس مغطّى بالفعل.
  const resolved = await resolveCable(central, cabinet);
  const wantCentral = normCentral(central), wantCab = normCab(resolved?.cableNumber ?? cabinet);
  for (const r of rows) {
    if (normCentral(r.central) !== wantCentral) continue;
    if (normCab(r.cabinet) !== wantCab) continue;
    if (expandBoxes(r.box).includes(wantBox)) {
      return { ticketId: String(r.ticketId), ticketNumber: r.ticketNumber, box: String(r.box) };
    }
  }
  return null;
}

/**
 * نفس منطق التغطية أعلاه لكن بالدخول من **الكابينة (cable_id)** — بيستخدمه برنامج
 * الكوابل نفسه عشان يمنع فتح تكت لبكس لسه عليه تكت **مفتوحة**.
 *   • «مفتوحة» فقط هى اللى بتمنع — لو التكت فى انتظار التأكيد (pending_confirmation)
 *     أو مغلقة (closed) يبقى الفتح عادى.
 *   • البكس الجديد ممكن يكون نطاق («1:5») — بنمنع لو أى بكس جواه مغطّى.
 * بيرجّع بيانات التكت المانعة عشان الرسالة تقول للمستخدم هى فين بالظبط.
 */
export interface CoveringTicketInfo {
  ticketNumber: string;
  central: string;
  cabinet: string;
  box: string;
  faultType: string | null;
  createdAt: Date | null;
  matchedBox: string;   // البكس المشترك اللى سبب المنع
}

export async function findOpenTicketCoveringCableBox(
  cableId: string, boxStr: string,
): Promise<CoveringTicketInfo | null> {
  const wantBoxes = expandBoxes(boxStr);
  if (!cableId || !wantBoxes.length) return null;

  // الكابينة المطلوبة: بنجيب (اسم السنترال + رقم الكابينة) عشان المطابقة تبقى
  // بالبيانات مش بالـ id — لو نفس الكابينة متكررة كصفّين تفضل التغطية شغالة.
  const { rows: tgt } = await pool.query(
    `SELECT cb.number AS cabinet, c.name AS central
       FROM cables cb JOIN centrals c ON c.id = cb.central_id
      WHERE cb.id = $1 LIMIT 1`, [cableId]);
  if (!tgt.length) return null;
  const wantCentral = normCentral(tgt[0].central), wantCab = normCab(tgt[0].cabinet);

  const { rows } = await pool.query(
    `SELECT t.ticket_number AS "ticketNumber", t.box, t.created_at AS "createdAt",
            c.name AS central, cb.number AS cabinet, ft.name AS "faultType"
       FROM tickets t
       JOIN centrals c  ON c.id  = t.central_id
       JOIN cables   cb ON cb.id = t.cable_id
       LEFT JOIN fault_types ft ON ft.id = t.fault_type_id
      WHERE t.status = 'open'
      ORDER BY t.created_at DESC`);
  for (const r of rows) {
    if (normCentral(r.central) !== wantCentral) continue;
    if (normCab(r.cabinet) !== wantCab) continue;
    const have = expandBoxes(r.box);
    const hit = wantBoxes.find((b) => have.includes(b));
    if (hit) {
      return {
        ticketNumber: r.ticketNumber, central: String(r.central), cabinet: String(r.cabinet),
        box: String(r.box), faultType: r.faultType ?? null,
        createdAt: r.createdAt ?? null, matchedBox: hit,
      };
    }
  }
  return null;
}

/**
 * لما البكس يبقى مغطّى بتكت **مفتوحة** مابنفتحش تكت جديدة — بس بنسجّل المتعذر
 * فى ملاحظات التكت المفتوحة عشان مهندس الكوابل يعرف إن عليها متعذر أو أكتر:
 *   • من متعذرات OM  → مسلسل المتعذر.
 *   • من الطلبات     → اسم العميل والرقم القومى.
 * السطر بيتضاف مرة واحدة بس (بنتأكد إنه مش مكتوب قبل كده) عشان إعادة التشغيل
 * أو إعادة حفظ رد الفنى مايكرّروش نفس السطر.
 */
async function appendPendingCaseNote(ticketId: string, inp: OpenBoxTicketInput): Promise<void> {
  const tech = String(inp.techName ?? "").trim();
  const line = inp.source === "OM"
    ? `متعذر OM مسلسل ${String(inp.serialNumber ?? "").trim() || inp.refKey || "غير معروف"}`
      + (tech ? ` — الفنى: ${tech}` : "")
    : `طلب${inp.refKey ? ` ${inp.refKey.replace(/^طلب\s*/, "")}` : ""}`
      + ` — العميل: ${String(inp.customerName ?? "").trim() || "غير معروف"}`
      + ` — الرقم القومى: ${String(inp.nationalId ?? "").trim() || "غير مسجّل"}`
      + (tech ? ` — الفنى: ${tech}` : "");
  const header = "متعذرات على البكس:";
  const { rows } = await pool.query(`SELECT notes FROM tickets WHERE id = $1`, [ticketId]);
  if (!rows.length) return;
  const cur = String(rows[0].notes ?? "");
  if (cur.includes(line)) return;                       // متسجّل قبل كده
  const next = cur.includes(header)
    ? `${cur}\n• ${line}`
    : `${cur ? cur + "\n" : ""}${header}\n• ${line}`;
  await pool.query(`UPDATE tickets SET notes = $2, updated_at = now() WHERE id = $1`, [ticketId, next]);
}

/**
 * بيفتح التكت لو مش مغطّاة. بيرجّع نتيجة واضحة فى كل الحالات — مابيرميش استثناء
 * عشان فشل فتح التكت مايمنعش تسجيل رد الفنى نفسه.
 */
export async function openBoxFaultTicket(inp: OpenBoxTicketInput): Promise<OpenBoxTicketResult> {
  const central = String(inp.central ?? "").trim();
  const cabinet = String(inp.cabinet ?? "").trim();
  const box = normBox(inp.box);
  if (!central || !cabinet || !box) return { ok: false, reason: "بيانات ناقصة (سنترال/كابينة/بكس)" };

  // مغطّاة بتكت مفتوحة؟ (بعد فكّ النطاقات)
  const covering = await findCoveringOpenTicket(central, cabinet, box);
  if (covering) {
    // مابنفتحش تكت جديدة، لكن بنسجّل المتعذر ده فى ملاحظات التكت المفتوحة
    await appendPendingCaseNote(covering.ticketId, inp).catch(() => {});
    return { ok: true, created: false, reason: "covered", ticketNumber: covering.ticketNumber };
  }

  // السنترال والكابينة — موحّدين بين النظامين، والمطابقة متسامحة مع شكل الفاصل
  const cab = await resolveCable(central, cabinet);
  if (!cab) return { ok: false, reason: `الكابينة ${cabinet} فى ${central} مش موجودة فى برنامج الكوابل` };

  // نوع العطل — بنطابقه من الجدول نفسه (الاسم مكتوب «لا توجد حراره على الخالى»)
  const { rows: fRows } = await pool.query(
    `SELECT id, name FROM fault_types
      WHERE name ~ 'حرار' AND name ~ 'خال'
      ORDER BY length(name) LIMIT 1`);
  if (!fRows.length) return { ok: false, reason: "نوع العطل «لا توجد حراره على الخالى» مش موجود فى برنامج الكوابل" };

  // حساب الإنشاء: حساب الفنى فى الكوابل لو مربوط، وإلا أى حساب أدمن
  // UNION بدون ORDER BY مايضمنش إن حساب الفنى المربوط ييجى الأول — كان ممكن
  // created_by يتسجّل على أدمن عشوائى رغم وجود ربط. pr بيفرض الأولوية.
  const { rows: uRows } = await pool.query(
    `SELECT id FROM (
       SELECT id, 0 AS pr FROM cfm_users
        WHERE id = (SELECT cfm_user_id FROM users WHERE full_name = $1 OR username = $1 LIMIT 1)
       UNION ALL
       SELECT id, 1 AS pr FROM cfm_users WHERE role = 'admin'
     ) x ORDER BY pr LIMIT 1`, [inp.techName]);
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
         -- GREATEST: lpad بتقصّ اللى أطول من 3 خانات (1001 → '100') مش بس بتحشو
         SELECT 'TKT-' || $1 || '-' || lpad(
                  -- MAX رقمى مش نصى: MAX('999','1000') النصية = '999' فكان الترقيم
                  -- هيقفل عند 999 ويتصادم للأبد. والـ CASE بيتجاهل أى رقم تكت
                  -- مكتوب يدوى بصيغة غير رقمية بدل ما يكسّر الـ cast.
                  (COALESCE(MAX(CASE WHEN ticket_number ~ ('^TKT-' || $1 || '-[0-9]+$')
                     THEN split_part(ticket_number, '-', 3)::int END), 0) + 1)::text,
                  GREATEST(3, length((COALESCE(MAX(CASE WHEN ticket_number ~ ('^TKT-' || $1 || '-[0-9]+$')
                     THEN split_part(ticket_number, '-', 3)::int END), 0) + 1)::text)), '0'),
                $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11, now()
           FROM tickets WHERE ticket_number LIKE 'TKT-' || $1 || '-%'
         RETURNING id, ticket_number AS "ticketNumber"`,
        [String(year), central, cab.centralId, cab.cableId, cab.cableNumber, box,
         fRows[0].id, notes, uRows[0].id, label, createdAt]);
      // نربط التكت بالطلب/المتعذر — يمنع فتحها مرتين ويغذّى تقرير «تم إصلاحها»
      await pool.query(
        `INSERT INTO box_fault_tickets
           (source, ref_key, central_name, cabin_number, box_number, tech_name, responded_at, ticket_id, ticket_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (source, ref_key) DO UPDATE SET
           ticket_id = EXCLUDED.ticket_id, ticket_number = EXCLUDED.ticket_number`,
        [inp.source, inp.refKey || `${central}|${cabinet}|${box}`, central, cab.cableNumber, box,
         inp.techName, createdAt, rows[0].id, rows[0].ticketNumber]).catch(() => {});
      return { ok: true, created: true, ticketNumber: rows[0].ticketNumber, ticketId: rows[0].id };
    } catch (e: any) {
      // 23505 = تعارض على رقم التكت (حد تانى أنشأ فى نفس اللحظة) → نعيد المحاولة
      if (e?.code === "23505" && attempt < 4) continue;
      return { ok: false, reason: e?.message || "فشل إنشاء التكت" };
    }
  }
  return { ok: false, reason: "فشل إنشاء التكت بعد عدة محاولات" };
}

// ── لما المتعذر يتحلّ: التكت اللى اتفتحت بسببه تروح «انتظار التأكيد» ──────────
// الطلب/المتعذر لما بياخد «يمكن التنفيذ» معناه إن البكس بقى شغّال. ساعتها:
//   • لو التكت **اتفتحت تلقائياً** من متعذر (ليها صف فى box_fault_tickets) ومفيش
//     أى متعذر تانى لسه مفتوح على نفس البكس → بنحوّلها لـ «انتظار التأكيد».
//     مابنقفلهاش: مهندس الكوابل لسه يقدر يضيف مهمات وأعمال ويقفلها بالتسلسل العادى.
//   • لو التكت **اتفتحت يدوى** (مفيش صف ليها فى box_fault_tickets) → مابنلمسهاش
//     خالص، بتفضل بتسلسل الإغلاق المعتاد.
export async function settleBoxTicketIfCleared(inp: {
  central?: string | null; cabinet?: string | null; box?: string | null;
}): Promise<{ changed: boolean; ticketNumber?: string }> {
  const central = String(inp.central ?? "").trim();
  const cabinet = String(inp.cabinet ?? "").trim();
  const box = normBox(inp.box);
  if (!central || !cabinet || !box) return { changed: false };

  // لسه فيه متعذر مفتوح على نفس البكس؟ (نفس تعريف /api/cfm/box-cases بالظبط)
  const { rows: still } = await pool.query(
    `SELECT 1 FROM (
       SELECT central_name, cabin_number, box_number FROM orders
        WHERE rejection_reason = 'بوكس معطل' AND COALESCE(btrim(box_number),'') <> ''
          AND status NOT IN ('feasible','external_feasible')
       UNION ALL
       SELECT central_name, cabin_number, box_number FROM om_responses
        WHERE rejection_reason = 'بوكس معطل' AND COALESCE(btrim(box_number),'') <> ''
          AND COALESCE(status,'') NOT IN ('feasible','external_feasible')
          AND COALESCE(is_feasible,false) = false AND COALESCE(is_feasible_external,false) = false
          AND NOT EXISTS (SELECT 1 FROM om_order_matches mm
                           WHERE mm.om_serial = om_responses.serial_number)
     ) x
      WHERE btrim(x.central_name) = $1 AND btrim(x.cabin_number) = $2 AND btrim(x.box_number) = $3
      LIMIT 1`, [central, cabinet, box]);
  if (still.length) return { changed: false };   // لسه فيه متعذر تانى → نسيبها مفتوحة

  // التكت المفتوحة اللى بتغطّى البكس ده، **بشرط** إنها اتفتحت تلقائياً من متعذر
  const covering = await findCoveringOpenTicket(central, cabinet, box);
  if (!covering) return { changed: false };
  const { rows: auto } = await pool.query(
    `SELECT 1 FROM box_fault_tickets WHERE ticket_id = $1 LIMIT 1`, [covering.ticketId]);
  if (!auto.length) return { changed: false };   // مفتوحة يدوى → مابنلمسهاش

  const { rowCount } = await pool.query(
    `UPDATE tickets
        SET status = 'pending_confirmation', updated_at = now(),
            notes = COALESCE(notes, '') || ' — اتحوّلت لانتظار التأكيد تلقائياً: المتعذر اللى فتحها اتحلّ'
      WHERE id = $1 AND status = 'open'`, [covering.ticketId]);
  return { changed: (rowCount ?? 0) > 0, ticketNumber: covering.ticketNumber };
}
