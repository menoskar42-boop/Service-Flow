import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

interface CabinetAvgRow {
  centralName: string;
  cabinNumber: string;
  msanCode: string | null;
  lineCount: number;
  measuredCount: number;
  avgScore: number | null;
  avgCurrentSpeed: number | null;
  avgMaxSpeed: number | null;
  oldestMeasTime: string | null;
  newestMeasTime: string | null;
}

interface FilterOptions {
  centrals: string[];
  copperCabins: Record<string, string[]>;
  msanCabins: Record<string, string[]>;
}

type SortKey = keyof CabinetAvgRow;
type SortDir = "asc" | "desc";

const fmtDt = (d: string | null | undefined) => {
  if (!d) return "لا يوجد";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "لا يوجد";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

const scoreBadge = (v: number | null | undefined) => {
  if (v == null) return <span className="text-gray-400">—</span>;
  const n = Number(v);
  const cls =
    n > 33 ? "bg-red-100 text-red-800" :
    n > 15 ? "bg-amber-100 text-amber-700" :
             "bg-green-100 text-green-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{n}</span>;
};

export function CabinetScoreReport() {
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [msan, setMsan] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("centralName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/reports/cabinet-score-avg/options"],
    queryFn: async () => {
      const res = await fetch("/api/reports/cabinet-score-avg/options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const copperCabins = central && filterOptions ? (filterOptions.copperCabins[central] ?? []) : [];
  const msanCabins = central && filterOptions ? (filterOptions.msanCabins[central] ?? []) : [];

  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/cabinet-score-avg", central, cabin, msan],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (msan) params.set("msan", msan);
      const res = await fetch(`/api/reports/cabinet-score-avg?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: CabinetAvgRow[] }>;
    },
    refetchOnMount: "always",
  });

  const sorted = useMemo(() => {
    if (!data?.data) return [];
    return [...data.data].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv), "ar")
        : String(bv).localeCompare(String(av), "ar");
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (
      sortDir === "asc"
        ? <ChevronUp className="inline w-3 h-3 ml-1" />
        : <ChevronDown className="inline w-3 h-3 ml-1" />
    ) : (
      <ChevronsUpDown className="inline w-3 h-3 ml-1 text-muted-foreground" />
    );

  const handleExportExcel = () => {
    const rows = sorted.map((r) => ({
      "السنترال": r.centralName,
      "رقم الكابينه": r.cabinNumber,
      "كود MSAN": r.msanCode ?? "—",
      "عدد الخطوط": r.lineCount,
      "خطوط مقاسة": r.measuredCount,
      "متوسط الاسكور": r.measuredCount > 0 ? r.avgScore : "لا توجد خطوط مقاسة",
      "متوسط السرعة الحالية (Kbps)": r.measuredCount > 0 ? r.avgCurrentSpeed : "",
      "متوسط أقصى سرعة (Kbps)": r.measuredCount > 0 ? r.avgMaxSpeed : "",
      "أقدم تاريخ قياس": fmtDt(r.oldestMeasTime),
      "أحدث تاريخ قياس": fmtDt(r.newestMeasTime),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "متوسط القياسات");
    XLSX.writeFile(wb, "cabinet-score-avg.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "متوسط قياسات الكباين",
      columns: ["السنترال", "الكابينه", "كود MSAN", "الخطوط", "مقاسة", "متوسط الاسكور", "متوسط السرعة الحالية", "متوسط أقصى سرعة", "أقدم قياس", "أحدث قياس"],
      rows: sorted.map((r) =>
        r.measuredCount > 0
          ? [r.centralName, r.cabinNumber, r.msanCode ?? "—", r.lineCount, r.measuredCount,
             r.avgScore ?? "—", r.avgCurrentSpeed ?? "—", r.avgMaxSpeed ?? "—",
             fmtDt(r.oldestMeasTime), fmtDt(r.newestMeasTime)]
          : [r.centralName, r.cabinNumber, r.msanCode ?? "—", r.lineCount, 0,
             "لا توجد خطوط مقاسة داخل هذه الكابينه", "", "", "لا يوجد", "لا يوجد"],
      ),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">متوسط قياسات الكباين</h3>
            {data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {sorted.length.toLocaleString("ar-EG")} كابينه — خطوط لها رقم أكونت فقط
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchableCombobox
              options={filterOptions?.centrals ?? []}
              value={central}
              onChange={(v) => { setCentral(v); setCabin(""); setMsan(""); }}
              placeholder="كل السنترالات"
              searchPlaceholder="ابحث في السنترالات..."
              className="w-full sm:w-44 text-sm"
            />
            <SearchableCombobox
              options={copperCabins}
              value={cabin}
              onChange={(v) => setCabin(v)}
              placeholder="كل الكباين النحاسية"
              searchPlaceholder="ابحث في الكباين النحاسية..."
              disabled={!central}
              className="w-full sm:w-44 text-sm"
            />
            <SearchableCombobox
              options={msanCabins}
              value={msan}
              onChange={(v) => setMsan(v)}
              placeholder="كل كباين MSAN"
              searchPlaceholder="ابحث في كباين MSAN..."
              disabled={!central}
              className="w-full sm:w-40 text-sm"
            />
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="text-green-700 border-green-200">
              تصدير Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="text-red-700 border-red-200">
              تصدير PDF
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-right text-sm" dir="rtl">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="text-right font-bold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort("centralName")}>
                    السنترال <SortIcon k="centralName" />
                  </TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort("cabinNumber")}>
                    رقم الكابينه <SortIcon k="cabinNumber" />
                  </TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort("msanCode")}>
                    كود MSAN <SortIcon k="msanCode" />
                  </TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort("lineCount")}>
                    الخطوط <SortIcon k="lineCount" />
                  </TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort("measuredCount")}>
                    مقاسة <SortIcon k="measuredCount" />
                  </TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort("avgScore")}>
                    متوسط الاسكور <SortIcon k="avgScore" />
                  </TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort("avgCurrentSpeed")}>
                    متوسط السرعة الحالية <SortIcon k="avgCurrentSpeed" />
                  </TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort("avgMaxSpeed")}>
                    متوسط أقصى سرعة <SortIcon k="avgMaxSpeed" />
                  </TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort("oldestMeasTime")}>
                    أقدم تاريخ قياس <SortIcon k="oldestMeasTime" />
                  </TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort("newestMeasTime")}>
                    أحدث تاريخ قياس <SortIcon k="newestMeasTime" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="whitespace-nowrap">{r.centralName}</TableCell>
                    <TableCell className="font-medium">{r.cabinNumber}</TableCell>
                    <TableCell className="font-mono text-xs">{r.msanCode ?? "—"}</TableCell>
                    <TableCell>{r.lineCount}</TableCell>
                    <TableCell>{r.measuredCount}</TableCell>
                    {r.measuredCount > 0 ? (
                      <>
                        <TableCell>{scoreBadge(r.avgScore)}</TableCell>
                        <TableCell>
                          {r.avgCurrentSpeed != null ? Number(r.avgCurrentSpeed).toLocaleString("ar-EG") : "—"}
                        </TableCell>
                        <TableCell>
                          {r.avgMaxSpeed != null ? Number(r.avgMaxSpeed).toLocaleString("ar-EG") : "—"}
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={3} className="text-center text-amber-600 text-xs">
                        لا توجد خطوط مقاسة داخل هذه الكابينه
                      </TableCell>
                    )}
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDt(r.oldestMeasTime)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDt(r.newestMeasTime)}</TableCell>
                  </TableRow>
                ))}
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      لا توجد بيانات — لا يوجد خطوط لها أكونت فى النطاق المحدد
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
