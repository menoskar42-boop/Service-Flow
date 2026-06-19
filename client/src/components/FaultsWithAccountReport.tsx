import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Radar } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

const DZS_URL = "https://10.42.187.101:8080/expresse/";

interface FaultRow {
  ticketId: string;
  centralName: string;
  phoneShort: string;
  accountNo: string;
  statusCode: string;
  msanCode: string | null;
  cabinetNo: string | null;
  boxNo: string | null;
  dpTerminal: string | null;
  complainTime: string | null;
  complainTypeName: string | null;
  workerCode: string | null;
  techName: string | null;
  voiceStatus: string | null;
  dataStatus: string | null;
  portNumber: string | null;
  lastCurrentSpeed: string | null;
  lastMaxSpeed: string | null;
  lastScore: string | null;
  lastMeasTime: string | null;
  lastMeasComplainNo: string | null;
}

interface FilterOptions {
  centrals: string[];
  cabins: Record<string, string[]>;
  boxes: Record<string, string[]>;
}

const scoreBadge = (v: string | null) => {
  if (!v) return <span className="text-gray-400">—</span>;
  const n = Number(v);
  const cls =
    n >= 70 ? "bg-green-100 text-green-800" :
    n >= 40 ? "bg-amber-100 text-amber-700" :
              "bg-red-100 text-red-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{v}</span>;
};

const fmtTime = (t: string | null) => {
  if (!t) return "—";
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  return d.toLocaleString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export function FaultsWithAccountReport() {
  const [central, setCentral] = useState("");
  const [q, setQ] = useState("");
  const [searchQ, setSearchQ] = useState("");

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["/api/reports/faults-with-account", central, searchQ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (central) params.set("central", central);
      if (searchQ) params.set("q", searchQ);
      const res = await fetch(`/api/reports/faults-with-account?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<FaultRow[]>;
    },
  });

  const openDZS = (r: FaultRow) => {
    const url = `${DZS_URL}#sf_accounts=${encodeURIComponent(r.accountNo)}&sf_meta=${encodeURIComponent([r.accountNo, r.ticketId, r.phoneShort, "88" + r.phoneShort].join("~"))}`;
    window.open(url, "_blank");
  };

  const handleMeasureAll = () => {
    if (rows.length === 0) { alert("لا توجد سجلات"); return; }
    if (rows.length > 150 && !confirm(`سيتم فتح DZS لقياس ${rows.length} رقم — متأكد؟`)) return;
    const seen = new Set<string>();
    const accounts = rows.filter((r) => r.accountNo && !seen.has(r.accountNo) && seen.add(r.accountNo));
    const accs = accounts.map((r) => r.accountNo);
    const meta = accounts.map((r) => [r.accountNo, r.ticketId, r.phoneShort, "88" + r.phoneShort].join("~")).join(";");
    window.open(`${DZS_URL}#sf_accounts=${encodeURIComponent(accs.join(","))}&sf_meta=${encodeURIComponent(meta)}`, "_blank");
  };

  const handleExportExcel = () => {
    const data = rows.map((r) => ({
      "رقم التذكرة": r.ticketId,
      "السنترال": r.centralName,
      "رقم التليفون": r.phoneShort,
      "رقم الأكونت": r.accountNo,
      "الكابينة": r.cabinetNo ?? "",
      "البكس": r.boxNo ?? "",
      "الكود": r.statusCode,
      "السرعة الحالية": r.lastCurrentSpeed ?? "",
      "أقصى سرعة": r.lastMaxSpeed ?? "",
      "الاسكور": r.lastScore ?? "",
      "وقت القياس": r.lastMeasTime ?? "",
      "تاريخ الشكوى": r.complainTime ?? "",
      "الفنى": r.techName ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أعطال لها أكونت");
    XLSX.writeFile(wb, "faults-with-account.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "الأعطال الحالية لخطوط لها رقم أكونت",
      columns: ["التذكرة", "السنترال", "التليفون", "الأكونت", "الكابينة", "البكس", "الكود", "سرعة حالية", "أقصى سرعة", "اسكور", "تاريخ الشكوى"],
      rows: rows.map((r) => [
        r.ticketId, r.centralName, r.phoneShort, r.accountNo, r.cabinetNo ?? "", r.boxNo ?? "",
        r.statusCode, r.lastCurrentSpeed ?? "—", r.lastMaxSpeed ?? "—", r.lastScore ?? "—",
        r.complainTime ? new Date(r.complainTime).toLocaleDateString("ar-EG") : "—",
      ]),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">الأعطال الحالية لخطوط لها رقم أكونت</h3>
            {!isLoading && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {rows.length.toLocaleString("ar-EG")} سجل
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchableCombobox
              options={filterOptions?.centrals ?? []}
              value={central}
              onChange={(v) => setCentral(v)}
              placeholder="كل السنترالات"
              searchPlaceholder="ابحث في السنترالات..."
              className="w-full sm:w-44 text-sm"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setSearchQ(q)}
              placeholder="بحث (تليفون/كابينة/كود)..."
              className="w-44 text-sm h-9"
              dir="rtl"
            />
            <Button variant="outline" size="sm" onClick={() => setSearchQ(q)} className="h-9">
              بحث
            </Button>
            <Button variant="outline" size="sm" onClick={handleMeasureAll} className="text-blue-700 border-blue-200 gap-1">
              <Radar className="w-4 h-4" /> قياس DZS
            </Button>
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
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم التذكرة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم الأكونت</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الكابينة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">البكس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الكود</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">السرعة الحالية</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">أقصى سرعة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الاسكور</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">وقت القياس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">تاريخ الشكوى</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الفنى</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">قياس</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-mono text-xs">{r.ticketId}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.centralName}</TableCell>
                    <TableCell className="font-mono">{r.phoneShort}</TableCell>
                    <TableCell dir="ltr" className="font-mono text-left">{r.accountNo}</TableCell>
                    <TableCell>{r.cabinetNo ?? "—"}</TableCell>
                    <TableCell>{r.boxNo ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.statusCode}</TableCell>
                    <TableCell className="font-mono">{r.lastCurrentSpeed ?? "—"}</TableCell>
                    <TableCell className="font-mono">{r.lastMaxSpeed ?? "—"}</TableCell>
                    <TableCell>{scoreBadge(r.lastScore)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtTime(r.lastMeasTime)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.complainTime ? new Date(r.complainTime).toLocaleDateString("ar-EG") : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.techName ?? "—"}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => openDZS(r)}
                        title="فتح DZS وقياس هذا الرقم"
                        className="text-blue-600 hover:text-blue-800"
                      >
                        <Radar className="w-4 h-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center text-muted-foreground py-8">
                      لا توجد أعطال لخطوط لها رقم أكونت
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
