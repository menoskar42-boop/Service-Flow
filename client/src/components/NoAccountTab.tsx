import { useState } from "react";
import { WithoutAccountReport } from "@/components/WithoutAccountReport";
import { RegularizedNoAccountReport } from "@/components/RegularizedNoAccountReport";
import { GroundFaultsNoAccountReport } from "@/components/GroundFaultsNoAccountReport";
import { MarkedNoAccountReport } from "@/components/MarkedNoAccountReport";
import { WithAccountReport } from "@/components/WithAccountReport";

type SubTab = "lines" | "regularized" | "ground" | "marked" | "score103";

const TABS: { id: SubTab; label: string }[] = [
  { id: "lines",       label: "الخطوط بدون رقم أكونت" },
  { id: "regularized", label: "أعطال منتظمة بدون أكونت" },
  { id: "ground",      label: "أعطال أرضية بدون رقم أكونت" },
  { id: "marked",      label: "معلَّمة بدون أكونت (محذوفة / غير موجودة)" },
  { id: "score103",    label: "اسكور 103 (مراجعة رقم الأكونت)" },
];

export function NoAccountTab() {
  const [tab, setTab] = useState<SubTab>("regularized");

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
      {tab === "marked"      && <MarkedNoAccountReport />}
      {/* اسكور 103: خطوط ليها أكونت بس القياس راجع بحالة خاصة — المراجعة بتعدّل رقم
          الأكونت أو تمسحه. المسح بيعلّم الخط «بدون أكونت» (صوت مش داتا) فيظهر فى
          تاب «معلَّمة بدون أكونت». التعديل ممنوع على الفنى والمبيعات وأدمن المبيعات. */}
      {tab === "score103"    && (
        <WithAccountReport
          scoreEq={103}
          editorsOnly
          showC360
          title="خطوط اسكورها 103 — راجع رقم الأكونت (عدّله أو امسحه)"
        />
      )}
    </div>
  );
}
