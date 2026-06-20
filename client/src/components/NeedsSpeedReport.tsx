import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronRight, ChevronLeft, Loader2, Radar, X } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

const DZS_URL = "https://10.42.187.101:8080/expresse/";
const buildDZSUrl = (accounts: string[]) =>
  `${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}`;

interface SpeedLine {
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
  lineCurrentSpeed: string | null;
  lineMaxSpeed: string | null;
  lastMeasScore: number | null;
  complaintNo: string | null;
  complaintTime: string | null;
}

interface FilterOptions {
  centrals: string[];
  cabins: Record<string, string[]>;
  boxes: Record<string, string[]>;
}

const PAGE_SIZE = 50;

const scoreBadge = (v: number | null | undefined) => {
  if (v == null) return <span className="text-gray-400">-</span>;
  const n = Number(v);
  const cls =
    n > 33 ? "bg-red-100 text-red-800" :
    n > 15 ? "bg-amber-100 text-amber-700" :
             "bg-green-100 text-green-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{n}</span>;
};

const fmtDate = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())}`;
};

interface NeedsSpeedReportProps {
  /** تقرير 2: فقط الأرقام التى لها شكوى خلال آخر شهر. بدونها (تقرير 4): الكل. */
  requireComplaint?: boolean;
  title?: string;
}

export function NeedsSpeedReport({ requireComplaint = false, title }: NeedsSpeedReportProps) {
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
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    if (requireComplaint) params.set("requireComplaint", "1");
    return params;
  };

  const { data, isLoading } = useQuery({
    queryKey: ["/api/phone-lines/needs-speed", central, cabin, box, page, requireComplaint],
    queryFn: async () => {
      const res = await fetch(`/api/phone-lines/needs-speed?${buildParams()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: SpeedLine[]; total: number }>;
    },
  });

  const cabins = central && filterOptions ? (filterOptions.cabins[central] ?? []) : [];
  const boxes = central && cabin && filterOptions ? (filterOptions.boxes[`${central}||${cabin}`] ?? []) : [];

  const openDZSSingle = (r: SpeedLine) => {
    if (!r.accountNo) { alert("لا يوجد رقم أكونت لهذا الخط"); return; }
    window.open(buildDZSUrl([String(r.accountNo).trim()]), "_blank");
  };

  // قياس DZS للنطاق المحدد — يفتح كل أرقام الأكونت فى تاب واحد والسكريبت يتولّى التقسيم لدفعات
  const handleMeasureDZS = async () => {
    const w = window.open("about:blank", "dzs_measure");
    setDzsLoading(true);
    setDzsCount(null);
    try {
      const res = await fetch(`/api/phone-lines/needs-speed?${buildParams(true)}`, { credentials: "include" });
      const json = await res.json();
      const all = (json.data as SpeedLine[]) ?? [];
      const seen = new Set<string>();
      const accounts = all
        .map((r) => (r.accountNo ?? "").toString().trim())
        .filter((a) => a && !seen.has(a) && seen.add(a));
      if (accounts.length === 0) { try { w?.close(); } catch {} alert("لا توجد أرقام أكونت فى النطاق المحدد"); return; }
      if (w) w.location.href = buildDZSUrl(accounts);
      setDzsCount(accounts.length);
    } catch {
      try { w?.close(); } catch {}
      alert("تعذّر تحميل بيانات النطاق للقياس");
    } finally {
      setDzsLoading(false);
    }
  };

  const handleExport = async () => {
    const res = await fetch(`/api/phone-lines/needs-speed?${buildParams(true)}`, { credentials: "include" });
    const json = await res.json();
    const rows = (json.data as SpeedLine[]).map((r) => ({
      "رقم التليفون الكامل": r.fullPhone,
      "رقم الأكونت": r.accountNo ?? "",
      "الاسكور": r.lastMeasScore ?? "",
      "السرعة الحالية": r.lineCurrentSpeed ?? "",
      "أقصى سرعة": r.lineMaxSpeed ?? "",
      "رقم الشكوى": r.complaintNo ?? "",
      "تاريخ الشكوى": fmtDate(r.complaintTime),
      "السنترال": r.central,
      "رقم الكابينه": r.cabinNumber,
      "رقم البكس": r.boxNumber,
      "رقم التليفون": r.telNo,
      "DP Terminal": r.dpTerminal,
      "Port": r.port,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "محتاجة رفع سرعة");
    XLSX.writeFile(wb, "needs-speed-report.xlsx");
  };

  const handleExportPDF = async () => {
    const res = await fetch(`/api/phone-lines/needs-speed?${buildParams(true)}`, { credentials: "include" });
    const json = await res.json();
    const all = json.data as SpeedLine[];
    printTablePDF({
      title: title ?? "أرقام محتاجة رفع سرعة",
      columns: ["#", "التليفون الكامل", "الأكونت", "الاسكور", "سرعة حالية", "أقصى سرعة", "رقم الشكوى", "السنترال", "الكابينه", "البكس"],
      rows: all.map((r, i) => [i + 1, r.fullPhone, r.accountNo ?? "", r.lastMeasScore ?? "",
        r.lineCurrentSpeed ?? "", r.lineMaxSpeed ?? "", r.complaintNo ?? "", r.central, r.cabinNumber, r.boxNumber]),
    });
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">{title ?? "أرقام محتاجة رفع سرعة"}</h3>
            {data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.total.toLocaleString("ar-EG")} سجل
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              placeholder="كل الكابينات"
              searchPlaceholder="ابحث في الكابينات..."
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
            <Button variant="outline" size="sm" onClick={handleMeasureDZS} className="text-blue-700 border-blue-200 gap-1">
              <Radar className="w-4 h-4" /> قياس DZS
            </Button>
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
                    <TableHead className="text-right font-bold whitespace-nowrap">الاسكور</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">السرعة الحالية</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">أقصى سرعة</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الشكوى</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">تاريخ الشكوى</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الكابينه</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم البكس</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">DP Terminal</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Port</TableHead>
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
                      <TableCell>{scoreBadge(r.lastMeasScore)}</TableCell>
                      <TableCell className="font-mono">{r.lineCurrentSpeed ?? "-"}</TableCell>
                      <TableCell className="font-mono">{r.lineMaxSpeed ?? "-"}</TableCell>
                      <TableCell className="font-mono">{r.complaintNo ?? "-"}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(r.complaintTime)}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.central || "-"}</TableCell>
                      <TableCell className="font-medium">{r.cabinNumber || "-"}</TableCell>
                      <TableCell className="font-medium">{r.boxNumber || "-"}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{r.telNo || "-"}</TableCell>
                      <TableCell>{r.dpTerminal || "-"}</TableCell>
                      <TableCell>{r.port || "-"}</TableCell>
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
