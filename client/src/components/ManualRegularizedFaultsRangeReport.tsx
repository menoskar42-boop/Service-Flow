import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, FileSpreadsheet, FileText, Repeat } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { closeReason } from "@/lib/close-codes";
import { useMobileLookup, phoneLookupKey, MobileValue } from "@/lib/mobile-lookup";

// «الأعطال المنتظمة خارج الشاشة لفترة» — الأعطال اليدوية اللى اتنظمت (أرشيف دائم بفلتر تاريخ).
interface Row {
  id: number;
  fullPhone: string | null;
  phoneShort: string | null;
  accountNo: string | null;
  central: string | null;
  cabinNumber: string | null;
  boxNumber: string | null;
  msanCode: string | null;
  techName: string | null;
  closeCode: string | null;
  flaggedAt: string;
  flaggedBy: string | null;
  regularizedAt: string;
  regularizedBy: string | null;
}

const fmt = (iso: string | null) => {
  if (!iso) return "-";
  try { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; }
  catch { return iso; }
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function ManualRegularizedFaultsRangeReport() {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return ymd(d); });
  const [to, setTo] = useState(() => ymd(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mobileLookup = useMobileLookup(rows.map((x) => x.phoneShort || x.fullPhone));

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/manual-faults/regularized?from=${from}&to=${to}`, { credentials: "include" });
      if (!r.ok) throw new Error("تعذّر التحميل");
      const d = await r.json();
      setRows(d.data ?? []);
    } catch (e: any) { setError(e.message || "خطأ"); } finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const COLUMNS = ["تاريخ الانتظام", "رقم التليفون", "رقم الموبايل", "رقم الأكونت", "السنترال", "الكابينة", "البكس", "سبب الإغلاق", "فنى الانتظام", "تاريخ العطل", "سجّل العطل"];
  const toRow = (x: Row) => [fmt(x.regularizedAt), x.fullPhone || x.phoneShort || "-", mobileLookup[phoneLookupKey(x.phoneShort || x.fullPhone)] || "-", x.accountNo || "-", x.central || "-", x.cabinNumber || "-", x.boxNumber || "-", closeReason(x.closeCode) || x.closeCode || "-", x.regularizedBy || "-", fmt(x.flaggedAt), x.flaggedBy || "-"];

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows.map(toRow)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أعطال منتظمة خارج الشاشة");
    XLSX.writeFile(wb, `manual-regularized-${from}_${to}.xlsx`);
  };
  const handleExportPDF = () => printTablePDF({ title: `الأعطال المنتظمة خارج الشاشة (${from} → ${to})`, columns: COLUMNS, rows: rows.map(toRow) });

  return (
    <Card className="p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Repeat className="w-5 h-5 text-green-600" /> الأعطال المنتظمة خارج الشاشة لفترة</h2>
          <p className="text-xs text-muted-foreground">الأعطال اليدوية اللى اتنظمت (بسبب الإغلاق) خلال الفترة المختارة — أرشيف دائم.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1 text-green-700 border-green-200" disabled={!rows.length}><FileSpreadsheet className="w-4 h-4" /> تصدير Excel</Button>
          <Button onClick={handleExportPDF} variant="outline" size="sm" className="gap-1 text-red-700 border-red-200" disabled={!rows.length}><FileText className="w-4 h-4" /> تصدير PDF</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1"><label className="text-xs text-muted-foreground">من</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" /></div>
        <div className="grid gap-1"><label className="text-xs text-muted-foreground">إلى</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" /></div>
        <Button onClick={load} size="sm" className="gap-1" disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} تحديث</Button>
        <div className="text-sm text-muted-foreground mr-auto">إجمالى: <strong>{rows.length}</strong> منتظم</div>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="rounded-md border max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader><TableRow>{COLUMNS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{c}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24 text-muted-foreground">لا توجد أعطال منتظمة خارج الشاشة فى الفترة</TableCell></TableRow>
            ) : rows.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="whitespace-nowrap">{fmt(x.regularizedAt)}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{x.fullPhone || x.phoneShort || "-"}</TableCell>
                <TableCell><MobileValue mobile={mobileLookup[phoneLookupKey(x.phoneShort || x.fullPhone)]} /></TableCell>
                <TableCell className="whitespace-nowrap">{x.accountNo || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{x.central || "-"}</TableCell>
                <TableCell>{x.cabinNumber || "-"}</TableCell>
                <TableCell>{x.boxNumber || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{closeReason(x.closeCode) || x.closeCode || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{x.regularizedBy || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{fmt(x.flaggedAt)}</TableCell>
                <TableCell className="whitespace-nowrap">{x.flaggedBy || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
