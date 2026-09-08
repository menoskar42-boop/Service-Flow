import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ClipboardCheck, Search, RefreshCw, CheckCircle2, FileSpreadsheet, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { format } from "date-fns";

// تقرير «تصحيح بيانات»: كل رقم بعته فنى، ومعاه اللى دخّله يدوياً جنب اللى رجع من
// مراجعة البيان الفنى. لو فيه اختلاف بيتعلّم «عدم تطابق» عشان مسئول البيانات يصحّح،
// وبعد التصحيح بيضغط «تم التصحيح» فتتبعت مراجعة تانية وتتقارن من أول وجديد.
interface Row {
  id: number;
  phoneLocal: string;
  phoneFull: string;
  central: string | null;
  cabinNumber: string | null;
  boxNumber: string | null;
  submittedBy: string | null;
  createdAt: string | null;
  requestedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  fetchedCentral: string | null;
  fetchedCabin: string | null;
  fetchedBox: string | null;
  subName: string | null;
  subAdd: string | null;
  fetchedAt: string | null;
  reviewed: boolean;
  mismatch: boolean;
  hasTyped: boolean;   // الفنى كتب سنترال/كابينة/بكس؟ لو لأ مافيش مقارنة أصلاً
}

const cairoToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const cairoMonthStart = () => cairoToday().slice(0, 8) + "01";

const fmtDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

const COLS = ["#", "رقم التليفون", "بواسطة", "تاريخ الإدخال", "السنترال (المُدخَل)", "السنترال (المراجعة)",
  "الكابينة (المُدخَل)", "الكابينة (المراجعة)", "البكس (المُدخَل)", "البكس (المراجعة)",
  "اسم العميل", "العنوان", "الحالة"];

export function LineDataCorrectionsReport() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  // «تم التصحيح» و«مراجعة الاسم والعنوان» لمسئول البيانات والأدمن/السوبر أدمن بس
  const canAct = user?.role === ROLES.DATA_MANAGER
    || user?.role === ROLES.ADMIN || user?.role === ROLES.SUPER_ADMIN;

  const [dateFrom, setDateFrom] = useState(cairoMonthStart);
  const [dateTo, setDateTo] = useState(cairoToday);
  const [search, setSearch] = useState("");
  const [onlyMismatch, setOnlyMismatch] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const { data: rows = [], isFetching } = useQuery<Row[]>({
    queryKey: ["/api/line-data-corrections", dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`/api/line-data-corrections?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
    refetchOnMount: "always",
  });

  const shown = useMemo(() => {
    const s = search.trim();
    const digits = s.replace(/\D/g, "");
    const low = s.toLowerCase();
    return rows.filter((r) => {
      if (onlyMismatch && !r.mismatch) return false;
      if (!s) return true;
      if (digits && String(r.phoneFull ?? "").replace(/\D/g, "").includes(digits)) return true;
      return [r.submittedBy, r.central, r.cabinNumber, r.subName, r.subAdd]
        .some((v) => String(v ?? "").toLowerCase().includes(low));
    });
  }, [rows, search, onlyMismatch]);

  const mismatchCount = rows.filter((r) => r.mismatch).length;

  const act = async (r: Row, kind: "review" | "resolve") => {
    setBusy(r.id);
    try {
      const res = await apiRequest("POST", `/api/line-data-corrections/${r.id}/${kind}`, {});
      const j = await res.json();
      toast({
        title: kind === "resolve" ? "اتسجّل «تم التصحيح»" : "اتبعت طلب المراجعة",
        description: j?.queued
          ? "طلب مراجعة الاسم والعنوان اتحطّ فى الطابور — هيتنفّذ أول ما جهاز التنفيذ يبقى متاح."
          : "الرقم ده لسه له طلب مراجعة فى الطابور.",
        duration: 5000,
      });
      qc.invalidateQueries({ queryKey: ["/api/line-data-corrections"] });
    } catch (e: any) {
      let msg = e?.message || "حدث خطأ";
      const m = String(msg).match(/^\d+:\s*(.*)$/s);
      if (m) msg = m[1];
      try { const j = JSON.parse(msg); if (j?.message) msg = j.message; } catch { /* نص عادى */ }
      toast({ title: "تعذّر التنفيذ", description: msg, variant: "destructive", duration: 6000 });
    } finally {
      setBusy(null);
    }
  };

  // الفنى اللى بعت الرقم بس من غير بيانات → مافيش مقارنة، مراجعة وخلاص.
  const statusText = (r: Row) =>
    !r.reviewed ? "فى انتظار المراجعة"
    : !r.hasTyped ? "مراجعة فقط"
    : r.mismatch ? "عدم تطابق" : "مطابق";

  const exportRows = () => shown.map((r, i) => [
    i + 1, r.phoneFull, r.submittedBy ?? "", fmtDt(r.createdAt),
    r.central ?? "", r.fetchedCentral ?? "", r.cabinNumber ?? "", r.fetchedCabin ?? "",
    r.boxNumber ?? "", r.fetchedBox ?? "", r.subName ?? "", r.subAdd ?? "", statusText(r),
  ]);

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLS, ...exportRows()]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تصحيح بيانات");
    XLSX.writeFile(wb, `line-data-corrections-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };
  const handleExportPDF = () =>
    printTablePDF({ title: "تصحيح بيانات — مقارنة بالمراجعة", columns: COLS, rows: exportRows() });

  // خانة بتوضّح الاختلاف: المُدخَل بلون تحذيرى لو مختلف عن اللى رجع من المراجعة
  const cmpCell = (typed: string | null, fetched: string | null, reviewed: boolean) => {
    const differs = reviewed && !!String(typed ?? "").trim()
      && String(typed ?? "").trim() !== String(fetched ?? "").trim();
    return (
      <TableCell className={differs ? "text-red-700 font-semibold whitespace-nowrap" : "whitespace-nowrap"}>
        {typed || "-"}
      </TableCell>
    );
  };

  return (
    <Card className="p-4 sm:p-5 bg-white border-0 shadow-sm" dir="rtl">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardCheck className="w-5 h-5 text-primary" />
        <h2 className="text-base font-bold">تصحيح بيانات — الأرقام المُرسَلة والمقارنة</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        كل رقم بعته فنى، ومعاه اللى دخّله يدوياً جنب اللى رجع من مراجعة البيان الفنى.
        أى اختلاف بيتعلّم <strong>«عدم تطابق»</strong> عشان مسئول البيانات يصحّحه — وبعد
        التصحيح يضغط <strong>«تم التصحيح»</strong> فتتبعت مراجعة تانية وتتقارن من أول وجديد.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">من</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="text-sm w-40" dir="ltr" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">إلى</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="text-sm w-40" dir="ltr" />
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <label className="text-xs text-muted-foreground block mb-1">بحث</label>
          <Search className="absolute right-2 top-[30px] w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="رقم التليفون / الفنى / السنترال" className="text-sm pr-8" dir="rtl" />
        </div>
        <Button
          variant={onlyMismatch ? "default" : "outline"} size="sm"
          onClick={() => setOnlyMismatch((v) => !v)}
          className={`mb-1 gap-1 ${onlyMismatch ? "bg-red-600 hover:bg-red-700 text-white" : "text-red-700 border-red-200"}`}
          title="عرض اللى فيه اختلاف بين المُدخَل والمراجعة فقط"
        >
          عدم التطابق ({mismatchCount})
        </Button>
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mb-2" />}
        <span className="text-sm text-muted-foreground mb-2">
          إجمالي: <strong>{shown.length}</strong> رقم
        </span>
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={shown.length === 0}
          className="text-green-700 border-green-200 gap-1 mb-1">
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={shown.length === 0}
          className="text-red-700 border-red-200 gap-1 mb-1">
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table className="text-right text-sm" dir="rtl">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="text-right font-bold">#</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">بواسطة</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">تاريخ الإدخال</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">السنترال (المُدخَل)</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">السنترال (المراجعة)</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">الكابينة (المُدخَل)</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">الكابينة (المراجعة)</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">البكس (المُدخَل)</TableHead>
              <TableHead className="text-right font-bold whitespace-nowrap">البكس (المراجعة)</TableHead>
              <TableHead className="text-right font-bold">اسم العميل</TableHead>
              <TableHead className="text-right font-bold">العنوان</TableHead>
              <TableHead className="text-right font-bold">الحالة</TableHead>
              {canAct && <TableHead className="text-right font-bold">إجراء</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canAct ? 14 : 13} className="text-center py-8 text-muted-foreground">
                  {isFetching ? "جارٍ التحميل…" : "مافيش أرقام مُرسَلة فى المدة دى"}
                </TableCell>
              </TableRow>
            ) : shown.map((r, i) => (
              <TableRow key={r.id} className={r.mismatch ? "bg-red-50/60" : "hover:bg-muted/30"}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-mono font-semibold text-blue-700">{r.phoneFull}</TableCell>
                <TableCell className="whitespace-nowrap">{r.submittedBy || "-"}</TableCell>
                <TableCell dir="ltr" className="text-left text-xs whitespace-nowrap">{fmtDt(r.createdAt)}</TableCell>
                {cmpCell(r.central, r.fetchedCentral, r.reviewed)}
                <TableCell className="whitespace-nowrap text-muted-foreground">{r.fetchedCentral || "-"}</TableCell>
                {cmpCell(r.cabinNumber, r.fetchedCabin, r.reviewed)}
                <TableCell className="whitespace-nowrap text-muted-foreground">{r.fetchedCabin || "-"}</TableCell>
                {cmpCell(r.boxNumber, r.fetchedBox, r.reviewed)}
                <TableCell className="whitespace-nowrap text-muted-foreground">{r.fetchedBox || "-"}</TableCell>
                <TableCell className="max-w-[160px] truncate">{r.subName || "-"}</TableCell>
                <TableCell className="max-w-[200px] truncate">{r.subAdd || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    !r.reviewed ? "bg-amber-100 text-amber-800"
                    : !r.hasTyped ? "bg-slate-100 text-slate-700"
                    : r.mismatch ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
                  }`}>{statusText(r)}</span>
                  {r.resolvedAt && (
                    <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                      اتصحّح: {r.resolvedBy || "-"}
                    </div>
                  )}
                </TableCell>
                {canAct && (
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="outline" onClick={() => void act(r, "review")}
                        disabled={busy === r.id}
                        className="h-8 gap-1 text-blue-700 border-blue-200"
                        title="إعادة طلب مراجعة الاسم والعنوان للرقم ده">
                        {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        مراجعة
                      </Button>
                      {r.mismatch && (
                        <Button size="sm" variant="outline" onClick={() => void act(r, "resolve")}
                          disabled={busy === r.id}
                          className="h-8 gap-1 text-emerald-700 border-emerald-200"
                          title="اتصحّح البيان — ابعت مراجعة تانية وقارن من أول وجديد">
                          <CheckCircle2 className="w-3.5 h-3.5" /> تم التصحيح
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
