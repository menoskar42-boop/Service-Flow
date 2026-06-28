import { useEffect, useState, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw, AlertCircle, FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

interface OpenTicketLine {
  telNo: string;
  central: string;
  cabinNumber: string;
  boxNumber: string;
  fullPhone: string;
  accountNo: string | null;
  lineCurrentSpeed: number | null;
  lineMaxSpeed: number | null;
  lastMeasScore: number | null;
  ticketNumber: string;
  faultType: string;
}

interface BoxAvgRow {
  central: string;
  cabinNumber: string;
  boxNumber: string;
  ticketNumber: string;
  faultType: string;
  lineCount: number;
  measuredCount: number;
  avgScore: number | null;
  avgCurrentSpeed: number | null;
  avgMaxSpeed: number | null;
}

const scoreBadge = (v: number | null) => {
  if (v == null) return <span className="text-gray-400">—</span>;
  const n = Number(v);
  const cls =
    n > 33 ? "bg-red-100 text-red-800" :
    n > 15 ? "bg-amber-100 text-amber-700" :
             "bg-green-100 text-green-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{n}</span>;
};

const avg = (nums: number[]) =>
  nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;

// يحوّل القيمة لرقم صالح أو null (يستبعد N/A والفراغات والقيم غير الرقمية)
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function OpenTicketBoxAvgReport() {
  const [lines, setLines] = useState<OpenTicketLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCentral, setFilterCentral] = useState("");
  const [filterCabinet, setFilterCabinet] = useState("");
  const [minScore, setMinScore] = useState("");

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

  // تجميع الخطوط حسب (سنترال | كابينه | بكس) وحساب المتوسطات
  const boxes = useMemo(() => {
    const map = new Map<string, BoxAvgRow & { scores: number[]; curs: number[]; maxs: number[] }>();
    for (const l of lines) {
      const key = `${l.central}|${l.cabinNumber}|${l.boxNumber}`;
      let g = map.get(key);
      if (!g) {
        g = {
          central: l.central, cabinNumber: l.cabinNumber, boxNumber: l.boxNumber,
          ticketNumber: l.ticketNumber, faultType: l.faultType,
          lineCount: 0, measuredCount: 0, avgScore: null, avgCurrentSpeed: null, avgMaxSpeed: null,
          scores: [], curs: [], maxs: [],
        };
        map.set(key, g);
      }
      g.lineCount++;
      const sc = num(l.lastMeasScore);
      if (sc != null) { g.scores.push(sc); g.measuredCount++; }
      // متوسط السرعات: نستبعد قيم N/A (غير الرقمية) ونستبعد الخطوط اللى اسكورها > 100
      // (101/102… أكواد خارج الخدمة وليست قياسات حقيقية).
      if (sc == null || sc <= 100) {
        const cur = num(l.lineCurrentSpeed);
        const mx = num(l.lineMaxSpeed);
        if (cur != null) g.curs.push(cur);
        if (mx != null) g.maxs.push(mx);
      }
    }
    return [...map.values()].map((g) => ({
      ...g,
      avgScore: avg(g.scores),
      avgCurrentSpeed: avg(g.curs),
      avgMaxSpeed: avg(g.maxs),
    })).sort((a, b) =>
      // ترتيب أبجدى/طبيعى: السنترال ثم الكابينه ثم البكس (numeric يتعامل مع صيغ زى "7-1")
      a.central.localeCompare(b.central, "ar", { numeric: true }) ||
      a.cabinNumber.localeCompare(b.cabinNumber, "ar", { numeric: true }) ||
      a.boxNumber.localeCompare(b.boxNumber, "ar", { numeric: true }),
    );
  }, [lines]);

  const centrals = useMemo(
    () => [...new Set(lines.map((l) => l.central).filter(Boolean))].sort(),
    [lines],
  );
  const cabinets = useMemo(
    () => [...new Set(
      boxes.filter((b) => !filterCentral || b.central === filterCentral)
        .map((b) => b.cabinNumber).filter(Boolean),
    )].sort((a, b) => Number(a) - Number(b)),
    [boxes, filterCentral],
  );

  const filtered = useMemo(() => {
    const threshold = minScore !== "" ? Number(minScore) : null;
    return boxes.filter((b) => {
      if (filterCentral && b.central !== filterCentral) return false;
      if (filterCabinet && b.cabinNumber !== filterCabinet) return false;
      if (threshold != null && !isNaN(threshold) && !(b.avgScore != null && b.avgScore > threshold)) return false;
      return true;
    });
  }, [boxes, filterCentral, filterCabinet, minScore]);

  const handleExportExcel = () => {
    const rows = filtered.map((b) => ({
      "رقم التذكرة": b.ticketNumber,
      "نوع العطل": b.faultType,
      "السنترال": b.central,
      "رقم الكابينه": b.cabinNumber,
      "رقم البكس": b.boxNumber,
      "عدد الخطوط": b.lineCount,
      "خطوط مقاسة": b.measuredCount,
      "متوسط الاسكور": b.avgScore ?? "",
      "متوسط السرعة الحالية": b.avgCurrentSpeed ?? "",
      "متوسط أقصى سرعة": b.avgMaxSpeed ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "متوسط قياس البكس");
    XLSX.writeFile(wb, "open-ticket-box-avg.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "متوسط قياس كل بكس — بكسيات لها تذكرة عطل شبكة أرضية مفتوحة",
      columns: ["#", "التذكرة", "نوع العطل", "السنترال", "الكابينه", "البكس", "الخطوط", "مقاسة", "متوسط الاسكور", "متوسط السرعة", "متوسط أقصى سرعة"],
      rows: filtered.map((b, i) => [
        i + 1, b.ticketNumber, b.faultType, b.central, b.cabinNumber, b.boxNumber,
        b.lineCount, b.measuredCount, b.avgScore ?? "—", b.avgCurrentSpeed ?? "—", b.avgMaxSpeed ?? "—",
      ]),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">متوسط قياس كل بكس</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              متوسط قياس كل بكس على البكسيات اللى لها تذكرة عطل شبكة أرضية مفتوحة — {filtered.length.toLocaleString("ar-EG")} بكس
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
            <input
              type="number"
              min={0}
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              placeholder="الاسكور أكبر من"
              className="w-36 border border-gray-200 rounded-md px-2 py-1.5 text-sm text-right bg-white"
              dir="rtl"
            />
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
                  <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم الكابينه</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم البكس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">عدد الخطوط</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">خطوط مقاسة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">متوسط الاسكور</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">متوسط السرعة الحالية</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">متوسط أقصى سرعة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                      لا توجد بكسيات لها تذاكر مفتوحة
                    </TableCell>
                  </TableRow>
                ) : filtered.map((b, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-mono font-semibold text-amber-700">{b.ticketNumber || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{b.faultType || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">{b.central || "-"}</TableCell>
                    <TableCell className="font-medium">{b.cabinNumber || "-"}</TableCell>
                    <TableCell className="font-medium">{b.boxNumber || "-"}</TableCell>
                    <TableCell>{b.lineCount}</TableCell>
                    <TableCell>{b.measuredCount}</TableCell>
                    <TableCell>{scoreBadge(b.avgScore)}</TableCell>
                    <TableCell className="font-mono">{b.avgCurrentSpeed != null ? b.avgCurrentSpeed.toLocaleString("ar-EG") : "—"}</TableCell>
                    <TableCell className="font-mono">{b.avgMaxSpeed != null ? b.avgMaxSpeed.toLocaleString("ar-EG") : "—"}</TableCell>
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
