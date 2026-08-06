import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { FileSpreadsheet, Printer } from "lucide-react";

// تفصيلى الباتش — للرقابة. بيوضّح لكل مهمة **الأثر الفعلى** فى قاعدة البيانات مش
// بس «اكتملت/ألغيت»: القياس اتقاس بكام، البورت اتغيّر من إيه لإيه، الطلب على
// البورتال حالته إيه، والجهاز اللى نفّذ.

interface Job {
  id: number;
  type: string;
  account: string;
  accountsCount: number;
  status: string;
  result: string | null;
  note: string | null;
  requestedBy: string | null;
  requestedFrom: string | null;
  executedBy: string | null;
  retryRound: number;
  createdAt: string | null;
  claimedAt: string | null;
  doneAt: string | null;
  detail: any;
}

const fmt = (d: string | null) => {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

const RESULT_LABEL: Record<string, string> = {
  done: "تمّت", tab_closed: "التاب اتقفل قبل ما تخلص", timeout: "علّقت / مافيش تقدّم",
  stopped: "جهاز التنفيذ اتقفل", preempted: "اتقطعت لمهمة أعلى أولوية",
  stuck_max_attempts: "علقت بعد كل المحاولات",
};
const statusLabel = (j: Job) =>
  j.status === "done" ? (RESULT_LABEL[j.result || "done"] ?? j.result ?? "تمّت")
  : j.status === "stale" ? "أُلغِيت"
  : j.status === "claimed" ? "جارٍ التنفيذ" : "فى الطابور";

const yn = (v: any) => (v === true ? "نعم" : v === false ? "لا" : "—");

// وصف نصّى للأثر — نفس النص بيتعرض فى الجدول وفى التصدير
function describe(j: Job): string {
  const d = j.detail || {};
  switch (j.type) {
    case "measure":
      return d.measuredInThisJob
        ? `اتقاس — الاسكور ${d.score ?? "؟"} · السرعة ${d.currentSpeed ?? "؟"}/${d.maxSpeed ?? "؟"}`
          + (d.complainNo ? ` · شكوى ${d.complainNo}` : "") + ` · ${fmt(d.at)}`
        : `ماتقاسش فى المهمة دى${d.at ? ` (آخر قياس معروف: ${fmt(d.at)})` : ""}`;
    case "raise":
    case "stop": {
      const w = j.type === "raise" ? "رفع السرعة" : "إيقاف الـ PO";
      return d.doneInThisJob
        ? `${w} اتنفّذ ${fmt(d.at)}${d.by ? ` · بطلب ${d.by}` : ""}`
        : `${w} ماتنفّذش فى المهمة دى${d.at ? ` (آخر مرة: ${fmt(d.at)})` : ""}`;
    }
    case "portchange": {
      const where = d.sameCabinet
        ? `نفس الكابينة (${d.requestedNewMsan})`
        : `نقل من ${d.requestedOldMsan || "؟"} → ${d.requestedNewMsan || "؟"}`;
      const portal = d.requestId
        ? `طلب ${d.requestId} · حالته ${d.portalStatus || "؟"}` + (d.portalCompleted ? " · اكتمل" : " · لسه/فشل")
        : "مافيش طلب مسجّل على البورتال";
      const now = d.currentFrame ? ` · البورت حالياً ${d.currentFrame}` : "";
      return `${where} · نوع البورت ${d.portType || "؟"} — ${portal}`
        + (d.portalNewFrame ? ` · البورت الجديد ${d.portalNewFrame}` : "") + now;
    }
    case "portcheck": {
      const before = d.msanBefore ? `كابينة قبل: ${d.msanBefore}` : "";
      const after = d.frameAfter ? `البورت حالياً: ${d.frameAfter}` : "مافيش بورت مسجّل";
      const st = d.portalStatus ? ` · البورتال: ${d.portalStatus}` : "";
      return `${d.updated ? "اتحدّث ✔" : "ماتحدّثش"} — ${before}${before ? " · " : ""}${after}${st}`
        + (d.portalNewFrame ? ` · البورت من الطلب ${d.portalNewFrame}` : "");
    }
    case "subinfo":
      return d.fetchedInThisJob
        ? `اتجابت — ${d.subName || "بدون اسم"} · ${d.subAdd || "بدون عنوان"} · ${fmt(d.at)}`
        : `ماتجابتش فى المهمة دى${d.at ? ` (آخر مراجعة: ${fmt(d.at)})` : ""}`;
    case "c360":
      return (d.accounts || []).map((a: any) =>
        `${a.phone}: ${a.accountNo || "مفيش أكونت"}${a.source ? ` (${a.source})` : ""}`).join(" — ") || "—";
    case "wfmcancel":
      return `${d.mode}${d.workerName ? ` · الفنى: ${d.workerName}` : ""}${d.worker ? ` (كود ${d.worker})` : ""}`;
    default:
      return "عملية على مستوى الموقع كله (تحديث ملف) — مافيش تفصيل لكل رقم";
  }
}

// «الجهاز الطالب» = الجهاز اللى اتبعت منه العملية (ده اللى الرقابة بتدوّر عليه).
// «الجهاز المنفّذ» = جهاز التنفيذ اللى سحب المهمة — بيفضل واحد لكل الطابور.
const COLS = ["#", "الرقم", "الحالة", "التفصيلى", "طلبها", "الجهاز الطالب", "الجهاز المنفّذ", "وقت السحب", "وقت الانتهاء"];

export function ExecBatchDetails({ batchId, typeLabel, onClose }:
  { batchId: string; typeLabel: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/exec-queue/batch-details", batchId],
    queryFn: async () => {
      const r = await fetch(`/api/exec-queue/batch-details?batchId=${encodeURIComponent(batchId)}`,
        { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "تعذّر التحميل");
      return r.json() as Promise<{ data: Job[] }>;
    },
  });

  const jobs = data?.data ?? [];
  const asRow = (j: Job, i: number) => [
    i + 1, j.account || "—", statusLabel(j) + (j.retryRound ? " (إعادة تنفيذ)" : ""),
    describe(j), j.requestedBy || "—", j.requestedFrom || "—", j.executedBy || "—",
    fmt(j.claimedAt), fmt(j.doneAt),
  ];

  const handleExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      jobs.map((j, i) => Object.fromEntries(COLS.map((c, ci) => [c, asRow(j, i)[ci]]))));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تفصيلى الباتش");
    XLSX.writeFile(wb, `تفصيلى-${batchId}.xlsx`);
  };
  const handlePDF = () => printTablePDF({
    title: `تفصيلى الباتش — ${typeLabel} (${batchId})`,
    columns: COLS, rows: jobs.map((j, i) => asRow(j, i).map((v) => String(v ?? "—"))),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-auto p-4" dir="rtl"
      onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl mt-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <div>
            <h3 className="font-semibold">تفصيلى الباتش — {typeLabel}</h3>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {batchId}{jobs.length ? ` — ${jobs.length} مهمة` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExcel} disabled={!jobs.length}
              className="gap-1 text-green-700 border-green-200">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handlePDF} disabled={!jobs.length}
              className="gap-1 text-red-700 border-red-200">
              <Printer className="w-4 h-4" /> PDF
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>

        <div className="overflow-auto max-h-[70vh]">
          {isLoading ? (
            <div className="py-14 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
          ) : jobs.length === 0 ? (
            <div className="py-14 text-center text-muted-foreground">مفيش مهام فى الباتش ده</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {COLS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap font-bold">{c}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j, i) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-mono whitespace-nowrap">{j.account || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <span className={
                        j.status === "done" && (!j.result || j.result === "done") ? "text-green-700 font-semibold"
                        : j.status === "stale" ? "text-red-700" : "text-amber-700"}>
                        {statusLabel(j)}
                      </span>
                      {j.retryRound ? <span className="text-[11px] text-muted-foreground"> (إعادة تنفيذ)</span> : null}
                    </TableCell>
                    <TableCell className="text-sm whitespace-normal break-words max-w-[420px] leading-5">
                      {describe(j)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{j.requestedBy || "—"}</TableCell>
                    <TableCell className="text-[11px] whitespace-normal break-words max-w-[220px] font-medium">
                      {j.requestedFrom || "—"}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground whitespace-normal break-words max-w-[200px]">
                      {j.executedBy || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmt(j.claimedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmt(j.doneAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}

export { yn };
