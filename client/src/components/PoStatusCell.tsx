/**
 * «حالة تحسين البروفايل» (Profile Optimization Status) — الكلام اللى أداة القياس
 * بتقراه من شاشة ClearView وبيتحفظ فى case_138.po_status.
 *
 * النص بتاع AXON طويل (سطرين) ولو اتحطّ زى ما هو فى جدول التقارير هيكسّر العرض،
 * فبنعرض شارة قصيرة (شغّال / اكتمل + التاريخ / مافيش) والنص الكامل فى الـ tooltip.
 * التصدير (إكسل/PDF) بياخد النص الكامل — مش الشارة.
 */

/** التاريخ اللى بعد «PO was completed on» لو موجود. */
export function poCompletedAt(v?: string | null): string {
  const m = String(v || "").match(/completed\s+on\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/i);
  if (!m) return "";
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}

/** شارة مختصرة للعرض فى الجداول وفى الـ PDF. */
export function poStatusShort(v?: string | null): string {
  const t = String(v || "").trim();
  if (!t) return "";
  // «PO is not currently running» لازم تتفحص **قبل** «PO is running» — الأولى بتحتوى التانية
  if (/\bPO\s+is\s+not\s+currently\s+running/i.test(t) || /\bPO\s+is\s+not\s+running/i.test(t)) {
    const at = poCompletedAt(t);
    return at ? `اكتمل ${at}` : "مش شغّال";
  }
  if (/\bPO\s+is\s+running/i.test(t)) return "شغّال دلوقتى";
  if (/\bnever\s+(been\s+)?(run|optimized)/i.test(t)) return "ماتعملش";
  return t.slice(0, 40);
}

/** ألوان الشارة حسب الحالة. */
function toneOf(v: string): string {
  if (/شغّال دلوقتى/.test(v)) return "bg-blue-100 text-blue-800";
  if (/^اكتمل/.test(v)) return "bg-emerald-100 text-emerald-800";
  if (/مش شغّال|ماتعملش/.test(v)) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

export default function PoStatusCell({ value }: { value?: string | null }) {
  const short = poStatusShort(value);
  if (!short) return <span className="text-muted-foreground">-</span>;
  return (
    <span
      title={String(value || "")}
      className={`text-xs px-2 py-0.5 rounded font-semibold whitespace-nowrap cursor-help ${toneOf(short)}`}
    >
      {short}
    </span>
  );
}
