import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, FileSpreadsheet, AlertTriangle, Wrench } from "lucide-react";
import * as XLSX from "xlsx";

// «نسبة التركيبات لكل فنى» — نسبة إنجاز التركيبات خلال 24 ساعة (Success فقط)، مع زر «تجاوزات 24 ساعة»
// يعرض خطوط التركيبات المتجاوزة. الفنى يشوف أرقامه فقط؛ الإدارة/الشئون الخارجية تشوف الكل.
interface TechRow { techName: string; total: number; within24: number; over24: number; }
interface LineRow {
  techName: string | null; centralName: string | null; workOrderId: number | null;
  phoneNumber: string | null; serviceType: string | null;
  creationDate: string | null; closeDate: string | null; hours: number | null;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const pctBadge = (p: number) => {
  const cls = p >= 90 ? "bg-green-100 text-green-800" : p >= 70 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{p}%</span>;
};
const fmt = (d: string | null) => {
  if (!d) return "-";
  try { const t = new Date(d); const p = (n: number) => String(n).padStart(2, "0"); return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`; }
  catch { return "-"; }
};

// الافتراضى: من أول يوم فى الشهر الحالى → اليوم (بتوقيت مصر)
const cairoParts = () => {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }); // YYYY-MM-DD
  return s;
};
const firstOfMonth = () => cairoParts().slice(0, 8) + "01";
const todayStr = () => cairoParts();

export function InstallationsByTechReport() {
  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(todayStr());
  const [rows, setRows] = useState<TechRow[]>([]);
  const [loading, setLoading] = useState(false);

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    return p;
  }, [dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/reports/installations-by-tech?${qs()}`, { credentials: "include" });
      const d = await r.json();
      setRows(Array.isArray(d.data) ? d.data : []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [qs]);
  useEffect(() => { load(); }, [load]);

  // يفتح خطوط التركيبات المتجاوزة 24 ساعة فى نافذة منبثقة (زى تقارير الأعطال)
  const openOver24Popup = useCallback(async () => {
    const w = window.open("", "_blank", "width=1150,height=780");
    if (!w) { alert("النوافذ المنبثقة متبلوكة — اسمح بالـ pop-ups للموقع"); return; }
    const style = `body{font-family:Arial,sans-serif;direction:rtl;padding:16px}h2{color:#b91c1c}
      table{border-collapse:collapse;width:100%;font-size:13px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:right;white-space:nowrap}
      th{background:#fee2e2;color:#7f1d1d}tr:nth-child(even){background:#fafafa}
      .hrs{color:#b91c1c;font-weight:bold;text-align:center}
      button{margin:0 0 12px;padding:6px 14px;border:0;border-radius:6px;background:#b91c1c;color:#fff;cursor:pointer}`;
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>خطوط التركيبات المتجاوزة 24 ساعة</title><style>${style}</style></head><body><h2>⚠️ جارٍ التحميل…</h2></body></html>`);
    w.document.close();
    try {
      const p = qs(); p.set("lines", "1");
      const r = await fetch(`/api/reports/installations-by-tech?${p}`, { credentials: "include" });
      const d = await r.json();
      const list: LineRow[] = Array.isArray(d.lines) ? d.lines : [];
      const esc = (s: any) => String(s ?? "-").replace(/[&<>]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as any)[c]));
      const body = list.length
        ? list.map((l) => `<tr><td>${esc(l.techName)}</td><td>${esc(l.centralName)}</td><td>${esc(l.workOrderId)}</td><td>${esc(l.phoneNumber)}</td><td>${esc(l.serviceType)}</td><td>${esc(fmt(l.creationDate))}</td><td>${esc(fmt(l.closeDate))}</td><td class="hrs">${esc(l.hours)}</td></tr>`).join("")
        : `<tr><td colspan="8" style="text-align:center;color:#666">لا توجد تركيبات متجاوزة 24 ساعة</td></tr>`;
      w.document.open();
      w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>خطوط التركيبات المتجاوزة 24 ساعة (${list.length})</title><style>${style}</style></head><body>
        <button onclick="window.print()">🖨️ طباعة</button>
        <h2>⚠️ خطوط التركيبات المتجاوزة 24 ساعة (${list.length})</h2>
        <table><thead><tr><th>اسم الفنى</th><th>السنترال</th><th>رقم الأمر</th><th>رقم التليفون</th><th>النوع</th><th>تاريخ الفتح</th><th>تاريخ الإغلاق</th><th>المدة (ساعة)</th></tr></thead><tbody>${body}</tbody></table>
        </body></html>`);
      w.document.close();
    } catch (e) {
      try { w.document.body.innerHTML = "<h2 style='color:#b91c1c'>تعذّر تحميل البيانات</h2>"; } catch {}
    }
  }, [qs]);

  const totals = rows.reduce((a, r) => ({ total: a.total + r.total, within24: a.within24 + r.within24, over24: a.over24 + r.over24 }), { total: 0, within24: 0, over24: 0 });

  const COLS = ["اسم الفنى", "إجمالى التركيبات", "خلال 24 ساعة", "نسبة الإنجاز خلال 24 ساعة", "متجاوزة 24 ساعة"];
  const handleExport = () => {
    const data = rows.map((r) => ({ "اسم الفنى": r.techName || "غير معروف", "إجمالى التركيبات": r.total, "خلال 24 ساعة": r.within24, "نسبة الإنجاز %": pct(r.within24, r.total), "متجاوزة 24 ساعة": r.over24 }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "نسبة التركيبات");
    XLSX.writeFile(wb, "installations-by-tech.xlsx");
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">نسبة التركيبات لكل فنى</h2>
            <p className="text-xs text-muted-foreground">نسبة التركيبات المنجَزة خلال 24 ساعة من فتح الأمر (Success فقط). زر «تجاوزات 24 ساعة» يعرض الخطوط المتجاوزة.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="text-xs text-muted-foreground block mb-1">من تاريخ</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40 text-sm" /></div>
            <div><label className="text-xs text-muted-foreground block mb-1">إلى تاريخ</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40 text-sm" /></div>
            <Button onClick={load} size="sm" variant="outline" className="gap-1" disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} تحديث</Button>
            <Button onClick={openOver24Popup} size="sm" variant="outline" className="gap-1 text-red-700 border-red-200">
              <AlertTriangle className="w-4 h-4" /> تجاوزات 24 ساعة ({totals.over24})
            </Button>
            <Button onClick={handleExport} size="sm" variant="outline" className="gap-1 text-green-700 border-green-200" disabled={!rows.length}><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
          </div>
        </div>

        <div className="rounded-md border max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader><TableRow>{COLS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{c}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={COLS.length} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={COLS.length} className="text-center h-24 text-muted-foreground">لا توجد تركيبات فى الفترة</TableCell></TableRow>
              ) : (<>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium whitespace-nowrap">{r.techName || "غير معروف"}</TableCell>
                    <TableCell className="text-center">{r.total}</TableCell>
                    <TableCell className="text-center text-green-700">{r.within24}</TableCell>
                    <TableCell className="text-center">{pctBadge(pct(r.within24, r.total))}</TableCell>
                    <TableCell className="text-center text-red-700 font-semibold">{r.over24}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-bold">
                  <TableCell>الإجمالى</TableCell>
                  <TableCell className="text-center">{totals.total}</TableCell>
                  <TableCell className="text-center text-green-700">{totals.within24}</TableCell>
                  <TableCell className="text-center">{pctBadge(pct(totals.within24, totals.total))}</TableCell>
                  <TableCell className="text-center text-red-700">{totals.over24}</TableCell>
                </TableRow>
              </>)}
            </TableBody>
          </Table>
        </div>
      </Card>

    </div>
  );
}
