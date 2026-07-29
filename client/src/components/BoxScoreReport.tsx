import { useState, useMemo } from "react";
import { useSpeedToolsVisible, useIsSuperAdmin } from "@/lib/use-speed-tools";
import { useSpeedToolSource } from "@/hooks/use-speed-tool-source";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ChevronUp, ChevronDown, ChevronsUpDown, Radar, Wrench, List, X } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { dispatchSpeedTool } from "@/lib/exec-queue";
import { MaintBoxDetail, maintStatusBadge, type MaintRow } from "@/components/MaintenanceComprehensiveReport";
import { WithAccountReport } from "@/components/WithAccountReport";

const DZS_URL = "https://10.42.187.101:8080/expresse/";
const buildDZSUrl = (accounts: string[]) =>
  `${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}`;

// يجيب أرقام الأكونت لخطوط نطاق معيّن ويفتح بوابة DZS لقياسها
async function measureAccountsFor(params: URLSearchParams, isSuper: boolean): Promise<number> {
  params.set("page", "1"); params.set("limit", "20000");
  const w = window.open("about:blank", "dzs_measure");
  try {
    const res = await fetch(`/api/phone-lines/with-account?${params}`, { credentials: "include" });
    const json = await res.json();
    const accounts = [...new Set(
      ((json.data as any[]) ?? []).map((r) => (r.accountNo ?? "").toString().trim()).filter(Boolean),
    )];
    if (!accounts.length) { try { w?.close(); } catch {} alert("لا توجد أرقام أكونت لقياسها فى هذا النطاق"); return 0; }
    if (await dispatchSpeedTool("measure", accounts, isSuper)) { try { w?.close(); } catch {} return 0; }
    if (w) w.location.href = buildDZSUrl(accounts);
    return accounts.length;
  } catch {
    try { w?.close(); } catch {}
    alert("تعذّر تحميل أرقام الأكونت للقياس");
    return 0;
  }
}

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
  withAccountCount: number;
  measuredCount: number;
  noAccountCount: number;
  undeterminedCount: number;
  avgScore: number | null;
  avgCurrentSpeed: number | null;
  avgMaxSpeed: number | null;
  oldestMeasTime: string | null;
  newestMeasTime: string | null;
  hasOpenTicket?: boolean;
}

interface FilterOptions {
  centrals: string[];
  copperCabins: Record<string, string[]>;
  msanCabins: Record<string, string[]>;
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
function CabinTab({ central, cabin, msan, minScore }: { central: string; cabin: string; msan: string; minScore: string }) {
  const [sortKey, setSortKey] = useState<keyof CabinetAvgRow>("centralName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
    const threshold = minScore !== "" ? Number(minScore) : null;
    let arr = [...data.data];
    if (threshold != null && !isNaN(threshold)) {
      arr = arr.filter((r) => r.avgScore != null && r.avgScore > threshold);
    }
    return arr.sort((a, b) => {
      const av = a[sortKey] ?? ""; const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number")
        return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv), "ar")
        : String(bv).localeCompare(String(av), "ar");
    });
  }, [data, sortKey, sortDir, minScore]);

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
      columns: ["السنترال", "الكابينه", "كود MSAN", "الخطوط", "مقاسة", "متوسط الاسكور", "متوسط السرعة الحالية", "متوسط أقصى سرعة", "أقدم قياس", "أحدث قياس"],
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
          {sorted.length.toLocaleString("ar-EG")} كابينه
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
                    <TableCell colSpan={3} className="text-center text-amber-600 text-xs">لا توجد خطوط مقاسة داخل هذه الكابينه</TableCell>
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
function BoxTab({ central, cabin, minScore }: { central: string; cabin: string; minScore: string }) {
  const showSpeedTools = useSpeedToolsVisible();
  const isSuper = useIsSuperAdmin();
  useSpeedToolSource("متوسط قياس البكس");
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
    refetchOnMount: "always",
  });

  // البكسيات اللى لها تذكرة عطل شبكة أرضية مفتوحة (من بروكسى CFM) — لتحديد عمود "تذكرة مفتوحة"
  const { data: openTickets } = useQuery({
    queryKey: ["/api/proxy/cfm-open-ticket-lines"],
    queryFn: async () => {
      const res = await fetch("/api/proxy/cfm-open-ticket-lines", { credentials: "include" });
      if (!res.ok) return { lines: [] };
      return res.json() as Promise<{ lines: { central: string; cabinNumber: string; boxNumber: string }[] }>;
    },
    refetchOnMount: "always",
  });
  const openTicketSet = useMemo(() => {
    const s = new Set<string>();
    for (const l of openTickets?.lines ?? []) s.add(`${l.central}|${l.cabinNumber}|${l.boxNumber}`);
    return s;
  }, [openTickets]);

  // بيانات الصيانة من الموقع المنفصل (مطابقة بالسنترال|الكابينة|البكس بعد إزالة المسافات)
  const mkey = (c: string, cab: string, b: string) =>
    `${(c ?? "").trim()}|${String(cab ?? "").replace(/\s/g, "")}|${String(b ?? "").replace(/\s/g, "").trim()}`;
  const { data: maintData } = useQuery({
    queryKey: ["/api/proxy/maintenance-comprehensive"],
    queryFn: async () => {
      const res = await fetch("/api/proxy/maintenance-comprehensive", { credentials: "include" });
      if (!res.ok) return { data: [] as MaintRow[] };
      return res.json() as Promise<{ data: MaintRow[] }>;
    },
    refetchOnMount: "always",
  });
  const maintMap = useMemo(() => {
    const m = new Map<string, MaintRow>();
    for (const r of maintData?.data ?? []) m.set(mkey(r.central, r.cabin_number, r.box_number), r);
    return m;
  }, [maintData]);
  const [maintDetail, setMaintDetail] = useState<MaintRow | null>(null);
  const [linesBox, setLinesBox] = useState<BoxAvgRow | null>(null); // نافذة خطوط البكس (خطوط لها أكونت)

  const [dzsBox, setDzsBox] = useState<string | null>(null);
  const measureBox = async (r: BoxAvgRow) => {
    setDzsBox(`${r.cabinNumber}/${r.boxNumber}`);
    const p = new URLSearchParams();
    p.set("central", r.centralName); p.set("cabin", r.cabinNumber); p.set("box", r.boxNumber);
    await measureAccountsFor(p, isSuper);
    setTimeout(() => setDzsBox(null), 1500);
  };
  const measureAll = async () => {
    const p = new URLSearchParams();
    if (central) p.set("central", central);
    if (cabin) p.set("cabin", cabin);
    if (box) p.set("box", box);
    if (!central && !cabin && !box) {
      if (!confirm("هتفتح قياس DZS لكل الخطوط اللى لها أكونت فى كل السنترالات — متأكد؟")) return;
    }
    await measureAccountsFor(p, isSuper);
  };

  const sorted = useMemo(() => {
    if (!data?.data) return [];
    const threshold = minScore !== "" ? Number(minScore) : null;
    let arr = data.data.map((r) => ({ ...r, hasOpenTicket: openTicketSet.has(`${r.centralName}|${r.cabinNumber}|${r.boxNumber}`) }));
    if (threshold != null && !isNaN(threshold)) {
      arr = arr.filter((r) => r.avgScore != null && r.avgScore > threshold);
    }
    return arr.sort((a, b) => {
      const av = a[sortKey] ?? ""; const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number")
        return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv), "ar")
        : String(bv).localeCompare(String(av), "ar");
    });
  }, [data, sortKey, sortDir, minScore]);

  const toggle = (k: keyof BoxAvgRow) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  const H = ({ label, k }: { label: string; k: keyof BoxAvgRow }) =>
    <SortableHead label={label} k={k} sortKey={sortKey} sortDir={sortDir} onSort={toggle} />;

  const handleExportExcel = () => {
    const rows = sorted.map((r) => ({
      "السنترال": r.centralName, "رقم الكابينه": r.cabinNumber, "رقم البكس": r.boxNumber,
      "عدد الخطوط": r.lineCount, "لها أكونت": r.withAccountCount, "خطوط مقاسة": r.measuredCount,
      "بدون أكونت": r.noAccountCount, "لم يُحدَّد": r.undeterminedCount,
      "تذكرة أرضية مفتوحة": r.hasOpenTicket ? "نعم" : "لا",
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
      columns: ["السنترال", "الكابينه", "البكس", "الخطوط", "لها أكونت", "مقاسة", "بدون أكونت", "لم يُحدَّد", "تذكرة أرضية", "متوسط الاسكور", "متوسط السرعة الحالية", "متوسط أقصى سرعة", "أقدم قياس", "أحدث قياس"],
      rows: sorted.map((r) =>
        r.measuredCount > 0
          ? [r.centralName, r.cabinNumber, r.boxNumber, r.lineCount, r.withAccountCount, r.measuredCount,
             r.noAccountCount, r.undeterminedCount, r.hasOpenTicket ? "نعم" : "لا",
             r.avgScore ?? "—", r.avgCurrentSpeed ?? "—", r.avgMaxSpeed ?? "—",
             fmtDt(r.oldestMeasTime), fmtDt(r.newestMeasTime)]
          : [r.centralName, r.cabinNumber, r.boxNumber, r.lineCount, r.withAccountCount, 0,
             r.noAccountCount, r.undeterminedCount, r.hasOpenTicket ? "نعم" : "لا",
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
          {showSpeedTools && (
          <Button variant="outline" size="sm" onClick={measureAll} className="text-blue-700 border-blue-200 gap-1">
            <Radar className="w-4 h-4" /> قياس الكل
          </Button>
          )}
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
                <H label="رقم البكس" k="boxNumber" /><H label="عدد الخطوط" k="lineCount" />
                <H label="لها أكونت" k="withAccountCount" /><H label="مقاسة" k="measuredCount" />
                <H label="بدون أكونت" k="noAccountCount" /><H label="لم يُحدَّد" k="undeterminedCount" />
                <TableHead className="text-right font-bold whitespace-nowrap">تذكرة أرضية</TableHead>
                <TableHead className="text-right font-bold whitespace-nowrap">حالة الصيانة</TableHead>
                <H label="متوسط الاسكور" k="avgScore" />
                <H label="متوسط السرعة الحالية" k="avgCurrentSpeed" /><H label="متوسط أقصى سرعة" k="avgMaxSpeed" />
                <H label="أقدم تاريخ قياس" k="oldestMeasTime" /><H label="أحدث تاريخ قياس" k="newestMeasTime" />
                <TableHead className="text-right font-bold whitespace-nowrap">قياس</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r, idx) => (
                <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="whitespace-nowrap">{r.centralName}</TableCell>
                  <TableCell className="font-medium">{r.cabinNumber}</TableCell>
                  <TableCell className="font-medium">{r.boxNumber}</TableCell>
                  <TableCell>{r.lineCount}</TableCell>
                  <TableCell className="text-green-700 font-medium">{r.withAccountCount}</TableCell>
                  <TableCell>{r.measuredCount}</TableCell>
                  <TableCell className="text-orange-600">{r.noAccountCount}</TableCell>
                  <TableCell className="text-gray-500">{r.undeterminedCount}</TableCell>
                  <TableCell>
                    {r.hasOpenTicket
                      ? <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">نعم</span>
                      : <span className="text-xs text-gray-400">لا</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {(() => {
                      const m = maintMap.get(mkey(r.centralName, r.cabinNumber, r.boxNumber));
                      if (!m) return <span className="text-xs text-gray-400">—</span>;
                      return (
                        <span className="inline-flex items-center gap-1">
                          {maintStatusBadge(m.maintenance_status, m.maintenance_status_ar)}
                          <button
                            type="button"
                            onClick={() => setMaintDetail(m)}
                            title="تفاصيل ما تم فى الصيانة"
                            className="text-purple-600 hover:text-purple-800"
                          >
                            <Wrench className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      );
                    })()}
                  </TableCell>
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
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setLinesBox(r)}
                        title="عرض خطوط هذا البكس اللى لها أكونت (نفس أعمدة تقرير خطوط لها أكونت)"
                        className="text-purple-600 hover:text-purple-800"
                      >
                        <List className="w-4 h-4" />
                      </button>
                      {showSpeedTools && (
                      <button
                        type="button"
                        onClick={() => measureBox(r)}
                        disabled={r.withAccountCount === 0}
                        title={r.withAccountCount > 0 ? "قياس DZS لكل خطوط البكس اللى لها أكونت" : "لا توجد خطوط لها أكونت"}
                        className="text-blue-600 hover:text-blue-800 disabled:opacity-30"
                      >
                        {dzsBox === `${r.cabinNumber}/${r.boxNumber}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
                      </button>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {sorted.length === 0 && (
                <TableRow><TableCell colSpan={16} className="text-center text-muted-foreground py-8">لا توجد بيانات</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {maintDetail && <MaintBoxDetail row={maintDetail} onClose={() => setMaintDetail(null)} />}
      {linesBox && (
        <div className="fixed inset-0 z-[9998] bg-black/50 flex items-start justify-center p-3 overflow-auto" onClick={() => setLinesBox(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-[1400px] my-4" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b bg-purple-50">
              <h3 className="font-bold text-sm">خطوط لها أكونت — {linesBox.centralName} / كابينة {linesBox.cabinNumber} / بكس {linesBox.boxNumber}</h3>
              <button onClick={() => setLinesBox(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-2">
              <WithAccountReport initialCentral={linesBox.centralName} initialCabin={linesBox.cabinNumber} initialBox={linesBox.boxNumber} />
            </div>
          </div>
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
  const [msan, setMsan] = useState("");
  const [minScore, setMinScore] = useState("");

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/reports/cabinet-score-avg/options"],
    queryFn: async () => {
      const res = await fetch("/api/reports/cabinet-score-avg/options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const copperCabins = central && filterOptions ? (filterOptions.copperCabins[central] ?? []) : [];
  const msanCabins   = central && filterOptions ? (filterOptions.msanCabins[central]   ?? []) : [];

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
            {activeTab === "cabinet" && (
              <SearchableCombobox
                options={msanCabins}
                value={msan}
                onChange={(v) => setMsan(v)}
                placeholder="كل كباين MSAN"
                searchPlaceholder="ابحث في كباين MSAN..."
                disabled={!central}
                className="w-full sm:w-40 text-sm"
              />
            )}
            <input
              type="number"
              min={0}
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              placeholder="الاسكور أكبر من"
              className="w-36 border border-gray-200 rounded-md px-2 py-1.5 text-sm text-right bg-white"
              dir="rtl"
            />
            <RefreshButton />
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
              {t === "cabinet" ? "الكابينه" : "البكسيات"}
            </button>
          ))}
        </div>

        {activeTab === "cabinet"
          ? <CabinTab central={central} cabin={cabin} msan={msan} minScore={minScore} />
          : <BoxTab central={central} cabin={cabin} minScore={minScore} />}
      </Card>
    </div>
  );
}
