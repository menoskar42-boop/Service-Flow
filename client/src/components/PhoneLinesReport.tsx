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
import { ChevronRight, ChevronLeft, Loader2, Radar } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { Measurement138Button, type Measurement138 } from "@/components/Measurement138Button";

// رابط بوابة DZS expresse — يُفتح في تاب جديد ويُمرَّر أرقام الأكونت فى الـ hash.
const DZS_URL = "https://10.42.187.101:8080/expresse/";

interface PhoneLine extends Measurement138 {
  telNo: string;
  central: string;
  iduNo: string;
  oduNo: string;
  cabinNumber: string;
  primaryBlockNo: string;
  cabinetIn: string;
  secBlockNo: string;
  cabinetOut: string;
  boxNumber: string;
  dpTerminal: string;
  port: string;
  len: string;
  fiberBlock: string;
  fiberOut: string;
  telNumTxt: string;
  fullPhone: string;
}

interface FilterOptions {
  centrals: string[];
  cabins: Record<string, string[]>;
  boxes: Record<string, string[]>;
}

const PAGE_SIZE = 50;

export function PhoneLinesReport() {
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [box, setBox] = useState("");
  const [page, setPage] = useState(1);

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["/api/phone-lines", central, cabin, box, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (box) params.set("box", box);
      const res = await fetch(`/api/phone-lines?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: PhoneLine[]; total: number; page: number; pageSize: number }>;
    },
  });

  const cabins = central && filterOptions ? (filterOptions.cabins[central] ?? []) : [];
  const boxes = central && cabin && filterOptions ? (filterOptions.boxes[`${central}||${cabin}`] ?? []) : [];

  // يجمع أرقام الأكونت من الصفحة المعروضة (يحذف المكرر ويتجاهل اللى مالهاش أكونت)
  // ويفتح تاب DZS واحد يمرّر الأرقام فى الـ hash ليقيسها الـ Tampermonkey.
  const handleMeasureDZS = () => {
    const accounts = Array.from(
      new Set(
        (data?.data ?? [])
          .map((r) => (r.accountNo ?? "").toString().trim())
          .filter((a) => a !== ""),
      ),
    );
    if (accounts.length === 0) {
      alert("لا توجد أرقام أكونت فى الصفحة المعروضة — لا شىء للقياس");
      return;
    }
    window.open(`${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}`, "_blank");
  };

  // يفتح تاب DZS لرقم أكونت واحد (الزر بجوار كل خط).
  const openDZSSingle = (account: string) => {
    window.open(`${DZS_URL}#sf_accounts=${encodeURIComponent(account)}`, "_blank");
  };

  const handleExport = async () => {
    const params = new URLSearchParams({ page: "1", limit: "20000" });
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    const res = await fetch(`/api/phone-lines?${params}`, { credentials: "include" });
    const json = await res.json();
    const rows = (json.data as PhoneLine[]).map((r) => ({
      "رقم التليفون الكامل": r.fullPhone,
      "رقم الأكونت": r.accountNo,
      "آخر قياس": r.lastMeasScore,
      "السرعة الحالية": r.lineCurrentSpeed,
      "أقصى سرعة": r.lineMaxSpeed,
      "السنترال": r.central,
      "رقم الكابينه": r.cabinNumber,
      "رقم البكس": r.boxNumber,
      "رقم التليفون": r.telNo,
      "IDU": r.iduNo,
      "ODU": r.oduNo,
      "Primary Block": r.primaryBlockNo,
      "Cabinet In": r.cabinetIn,
      "Sec Block": r.secBlockNo,
      "Cabinet Out": r.cabinetOut,
      "DP Terminal": r.dpTerminal,
      "Port": r.port,
      "LEN": r.len,
      "Fiber Block": r.fiberBlock,
      "Fiber Out": r.fiberOut,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بيان التليفونات");
    XLSX.writeFile(wb, "phone-lines-report.xlsx");
  };

  const handleExportPDF = async () => {
    const params = new URLSearchParams({ page: "1", limit: "20000" });
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    const res = await fetch(`/api/phone-lines?${params}`, { credentials: "include" });
    const json = await res.json();
    const all = json.data as PhoneLine[];
    printTablePDF({
      title: "تقرير بيان أرقام التليفونات",
      columns: ["#", "التليفون الكامل", "الأكونت", "سرعة حالية", "أقصى سرعة", "السنترال", "الكابينه", "البكس", "التليفون",
        "IDU", "ODU", "Cabinet In", "DP Terminal", "Port", "LEN"],
      rows: all.map((r, i) => [i + 1, r.fullPhone, r.accountNo ?? "", r.lineCurrentSpeed ?? "", r.lineMaxSpeed ?? "",
        r.central, r.cabinNumber, r.boxNumber,
        r.telNo, r.iduNo, r.oduNo, r.cabinetIn, r.dpTerminal, r.port, r.len]),
    });
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">بيان أرقام التليفونات</h3>
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

        {isLoading ? (
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
                    <TableHead className="text-right font-bold whitespace-nowrap">قياس</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الكابينه</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم البكس</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">IDU</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">ODU</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Primary Block</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Cabinet In</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Sec Block</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Cabinet Out</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">DP Terminal</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Port</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">LEN</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Fiber Block</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">Fiber Out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((r, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono font-semibold text-blue-700">{r.fullPhone || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left font-mono">
                        {r.accountNo ? (
                          <span className="inline-flex items-center gap-1">
                            {r.accountNo}
                            <button
                              type="button"
                              onClick={() => openDZSSingle(r.accountNo!)}
                              title="فتح DZS وقياس هذا الرقم"
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <Radar className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ) : "-"}
                      </TableCell>
                      <TableCell><Measurement138Button m={r} /></TableCell>
                      <TableCell className="whitespace-nowrap">{r.central || "-"}</TableCell>
                      <TableCell className="font-medium">{r.cabinNumber || "-"}</TableCell>
                      <TableCell className="font-medium">{r.boxNumber || "-"}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{r.telNo || "-"}</TableCell>
                      <TableCell>{r.iduNo || "-"}</TableCell>
                      <TableCell>{r.oduNo || "-"}</TableCell>
                      <TableCell>{r.primaryBlockNo || "-"}</TableCell>
                      <TableCell>{r.cabinetIn || "-"}</TableCell>
                      <TableCell>{r.secBlockNo || "-"}</TableCell>
                      <TableCell>{r.cabinetOut || "-"}</TableCell>
                      <TableCell>{r.dpTerminal || "-"}</TableCell>
                      <TableCell>{r.port || "-"}</TableCell>
                      <TableCell>{r.len || "-"}</TableCell>
                      <TableCell>{r.fiberBlock || "-"}</TableCell>
                      <TableCell>{r.fiberOut || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="p-4 border-t flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronRight className="w-4 h-4 ml-1" />
                  السابق
                </Button>
                <span className="text-sm text-muted-foreground">
                  صفحة {page} من {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
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
