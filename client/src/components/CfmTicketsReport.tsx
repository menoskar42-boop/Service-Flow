import { useEffect, useState, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, AlertCircle, Search, FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";

const REFRESH_INTERVAL = 30;

interface CfmTicket {
  id: string;
  ticketNumber: string;
  centralDepartment?: string;
  central?: { name: string; code?: string } | null;
  cable?: { number?: string; cableNumber?: string; cabinetNumber?: string; type?: string } | null;
  box?: string | null;
  faultType?: { name: string; category?: string } | null;
  notes?: string | null;
  status: "open" | "pending_confirmation" | "closed" | "cancelled" | string;
  createdAt: string;
  createdByUser?: { name: string } | null;
  works?: { performedBy?: string }[];
  // مُضافة من الـ proxy: متوسط قياس بكسات التذكرة من Service Flow
  boxAvgScore?: number | null;
  boxMeasuredLines?: number;
  boxCount?: number;
  boxesWithData?: number;
  boxBreakdown?: { box: string; avg: number | null; measured: number }[];
}

function avgScoreBadge(v: number | null | undefined) {
  if (v == null) return <span className="text-gray-400">-</span>;
  const cls =
    v > 33 ? "bg-red-100 text-red-800" :
    v > 15 ? "bg-amber-100 text-amber-700" :
             "bg-green-100 text-green-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{v}</span>;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  open:                 { label: "مفتوحة",        cls: "bg-blue-100 text-blue-800" },
  pending_confirmation: { label: "تحت التأكيد",   cls: "bg-amber-100 text-amber-800" },
  closed:               { label: "مغلقة",         cls: "bg-green-100 text-green-800" },
  cancelled:            { label: "ملغية",         cls: "bg-red-100 text-red-800" },
};

function statusBadge(s: string) {
  const { label, cls } = STATUS_LABELS[s] ?? { label: s, cls: "bg-gray-100 text-gray-700" };
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>{label}</span>;
}

function getTechs(ticket: CfmTicket) {
  if (!ticket.works?.length) return "-";
  const all = ticket.works.map((w) => w.performedBy).filter(Boolean);
  return all.length ? [...new Set(all)].join("، ") : "-";
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}

function parseTicketBoxesClient(boxStr: string | null | undefined): string[] {
  if (!boxStr) return [];
  const s = String(boxStr).trim();
  if (!s) return [];
  if (s.includes(":")) {
    const parts = s.split(":").map((x) => parseInt(x.replace(/[^0-9]/g, ""), 10));
    const [a, b] = parts;
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const out: string[] = [];
      for (let i = lo; i <= hi && i - lo < 1000; i++) out.push(String(i));
      return out;
    }
  }
  if (/[&،,]/.test(s)) {
    return s.split(/[&،,]/).map((x) => x.replace(/[^0-9]/g, "")).filter(Boolean);
  }
  const single = s.replace(/[^0-9]/g, "");
  return single ? [single] : [];
}

export function CfmTicketsReport() {
  // --- ticket data ---
  const [data, setData] = useState<CfmTicket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);

  // --- filters ---
  const [filterCentral, setFilterCentral] = useState("");
  const [filterCabinet, setFilterCabinet] = useState("");
  const [filterBoxFrom, setFilterBoxFrom] = useState("");
  const [filterBoxTo, setFilterBoxTo] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // --- 430D ---
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // preTicketMap: يُحمَّل تلقائياً مع التذاكر (لا يحتاج تواريخ من المستخدم)
  const [preTicketMap, setPreTicketMap] = useState<Map<string, number> | null>(null);
  // faultMap: عدد أعطال الفترة المختارة — يظهر فقط بعد ضغط بحث
  const [faultMap, setFaultMap] = useState<Map<string, number> | null>(null);
  const [faultLoading, setFaultLoading] = useState(false);
  const [faultError, setFaultError] = useState<string | null>(null);

  // --- box breakdown expand ---
  const [expandedBox, setExpandedBox] = useState<string | null>(null);

  // --- derived ---
  const centrals = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.map(t => t.central?.name ?? t.centralDepartment ?? "").filter(Boolean))].sort();
  }, [data]);

  const cabinets = useMemo(() => {
    if (!data) return [];
    const base = filterCentral
      ? data.filter(t => (t.central?.name ?? t.centralDepartment ?? "") === filterCentral)
      : data;
    return [...new Set(base.map(t => t.cable?.number ?? "").filter(Boolean))].sort();
  }, [data, filterCentral]);

  const filteredData = useMemo(() => {
    if (!data) return [];
    return data.filter(t => {
      if (filterCentral && (t.central?.name ?? t.centralDepartment ?? "") !== filterCentral) return false;
      if (filterCabinet && t.cable?.number !== filterCabinet) return false;
      if (filterStatus && t.status !== filterStatus) return false;
      if (filterBoxFrom || filterBoxTo) {
        const boxes = parseTicketBoxesClient(t.box);
        const lo = filterBoxFrom ? parseInt(filterBoxFrom) : -Infinity;
        const hi = filterBoxTo   ? parseInt(filterBoxTo)   : Infinity;
        if (!boxes.some(b => { const n = parseInt(b); return n >= lo && n <= hi; })) return false;
      }
      return true;
    });
  }, [data, filterCentral, filterCabinet, filterStatus, filterBoxFrom, filterBoxTo]);

  // --- totals for filtered data ---
  const totals = useMemo(() => {
    let preTicket = 0, inRange = 0;
    for (const t of filteredData) {
      preTicket += preTicketMap?.get(t.id) ?? 0;
      inRange   += faultMap?.get(t.id) ?? 0;
    }
    return { preTicket, inRange };
  }, [filteredData, preTicketMap, faultMap]);

  // --- fetch tickets ---
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/proxy/cfm-tickets", { credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any).message || `خطأ ${res.status}`);
      }
      const json = await res.json();
      setData(Array.isArray(json) ? json : (json.data ?? json.tickets ?? []));
      setLastFetch(new Date());
      setCountdown(REFRESH_INTERVAL);
      // تحميل عدد أعطال ما قبل التكت تلقائياً (لا يحتاج تواريخ من المستخدم)
      fetch("/api/proxy/cfm-fault-counts", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then((fj: { id: string; faultCountPreTicket: number }[] | null) => {
          if (!fj) return;
          const m = new Map<string, number>();
          for (const r of fj) m.set(r.id, r.faultCountPreTicket);
          setPreTicketMap(m);
        })
        .catch(() => {});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // --- fetch 430D fault counts ---
  const fetchFaultData = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setFaultLoading(true);
    setFaultError(null);
    try {
      const res = await fetch(
        `/api/proxy/cfm-fault-counts?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any).message || `خطأ ${res.status}`);
      }
      const json: { id: string; faultCountInRange: number; faultCountPreTicket: number }[] = await res.json();
      // تحديث عمود الفترة المختارة
      const rangeMap = new Map<string, number>();
      const preMap   = new Map<string, number>();
      for (const r of json) {
        rangeMap.set(r.id, r.faultCountInRange);
        preMap.set(r.id, r.faultCountPreTicket);
      }
      setFaultMap(rangeMap);
      setPreTicketMap(preMap);
    } catch (e: any) {
      setFaultError(e.message);
    } finally {
      setFaultLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { fetchData(); return REFRESH_INTERVAL; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [fetchData]);

  // --- export Excel ---
  const handleExportExcel = () => {
    if (!filteredData.length) return;
    const rows = filteredData.map((t, idx) => {
      return {
        "#": idx + 1,
        "رقم التذكرة": t.ticketNumber,
        "تاريخ الإنشاء": fmtDate(t.createdAt),
        "السنترال": t.central?.name ?? t.centralDepartment ?? "",
        "رقم الكابينة": t.cable?.number ?? "",
        "بوكس": t.box ?? "",
        "متوسط القياس": t.boxAvgScore ?? "",
        "البكسيات المقاسة": t.boxCount ? `${t.boxesWithData}/${t.boxCount} · ${t.boxMeasuredLines ?? 0} خط` : "",
        "نوع العطل": t.faultType?.name ?? "",
        "الحالة": STATUS_LABELS[t.status]?.label ?? t.status,
        "الفنى": getTechs(t),
        "ملاحظات": t.notes ?? "",
        "أعطال 7أيام قبل التكت": preTicketMap?.get(t.id) ?? "",
        ...(faultMap ? { "أعطال فى الفترة المختارة": faultMap.get(t.id) ?? 0 } : {}),
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تذاكر الأعطال");
    XLSX.writeFile(wb, `cfm-tickets-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // --- export PDF ---
  const handleExportPDF = () => {
    if (!filteredData.length) return;
    const title = `تذاكر أعطال الشبكات الأرضية — ${new Date().toLocaleString("ar-EG")}`;
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const hasFault = !!faultMap;
    const headRow = `<tr>
      <th>#</th><th>رقم التذكرة</th><th>تاريخ الإنشاء</th><th>السنترال</th>
      <th>الكابينة</th><th>بوكس</th><th>متوسط القياس</th><th>البكسيات المقاسة</th>
      <th>نوع العطل</th><th>الحالة</th><th>الفنى</th>
      <th>أعطال 7أيام قبل التكت</th>
      ${hasFault ? "<th>أعطال فى الفترة</th>" : ""}
      <th>ملاحظات</th>
    </tr>`;
    const ROWS_PER_PAGE = 25;
    const totalPages = Math.max(1, Math.ceil(filteredData.length / ROWS_PER_PAGE));
    let pages = "";
    for (let p = 0; p < totalPages; p++) {
      const chunk = filteredData.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
      const body = chunk.map((t, ci) => {
        const fault = faultMap?.get(t.id);
        const cov = t.boxCount ? `${t.boxesWithData}/${t.boxCount} · ${t.boxMeasuredLines ?? 0}خط` : "";
        return `<tr>
          <td>${p * ROWS_PER_PAGE + ci + 1}</td><td>${esc(t.ticketNumber)}</td>
          <td>${esc(fmtDate(t.createdAt))}</td><td>${esc(t.central?.name ?? t.centralDepartment)}</td>
          <td>${esc(t.cable?.number)}</td><td>${esc(t.box)}</td>
          <td>${esc(t.boxAvgScore ?? "")}</td><td>${esc(cov)}</td>
          <td>${esc(t.faultType?.name)}</td><td>${esc(STATUS_LABELS[t.status]?.label ?? t.status)}</td>
          <td>${esc(getTechs(t))}</td>
          <td>${preTicketMap?.get(t.id) ?? ""}</td>
          ${hasFault ? `<td>${faultMap?.get(t.id) ?? 0}</td>` : ""}
          <td>${esc(t.notes)}</td>
        </tr>`;
      }).join("");
      pages += `<section class="page">
        <h2>${esc(title)}</h2>
        <div class="pageno">صفحة ${p + 1} من ${totalPages} — إجمالي: ${filteredData.length} تذكرة</div>
        <table><thead>${headRow}</thead><tbody>${body}</tbody></table>
      </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>${esc(title)}</title>
      <style>
        body{font-family:Arial,"Segoe UI",sans-serif;font-size:9px;direction:rtl;margin:0;background:#f1f5f9}
        h2{text-align:center;font-size:12px;margin:0 0 3px}
        .pageno{text-align:center;font-size:8px;color:#64748b;margin-bottom:5px}
        *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        table{width:100%;border-collapse:collapse}
        th{background:#1e50a0!important;color:#fff!important;padding:4px 3px;border:1px solid #15407f;font-size:9px}
        td{border:1px solid #ccc;padding:3px;text-align:right;color:#111}
        tbody tr:nth-child(even){background:#eef2fb!important}
        .page{background:#fff;padding:8px;margin:8px auto;max-width:1500px;box-shadow:0 1px 4px rgba(0,0,0,.15)}
        .toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #e2e8f0;padding:8px 12px;display:flex;gap:10px;align-items:center;z-index:10}
        @media print{.toolbar{display:none}.page{box-shadow:none;margin:0;padding:5px}}
      </style></head><body>
      <div class="toolbar">
        <button onclick="window.print()" style="padding:6px 14px;background:#1e50a0;color:#fff;border:none;border-radius:4px;cursor:pointer">طباعة / PDF</button>
        <button onclick="window.close()" style="padding:6px 14px;background:#64748b;color:#fff;border:none;border-radius:4px;cursor:pointer">إغلاق</button>
      </div>
      ${pages}</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const hasFilters = !!(filterCentral || filterCabinet || filterBoxFrom || filterBoxTo || filterStatus);

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">

        {/* Header */}
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">تذاكر أعطال الشبكات الأرضية</h3>
            {lastFetch && (
              <p className="text-xs text-muted-foreground mt-0.5">
                آخر تحديث: {lastFetch.toLocaleTimeString("ar-EG")} — يتجدد خلال {countdown}ث
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data && (
              <span className="text-sm text-muted-foreground">
                {filteredData.length !== data.length ? `${filteredData.length} من ` : ""}{data.length} تذكرة
              </span>
            )}
            <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!filteredData.length}
              className="gap-1 text-green-700 border-green-300 hover:bg-green-50">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!filteredData.length}
              className="gap-1 text-red-700 border-red-300 hover:bg-red-50">
              <FileText className="w-4 h-4" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => { fetchData(); setCountdown(REFRESH_INTERVAL); }} disabled={loading} className="gap-1">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              تحديث
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="px-4 py-3 border-b bg-slate-50 flex flex-wrap gap-x-4 gap-y-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">السنترال</label>
            <select value={filterCentral} onChange={e => { setFilterCentral(e.target.value); setFilterCabinet(""); }}
              className="border rounded px-2 py-1 text-sm bg-white min-w-[160px]">
              <option value="">الكل</option>
              {centrals.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">الكابينة</label>
            <select value={filterCabinet} onChange={e => setFilterCabinet(e.target.value)}
              className="border rounded px-2 py-1 text-sm bg-white min-w-[100px]">
              <option value="">الكل</option>
              {cabinets.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">بكس من</label>
            <input type="number" min="1" value={filterBoxFrom} onChange={e => setFilterBoxFrom(e.target.value)}
              className="border rounded px-2 py-1 text-sm w-20 bg-white" placeholder="1" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">إلى</label>
            <input type="number" min="1" value={filterBoxTo} onChange={e => setFilterBoxTo(e.target.value)}
              className="border rounded px-2 py-1 text-sm w-20 bg-white" placeholder="99" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">الحالة</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="border rounded px-2 py-1 text-sm bg-white min-w-[130px]">
              <option value="">الكل</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="self-end text-xs"
              onClick={() => { setFilterCentral(""); setFilterCabinet(""); setFilterBoxFrom(""); setFilterBoxTo(""); setFilterStatus(""); }}>
              مسح الفلاتر
            </Button>
          )}
        </div>

        {/* 430D date range */}
        <div className="px-4 py-3 border-b bg-blue-50/40 flex flex-wrap gap-x-4 gap-y-2 items-end">
          <span className="text-xs font-semibold text-blue-900 self-center">ربط بأعطال 430D:</span>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">من تاريخ (وقت الشكوى)</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border rounded px-2 py-1 text-sm bg-white" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">إلى تاريخ</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border rounded px-2 py-1 text-sm bg-white" />
          </div>
          <Button size="sm" onClick={fetchFaultData} disabled={!dateFrom || !dateTo || faultLoading} className="self-end gap-1">
            {faultLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            بحث
          </Button>
          {faultMap && !faultLoading && (
            <span className="text-xs text-green-700 self-center font-medium bg-green-50 border border-green-200 px-2 py-0.5 rounded">
              ✓ تم تحميل بيانات الأعطال
            </span>
          )}
          {faultError && <span className="text-xs text-red-600 self-center">{faultError}</span>}
        </div>

        {/* Totals summary */}
        {(preTicketMap || faultMap) && filteredData.length > 0 && (
          <div className="px-4 py-2 border-b bg-amber-50/60 flex flex-wrap gap-x-6 gap-y-1 items-center text-sm">
            <span className="font-semibold text-amber-900">إجمالى ({filteredData.length} تذكرة):</span>
            {preTicketMap && (
              <span className="text-orange-800 font-medium">
                أعطال 7أيام قبل التكتات: <span className="font-bold text-base">{totals.preTicket}</span>
              </span>
            )}
            {faultMap && (
              <span className="text-blue-800 font-medium">
                أعطال فى الفترة المختارة: <span className="font-bold text-base">{totals.inRange}</span>
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-50 text-red-700 text-sm border-b">
            <AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredData.length === 0 && data != null ? (
          <div className="text-center py-16 text-muted-foreground text-sm">لا توجد تذاكر تطابق الفلاتر</div>
        ) : data ? (
          <div className="overflow-x-auto">
            <Table className="text-right text-sm" dir="rtl">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="text-right font-bold">#</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم التذكرة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">تاريخ الإنشاء</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم الكابينة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">بوكس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap" title="متوسط قيمة الـ score لكل البكسيات — الرقم الصغير يوضح: (بكسيات فيها قياس / إجمالى البكسيات) · عدد الخطوط المقاسة">
                    متوسط القياس ⓘ
                  </TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">نوع العطل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الحالة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الفنى</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap text-orange-700" title="عدد أعطال 430D فى بكسيات هذه التذكرة من أسبوع قبل إنشاء التكت وحتى الآن">أعطال 7أيام قبل التكت</TableHead>
                  {faultMap && <TableHead className="text-right font-bold whitespace-nowrap text-blue-800">أعطال فى الفترة المختارة</TableHead>}
                  <TableHead className="text-right font-bold whitespace-nowrap">ملاحظات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((t, idx) => {
                  const hasBreakdown = (t.boxBreakdown?.length ?? 0) > 1;
                  const isExpanded = expandedBox === t.id;
                  return (
                    <TableRow key={t.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-mono font-semibold text-blue-700 whitespace-nowrap">{t.ticketNumber}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(t.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap">{t.central?.name ?? t.centralDepartment ?? "-"}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{t.cable?.number || "-"}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <span className="font-medium">{t.box || "-"}</span>
                          {hasBreakdown && (
                            <button onClick={() => setExpandedBox(isExpanded ? null : t.id)}
                              className="text-[10px] text-blue-600 hover:text-blue-800 underline hover:no-underline whitespace-nowrap">
                              {isExpanded ? "▲" : "▼ تفاصيل"}
                            </button>
                          )}
                        </div>
                        {isExpanded && t.boxBreakdown && (
                          <div className="mt-1 rounded border bg-white shadow-sm p-1.5 space-y-0.5 min-w-[110px]">
                            {t.boxBreakdown.map(bd => (
                              <div key={bd.box} className="flex items-center justify-between gap-2 text-[10px]">
                                <span className="text-muted-foreground">بكس {bd.box}</span>
                                {bd.avg != null
                                  ? <span className={`font-semibold px-1 rounded ${bd.avg > 33 ? "text-red-700 bg-red-50" : bd.avg > 15 ? "text-amber-700 bg-amber-50" : "text-green-700 bg-green-50"}`}>{bd.avg}</span>
                                  : <span className="text-gray-400">-</span>}
                                <span className="text-gray-400">{bd.measured}خط</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {avgScoreBadge(t.boxAvgScore)}
                        {t.boxCount != null && t.boxCount > 0 && (
                          <span className="text-[10px] text-muted-foreground block mt-0.5" title="بكسيات فيها قياس / إجمالى البكسيات · عدد الخطوط المقاسة">
                            {t.boxesWithData}/{t.boxCount} بكس · {t.boxMeasuredLines ?? 0} خط
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {t.faultType ? <span className="text-xs">{t.faultType.name}</span> : "-"}
                      </TableCell>
                      <TableCell>{statusBadge(t.status)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{getTechs(t)}</TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        {preTicketMap == null
                          ? <span className="text-gray-300 text-[10px]">…</span>
                          : (() => { const n = preTicketMap.get(t.id) ?? 0; return <span className={`text-xs font-semibold px-2 py-0.5 rounded ${n > 0 ? "bg-orange-100 text-orange-800" : "text-gray-400"}`}>{n}</span>; })()}
                      </TableCell>
                      {faultMap && (
                        <TableCell className="text-center whitespace-nowrap">
                          {(() => { const n = faultMap.get(t.id) ?? 0; return <span className={`text-xs font-semibold px-2 py-0.5 rounded ${n > 0 ? "bg-blue-100 text-blue-800" : "text-gray-400"}`}>{n}</span>; })()}
                        </TableCell>
                      )}
                      <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">{t.notes || "-"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
