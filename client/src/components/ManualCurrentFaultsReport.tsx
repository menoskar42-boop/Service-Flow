import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, FileSpreadsheet, FileText, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

// «الأعطال الحالية خارج الشاشة» — الأعطال اليدوية (زر «الخط به عطل») اللى لسه ماانتظمتش.
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
  flaggedAt: string;
  flaggedBy: string | null;
}

const fmt = (iso: string | null) => {
  if (!iso) return "-";
  try { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; }
  catch { return iso; }
};

export function ManualCurrentFaultsReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/manual-faults/current", { credentials: "include" });
      if (!r.ok) throw new Error("تعذّر التحميل");
      const d = await r.json();
      setRows(d.data ?? []);
    } catch (e: any) { setError(e.message || "خطأ"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const COLUMNS = ["تاريخ العطل", "رقم التليفون", "رقم الأكونت", "السنترال", "الكابينة", "البكس", "كود MSAN", "اسم الفنى", "سجّل العطل"];
  const toRow = (x: Row) => [fmt(x.flaggedAt), x.fullPhone || x.phoneShort || "-", x.accountNo || "-", x.central || "-", x.cabinNumber || "-", x.boxNumber || "-", x.msanCode || "-", x.techName || "-", x.flaggedBy || "-"];

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows.map(toRow)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أعطال حالية خارج الشاشة");
    XLSX.writeFile(wb, `manual-current-faults.xlsx`);
  };
  const handleExportPDF = () => printTablePDF({ title: "الأعطال الحالية خارج الشاشة", columns: COLUMNS, rows: rows.map(toRow) });

  return (
    <Card className="p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-600" /> الأعطال الحالية خارج الشاشة</h2>
          <p className="text-xs text-muted-foreground">أعطال يدوية مسجّلة من زر «الخط به عطل» فى بحث برقم التليفون ولم تنتظم بعد.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={load} size="sm" className="gap-1" disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} تحديث</Button>
          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1 text-green-700 border-green-200" disabled={!rows.length}><FileSpreadsheet className="w-4 h-4" /> تصدير Excel</Button>
          <Button onClick={handleExportPDF} variant="outline" size="sm" className="gap-1 text-red-700 border-red-200" disabled={!rows.length}><FileText className="w-4 h-4" /> تصدير PDF</Button>
        </div>
      </div>
      <div className="text-sm text-muted-foreground">إجمالى: <strong>{rows.length}</strong> عطل مفتوح</div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="rounded-md border max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader><TableRow>{COLUMNS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{c}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24 text-muted-foreground">لا توجد أعطال حالية خارج الشاشة</TableCell></TableRow>
            ) : rows.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="whitespace-nowrap">{fmt(x.flaggedAt)}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{x.fullPhone || x.phoneShort || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{x.accountNo || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{x.central || "-"}</TableCell>
                <TableCell>{x.cabinNumber || "-"}</TableCell>
                <TableCell>{x.boxNumber || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{x.msanCode || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{x.techName || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{x.flaggedBy || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
