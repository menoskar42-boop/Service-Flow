import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, FileSpreadsheet, ArrowLeftRight, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { useMobileLookup, phoneLookupKey, MobileValue } from "@/lib/mobile-lookup";

// «متابعة تغيير البورت» — نتائج طلبات تغيير البورت من Provisioning Portal (اللى السكربت بيتابعها).
// COMPLETED → اتحدّث بيان البورت تلقائياً. غير COMPLETED (زى FAIL_TO_RESERVE) → متسجّل هنا للمتابعة.
interface Row {
  requestId: string;
  phoneNumber: string | null;
  oldMsan: string | null;
  newMsan: string | null;
  newFrame: string | null;
  portType: string | null;
  status: string | null;
  reservationCode: string | null;
  requestDate: string | null;
  completed: boolean;
  requestedBy: string | null;
  requestedFrom: string | null;
  executedBy: string | null;
  executedAt: string | null;
  recordedAt: string | null;
}

const fmt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return d;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

export function PortChangeReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const mobileLookup = useMobileLookup(rows.map((r) => r.phoneNumber));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/port-change/list", { credentials: "include" });
      const d = await r.json();
      setRows(Array.isArray(d) ? d : []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // «مراجعة»: يفتح تاب «بحث برقم التليفون» ويحط الرقم ويبحث (مايحدّثش البورت — للمراجعة فقط).
  const openLookup = (phone: string | null) => {
    const p = (phone || "").toString().replace(/\D/g, "");
    if (!p) return;
    try { sessionStorage.setItem("sf_lookup_phone", p); } catch {}
    window.dispatchEvent(new CustomEvent("sf-open-phone-lookup", { detail: p }));
  };

  const shown = onlyFailed ? rows.filter((r) => !r.completed) : rows;
  const COLUMNS = ["Request ID", "رقم التليفون", "رقم الموبايل", "الحالة", "MSAN القديم", "MSAN الجديد", "Frame الجديد", "نوع البورت", "طلبها", "الجهاز الطالب", "الجهاز المنفّذ", "وقت التنفيذ", "Reservation Code", "تاريخ الطلب", "وقت التسجيل"];
  const toRow = (r: Row) => [r.requestId, r.phoneNumber || "-", mobileLookup[phoneLookupKey(r.phoneNumber)] || "-", r.status || "-", r.oldMsan || "-", r.newMsan || "-", r.newFrame || "-", r.portType || "-", r.requestedBy || "-", r.requestedFrom || "-", r.executedBy || "-", fmt(r.executedAt), r.reservationCode || "-", r.requestDate || "-", fmt(r.recordedAt)];

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...shown.map(toRow)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تغيير البورت");
    XLSX.writeFile(wb, `port-change-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const completedCount = rows.filter((r) => r.completed).length;
  const failedCount = rows.length - completedCount;

  return (
    <Card className="p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><ArrowLeftRight className="w-5 h-5 text-cyan-700" /> متابعة تغيير البورت</h2>
          <p className="text-xs text-muted-foreground">نتائج طلبات تغيير البورت من البروفيزيونال. المكتملة (COMPLETED) بيتحدّث لها بيان البورت تلقائياً؛ غير المكتملة تظهر هنا للمتابعة.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={load} size="sm" className="gap-1" disabled={loading}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} تحديث</Button>
          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1 text-green-700 border-green-200" disabled={!shown.length}><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-green-700">مكتمل: <strong>{completedCount}</strong></span>
        <span className="text-red-700">غير مكتمل: <strong>{failedCount}</strong></span>
        <label className="flex items-center gap-1 cursor-pointer text-muted-foreground mr-auto">
          <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> غير المكتملة فقط
        </label>
      </div>
      <div className="rounded-md border max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader><TableRow>{COLUMNS.map((c) => <TableHead key={c} className="text-right whitespace-nowrap">{c}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
            ) : shown.length === 0 ? (
              <TableRow><TableCell colSpan={COLUMNS.length} className="text-center h-24 text-muted-foreground">لا توجد طلبات تغيير بورت مسجّلة</TableCell></TableRow>
            ) : shown.map((r, i) => (
              <TableRow key={i} className={r.completed ? "" : "bg-red-50"}>
                {toRow(r).map((cell, j) => (
                  <TableCell key={j} className={
                    j === 8 ? "whitespace-normal break-words max-w-[220px] text-[11px] font-medium leading-5"
                    : j === 9 ? "whitespace-normal break-words max-w-[200px] text-[11px] text-muted-foreground leading-5"
                    : `whitespace-nowrap ${j === 2 ? (r.completed ? "text-green-700 font-semibold" : "text-red-700 font-semibold") : ""}`}>
                    {j === 1 ? (
                      <span className="inline-flex items-center gap-2 font-medium">
                        {cell}
                        {r.phoneNumber && (
                          <button type="button" onClick={() => openLookup(r.phoneNumber)}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50">
                            <Search className="w-3.5 h-3.5" /> مراجعة
                          </button>
                        )}
                      </span>
                    ) : j === 2 ? <MobileValue mobile={mobileLookup[phoneLookupKey(r.phoneNumber)]} /> : cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
