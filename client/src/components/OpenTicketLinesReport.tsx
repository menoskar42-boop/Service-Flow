import { useEffect, useState, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, AlertCircle, Radar, FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

const DZS_URL = "https://10.42.187.101:8080/expresse/";
const buildDZSUrl = (accounts: string[]) =>
  `${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}`;

interface OpenTicketLine {
  telNo: string;
  central: string;
  cabinNumber: string;
  boxNumber: string;
  fullPhone: string;
  iduNo: string;
  dpTerminal: string;
  accountNo: string | null;
  accountSource: string | null;
  lineCurrentSpeed: number | null;
  lineMaxSpeed: number | null;
  lastMeasScore: number | null;
  ticketNumber: string;
  faultType: string;
  ticketCreatedAt: string;
}

const scoreBadge = (v: string | number | null | undefined) => {
  if (v == null || v === "") return <span className="text-gray-400">-</span>;
  const n = Number(v);
  if (isNaN(n)) return <span>{String(v)}</span>;
  const cls =
    n > 33 ? "bg-red-100 text-red-800" :
    n > 15 ? "bg-amber-100 text-amber-700" :
             "bg-green-100 text-green-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{n}</span>;
};

export function OpenTicketLinesReport() {
  const [lines, setLines] = useState<OpenTicketLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCentral, setFilterCentral] = useState("");
  const [filterCabinet, setFilterCabinet] = useState("");
  const [onlyWithAccount, setOnlyWithAccount] = useState(false);
  const [dzsCount, setDzsCount] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/proxy/cfm-open-ticket-lines", { credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error((j as any).message || `خطأ ${res.status}`);
      setLines((j.lines as OpenTicketLine[]) ?? []);
    } catch (e: any) {
      setError(e.message || "تعذّر التحميل");
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const centrals = useMemo(
    () => [...new Set(lines.map((l) => l.central).filter(Boolean))].sort(),
    [lines],
  );
  const cabinets = useMemo(
    () => [...new Set(
      lines.filter((l) => !filterCentral || l.central === filterCentral)
        .map((l) => l.cabinNumber).filter(Boolean),
    )].sort((a, b) => Number(a) - Number(b)),
    [lines, filterCentral],
  );

  const filtered = useMemo(
    () => lines.filter((l) => {
      if (filterCentral && l.central !== filterCentral) return false;
      if (filterCabinet && l.cabinNumber !== filterCabinet) return false;
      if (onlyWithAccount && !l.accountNo) return false;
      return true;
    }),
    [lines, filterCentral, filterCabinet, onlyWithAccount],
  );

  const handleMeasureDZS = () => {
    const accounts = [...new Set(
      filtered.map((l) => (l.accountNo ?? "").toString().trim()).filter(Boolean),
    )];
    if (accounts.length === 0) {
      alert("لا توجد أرقام أكونت فى الخطوط المعروضة لقياسها");
      return;
    }
    window.open(buildDZSUrl(accounts), "dzs_measure");
    setDzsCount(accounts.length);
  };

  const handleExportExcel = () => {
    const rows = filtered.map((l) => ({
      "رقم التذكرة": l.ticketNumber,
      "نوع العطل": l.faultType,
      "رقم التليفون الكامل": l.fullPhone,
      "رقم التليفون": l.telNo,
      "رقم الأكونت": l.accountNo ?? "",
      "آخر قياس": l.lastMeasScore ?? "",
      "السرعة الحالية": l.lineCurrentSpeed ?? "",
      "أقصى سرعة": l.lineMaxSpeed ?? "",
      "السنترال": l.central,
      "رقم الكابينة": l.cabinNumber,
      "رقم البكس": l.boxNumber,
      "DP Terminal": l.dpTerminal,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "خطوط تذاكر مفتوحة");
    XLSX.writeFile(wb, "open-ticket-lines.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "خطوط على بكسيات لها تذكرة عطل شبكة أرضية مفتوحة",
      columns: ["#", "التذكرة", "نوع العطل", "التليفون الكامل", "الأكونت", "آخر قياس",
        "سرعة حالية", "أقصى سرعة", "السنترال", "الكابينة", "البكس"],
      rows: filtered.map((l, i) => [
        i + 1, l.ticketNumber, l.faultType, l.fullPhone, l.accountNo ?? "",
        l.lastMeasScore ?? "", l.lineCurrentSpeed ?? "", l.lineMaxSpeed ?? "",
        l.central, l.cabinNumber, l.boxNumber,
      ]),
    });
  };

  const withAccountCount = useMemo(
    () => filtered.filter((l) => l.accountNo).length,
    [filtered],
  );

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">
              خطوط على بكسيات لها تذكرة عطل شبكة أرضية مفتوحة
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {filtered.length.toLocaleString("ar-EG")} خط — منها {withAccountCount.toLocaleString("ar-EG")} له رقم أكونت
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchableCombobox
              options={centrals}
              value={filterCentral}
              onChange={(v) => { setFilterCentral(v); setFilterCabinet(""); }}
              placeholder="كل السنترالات"
              searchPlaceholder="ابحث في السنترالات..."
              className="w-full sm:w-44 text-sm"
            />
            <SearchableCombobox
              options={cabinets}
              value={filterCabinet}
              onChange={setFilterCabinet}
              placeholder="كل الكباين"
              searchPlaceholder="ابحث في الكباين..."
              disabled={!filterCentral}
              className="w-full sm:w-40 text-sm"
            />
            <label className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-md px-2 py-1.5 cursor-pointer bg-white">
              <input
                type="checkbox"
                checked={onlyWithAccount}
                onChange={(e) => setOnlyWithAccount(e.target.checked)}
              />
              لها أكونت فقط
            </label>
            <Button variant="outline" size="sm" onClick={handleMeasureDZS} className="text-blue-700 border-blue-200 gap-1">
              <Radar className="w-4 h-4" /> قياس DZS
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="text-green-700 border-green-200 gap-1">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="text-red-700 border-red-200 gap-1">
              <FileText className="w-4 h-4" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> تحديث
            </Button>
          </div>
        </div>

        {dzsCount != null && (
          <div className="px-4 py-2 border-b bg-blue-50 text-sm text-blue-700 font-semibold">
            فُتح قياس DZS لـ {dzsCount} رقم — السكريبت بيقيس على دفعات ويرفع النتائج تلقائياً لشيت 138.
          </div>
        )}

        {error && (
          <div className="px-4 py-3 border-b bg-red-50 flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-right text-sm" dir="rtl">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم التذكرة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">نوع العطل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون الكامل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم الأكونت</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">آخر قياس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">السرعة الحالية</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">أقصى سرعة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم الكابينة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم البكس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">DP Terminal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-10">
                      لا توجد خطوط على بكسيات لها تذاكر مفتوحة
                    </TableCell>
                  </TableRow>
                ) : filtered.map((l, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-mono font-semibold text-amber-700">{l.ticketNumber || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.faultType || "-"}</TableCell>
                    <TableCell className="font-mono font-semibold text-blue-700">
                      {l.fullPhone || "-"}
                      {l.accountNo && (
                        <button
                          type="button"
                          onClick={() => window.open(buildDZSUrl([l.accountNo!.toString().trim()]), "_blank")}
                          title="فتح DZS وقياس هذا الرقم"
                          className="text-blue-600 hover:text-blue-800 mr-1 align-middle"
                        >
                          <Radar className="w-3.5 h-3.5 inline" />
                        </button>
                      )}
                    </TableCell>
                    <TableCell dir="ltr" className="text-left font-mono">{l.accountNo || "-"}</TableCell>
                    <TableCell>{scoreBadge(l.lastMeasScore)}</TableCell>
                    <TableCell className="font-mono">{l.lineCurrentSpeed ?? "-"}</TableCell>
                    <TableCell className="font-mono">{l.lineMaxSpeed ?? "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.central || "-"}</TableCell>
                    <TableCell className="font-medium">{l.cabinNumber || "-"}</TableCell>
                    <TableCell className="font-medium">{l.boxNumber || "-"}</TableCell>
                    <TableCell>{l.dpTerminal || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
