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

export function InstallationsByTechReport() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<TechRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showOver24, setShowOver24] = useState(false);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);

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

  const loadLines = useCallback(async () => {
    setLinesLoading(true);
    try {
      const p = qs(); p.set("lines", "1");
      const r = await fetch(`/api/reports/installations-by-tech?${p}`, { credentials: "include" });
      const d = await r.json();
      setLines(Array.isArray(d.lines) ? d.lines : []);
    } catch { setLines([]); } finally { setLinesLoading(false); }
  }, [qs]);

  const toggleOver24 = () => {
    const next = !showOver24;
    setShowOver24(next);
    if (next) loadLines();
  };
  // إعادة تحميل الخطوط لو التاريخ اتغيّر والزر مفتوح
  useEffect(() => { if (showOver24) loadLines(); }, [dateFrom, dateTo]); // eslint-disable-line

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
            <Button onClick={toggleOver24} size="sm" variant={showOver24 ? "default" : "outline"} className={`gap-1 ${showOver24 ? "bg-red-600 hover:bg-red-700" : "text-red-700 border-red-200"}`}>
              <AlertTriangle className="w-4 h-4" /> تجاوزات 24 ساعة {showOver24 ? "✓" : `(${totals.over24})`}
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

      {showOver24 && (
        <Card className="p-4 space-y-3">
          <h3 className="font-bold flex items-center gap-2 text-red-700"><AlertTriangle className="w-5 h-5" /> خطوط التركيبات المتجاوزة 24 ساعة</h3>
          <div className="rounded-md border max-h-[55vh] overflow-auto">
            <Table>
              <TableHeader><TableRow>{["اسم الفنى", "السنترال", "رقم الأمر", "رقم التليفون", "النوع", "تاريخ الفتح", "تاريخ الإغلاق", "المدة (ساعة)"].map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{c}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {linesLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                ) : lines.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center h-24 text-muted-foreground">لا توجد تركيبات متجاوزة 24 ساعة</TableCell></TableRow>
                ) : lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{l.techName || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.centralName || "-"}</TableCell>
                    <TableCell>{l.workOrderId ?? "-"}</TableCell>
                    <TableCell className="font-mono">{l.phoneNumber || "-"}</TableCell>
                    <TableCell><span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">{l.serviceType || "-"}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmt(l.creationDate)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmt(l.closeDate)}</TableCell>
                    <TableCell className="text-center font-semibold text-red-700">{l.hours ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
