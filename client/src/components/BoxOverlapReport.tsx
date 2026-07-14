import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer, Ruler } from "lucide-react";
import { format } from "date-fns";

// شكل الرد من نظام صيانة البوكسات (عبر الوسيط /api/reports/box-overlap)
interface OverlapRow {
  central: string | null;
  cabin: string | null;
  box: string | null;
  status: string | null;
  item: string | null;
  cableType: string | null;
  distance: number | null;
  observer: string | null;
  date: string | null;
}
interface OverlapSummary {
  totalDistance: number;
  handledBoxes10: number;
  totalHandled10: number;
  totalAerial10: number;
  totalAerial6: number;
}
interface OverlapResp { rows: OverlapRow[]; summary: OverlapSummary }

const EMPTY_SUMMARY: OverlapSummary = {
  totalDistance: 0, handledBoxes10: 0, totalHandled10: 0, totalAerial10: 0, totalAerial6: 0,
};

const num = (n: number | null | undefined) =>
  n == null || isNaN(Number(n)) ? "-" : Number(n).toLocaleString("en-US");

const statusBadge = (s: string | null) => {
  if (!s) return null;
  const map: Record<string, string> = {
    "قيد الصيانة": "bg-orange-100 text-orange-800",
    "يحتاج صيانة": "bg-yellow-100 text-yellow-800",
  };
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[s] ?? "bg-gray-100 text-gray-700"}`}>{s}</span>;
};

const itemBadge = (s: string | null) => {
  if (!s) return null;
  const map: Record<string, string> = {
    "تعارض هواء": "bg-cyan-100 text-cyan-800",
    "تخاطي":      "bg-amber-100 text-amber-800",
  };
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[s] ?? "bg-gray-100 text-gray-700"}`}>{s}</span>;
};

export function BoxOverlapReport() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");

  const { data, isFetching, error } = useQuery<OverlapResp>({
    queryKey: ["/api/reports/box-overlap", from, to],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const res = await fetch(`/api/reports/box-overlap?${p}`, { credentials: "include" });
      if (!res.ok) {
        let info: any = {}; try { info = await res.json(); } catch {}
        const st = info.status ? ` (كود ${info.status})` : "";
        const hint = info.status === 404 ? " — الخدمة غير منشورة (اعمل Republish لمشروع صيانة البوكسات)"
          : info.status === 401 ? " — التوكن غير متطابق"
          : info.error ? ` — ${info.error}` : "";
        throw new Error(`تعذّر جلب التقرير من نظام صيانة البوكسات${st}${hint}`);
      }
      return res.json();
    },
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary ?? EMPTY_SUMMARY;

  // بحث نصّى محلى على السنترال/الكابينة/البوكس/المراقب/البند/نوع الكابل
  const displayed = rows.filter((r) => {
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return [r.central, r.cabin, r.box, r.observer, r.item, r.cableType, r.status]
      .some((v) => (v ?? "").toString().toLowerCase().includes(t));
  });

  const CARDS: { label: string; value: number; suffix: string }[] = [
    { label: "إجمالي المسافات", value: summary.totalDistance, suffix: "م" },
    { label: "عدد البكسيات المناولة ١٠ جوز", value: summary.handledBoxes10, suffix: "" },
    { label: "إجمالي أطوال بكس مناول ١٠ جوز", value: summary.totalHandled10, suffix: "م" },
    { label: "إجمالي أطوال كابل هوائي ١٠ جوز", value: summary.totalAerial10, suffix: "م" },
    { label: "إجمالي أطوال كابل هوائي ٦ جوز", value: summary.totalAerial6, suffix: "م" },
  ];

  const handleExportExcel = () => {
    const body = displayed.map((r, i) => ({
      "#": i + 1,
      "السنترال": r.central,
      "الكابينة": r.cabin,
      "البوكس": r.box,
      "الحالة": r.status,
      "البند": r.item,
      "نوع الكابل / البكس": r.cableType,
      "المسافة (م)": r.distance,
      "المراقب": r.observer,
      "التاريخ": r.date,
    }));
    const ws = XLSX.utils.json_to_sheet(body);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "مسافات التخاطي والتعارض");
    // ورقة الملخص
    const sumSheet = XLSX.utils.json_to_sheet(CARDS.map((c) => ({ "البند": c.label, "القيمة": c.value, "الوحدة": c.suffix })));
    XLSX.utils.book_append_sheet(wb, sumSheet, "الملخص");
    XLSX.writeFile(wb, `box-overlap-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const title = `مسافات التخاطي والتعارض — لم يتم الإصلاح بعد — ${format(new Date(), "yyyy/MM/dd HH:mm")}`;
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ROWS_PER_PAGE = 18;
    const totalPages = Math.max(1, Math.ceil(displayed.length / ROWS_PER_PAGE));
    const headRow = `<tr>
      <th>#</th><th>السنترال</th><th>الكابينة</th><th>البوكس</th><th>الحالة</th><th>البند</th>
      <th>نوع الكابل / البكس</th><th>المسافة (م)</th><th>المراقب</th><th>التاريخ</th>
    </tr>`;
    const cards = CARDS.map((c) => `
      <div class="card"><div class="cv">${esc(num(c.value))}${c.suffix ? " " + esc(c.suffix) : ""}</div><div class="cl">${esc(c.label)}</div></div>`).join("");
    let pages = "";
    for (let p = 0; p < totalPages; p++) {
      const chunk = displayed.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
      const bodyRows = chunk.map((r, ci) => `
        <tr>
          <td>${p * ROWS_PER_PAGE + ci + 1}</td>
          <td>${esc(r.central)}</td>
          <td>${esc(r.cabin)}</td>
          <td>${esc(r.box)}</td>
          <td>${esc(r.status)}</td>
          <td>${esc(r.item)}</td>
          <td>${esc(r.cableType)}</td>
          <td>${esc(r.distance)}</td>
          <td>${esc(r.observer)}</td>
          <td>${esc(r.date)}</td>
        </tr>`).join("");
      pages += `
        <section class="page">
          <h2>${esc(title)}</h2>
          ${p === 0 ? `<div class="cards">${cards}</div>` : ""}
          <div class="pageno">صفحة ${p + 1} من ${totalPages} — إجمالي: ${displayed.length} سجل</div>
          <table><thead>${headRow}</thead><tbody>${bodyRows}</tbody></table>
        </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>${esc(title)}</title>
      <style>
        body { font-family: Arial, "Segoe UI", sans-serif; font-size: 11px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 14px; margin: 0 0 6px; }
        .pageno { text-align: center; font-size: 10px; color: #64748b; margin: 4px 0 6px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .cards { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 6px 0 10px; }
        .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 14px; min-width: 130px; text-align: center; background: #f8fafc; }
        .cv { font-size: 16px; font-weight: bold; color: #15407f; }
        .cl { font-size: 10px; color: #475569; margin-top: 2px; }
        table { width: 100%; border-collapse: collapse; } td, th { word-break: break-word; overflow-wrap: anywhere; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 6px 4px; border: 1px solid #15407f; font-size: 11px; }
        td { border: 1px solid #ccc; padding: 5px 4px; text-align: right; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        .page { background: #fff; padding: 12px; margin: 10px auto; max-width: 1100px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0;
          padding: 8px 12px; display: flex; gap: 10px; align-items: center; z-index: 10; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px;
          padding: 7px 14px; font-size: 12px; cursor: pointer; font-family: inherit; }
        .toolbar span { color: #475569; font-size: 11px; }
        @media print {
          body { background: #fff; }
          .toolbar { display: none; }
          .page { box-shadow: none; margin: 0; padding: 0; max-width: none; page-break-after: always; }
          .page:last-child { page-break-after: auto; }
          @page { size: A4 landscape; margin: 8mm; }
        }
      </style></head><body>
      <div class="toolbar">
        <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
        <span>في نافذة الطباعة اختر &quot;حفظ بصيغة PDF&quot; كوجهة الطباعة.</span>
      </div>
      ${pages}
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* كروت الملخص */}
      <div className="flex flex-wrap gap-3">
        {CARDS.map((c) => (
          <Card key={c.label} className="flex-1 min-w-[160px] p-4 border-0 shadow-sm bg-white text-center">
            <Ruler className="w-5 h-5 text-blue-600 mx-auto mb-1" />
            <div className="text-2xl font-bold text-blue-900">
              {num(c.value)}{c.suffix ? <span className="text-base font-medium text-muted-foreground"> {c.suffix}</span> : null}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{c.label}</div>
          </Card>
        ))}
      </div>

      {/* شريط الأدوات */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-muted-foreground">من
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto text-sm mr-1 inline-block" />
        </label>
        <label className="text-xs text-muted-foreground">إلى
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto text-sm mr-1 inline-block" />
        </label>
        <Input
          placeholder="بحث بالسنترال / الكابينة / البوكس / المراقب"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:max-w-xs text-sm"
          dir="rtl"
        />
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <span className="text-sm text-muted-foreground">إجمالي: <strong>{displayed.length}</strong> سجل</span>
        <RefreshButton />
        <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={displayed.length === 0} className="text-green-700 border-green-200 gap-1">
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={displayed.length === 0} className="text-red-700 border-red-200 gap-1">
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      {error && (
        <Card className="p-4 border-0 bg-red-50 text-red-700 text-sm">
          {(error as Error).message || "تعذّر جلب التقرير من نظام صيانة البوكسات — تأكد أن الخدمة تعمل وأن التوكن صحيح."}
        </Card>
      )}

      {/* الجدول */}
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-xs" dir="rtl">
            <TableHeader className="bg-blue-900">
              <TableRow>
                <TableHead className="text-right font-bold text-white w-8">#</TableHead>
                <TableHead className="text-right font-bold text-white">السنترال</TableHead>
                <TableHead className="text-right font-bold text-white">الكابينة</TableHead>
                <TableHead className="text-right font-bold text-white">البوكس</TableHead>
                <TableHead className="text-right font-bold text-white">الحالة</TableHead>
                <TableHead className="text-right font-bold text-white">البند</TableHead>
                <TableHead className="text-right font-bold text-white">نوع الكابل / البكس</TableHead>
                <TableHead className="text-right font-bold text-white">المسافة (م)</TableHead>
                <TableHead className="text-right font-bold text-white">المراقب</TableHead>
                <TableHead className="text-right font-bold text-white">التاريخ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-16 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : "لا توجد سجلات"}
                  </TableCell>
                </TableRow>
              ) : displayed.map((r, i) => (
                <TableRow key={i} className="hover:bg-muted/30">
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.central || "-"}</TableCell>
                  <TableCell>{r.cabin || "-"}</TableCell>
                  <TableCell>{r.box || "-"}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell>{itemBadge(r.item)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.cableType || "-"}</TableCell>
                  <TableCell className="font-medium text-blue-700">{num(r.distance)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.observer || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left whitespace-nowrap">{r.date || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
