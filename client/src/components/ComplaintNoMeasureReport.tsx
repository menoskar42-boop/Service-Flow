import { useState } from "react";
import { useSpeedToolsVisible, useIsSuperAdmin } from "@/lib/use-speed-tools";
import { useSpeedToolSource } from "@/hooks/use-speed-tool-source";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronRight, ChevronLeft, Loader2, Radar, X, Gauge } from "lucide-react";
import { openProfileOptimization } from "@/lib/profile-optimization";
import { dispatchSpeedTool } from "@/lib/exec-queue";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

const DZS_URL = "https://10.42.187.101:8080/expresse/";
const buildDZSUrl = (accounts: string[]) =>
  `${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}`;

interface Row {
  id: number;
  telNo: string;
  central: string;
  iduNo: string;
  oduNo: string;
  cabinNumber: string;
  boxNumber: string;
  dpTerminal: string;
  port: string;
  len: string;
  fullPhone: string;
  accountNo: string | null;
  accountSource: string | null;
  complaintTime: string | null;
  lineCurrentSpeed: string | null;
  lineMaxSpeed: string | null;
  lastMeasScore: number | null;
  lastMeasTime: string | null;
  lastPoRaiseAt: string | null;
  lastPoStopAt: string | null;
}

interface FilterOptions {
  centrals: string[];
  cabins: Record<string, string[]>;
  boxes: Record<string, string[]>;
}

const PAGE_SIZE = 50;

const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())}`;
};
const fmtPoDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};
const scoreBadge = (v: number | null | undefined) => {
  if (v == null) return <span className="text-gray-400">-</span>;
  const n = Number(v);
  const cls =
    n > 33 ? "bg-red-100 text-red-800" :
    n > 15 ? "bg-amber-100 text-amber-700" :
             "bg-green-100 text-green-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{n}</span>;
};

export function ComplaintNoMeasureReport() {
  const showSpeedTools = useSpeedToolsVisible();
  const isSuper = useIsSuperAdmin();
  useSpeedToolSource("شكوى بدون قياس");
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(todayStr());
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [box, setBox] = useState("");
  const [page, setPage] = useState(1);
  const [dzsLoading, setDzsLoading] = useState(false);
  const [dzsCount, setDzsCount] = useState<number | null>(null);

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const buildParams = (forExport = false) => {
    const params = new URLSearchParams(
      forExport ? { page: "1", limit: "20000" } : { page: String(page), limit: String(PAGE_SIZE) },
    );
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    return params;
  };

  const { data, isLoading } = useQuery({
    queryKey: ["/api/reports/complaint-no-measure", dateFrom, dateTo, central, cabin, box, page],
    queryFn: async () => {
      const res = await fetch(`/api/reports/complaint-no-measure?${buildParams()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: Row[]; total: number }>;
    },
  });

  const cabins = central && filterOptions ? (filterOptions.cabins[central] ?? []) : [];
  const boxes = central && cabin && filterOptions ? (filterOptions.boxes[`${central}||${cabin}`] ?? []) : [];

  const openDZSSingle = async (r: Row) => {
    if (!r.accountNo) { alert("لا يوجد رقم أكونت لهذا الخط"); return; }
    if (await dispatchSpeedTool("measure", [String(r.accountNo).trim()], isSuper)) return;
    window.open(buildDZSUrl([String(r.accountNo).trim()]), "dzs_measure");
  };

  const handleMeasureDZS = async () => {
    const w = window.open("about:blank", "dzs_measure");
    setDzsLoading(true);
    setDzsCount(null);
    try {
      const res = await fetch(`/api/reports/complaint-no-measure?${buildParams(true)}`, { credentials: "include" });
      const json = await res.json();
      const all = (json.data as Row[]) ?? [];
      const seen = new Set<string>();
      const accounts = all
        .map((r) => (r.accountNo ?? "").toString().trim())
        .filter((a) => a && !seen.has(a) && seen.add(a));
      if (accounts.length === 0) { try { w?.close(); } catch {} alert("لا توجد أرقام أكونت فى النطاق المحدد"); return; }
      if (await dispatchSpeedTool("measure", accounts, isSuper)) { try { w?.close(); } catch {} return; }
      if (w) w.location.href = buildDZSUrl(accounts);
      setDzsCount(accounts.length);
    } catch {
      try { w?.close(); } catch {}
      alert("تعذّر تحميل بيانات النطاق للقياس");
    } finally {
      setDzsLoading(false);
    }
  };

  const handleRaisePO = async (kind: "raise" | "stop") => {
    const afterStop = kind === "raise"
      ? window.confirm("رفع السرعة والإيقاف؟\n\nموافق = رفع السرعة لكل الأرقام ثم إيقاف الـ Nightly الناتج لكلهم\nإلغاء = رفع السرعة فقط")
      : false;
    setDzsLoading(true);
    try {
      const res = await fetch(`/api/reports/complaint-no-measure?${buildParams(true)}`, { credentials: "include" });
      const json = await res.json();
      const all = (json.data as Row[]) ?? [];
      const seen = new Set<string>();
      const accounts = all
        .map((r) => (r.accountNo ?? "").toString().trim())
        .filter((a) => a && !seen.has(a) && seen.add(a));
      if (accounts.length === 0) { alert("لا توجد أرقام أكونت فى النطاق المحدد"); return; }
      if (await dispatchSpeedTool(kind === "stop" ? "stop" : "raise", accounts, isSuper)) return;
      openProfileOptimization(accounts, kind === "stop" ? { stopOnly: true } : { afterStop });
    } catch {
      alert("تعذّر تحميل بيانات النطاق");
    } finally {
      setDzsLoading(false);
    }
  };

  const handleExport = async () => {
    const res = await fetch(`/api/reports/complaint-no-measure?${buildParams(true)}`, { credentials: "include" });
    const json = await res.json();
    const rows = (json.data as Row[]).map((r) => ({
      "رقم التليفون الكامل": r.fullPhone,
      "رقم الأكونت": r.accountNo ?? "",
      "تاريخ الشكوى": fmtDate(r.complaintTime),
      "آخر قياس": fmtDate(r.lastMeasTime),
      "الاسكور": r.lastMeasScore ?? "",
      "السرعة الحالية": r.lineCurrentSpeed ?? "",
      "أقصى سرعة": r.lineMaxSpeed ?? "",
      "السنترال": r.central,
      "رقم الكابينه": r.cabinNumber,
      "رقم البكس": r.boxNumber,
      "رقم التليفون": r.telNo,
      "DP Terminal": r.dpTerminal,
      "آخر رفع سرعة": fmtPoDt(r.lastPoRaiseAt),
      "آخر إيقاف PO": fmtPoDt(r.lastPoStopAt),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "شكوى بدون قياس");
    XLSX.writeFile(wb, "complaint-no-measure-report.xlsx");
  };

  const handleExportPDF = async () => {
    const res = await fetch(`/api/reports/complaint-no-measure?${buildParams(true)}`, { credentials: "include" });
    const json = await res.json();
    const all = json.data as Row[];
    printTablePDF({
      title: `شكاوى بدون قياس بعدها (${dateFrom} → ${dateTo})`,
      columns: ["#", "التليفون الكامل", "الأكونت", "تاريخ الشكوى", "آخر قياس", "الاسكور", "السنترال", "الكابينه", "البكس"],
      rows: all.map((r, i) => [i + 1, r.fullPhone, r.accountNo ?? "", fmtDate(r.complaintTime), fmtDate(r.lastMeasTime),
        r.lastMeasScore ?? "", r.central, r.cabinNumber, r.boxNumber]),
    });
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">شكاوى منتظمة بدون قياس بعدها (لها أكونت)</h3>
            {data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.total.toLocaleString("ar-EG")} سجل
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">من</span>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-9 w-36 text-sm" />
              <span className="text-xs text-muted-foreground">إلى</span>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-9 w-36 text-sm" />
            </div>
            <SearchableCombobox
              options={filterOptions?.centrals ?? []}
              value={central}
              onChange={(v) => { setCentral(v); setCabin(""); setBox(""); setPage(1); }}
              placeholder="كل السنترالات"
              searchPlaceholder="ابحث في السنترالات..."
              className="w-full sm:w-44 text-sm"
            />
            <SearchableCombobox
              options={cabins}
              value={cabin}
              onChange={(v) => { setCabin(v); setBox(""); setPage(1); }}
              placeholder="كل الكباين"
              searchPlaceholder="ابحث في الكباين..."
              disabled={!central}
              className="w-full sm:w-40 text-sm"
            />
            <SearchableCombobox
              options={boxes}
              value={box}
              onChange={(v) => { setBox(v); setPage(1); }}
              placeholder="كل البكسيات"
              searchPlaceholder="ابحث في البكسيات..."
              disabled={!cabin}
              className="w-full sm:w-36 text-sm"
            />
            {showSpeedTools && (<>
            <Button variant="outline" size="sm" onClick={handleMeasureDZS} className="text-blue-700 border-blue-200 gap-1">
              <Radar className="w-4 h-4" /> قياس DZS
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleRaisePO("raise")} className="text-emerald-700 border-emerald-200 gap-1" title="رفع السرعة (Profile Optimization) لأرقام النطاق المحدد">
              <Gauge className="w-4 h-4" /> رفع سرعة
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleRaisePO("stop")} className="text-orange-700 border-orange-200 gap-1" title="إيقاف الـ Nightly PO فقط لأرقام النطاق المحدد">
              <Gauge className="w-4 h-4" /> إيقاف PO
            </Button>
            </>)}
            <RefreshButton />
            <Button variant="outline" size="sm" onClick={handleExport} className="text-green-700 border-green-200">
              تصدير Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="text-red-700 border-red-200">
              تصدير PDF
            </Button>
          </div>
        </div>

        {dzsCount != null && (
          <div className="px-4 py-2 border-b bg-blue-50 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-blue-700 font-semibold">
              فُتح قياس DZS لـ {dzsCount} رقم — السكريبت بيقيس على دفعات ويرفع النتائج لشيت 138 تلقائياً.
            </span>
            <button onClick={() => setDzsCount(null)} className="text-gray-400 hover:text-gray-600 mr-auto" title="إغلاق">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {isLoading || dzsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون الكامل</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الأكونت</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">تاريخ الشكوى</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">آخر قياس</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">الاسكور</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">السرعة الحالية</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">أقصى سرعة</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الكابينه</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم البكس</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">DP Terminal</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">آخر رفع سرعة</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">آخر إيقاف PO</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((r, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono font-semibold text-blue-700">{r.fullPhone || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left font-mono">
                        <span className="inline-flex items-center gap-1">
                          {r.accountNo ?? "-"}
                          {r.accountNo && (
                            <button
                              type="button"
                              onClick={() => openDZSSingle(r)}
                              title="فتح DZS وقياس هذا الرقم"
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <Radar className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(r.complaintTime)}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(r.lastMeasTime)}</TableCell>
                      <TableCell>{scoreBadge(r.lastMeasScore)}</TableCell>
                      <TableCell className="font-mono">{r.lineCurrentSpeed ?? "-"}</TableCell>
                      <TableCell className="font-mono">{r.lineMaxSpeed ?? "-"}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.central || "-"}</TableCell>
                      <TableCell className="font-medium">{r.cabinNumber || "-"}</TableCell>
                      <TableCell className="font-medium">{r.boxNumber || "-"}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{r.telNo || "-"}</TableCell>
                      <TableCell>{r.dpTerminal || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left text-xs whitespace-nowrap text-emerald-700">{fmtPoDt(r.lastPoRaiseAt)}</TableCell>
                      <TableCell dir="ltr" className="text-left text-xs whitespace-nowrap text-orange-700">{fmtPoDt(r.lastPoStopAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="p-4 border-t flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronRight className="w-4 h-4 ml-1" />
                  السابق
                </Button>
                <span className="text-sm text-muted-foreground">صفحة {page} من {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  التالي
                  <ChevronLeft className="w-4 h-4 mr-1" />
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
