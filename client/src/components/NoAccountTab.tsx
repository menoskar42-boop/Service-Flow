import { useState } from "react";
import { WithoutAccountReport } from "@/components/WithoutAccountReport";
import { RegularizedNoAccountReport } from "@/components/RegularizedNoAccountReport";
import { GroundFaultsNoAccountReport } from "@/components/GroundFaultsNoAccountReport";

type SubTab = "lines" | "regularized" | "ground";

const TABS: { id: SubTab; label: string }[] = [
  { id: "lines",       label: "الخطوط بدون رقم أكونت" },
  { id: "regularized", label: "أعطال منتظمة بدون أكونت" },
  { id: "ground",      label: "أعطال أرضية بدون رقم أكونت" },
];

export function NoAccountTab() {
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

      {tab === "lines"       && <WithoutAccountReport />}
      {tab === "regularized" && <RegularizedNoAccountReport />}
      {tab === "ground"      && <GroundFaultsNoAccountReport />}
    </div>
  );
}
