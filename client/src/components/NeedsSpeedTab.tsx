import { useState } from "react";
import { NeedsSpeedReport } from "@/components/NeedsSpeedReport";

type SubTab = "complaint" | "all";

const TABS: { id: SubTab; label: string }[] = [
  { id: "complaint", label: "محتاجة رفع سرعة (لها شكوى)" },
  { id: "all",       label: "محتاجة رفع سرعة (الكل)" },
];

export function NeedsSpeedTab() {
  const [tab, setTab] = useState<SubTab>("all");

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "complaint" && <NeedsSpeedReport requireComplaint title="أرقام لها شكوى ومحتاجة رفع سرعة" />}
      {tab === "all"       && <NeedsSpeedReport title="أرقام محتاجة رفع سرعة" />}
    </div>
  );
}
