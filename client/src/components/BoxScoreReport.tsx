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

interface BoxAvgRow {
  centralName: string;
  cabinNumber: string;
  boxNumber: string;
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
}

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

function SortableHead<T extends string>({
  label, k, sortKey, sortDir, onSort,
}: { label: string; k: T; sortKey: T; sortDir: SortDir; onSort: (k: T) => void }) {
  return (
    <TableHead
      className="text-right font-bold whitespace-nowrap cursor-pointer select-none"
      onClick={() => onSort(k)}
    >
      {label}
      {sortKey === k ? (
        sortDir === "asc"
          ? <ChevronUp className="inline w-3 h-3 ml-1" />
          : <ChevronDown className="inline w-3 h-3 ml-1" />
      ) : (
        <ChevronsUpDown className="inline w-3 h-3 ml-1 text-muted-foreground" />
      )}
    </TableHead>
  );
}

// ── تاب الكباين ──────────────────────────────────────────────────────────────
function CabinTab({ central, cabin }: { central: string; cabin: string }) {
  const [sortKey, setSortKey] = useState<keyof CabinetAvgRow>("centralName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/cabinet-score-avg", central, cabin],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      const res = await fetch(`/api/reports/cabinet-score-avg?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: CabinetAvgRow[] }>;
    },
  });

  const sorted = useMemo(() => {
    if (!data?.data) return [];
    return [...data.data].sort((a, b) => {
      const av = a[sortKey] ?? ""; const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number")
        return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv), "ar")
        : String(bv).localeCompare(String(av), "ar");
    });
  }, [data, sortKey, sortDir]);

  const toggle = (k: keyof CabinetAvgRow) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  const H = ({ label, k }: { label: string; k: keyof CabinetAvgRow }) =>
    <SortableHead label={label} k={k} sortKey={sortKey} sortDir={sortDir} onSort={toggle} />;

  const handleExportExcel = () => {
    const rows = sorted.map((r) => ({
      "السنترال": r.centralName, "رقم الكابينه": r.cabinNumber, "كود MSAN": r.msanCode ?? "—",
      "عدد الخطوط": r.lineCount, "خطوط مقاسة": r.measuredCount,
      "متوسط الاسكور": r.measuredCount > 0 ? r.avgScore : "لا توجد خطوط مقاسة",
      "متوسط السرعة الحالية (Kbps)": r.measuredCount > 0 ? r.avgCurrentSpeed : "",
      "متوسط أقصى سرعة (Kbps)": r.measuredCount > 0 ? r.avgMaxSpeed : "",
      "أقدم تاريخ قياس": fmtDt(r.oldestMeasTime), "أحدث تاريخ قياس": fmtDt(r.newestMeasTime),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "متوسط الكباين");
    XLSX.writeFile(wb, "cabinet-score-avg.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "متوسط قياسات الكباين",
      columns: ["السنترال", "الكابينة", "كود MSAN", "الخطوط", "مقاسة", "متوسط الاسكور", "متوسط السرعة الحالية", "متوسط أقصى سرعة", "أقدم قياس", "أحدث قياس"],
      rows: sorted.map((r) =>
        r.measuredCount > 0
          ? [r.centralName, r.cabinNumber, r.msanCode ?? "—", r.lineCount, r.measuredCount,
             r.avgScore ?? "—", r.avgCurrentSpeed ?? "—", r.avgMaxSpeed ?? "—",
             fmtDt(r.oldestMeasTime), fmtDt(r.newestMeasTime)]
          : [r.centralName, r.cabinNumber, r.msanCode ?? "—", r.lineCount, 0,
             "لا توجد خطوط مقاسة", "", "", "لا يوجد", "لا يوجد"],
      ),
    });
  };

  return (
    <>
      <div className="p-3 border-b flex gap-2 justify-end">
        <p className="text-xs text-muted-foreground self-center ml-auto">
          {sorted.length.toLocaleString("ar-EG")} كابينة
        </p>
        <Button variant="outline" size="sm" onClick={handleExportExcel} className="text-green-700 border-green-200">تصدير Excel</Button>
        <Button variant="outline" size="sm" onClick={handleExportPDF} className="text-red-700 border-red-200">تصدير PDF</Button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <H label="السنترال" k="centralName" /><H label="رقم الكابينه" k="cabinNumber" />
                <H label="كود MSAN" k="msanCode" /><H label="الخطوط" k="lineCount" />
                <H label="مقاسة" k="measuredCount" /><H label="متوسط الاسكور" k="avgScore" />
                <H label="متوسط السرعة الحالية" k="avgCurrentSpeed" /><H label="متوسط أقصى سرعة" k="avgMaxSpeed" />
                <H label="أقدم تاريخ قياس" k="oldestMeasTime" /><H label="أحدث تاريخ قياس" k="newestMeasTime" />
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
                      <TableCell>{r.avgCurrentSpeed != null ? Number(r.avgCurrentSpeed).toLocaleString("ar-EG") : "—"}</TableCell>
                      <TableCell>{r.avgMaxSpeed != null ? Number(r.avgMaxSpeed).toLocaleString("ar-EG") : "—"}</TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={3} className="text-center text-amber-600 text-xs">لا توجد خطوط مقاسة داخل هذه الكابينة</TableCell>
                  )}
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDt(r.oldestMeasTime)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDt(r.newestMeasTime)}</TableCell>
                </TableRow>
              ))}
              {sorted.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">لا توجد بيانات</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

// ── تاب البكسيات ──────────────────────────────────────────────────────────────
function BoxTab({ central, cabin }: { central: string; cabin: string }) {
  const [sortKey, setSortKey] = useState<keyof BoxAvgRow>("centralName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [box, setBox] = useState("");

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ centrals: string[]; cabins: Record<string, string[]>; boxes: Record<string, string[]> }>;
    },
  });
  const boxOptions = central && cabin && filterOptions
    ? (filterOptions.boxes[`${central}||${cabin}`] ?? [])
    : [];

  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/box-score-avg", central, cabin, box],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (box) params.set("box", box);
      const res = await fetch(`/api/reports/box-score-avg?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: BoxAvgRow[] }>;
    },
  });

  const sorted = useMemo(() => {
    if (!data?.data) return [];
    return [...data.data].sort((a, b) => {
      const av = a[sortKey] ?? ""; const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number")
        return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv), "ar")
        : String(bv).localeCompare(String(av), "ar");
    });
  }, [data, sortKey, sortDir]);

  const toggle = (k: keyof BoxAvgRow) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  const H = ({ label, k }: { label: string; k: keyof BoxAvgRow }) =>
    <SortableHead label={label} k={k} sortKey={sortKey} sortDir={sortDir} onSort={toggle} />;

  const handleExportExcel = () => {
    const rows = sorted.map((r) => ({
      "السنترال": r.centralName, "رقم الكابينه": r.cabinNumber, "رقم البكس": r.boxNumber,
      "عدد الخطوط": r.lineCount, "خطوط مقاسة": r.measuredCount,
      "متوسط الاسكور": r.measuredCount > 0 ? r.avgScore : "لا توجد خطوط مقاسة",
      "متوسط السرعة الحالية (Kbps)": r.measuredCount > 0 ? r.avgCurrentSpeed : "",
      "متوسط أقصى سرعة (Kbps)": r.measuredCount > 0 ? r.avgMaxSpeed : "",
      "أقدم تاريخ قياس": fmtDt(r.oldestMeasTime), "أحدث تاريخ قياس": fmtDt(r.newestMeasTime),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "متوسط البكسيات");
    XLSX.writeFile(wb, "box-score-avg.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "متوسط قياسات البكسيات",
      columns: ["السنترال", "الكابينة", "البكس", "الخطوط", "مقاسة", "متوسط الاسكور", "متوسط السرعة الحالية", "متوسط أقصى سرعة", "أقدم قياس", "أحدث قياس"],
      rows: sorted.map((r) =>
        r.measuredCount > 0
          ? [r.centralName, r.cabinNumber, r.boxNumber, r.lineCount, r.measuredCount,
             r.avgScore ?? "—", r.avgCurrentSpeed ?? "—", r.avgMaxSpeed ?? "—",
             fmtDt(r.oldestMeasTime), fmtDt(r.newestMeasTime)]
          : [r.centralName, r.cabinNumber, r.boxNumber, r.lineCount, 0,
             "لا توجد خطوط مقاسة", "", "", "لا يوجد", "لا يوجد"],
      ),
    });
  };

  return (
    <>
      <div className="p-3 border-b flex flex-wrap gap-2 items-center justify-between">
        <p className="text-xs text-muted-foreground">{sorted.length.toLocaleString("ar-EG")} بكس</p>
        <div className="flex gap-2 flex-wrap items-center">
          <SearchableCombobox
            options={boxOptions}
            value={box}
            onChange={(v) => setBox(v)}
            placeholder="كل البكسيات"
            searchPlaceholder="ابحث في البكسيات..."
            disabled={!cabin}
            className="w-36 text-sm"
          />
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="text-green-700 border-green-200">تصدير Excel</Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} className="text-red-700 border-red-200">تصدير PDF</Button>
        </div>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <H label="السنترال" k="centralName" /><H label="رقم الكابينه" k="cabinNumber" />
                <H label="رقم البكس" k="boxNumber" /><H label="الخطوط" k="lineCount" />
                <H label="مقاسة" k="measuredCount" /><H label="متوسط الاسكور" k="avgScore" />
                <H label="متوسط السرعة الحالية" k="avgCurrentSpeed" /><H label="متوسط أقصى سرعة" k="avgMaxSpeed" />
                <H label="أقدم تاريخ قياس" k="oldestMeasTime" /><H label="أحدث تاريخ قياس" k="newestMeasTime" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r, idx) => (
                <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="whitespace-nowrap">{r.centralName}</TableCell>
                  <TableCell className="font-medium">{r.cabinNumber}</TableCell>
                  <TableCell className="font-medium">{r.boxNumber}</TableCell>
                  <TableCell>{r.lineCount}</TableCell>
                  <TableCell>{r.measuredCount}</TableCell>
                  {r.measuredCount > 0 ? (
                    <>
                      <TableCell>{scoreBadge(r.avgScore)}</TableCell>
                      <TableCell>{r.avgCurrentSpeed != null ? Number(r.avgCurrentSpeed).toLocaleString("ar-EG") : "—"}</TableCell>
                      <TableCell>{r.avgMaxSpeed != null ? Number(r.avgMaxSpeed).toLocaleString("ar-EG") : "—"}</TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={3} className="text-center text-amber-600 text-xs">لا توجد خطوط مقاسة داخل هذا البكس</TableCell>
                  )}
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDt(r.oldestMeasTime)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDt(r.newestMeasTime)}</TableCell>
                </TableRow>
              ))}
              {sorted.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">لا توجد بيانات</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

// ── المكوّن الرئيسى ───────────────────────────────────────────────────────────
export function BoxScoreReport() {
  const [activeTab, setActiveTab] = useState<"cabinet" | "box">("cabinet");
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/reports/cabinet-score-avg/options"],
    queryFn: async () => {
      const res = await fetch("/api/reports/cabinet-score-avg/options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const cabins = central && filterOptions ? (filterOptions.copperCabins[central] ?? []) : [];

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        {/* رأس الفلاتر المشتركة */}
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-base">متوسط القياسات</h3>
          <div className="flex flex-wrap items-center gap-2">
            <SearchableCombobox
              options={filterOptions?.centrals ?? []}
              value={central}
              onChange={(v) => { setCentral(v); setCabin(""); }}
              placeholder="كل السنترالات"
              searchPlaceholder="ابحث في السنترالات..."
              className="w-full sm:w-44 text-sm"
            />
            <SearchableCombobox
              options={cabins}
              value={cabin}
              onChange={(v) => setCabin(v)}
              placeholder="كل الكباين"
              searchPlaceholder="ابحث في الكباين..."
              disabled={!central}
              className="w-full sm:w-40 text-sm"
            />
          </div>
        </div>

        {/* تبويبات الكباين / البكسيات */}
        <div className="flex border-b bg-muted/30">
          {(["cabinet", "box"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t
                  ? "border-blue-600 text-blue-700 bg-white"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "cabinet" ? "الكباين" : "البكسيات"}
            </button>
          ))}
        </div>

        {activeTab === "cabinet"
          ? <CabinTab central={central} cabin={cabin} />
          : <BoxTab central={central} cabin={cabin} />}
      </Card>
    </div>
  );
}
