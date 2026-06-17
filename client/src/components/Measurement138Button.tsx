import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Gauge } from "lucide-react";

// بيانات القياس القادمة من شيت 138 (case_138) المرفقة بكل صف فى التقارير.
export interface Measurement138 {
  accountNo?: string | null;
  // آخر قياس للرقم (أى رقم شكوى) — المطابقة بالتليفون الكامل
  lastMeasScore?: string | number | null;
  lastMeasComplainNo?: string | null;
  lastMeasTime?: string | null;
  lineCurrentSpeed?: string | null;
  lineMaxSpeed?: string | null;
  // القياس الحالى لنفس رقم الشكوى
  curMeasScore?: string | number | null;
  curMeasCurrentSpeed?: string | null;
  curMeasMaxSpeed?: string | null;
  curMeasTime?: string | null;
}

const fmtDt = (d?: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

const val = (v: any) => (v === null || v === undefined || v === "" ? "-" : String(v));

function Block({ title, score, cur, max, when, complainNo }: {
  title: string; score: any; cur: any; max: any; when?: string | null; complainNo?: string | null;
}) {
  const has = !(score === null || score === undefined || score === "");
  return (
    <div className="rounded-md border p-2 space-y-1">
      <div className="text-xs font-bold text-blue-800">{title}</div>
      {has ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          <div>القياس (Score): <strong>{val(score)}</strong></div>
          <div>السرعة الحالية: <strong>{val(cur)}</strong></div>
          <div>أقصى سرعة: <strong>{val(max)}</strong></div>
          {complainNo !== undefined && <div>رقم الشكوى: <strong>{val(complainNo)}</strong></div>}
          {when !== undefined && <div className="col-span-2">الوقت: {fmtDt(when)}</div>}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">لا يوجد قياس</div>
      )}
    </div>
  );
}

export function Measurement138Button({ m }: { m: Measurement138 }) {
  const hasAny =
    (m.lastMeasScore !== null && m.lastMeasScore !== undefined && m.lastMeasScore !== "") ||
    (m.curMeasScore !== null && m.curMeasScore !== undefined && m.curMeasScore !== "");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost" size="icon"
          className={`h-7 w-7 ${hasAny ? "text-blue-600 hover:text-blue-700 hover:bg-blue-50" : "text-muted-foreground/40"}`}
          title="قياسات شيت 138"
        >
          <Gauge className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2 space-y-2" dir="rtl" align="end">
        <Block
          title="القياس الحالى (نفس رقم الشكوى)"
          score={m.curMeasScore} cur={m.curMeasCurrentSpeed} max={m.curMeasMaxSpeed} when={m.curMeasTime}
        />
        <Block
          title="آخر قياس للرقم (أى شكوى)"
          score={m.lastMeasScore} cur={m.lineCurrentSpeed} max={m.lineMaxSpeed}
          when={m.lastMeasTime} complainNo={m.lastMeasComplainNo}
        />
      </PopoverContent>
    </Popover>
  );
}
