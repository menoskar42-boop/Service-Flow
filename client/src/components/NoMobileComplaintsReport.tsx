import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageJump } from "@/components/ui/page-jump";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronRight, ChevronLeft, Loader2, Phone, Check, X, CheckCheck } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { useMobileLookup, phoneLookupKey, MobileValue } from "@/lib/mobile-lookup";

interface Row {
  id: number;
  ticketId: string | null;
  source: "تفاصيل" | "متبقى" | "خارج الشاشة" | "الأعطال الحالية" | "منتظم اليوم";
  fullPhone: string;
  phoneShort: string | null;
  central: string | null;
  cabinNumber: string | null;
  boxNumber: string | null;
  msanCode: string | null;
  subName: string | null;
  subAdd: string | null;
  closeCode: string | null;
  complaintTypeName: string | null;
  complaintTime: string | null;
  closeDate: string | null;
  regularizedAt: string | null;
  techName: string | null;
}

interface FilterOptions {
  centrals: string[];
  cabins: Record<string, string[]>;
  boxes: Record<string, string[]>;
}

const ENDPOINT = "/api/phone-lines/no-mobile-complaints";
const PAGE_SIZE = 50;

const todayInCairo = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

export function NoMobileComplaintsReport() {
  const today = todayInCairo();
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 8)}01`);
  const [dateTo, setDateTo] = useState(today);
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [box, setBox] = useState("");
  const [phoneFrom, setPhoneFrom] = useState("");
  const [phoneTo, setPhoneTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [mobileInput, setMobileInput] = useState("");
  const [savingPhone, setSavingPhone] = useState<string | null>(null);
  const [markingPhone, setMarkingPhone] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const queryKey = [ENDPOINT, dateFrom, dateTo, central, cabin, box, phoneFrom, phoneTo, search, page];
  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (box) params.set("box", box);
      if (phoneFrom.trim()) params.set("phoneFrom", phoneFrom.trim());
      if (phoneTo.trim()) params.set("phoneTo", phoneTo.trim());
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`${ENDPOINT}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: Row[]; total: number; page: number; pageSize: number }>;
    },
    refetchOnMount: "always",
  });
  const mobileLookup = useMobileLookup((data?.data ?? []).map((row) => row.phoneShort || row.fullPhone));

  const cabins = central && filterOptions ? (filterOptions.cabins[central] ?? []) : [];
  const boxes = central && cabin && filterOptions ? (filterOptions.boxes[`${central}||${cabin}`] ?? []) : [];
  const resetPage = () => setPage(1);

  const buildParams = () => {
    const params = new URLSearchParams({ page: "1", limit: "20000" });
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    if (phoneFrom.trim()) params.set("phoneFrom", phoneFrom.trim());
    if (phoneTo.trim()) params.set("phoneTo", phoneTo.trim());
    if (search.trim()) params.set("search", search.trim());
    return params;
  };

  const startEdit = (row: Row) => {
    setEditingPhone(row.fullPhone);
    setMobileInput("");
  };

  const cancelEdit = () => {
    setEditingPhone(null);
    setMobileInput("");
  };

  const saveMobile = async (fullPhone: string) => {
    const mobile = mobileInput.trim();
    if (!mobile) return;
    setSavingPhone(fullPhone);
    try {
      const res = await fetch("/api/line-mobiles", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullPhone, mobile }),
      });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
      await queryClient.invalidateQueries({ queryKey: ["/api/phone-lines/no-mobile"] });
      setEditingPhone(null);
      setMobileInput("");
    } catch {
      alert("تعذّر حفظ رقم الموبايل");
    } finally {
      setSavingPhone(null);
    }
  };

  const markChecked = async (fullPhone: string) => {
    setMarkingPhone(fullPhone);
    try {
      const res = await fetch("/api/line-mobile-checked", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullPhone }),
      });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
      await queryClient.invalidateQueries({ queryKey: ["/api/phone-lines/no-mobile"] });
    } catch {
      alert("تعذّر تعليم الرقم كمفحوص");
    } finally {
      setMarkingPhone(null);
    }
  };

  const handleExport = async () => {
    const res = await fetch(`${ENDPOINT}?${buildParams()}`, { credentials: "include" });
    if (!res.ok) return;
    const json = await res.json();
    const rows = (json.data as Row[]).map((row, index) => ({
      "#": index + 1,
      "المصدر": row.source,
      "رقم الشكوى": row.ticketId ?? "",
      "رقم التليفون الكامل": row.fullPhone,
      "رقم التليفون": row.phoneShort ?? "",
      "تاريخ الشكوى": formatDate(row.complaintTime),
      "تاريخ الانتظام": formatDate(row.closeDate ?? row.regularizedAt),
      "السنترال": row.central ?? "",
      "اسم العميل": row.subName ?? "",
      "العنوان": row.subAdd ?? "",
      "الكابينة": row.cabinNumber ?? "",
      "البكس": row.boxNumber ?? "",
      "MSAN": row.msanCode ?? "",
      "سبب الإغلاق": row.closeCode ?? "",
      "نوع الشكوى": row.complaintTypeName ?? "",
      "الفني": row.techName ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "شكاوى بدون موبايل");
    XLSX.writeFile(wb, `no-mobile-complaints-${dateFrom || "all"}_${dateTo || "all"}.xlsx`);
  };

  const handleExportPDF = async () => {
    const res = await fetch(`${ENDPOINT}?${buildParams()}`, { credentials: "include" });
    if (!res.ok) return;
    const json = await res.json();
    const rows = json.data as Row[];
    printTablePDF({
      title: `أرقام لها شكاوى بدون رقم موبايل (${dateFrom || "البداية"} → ${dateTo || "النهاية"})`,
      columns: ["#", "المصدر", "رقم الشكوى", "التليفون الكامل", "التليفون", "تاريخ الشكوى", "تاريخ الانتظام",
        "السنترال", "اسم العميل", "العنوان", "الكابينة", "البكس", "MSAN", "سبب الإغلاق", "نوع الشكوى", "الفني"],
      rows: rows.map((row, index) => [
        index + 1, row.source, row.ticketId ?? "-", row.fullPhone, row.phoneShort ?? "-",
        formatDate(row.complaintTime), formatDate(row.closeDate ?? row.regularizedAt), row.central ?? "-",
        row.subName ?? "-", row.subAdd ?? "-", row.cabinNumber ?? "-", row.boxNumber ?? "-",
        row.msanCode ?? "-", row.closeCode ?? "-", row.complaintTypeName ?? "-", row.techName ?? "-",
      ]),
    });
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <Card className="overflow-hidden shadow-sm border-0 bg-white" dir="rtl">
      <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-base">أرقام لها شكاوى بدون رقم موبايل</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            الشكاوى المنتظمة داخل الشاشة وخارجها من {dateFrom || "البداية"} إلى {dateTo || "النهاية"}
            {data ? ` — ${data.total.toLocaleString("ar-EG")} رقم` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">من</span>
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); resetPage(); }} className="h-9 w-36 text-sm" dir="ltr" />
            <span className="text-xs text-muted-foreground">إلى</span>
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); resetPage(); }} className="h-9 w-36 text-sm" dir="ltr" />
          </div>
          <SearchableCombobox
            options={filterOptions?.centrals ?? []}
            value={central}
            onChange={(value) => { setCentral(value); setCabin(""); setBox(""); resetPage(); }}
            placeholder="كل السنترالات"
            searchPlaceholder="ابحث في السنترالات..."
            className="w-full sm:w-44 text-sm"
          />
          <SearchableCombobox
            options={cabins}
            value={cabin}
            onChange={(value) => { setCabin(value); setBox(""); resetPage(); }}
            placeholder="كل الكباين"
            searchPlaceholder="ابحث في الكباين..."
            disabled={!central}
            className="w-full sm:w-40 text-sm"
          />
          <SearchableCombobox
            options={boxes}
            value={box}
            onChange={(value) => { setBox(value); resetPage(); }}
            placeholder="كل البكسيات"
            searchPlaceholder="ابحث في البكسيات..."
            disabled={!cabin}
            className="w-full sm:w-36 text-sm"
          />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            placeholder="بحث برقم الشكوى أو الخط أو الاسم…"
            className="w-full sm:w-60 text-sm h-9"
            dir="rtl"
          />
          <div className="flex items-center gap-1">
            <Input inputMode="numeric" value={phoneFrom} onChange={(e) => { setPhoneFrom(e.target.value.replace(/\D/g, "")); resetPage(); }} placeholder="من رقم" dir="ltr" className="w-28 text-sm h-9" />
            <span className="text-xs text-muted-foreground">إلى</span>
            <Input inputMode="numeric" value={phoneTo} onChange={(e) => { setPhoneTo(e.target.value.replace(/\D/g, "")); resetPage(); }} placeholder="إلى رقم" dir="ltr" className="w-28 text-sm h-9" />
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} className="text-green-700 border-green-200">تصدير Excel</Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} className="text-red-700 border-red-200">تصدير PDF</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <div className="py-12 text-center text-red-700">
          تعذّر تحميل التقرير: {error instanceof Error ? error.message : "خطأ غير معروف"}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table className="text-right text-xs" dir="rtl">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="text-right font-bold whitespace-nowrap">المصدر</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم الشكوى</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">التليفون الكامل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم الموبايل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">تاريخ الشكوى</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">تاريخ الانتظام</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">اسم العميل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">العنوان</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الكابينة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">البكس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">سبب الإغلاق</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">نوع الشكوى</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الفني</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الفحص</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.data.length === 0 ? (
                  <TableRow><TableCell colSpan={15} className="text-center py-10 text-muted-foreground">لا توجد شكاوى منتظمة بدون رقم موبايل فى النطاق</TableCell></TableRow>
                ) : data?.data.map((row) => (
                  <TableRow key={`${row.source}-${row.id}`} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="whitespace-nowrap">
                       <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                         row.source === "خارج الشاشة" ? "bg-purple-100 text-purple-800" :
                         row.source === "الأعطال الحالية" ? "bg-red-100 text-red-800" :
                         row.source === "منتظم اليوم" ? "bg-blue-100 text-blue-800" :
                         "bg-amber-100 text-amber-800"
                       }`}>{row.source}</span>
                    </TableCell>
                    <TableCell className="font-mono">{row.ticketId || `يدوي #${row.id}`}</TableCell>
                    <TableCell className="font-mono font-semibold text-blue-700">{row.fullPhone || "-"}</TableCell>
                    <TableCell dir="ltr" className="text-left">
                      {editingPhone === row.fullPhone ? (
                        <span className="inline-flex items-center gap-1">
                          <input value={mobileInput} onChange={(e) => setMobileInput(e.target.value)} placeholder="رقم الموبايل" className="border rounded px-2 py-0.5 text-sm w-32" dir="ltr" autoFocus />
                          <button onClick={() => saveMobile(row.fullPhone)} disabled={savingPhone === row.fullPhone || !mobileInput.trim()} title="حفظ" className="text-emerald-600 hover:text-emerald-800 disabled:opacity-30">
                            {savingPhone === row.fullPhone ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button onClick={cancelEdit} title="إلغاء" className="text-gray-500 hover:text-gray-700"><X className="w-4 h-4" /></button>
                        </span>
                       ) : (
                         <span className="inline-flex items-center gap-1">
                           <MobileValue mobile={mobileLookup[phoneLookupKey(row.phoneShort || row.fullPhone)]} />
                           <button onClick={() => startEdit(row)} className="inline-flex items-center gap-1 text-xs text-blue-700 border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50" title="إضافة رقم موبايل">
                             <Phone className="w-3 h-3" /> + إضافة
                           </button>
                         </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(row.complaintTime)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(row.closeDate ?? row.regularizedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.central || "-"}</TableCell>
                    <TableCell className="whitespace-normal break-words min-w-[130px]">{row.subName || "-"}</TableCell>
                    <TableCell className="whitespace-normal break-words min-w-[180px] max-w-[300px] text-xs">{row.subAdd || "-"}</TableCell>
                    <TableCell>{row.cabinNumber || "-"}</TableCell>
                    <TableCell>{row.boxNumber || "-"}</TableCell>
                    <TableCell>{row.closeCode || "-"}</TableCell>
                    <TableCell className="whitespace-normal break-words min-w-[140px]">{row.complaintTypeName || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap text-indigo-700">{row.techName || "-"}</TableCell>
                    <TableCell>
                      <button onClick={() => markChecked(row.fullPhone)} disabled={markingPhone === row.fullPhone} title="اتفقص وطلع فعلاً مالوش رقم محمول" className="inline-flex items-center gap-1 text-xs text-emerald-700 border border-emerald-300 rounded px-2 py-0.5 hover:bg-emerald-50 disabled:opacity-40">
                        {markingPhone === row.fullPhone ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />} تم الفحص
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="p-4 border-t flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}><ChevronRight className="w-4 h-4 ml-1" /> السابق</Button>
              <PageJump page={page} totalPages={totalPages} onJump={setPage} />
              <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}>التالي <ChevronLeft className="w-4 h-4 mr-1" /></Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}