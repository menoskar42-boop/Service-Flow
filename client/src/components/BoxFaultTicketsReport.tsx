import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshButton } from "@/components/RefreshButton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { Loader2, FileSpreadsheet, Printer, Ticket, PlayCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

// تقريران فى ملف واحد لأنهما وجهان لنفس الميزة:
//   mode="backfill" → معاينة الطلبات/المتعذرات القديمة اللى فيها «بوكس معطل» + زر تنفيذ
//   mode="repaired" → المتعذرات اللى تكتها اتقفلت (اتصلحت فعلاً)
type Mode = "backfill" | "repaired";

const fmtDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

const ACTION_LABEL: Record<string, { txt: string; cls: string }> = {
  will_open: { txt: "هيتفتحله تكت", cls: "bg-green-100 text-green-800" },
  covered:   { txt: "مغطّى بتكت مفتوحة", cls: "bg-amber-100 text-amber-800" },
  done:      { txt: "اتفتحت قبل كده", cls: "bg-gray-100 text-gray-700" },
};

export function BoxFaultTicketsReport({ mode }: { mode: Mode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuper = user?.role === ROLES.SUPER_ADMIN;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [running, setRunning] = useState(false);

  const url = mode === "backfill"
    ? "/api/box-tickets/backfill-preview"
    : `/api/box-tickets/repaired?from=${from}&to=${to}`;

  const { data, isLoading, refetch } = useQuery({
    queryKey: [url],
    queryFn: async () => {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "تعذّر التحميل");
      return r.json() as Promise<any>;
    },
    refetchOnMount: "always",
  });

  const rows: any[] = data?.data ?? [];

  const COLS: [string, (r: any) => any][] = mode === "backfill"
    ? [
        ["المصدر", (r) => r.source],
        ["المرجع", (r) => r.refKey],
        ["السنترال", (r) => r.central],
        ["الكابينة", (r) => r.cabinet],
        ["البكس", (r) => r.box],
        ["الفنى", (r) => r.techName],
        ["تاريخ رد الفنى", (r) => fmtDt(r.respondedAt)],
        ["الحالة", (r) => ACTION_LABEL[r.action]?.txt ?? r.action],
        ["التكت", (r) => r.ticketNumber ?? "-"],
      ]
    : [
        ["المصدر", (r) => r.source],
        ["المرجع", (r) => r.refKey],
        ["السنترال", (r) => r.central],
        ["الكابينة", (r) => r.cabinet],
        ["البكس", (r) => r.box],
        ["الفنى", (r) => r.techName],
        ["تاريخ رد الفنى", (r) => fmtDt(r.respondedAt)],
        ["رقم التكت", (r) => r.ticketNumber],
        ["نوع العطل", (r) => r.faultType],
        ["تاريخ الإغلاق", (r) => fmtDt(r.closedAt)],
        ["أغلقها", (r) => r.closedBy],
        ["وصف الإصلاح", (r) => r.repairDescription],
      ];

  const title = mode === "backfill"
    ? "فحص «بوكس معطل» بأثر رجعى"
    : "متعذرات على بكسيات معطلة تم إصلاحها";

  const handleExcel = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => Object.fromEntries(COLS.map(([h, f]) => [h, f(r) ?? ""]))));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بيانات");
    XLSX.writeFile(wb, `${title}.xlsx`);
  };
  const handlePDF = () => printTablePDF({
    title, columns: COLS.map(([h]) => h), rows: rows.map((r) => COLS.map(([, f]) => f(r) ?? "-")),
  });

  // التنفيذ الفعلى — بيفتح تكتات حقيقية، فبنطلب تأكيد صريح بعدد اللى هيتفتح
  const runBackfill = async () => {
    const n = data?.counts?.willOpen ?? 0;
    if (!n) { toast({ title: "مفيش حاجة محتاجة تكت" }); return; }
    if (!window.confirm(`هيتفتح ${n} تكت جديدة على برنامج الكوابل. متأكد؟`)) return;
    setRunning(true);
    try {
      const r = await fetch("/api/box-tickets/backfill-run", { method: "POST", credentials: "include" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.message || "فشل التنفيذ");
      toast({ title: `اتفتح ${d.opened} تكت — اتخطّى ${d.skipped}${d.failed ? ` — فشل ${d.failed}` : ""}` });
      refetch();
    } catch (e: any) {
      toast({ title: e?.message || "فشل التنفيذ", variant: "destructive" });
    } finally { setRunning(false); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2"><Ticket className="w-4 h-4" /> {title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {mode === "backfill" ? (
                <>
                  كل الطلبات والمتعذرات اللى الفنى سجّل فيها «بوكس معطل». الفحص ده <b>مابيفتحش حاجة</b> —
                  شوف القايمة الأول وبعدين اضغط «نفّذ».
                  {data?.counts && (
                    <span> {" "}— <b className="text-green-700">{data.counts.willOpen} هيتفتحلهم</b>،
                      {" "}{data.counts.covered} مغطّى بتكت مفتوحة، {data.counts.done} اتفتح قبل كده.</span>
                  )}
                </>
              ) : (
                <>التكتات اللى اتفتحت من Service-Flow ومهندس الكوابل نظّمها والشئون الخارجية أكّدتها (بقت مغلقة).
                  {data && <span> {" "}({data.total} تكت)</span>}</>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mode === "repaired" && (
              <>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 text-sm" />
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 text-sm" />
              </>
            )}
            {mode === "backfill" && isSuper && (
              <Button size="sm" onClick={runBackfill} disabled={running || !data?.counts?.willOpen}
                className="gap-1 bg-green-700 hover:bg-green-800 text-white">
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                نفّذ وافتح التكتات ({data?.counts?.willOpen ?? 0})
              </Button>
            )}
            <RefreshButton />
            <Button variant="outline" size="sm" onClick={handleExcel} className="gap-1 text-green-700 border-green-200">
              <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handlePDF} className="gap-1 text-red-700 border-red-200">
              <Printer className="w-4 h-4" /> تصدير PDF
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-auto">
        {isLoading ? (
          <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">مفيش بيانات</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>{COLS.map(([h]) => <TableHead key={h} className="text-right whitespace-nowrap">{h}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.source}-${r.refKey}-${i}`}>
                  {COLS.map(([h, f]) => (
                    <TableCell key={h} className="whitespace-nowrap text-sm">
                      {h === "الحالة" && mode === "backfill" ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${ACTION_LABEL[r.action]?.cls ?? ""}`}>
                          {ACTION_LABEL[r.action]?.txt ?? r.action}
                        </span>
                      ) : (f(r) ?? "-")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
