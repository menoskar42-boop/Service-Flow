import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer, UserPlus, Pencil, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ROLES } from "@shared/schema";

interface Row {
  id: number;
  serviceOrderId: string | null;
  customerOrderId: string | null;
  serialNumber: string | null;
  customerName: string | null;
  orderStatus: string | null;
  orderCreateTime: string | null;
  msanCode: string | null;
  errorName: string | null;
  currentActivity: string | null;
  customerMobile: string | null;
  fccExchange: string | null;
  techName: string | null;
  techManual: boolean | null;
  address: string | null;
}

// الوقت مخزَّن كـ UTC (توقيت الملف) — يُعرض كما هو دون إزاحة المتصفح.
const fmtDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

type YearFilter = "all" | "current" | "previous";

export function OmRejectionsReport({ bucket, title }: { bucket: "current" | "soy" | "resolved"; title: string }) {
  const [q, setQ] = useState("");
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");
  const [msanFilter, setMsanFilter] = useState("");
  const [fccFilter, setFccFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === ROLES.ADMIN;

  const { data: rows = [], isFetching } = useQuery<Row[]>({
    queryKey: ["/api/ftth-orders", bucket, q, yearFilter, msanFilter, fccFilter, dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams({ bucket });
      if (q.trim()) p.set("q", q.trim());
      if (yearFilter !== "all") p.set("yearFilter", yearFilter);
      if (msanFilter.trim()) p.set("msanFilter", msanFilter.trim());
      if (fccFilter.trim()) p.set("fccFilter", fccFilter.trim());
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`/api/ftth-orders?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  // إسناد فنى يدوى لكود كابينة غير معروف (أدمن) — نفس أسلوب تجاوزات ٢٤ ساعة
  const [assigningCode, setAssigningCode] = useState<string | null>(null);
  const { data: techList = [] } = useQuery<{ workerCode: string; techName: string }[]>({
    queryKey: ["/api/technician-names"],
    queryFn: async () => {
      const res = await fetch("/api/technician-names", { credentials: "include" });
      if (!res.ok) throw new Error("فشل");
      return res.json();
    },
    enabled: isAdmin,
  });
  const techNames = Array.from(new Set(techList.map((t) => t.techName).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "ar"));

  // فلتر السنة client-side — يضمن الصحة بغض النظر عن الـ DB timezone
  const displayRows = useMemo(() => {
    if (yearFilter === "all") return rows;
    const nowYear = new Date().getFullYear();
    return rows.filter((r) => {
      if (!r.orderCreateTime) return yearFilter === "previous";
      const yr = new Date(r.orderCreateTime).getFullYear();
      return yearFilter === "current" ? yr === nowYear : yr < nowYear;
    });
  }, [rows, yearFilter]);

  const assignTech = async (msanCode: string, techName: string) => {
    try {
      await apiRequest("POST", "/api/msan-tech", { msanCode, techName });
      setAssigningCode(null);
      qc.invalidateQueries({ queryKey: ["/api/ftth-orders"] });
      qc.invalidateQueries({ queryKey: ["/api/reports/om-stats"] });
      toast({ title: "تم إسناد الفنى", description: `${techName} — كابينة ${msanCode}`, duration: 3500 });
    } catch (e: any) {
      toast({ title: "خطأ", description: e?.message || "تعذّر الحفظ", variant: "destructive", duration: 5000 });
    }
  };

  const removeTech = async (msanCode: string) => {
    try {
      await apiRequest("DELETE", `/api/msan-tech/${encodeURIComponent(msanCode)}`);
      qc.invalidateQueries({ queryKey: ["/api/ftth-orders"] });
      qc.invalidateQueries({ queryKey: ["/api/reports/om-stats"] });
      toast({ title: "تم إلغاء الإسناد", description: `كابينة ${msanCode}`, duration: 3000 });
    } catch (e: any) {
      toast({ title: "خطأ", description: e?.message || "تعذّر الحذف", variant: "destructive", duration: 5000 });
    }
  };

  // خلية اسم الفنى مع إمكانية الإسناد اليدوى للأدمن عند "غير معروف"
  const renderTechCell = (r: Row) => {
    const code = String(r.msanCode ?? "").trim();
    const unknown = !r.techName || r.techName === "غير معروف";
    if (isAdmin && assigningCode === code && code) {
      return (
        <div className="flex items-center gap-1">
          <select
            autoFocus defaultValue=""
            onChange={(e) => { if (e.target.value) assignTech(code, e.target.value); }}
            className="border rounded text-xs px-1 py-1 max-w-[150px] bg-white"
          >
            <option value="" disabled>اختر الفنى…</option>
            {techNames.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={() => setAssigningCode(null)} className="text-gray-400 hover:text-gray-600" title="إلغاء">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5">
        <span className={r.techManual ? "text-blue-700 font-semibold" : unknown ? "text-muted-foreground" : ""}>
          {r.techName ?? "غير معروف"}
        </span>
        {isAdmin && code && (unknown || r.techManual) && (
          <button onClick={() => setAssigningCode(code)} className="text-blue-600 hover:text-blue-800"
            title={r.techManual ? "تعديل الفنى" : "إسناد فنى"}>
            {r.techManual ? <Pencil className="w-3.5 h-3.5" /> : <UserPlus className="w-4 h-4" />}
          </button>
        )}
        {isAdmin && r.techManual && code && (
          <button onClick={() => removeTech(code)} className="text-red-500 hover:text-red-700" title="إلغاء الإسناد اليدوى">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  };

  const cols: [string, (r: Row) => any][] = [
    ["المسلسل", (r) => r.serialNumber],
    ["Service Order ID", (r) => r.serviceOrderId],
    ["Customer Order ID", (r) => r.customerOrderId],
    ["اسم العميل", (r) => r.customerName],
    ["الحالة", (r) => r.orderStatus],
    ["كود MSAN", (r) => r.msanCode],
    ["FCC", (r) => r.fccExchange],
    ["اسم الفنى", (r) => r.techName],
    ["سبب التعذر", (r) => r.errorName],
    ["النشاط الحالى", (r) => r.currentActivity],
    ["الموبايل", (r) => r.customerMobile],
    ["عنوان العميل", (r) => r.address],
    ["تاريخ الإنشاء", (r) => fmtDt(r.orderCreateTime)],
  ];

  const handleExportExcel = () => {
    const data = displayRows.map((r, i) => {
      const o: Record<string, any> = { "#": i + 1 };
      cols.forEach(([h, f]) => { o[h] = f(r) ?? ""; });
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "متعذرات");
    XLSX.writeFile(wb, `om-${bucket}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExportPDF = () => {
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ROWS_PER_PAGE = 20;
    const total = Math.max(1, Math.ceil(displayRows.length / ROWS_PER_PAGE));
    const head = `<th>#</th>` + cols.map(([h]) => `<th>${esc(h)}</th>`).join("");
    let pages = "";
    for (let pg = 0; pg < total; pg++) {
      const chunk = displayRows.slice(pg * ROWS_PER_PAGE, (pg + 1) * ROWS_PER_PAGE);
      const body = chunk.map((r, ci) =>
        `<tr><td>${pg * ROWS_PER_PAGE + ci + 1}</td>` + cols.map(([, f]) => `<td>${esc(f(r))}</td>`).join("") + `</tr>`,
      ).join("");
      pages += `
        <section class="page">
          <h2>${esc(title)} — ${displayRows.length} متعذر</h2>
          <div class="pageno">صفحة ${pg + 1} من ${total}</div>
          <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 10px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 14px; margin: 0 0 4px; }
        .pageno { text-align: center; font-size: 10px; color: #64748b; margin-bottom: 8px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 6px 3px; border: 1px solid #15407f; font-size: 10px; }
        td { border: 1px solid #ccc; padding: 4px 3px; text-align: center; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        .page { background: #fff; padding: 12px; margin: 10px auto; max-width: 1100px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0; padding: 10px 14px; display: flex; gap: 10px; align-items: center; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; font-family: inherit; }
        @media print { body { background: #fff; } .toolbar { display: none; } .page { box-shadow: none; margin: 0; max-width: none; page-break-after: always; } @page { size: A4 landscape; margin: 8mm; } }
      </style></head><body>
      <div class="toolbar"><button onclick="window.print()">🖸️ طباعة / حفظ PDF</button>
        <span>اختر "حفظ بصيغة PDF" كوجهة الطباعة.</span></div>
      ${pages}</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4 bg-white border-0 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold w-full sm:w-auto">{title}</h2>
          <Input
            placeholder="بحث بالمسلسل / Order ID / العميل / MSAN"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full sm:w-56 text-sm"
            dir="rtl"
          />
          <Input
            placeholder="كود الكابينة (MSAN)"
            value={msanFilter}
            onChange={(e) => setMsanFilter(e.target.value)}
            className="w-full sm:w-36 text-sm"
            dir="ltr"
          />
          <select
            value={fccFilter}
            onChange={(e) => setFccFilter(e.target.value)}
            className="border rounded-md text-sm px-2 py-2 bg-white"
            title="فلتر حسب كود السنترال"
          >
            <option value="">كل السنترالات</option>
            <option value="GHNAT">GHNAT</option>
            <option value="AMZAT">AMZAT</option>
            <option value="DRGAT">DRGAT</option>
            <option value="NGOAT">NGOAT</option>
          </select>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value as YearFilter)}
            className="border rounded-md text-sm px-2 py-2 bg-white"
            title="فلتر حسب سنة إنشاء الطلب"
          >
            <option value="all">الكل</option>
            <option value="current">متعذرات العام</option>
            <option value="previous">متعذرات سنوات سابقة</option>
          </select>
          <label className="text-xs text-muted-foreground whitespace-nowrap">من:</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded-md text-sm px-2 py-1.5 bg-white" />
          <label className="text-xs text-muted-foreground whitespace-nowrap">إلى:</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="border rounded-md text-sm px-2 py-1.5 bg-white" />
          {(msanFilter || fccFilter || dateFrom || dateTo) && (
            <button
              onClick={() => { setMsanFilter(""); setFccFilter(""); setDateFrom(""); setDateTo(""); }}
              className="text-xs text-red-500 hover:text-red-700 underline whitespace-nowrap"
            >مسح الفلاتر</button>
          )}
          <div className="flex-1" />
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <span className="text-sm text-muted-foreground">إجمالي: <strong className="text-foreground">{displayRows.length}</strong> متعذر</span>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={displayRows.length === 0} className="text-green-700 border-green-200 gap-1">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={displayRows.length === 0} className="text-red-700 border-red-200 gap-1">
            <Printer className="w-4 h-4" /> PDF
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-xs" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-right font-bold w-10">#</TableHead>
                {cols.map(([h]) => <TableHead key={h} className="text-right font-bold whitespace-nowrap">{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={cols.length + 1} className="text-center py-14 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : "لا توجد بيانات — تأكد من رفع ملفات متعذرات OM (الحالى + بداية السنة)"}
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map((r, idx) => (
                  <TableRow key={r.id ?? idx} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    {cols.map(([h, f]) => (
                      <TableCell key={h} className="whitespace-nowrap">
                        {h === "اسم الفنى" ? renderTechCell(r) : (f(r) ?? "-")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
