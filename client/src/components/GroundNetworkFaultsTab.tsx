import { useState } from "react";
import { OpenTicketLinesReport } from "@/components/OpenTicketLinesReport";
import { GroundFaultsNoAccountReport } from "@/components/GroundFaultsNoAccountReport";
import { OpenTicketBoxAvgReport } from "@/components/OpenTicketBoxAvgReport";

type SubTab = "lines" | "no-account" | "box-avg";

const TABS: { id: SubTab; label: string }[] = [
  { id: "lines",      label: "خطوط على بكسيات لها تذكرة مفتوحة" },
  { id: "no-account", label: "أعطال أرضية بدون رقم أكونت" },
  { id: "box-avg",    label: "متوسط قياس كل بكس" },
];

export function GroundNetworkFaultsTab() {
  const [tab, setTab] = useState<SubTab>("lines");

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

      {tab === "lines"      && <OpenTicketLinesReport />}
      {tab === "no-account" && <GroundFaultsNoAccountReport />}
      {tab === "box-avg"    && <OpenTicketBoxAvgReport />}
    </div>
  );
}
