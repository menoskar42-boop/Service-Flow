import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshButton } from "@/components/RefreshButton";
import { ReviewSubscriberInfoButton } from "@/components/ReviewSubscriberInfoButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Search, Server } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

interface Row {
  phoneNumber: string;
  telNo: string;
  central: string | null;
  cabinNumber: string | null;
  boxNumber: string | null;
  dpTerminal: string | null;
  subName: string | null;
  subAdd: string | null;
  msanCode: string | null;
  frame: string | null;
  shelf: string | null;
  slot: string | null;
  portNumber: string | null;
  portType: string | null;
  voiceStatus: string | null;
  dataStatus: string | null;
  operator: string | null;
  portUploadedAt: string | null;
  missingTechnical: boolean;
  missingSubscriber: boolean;
}

interface ReportData {
  data: Row[];
  total: number;
  page: number;
  pageSize: number;
  lastPortUpdateAt: string | null;
}

const PAGE_SIZE = 50;

const empty = (value: string | null | undefined) => !String(value ?? "").trim();

const fmtDateTime = (value: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

export function PortsMissingLineDataReport() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const buildParams = (forExport = false) => {
    const params = new URLSearchParams({
      page: forExport ? "1" : String(page),
      limit: forExport ? "20000" : String(PAGE_SIZE),
    });
    if (search.trim()) params.set("search", search.trim());
    return params;
  };

  const { data, isFetching } = useQuery<ReportData>({
    queryKey: ["/api/reports/ports-missing-line-data", search, page],
    queryFn: async () => {
      const res = await fetch(`/api/reports/ports-missing-line-data?${buildParams()}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل تحميل التقرير");
      return res.json();
    },
    refetchOnMount: "always",
  });

  const rows = data?.data ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const exportRows = (all: Row[]) => all.map((r, i) => ({
    "#": i + 1,
    "رقم التليفون": r.telNo || r.phoneNumber,
    "السنترال": r.central ?? "",
    "MSAN": r.msanCode ?? "",
    "Frame": r.frame ?? "",
    "Shelf": r.shelf ?? "",
    "Slot": r.slot ?? "",
    "رقم البورت": r.portNumber ?? "",
    "نوع البورت": r.portType ?? "",
    "الكابينة": r.cabinNumber ?? "",
    "البكس": r.boxNumber ?? "",
    "DP Terminal": r.dpTerminal ?? "",
    "اسم العميل": r.subName ?? "",
    "العنوان": r.subAdd ?? "",
    "سبب الظهور": [
      r.missingTechnical ? "بيان فني ناقص (كابينة/بكس)" : "",
      r.missingSubscriber ? "اسم/عنوان ناقص" : "",
    ].filter(Boolean).join(" + "),
    "آخر تحديث للبورت": fmtDateTime(r.portUploadedAt),
  }));

  const handleExportExcel = async () => {
    const res = await fetch(`/api/reports/ports-missing-line-data?${buildParams(true)}`, { credentials: "include" });
    if (!res.ok) return;
    const json = await res.json() as ReportData;
    const ws = XLSX.utils.json_to_sheet(exportRows(json.data ?? []));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بورتات بلا بيانات");
    XLSX.writeFile(wb, "ports-missing-line-data.xlsx");
  };

  const handleExportPDF = async () => {
    const res = await fetch(`/api/reports/ports-missing-line-data?${buildParams(true)}`, { credentials: "include" });
    if (!res.ok) return;
    const json = await res.json() as ReportData;
    printTablePDF({
      title: "بورتات MSAN بلا بيان فني أو اسم/عنوان",
      columns: ["#", "رقم التليفون", "السنترال", "MSAN", "Frame", "البورت", "الكابينة", "البكس", "اسم العميل", "العنوان", "سبب الظهور"],
      rows: (json.data ?? []).map((r, i) => [
        i + 1,
        r.telNo || r.phoneNumber,
        r.central ?? "—",
        r.msanCode ?? "—",
        r.frame ?? "—",
        r.portNumber ?? "—",
        r.cabinNumber ?? "—",
        r.boxNumber ?? "—",
        r.subName ?? "—",
        r.subAdd ?? "—",
        [
          r.missingTechnical ? "بيان فني ناقص" : "",
          r.missingSubscriber ? "اسم/عنوان ناقص" : "",
        ].filter(Boolean).join(" + "),
      ]),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-base flex items-center gap-2">
                <Server className="w-4 h-4 text-blue-700" />
                بورتات MSAN بلا بيان فني أو اسم/عنوان
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
                أرقام موجودة في جدول منافذ MSAN الحالي بعد آخر تحديث، وينقصها بيان فني كامل
                (رقم كابينة + رقم بكس) أو اسم العميل والعنوان.
              </p>
              <p className="text-xs text-blue-700 mt-1">
                آخر وقت تحديث لصفوف البورتات: {fmtDateTime(data?.lastPortUpdateAt ?? null)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RefreshButton queryKeys={["/api/reports/ports-missing-line-data"]} />
              <ReviewSubscriberInfoButton />
              <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!data?.total} className="text-green-700 border-green-200 gap-1">
                <FileSpreadsheet className="w-4 h-4" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!data?.total} className="text-red-700 border-red-200">
                تصدير PDF
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="بحث برقم التليفون أو MSAN أو البورت أو الاسم أو العنوان"
                className="text-sm pr-8"
              />
            </div>
            {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            <span className="text-sm text-muted-foreground">
              إجمالي: <strong className="text-foreground">{(data?.total ?? 0).toLocaleString("ar-EG")}</strong> رقم
            </span>
          </div>
        </div>

        {isFetching && !data ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="overflow-x-auto [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <Table className="text-right text-xs min-w-max" dir="rtl">
                <TableHeader className="bg-blue-800">
                  <TableRow>
                    {["#", "رقم التليفون", "السنترال", "MSAN", "Frame", "Shelf", "Slot", "البورت", "نوع البورت", "الكابينة", "البكس", "DP", "اسم العميل", "العنوان", "سبب الظهور", "آخر تحديث للبورت"].map((label) => (
                      <TableHead key={label} className="text-white font-bold text-center">{label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={16} className="text-center py-14 text-muted-foreground">
                        {isFetching ? "جاري التحميل..." : "لا توجد أرقام تنطبق عليها الشروط"}
                      </TableCell>
                    </TableRow>
                  ) : rows.map((r, i) => (
                    <TableRow key={r.phoneNumber} className="hover:bg-muted/30">
                      <TableCell className="text-center text-muted-foreground">{(page - 1) * PAGE_SIZE + i + 1}</TableCell>
                      <TableCell className="text-center font-mono font-semibold text-blue-700">{r.telNo || r.phoneNumber}</TableCell>
                      <TableCell>{r.central || "—"}</TableCell>
                      <TableCell className="font-mono">{r.msanCode || "—"}</TableCell>
                      <TableCell className="font-mono">{r.frame || "—"}</TableCell>
                      <TableCell className="font-mono">{r.shelf || "—"}</TableCell>
                      <TableCell className="font-mono">{r.slot || "—"}</TableCell>
                      <TableCell className="font-mono">{r.portNumber || "—"}</TableCell>
                      <TableCell>{r.portType || "—"}</TableCell>
                      <TableCell className={r.missingTechnical ? "text-red-700 font-semibold" : ""}>{r.cabinNumber || "—"}</TableCell>
                      <TableCell className={r.missingTechnical ? "text-red-700 font-semibold" : ""}>{r.boxNumber || "—"}</TableCell>
                      <TableCell>{r.dpTerminal || "—"}</TableCell>
                      <TableCell className={r.missingSubscriber ? "text-orange-700 font-semibold" : ""}>{r.subName || "—"}</TableCell>
                      <TableCell className={`max-w-[280px] truncate ${r.missingSubscriber ? "text-orange-700 font-semibold" : ""}`} title={r.subAdd || ""}>{r.subAdd || "—"}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-wrap justify-center gap-1">
                          {r.missingTechnical && <span className="rounded bg-red-100 text-red-700 px-1.5 py-0.5">بيان فني ناقص</span>}
                          {r.missingSubscriber && <span className="rounded bg-orange-100 text-orange-700 px-1.5 py-0.5">اسم/عنوان ناقص</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">{fmtDateTime(r.portUploadedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 p-3 border-t">
                <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronRight className="w-4 h-4" /> السابق
                </Button>
                <span className="text-sm text-muted-foreground">صفحة {page} من {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages || isFetching} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  التالي <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}