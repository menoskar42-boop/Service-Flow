// ── «استبعاد اللى فى الطابور» — قائمة اختيار بنوع المهمة ─────────────────────
// كان زرار تشغيل/إطفاء واحد بيستبعد **أى** نوع (قياس أو رفع سرعة أو إيقاف PO)
// مع بعض. وده كان بيمنع شغل صح: رقم مستنى قياس فى الطابور كان بيختفى من تقرير
// «تحتاج إيقاف PO» رغم إن الإيقاف مالوش دعوة بالقياس.
// بقت قائمة: تختار تستبعد اللى فى الطابور بأنهى **سبب** بالظبط.
//
// القيمة بتتبعت للسيرفر فى ?excludeQueued=<type>. القيمة القديمة "1" (كل الأنواع)
// لسه مدعومة على السيرفر عشان أى رابط قديم يفضل يشتغل.
export type QueueExcludeValue = "" | "measure" | "stop" | "raise";

const OPTIONS: { value: QueueExcludeValue; label: string }[] = [
  { value: "",        label: "بدون استبعاد من الطابور" },
  { value: "measure", label: "استبعاد من الطابور: قياس" },
  { value: "stop",    label: "استبعاد من الطابور: إيقاف PO" },
  { value: "raise",   label: "استبعاد من الطابور: رفع سرعة" },
];

interface Props {
  value: QueueExcludeValue;
  onChange: (v: QueueExcludeValue) => void;
  /** عدد الأرقام اللى اتستبعدت فعلاً — بييجى من الرد (queuedExcluded). */
  excluded?: number | null;
  className?: string;
}

export function QueueExcludeSelect({ value, onChange, excluded, className = "" }: Props) {
  const on = value !== "";
  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as QueueExcludeValue)}
        dir="rtl"
        className={`h-9 rounded-md border px-2 text-sm ${
          on ? "bg-amber-600 border-amber-600 text-white" : "bg-white text-amber-700 border-amber-300"}`}
        title="يشيل أرقام أى باتش لسه نشط فى الطابور **بنفس السبب** — حتى اللى اتنفّذ منها فعلاً — عشان مايتبعتوش تانى ويتكرّر نفس الشغل"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value} className="bg-white text-foreground">{o.label}</option>
        ))}
      </select>
      {on && !!excluded && (
        <span className="text-xs text-amber-700 font-medium whitespace-nowrap">
          ({excluded.toLocaleString("ar-EG")} مستبعَد)
        </span>
      )}
    </div>
  );
}
