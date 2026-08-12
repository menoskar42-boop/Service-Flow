import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageJump } from "@/components/ui/page-jump";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronRight, ChevronLeft, Loader2, Phone, Check, X, CheckCheck, Undo2, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

// «أرقام بدون رقم موبايل» — نفس عمود بيان التليفونات، بس مقصور على الأرقام اللى
// مالهاش رقم موبايل من أى مصدر (يدوى/أوامر شغل/طلبات FTTH). الغرض: تجميع أرقام
// الموبايل الناقصة، مع إمكانية إضافة الرقم من نفس الجدول مباشرة.
interface Row {
  id: number | null;
  telNo: string;
  central: string;
  cabinNumber: string;
  boxNumber: string;
  dpTerminal: string;
  msanCode: string | null;
  frameNo: string | null;
  frameStatus: string | null;
  techName: string | null;
  fullPhone: string;
  subName: string | null;
  subAdd: string | null;
}

interface FilterOptions {
  centrals: string[];
  cabins: Record<string, string[]>;
  boxes: Record<string, string[]>;
}

const PAGE_SIZE = 50;

interface Props {
  /** true = تقرير «تم الفحص وتحتاج أرقام محمول» (سوبر أدمن) بدل «تحت الفحص». */
  checked?: boolean;
}

export function LinesNoMobileReport({ checked = false }: Props) {
  const endpoint = checked ? "/api/phone-lines/mobile-checked" : "/api/phone-lines/no-mobile";
  const heading = checked ? "أرقام تم الفحص وتحتاج أرقام محمول" : "أرقام بدون رقم موبايل تحت الفحص";
  // فلتر (فى تقرير «تم الفحص» بس): الأرقام اللى ليها شكوى مفتوحة فى الأعطال الحالية
  const [onlyCurrentFault, setOnlyCurrentFault] = useState(false);
  // علامة «اتفحص» — بتشيل الرقم من «تحت الفحص» وتوديه للتقرير التانى (والعكس)
  const [markingPhone, setMarkingPhone] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [box, setBox] = useState("");
  const [phoneFrom, setPhoneFrom] = useState("");
  const [phoneTo, setPhoneTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // تحرير رقم الموبايل — صف واحد فى نفس الوقت
  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [mobileInput, setMobileInput] = useState("");
  const [savingPhone, setSavingPhone] = useState<string | null>(null);

  const { data: filterOptions } = useQuery({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return res.json() as Promise<FilterOptions>;
    },
  });

  const queryKey = [endpoint, central, cabin, box, phoneFrom, phoneTo, search, page, onlyCurrentFault];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (central) params.set("central", central);
      if (cabin) params.set("cabin", cabin);
      if (box) params.set("box", box);
      if (phoneFrom.trim()) params.set("phoneFrom", phoneFrom.trim());
      if (phoneTo.trim()) params.set("phoneTo", phoneTo.trim());
      if (search.trim()) params.set("search", search.trim());
      if (checked && onlyCurrentFault) params.set("onlyCurrentFault", "1");
      const res = await fetch(`${endpoint}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ data: Row[]; total: number; page: number; pageSize: number }>;
    },
    refetchOnMount: "always",
  });

  const cabins = central && filterOptions ? (filterOptions.cabins[central] ?? []) : [];
  const boxes = central && cabin && filterOptions ? (filterOptions.boxes[`${central}||${cabin}`] ?? []) : [];

  const startEdit = (r: Row) => { setEditingPhone(r.fullPhone); setMobileInput(""); };
  const cancelEdit = () => { setEditingPhone(null); setMobileInput(""); };
  const saveMobile = async (fullPhone: string) => {
    const mobile = mobileInput.trim();
    if (!mobile) return;
    setSavingPhone(fullPhone);
    try {
      const res = await fetch("/api/line-mobiles", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullPhone, mobile }),
      });
      if (!res.ok) throw new Error();
      // الرقم بقى له موبايل → بيختفى من **التقريرين** (الاتنين بيستبعدوا اللى ليه موبايل)
      await queryClient.invalidateQueries({ queryKey: ["/api/phone-lines/no-mobile"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/phone-lines/mobile-checked"] });
      setEditingPhone(null);
      setMobileInput("");
    } catch {
      alert("تعذّر حفظ رقم الموبايل");
    } finally {
      setSavingPhone(null);
    }
  };

  // «تم الفحص»: بينقل الرقم بين التقريرين. الرقم مابيتمسحش من أى مكان — بس بيتعلّم.
  const toggleChecked = async (fullPhone: string) => {
    setMarkingPhone(fullPhone);
    try {
      const res = checked
        ? await fetch(`/api/line-mobile-checked/${encodeURIComponent(fullPhone)}`, { method: "DELETE", credentials: "include" })
        : await fetch("/api/line-mobile-checked", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fullPhone }),
          });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ["/api/phone-lines/no-mobile"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/phone-lines/mobile-checked"] });
    } catch {
      alert(checked ? "تعذّر إرجاع الرقم لتحت الفحص" : "تعذّر تعليم الرقم كمفحوص");
    } finally {
      setMarkingPhone(null);
    }
  };

  const buildParams = () => {
    const params = new URLSearchParams({ page: "1", limit: "20000" });
    if (central) params.set("central", central);
    if (cabin) params.set("cabin", cabin);
    if (box) params.set("box", box);
    if (phoneFrom.trim()) params.set("phoneFrom", phoneFrom.trim());
    if (phoneTo.trim()) params.set("phoneTo", phoneTo.trim());
    if (search.trim()) params.set("search", search.trim());
    if (checked && onlyCurrentFault) params.set("onlyCurrentFault", "1");
    return params;
  };

  const handleExport = async () => {
    const res = await fetch(`${endpoint}?${buildParams()}`, { credentials: "include" });
    const json = await res.json();
    const rows = (json.data as Row[]).map((r) => ({
      "رقم التليفون الكامل": r.fullPhone,
      "السنترال": r.central,
      "اسم العميل": r.subName ?? "",
      "العنوان": r.subAdd ?? "",
      "رقم الكابينه": r.cabinNumber,
      "رقم البكس": r.boxNumber,
      "رقم التليفون": r.telNo,
      "كود كابينة المسان": r.msanCode ?? "",
      "رقم الفريم": r.frameNo ?? "",
      "الحالة": r.frameStatus ?? "شغّال",
      "DP Terminal": r.dpTerminal,
      "الفنى": r.techName ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أرقام بدون موبايل");
    XLSX.writeFile(wb, "lines-no-mobile-report.xlsx");
  };

  const handleExportPDF = async () => {
    const res = await fetch(`${endpoint}?${buildParams()}`, { credentials: "include" });
    const json = await res.json();
    const all = json.data as Row[];
    printTablePDF({
      title: heading,
      columns: ["#", "التليفون الكامل", "السنترال", "اسم العميل", "العنوان", "الكابينه", "البكس", "التليفون",
        "كود المسان", "الفريم", "الحالة", "الفنى"],
      rows: all.map((r, i) => [i + 1, r.fullPhone, r.central, r.subName ?? "", r.subAdd ?? "",
        r.cabinNumber, r.boxNumber, r.telNo, r.msanCode ?? "", r.frameNo ?? "", r.frameStatus ?? "شغّال", r.techName ?? ""]),
    });
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">{heading}</h3>
            {data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.total.toLocaleString("ar-EG")} رقم مالوش موبايل مسجّل من أى مصدر (يدوى/أوامر شغل/FTTH)
                {checked ? " — اتفحصوا وطلعوا فعلاً محتاجين رقم محمول" : " — لسه تحت الفحص"}
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
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="بحث فى كل الأعمدة…"
              className="w-full sm:w-56 text-sm h-9"
              dir="rtl"
            />
            <div className="flex items-center gap-1">
              <Input
                inputMode="numeric"
                value={phoneFrom}
                onChange={(e) => { setPhoneFrom(e.target.value.replace(/\D/g, "")); setPage(1); }}
                placeholder="من رقم"
                dir="ltr"
                className="w-28 sm:w-32 text-sm text-left h-9"
              />
              <span className="text-xs text-muted-foreground">إلى</span>
              <Input
                inputMode="numeric"
                value={phoneTo}
                onChange={(e) => { setPhoneTo(e.target.value.replace(/\D/g, "")); setPage(1); }}
                placeholder="إلى رقم"
                dir="ltr"
                className="w-28 sm:w-32 text-sm text-left h-9"
              />
            </div>
            {checked && (
              <Button
                variant={onlyCurrentFault ? "default" : "outline"}
                size="sm"
                onClick={() => { setOnlyCurrentFault((v) => !v); setPage(1); }}
                title="اعرض بس الأرقام اللى ليها شكوى مفتوحة فى الأعطال الحالية"
                className={`gap-1 ${onlyCurrentFault ? "bg-red-600 hover:bg-red-700 text-white" : "text-red-700 border-red-200"}`}
              >
                <AlertTriangle className="w-4 h-4" />
                {onlyCurrentFault ? "له شكوى حالية ✓" : "له شكوى فى الأعطال الحالية"}
              </Button>
            )}
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
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الموبايل</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">اسم العميل</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">العنوان</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الكابينه</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم البكس</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم التليفون</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">كود كابينة المسان</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">رقم الفريم</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">الحالة</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">DP Terminal</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">الفنى</TableHead>
                    <TableHead className="text-right font-bold whitespace-nowrap">{checked ? "رجوع" : "الفحص"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.length === 0 ? (
                    <TableRow><TableCell colSpan={14} className="text-center py-10 text-muted-foreground">مفيش أرقام — كل الأرقام فى هذا النطاق عندها موبايل مسجّل</TableCell></TableRow>
                  ) : data?.data.map((r, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono font-semibold text-blue-700">{r.fullPhone || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left">
                        {editingPhone === r.fullPhone ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              value={mobileInput}
                              onChange={(e) => setMobileInput(e.target.value)}
                              placeholder="رقم الموبايل"
                              className="border rounded px-2 py-0.5 text-sm w-32"
                              dir="ltr"
                              autoFocus
                            />
                            <button
                              onClick={() => saveMobile(r.fullPhone)}
                              disabled={savingPhone === r.fullPhone || !mobileInput.trim()}
                              title="حفظ"
                              className="text-emerald-600 hover:text-emerald-800 disabled:opacity-30"
                            >
                              {savingPhone === r.fullPhone ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button onClick={cancelEdit} title="إلغاء" className="text-gray-500 hover:text-gray-700">
                              <X className="w-4 h-4" />
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => startEdit(r)}
                            className="inline-flex items-center gap-1 text-xs text-blue-700 border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50"
                            title="إضافة رقم موبايل"
                          >
                            <Phone className="w-3 h-3" /> + إضافة
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{r.central || "-"}</TableCell>
                      <TableCell className="whitespace-normal break-words min-w-[130px]">{r.subName || "-"}</TableCell>
                      <TableCell className="whitespace-normal break-words min-w-[180px] max-w-[300px] text-xs">{r.subAdd || "-"}</TableCell>
                      <TableCell className="font-medium">{r.cabinNumber || "-"}</TableCell>
                      <TableCell className="font-medium">{r.boxNumber || "-"}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{r.telNo || "-"}</TableCell>
                      <TableCell className="font-mono">{r.msanCode || "-"}</TableCell>
                      <TableCell className="font-mono">{r.frameNo || "-"}</TableCell>
                      <TableCell>
                        {r.frameStatus ? (
                          <span className={`text-[11px] px-2 py-0.5 rounded font-semibold whitespace-nowrap ${
                            r.frameStatus === "تم رفعه نهائياً" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                          }`}>
                            {r.frameStatus}
                          </span>
                        ) : (
                          <span className="text-[11px] px-2 py-0.5 rounded font-semibold bg-emerald-100 text-emerald-800 whitespace-nowrap">شغّال</span>
                        )}
                      </TableCell>
                      <TableCell>{r.dpTerminal || "-"}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium text-indigo-700">{r.techName || "-"}</TableCell>
                      <TableCell>
                        <button
                          onClick={() => toggleChecked(r.fullPhone)}
                          disabled={markingPhone === r.fullPhone}
                          title={checked
                            ? "رجّع الرقم لتقرير «تحت الفحص»"
                            : "اتفحص وطلع فعلاً مالوش رقم محمول — انقله لتقرير «تم الفحص وتحتاج أرقام محمول»"}
                          className={`inline-flex items-center gap-1 text-xs border rounded px-2 py-0.5 disabled:opacity-40 ${
                            checked
                              ? "text-gray-700 border-gray-300 hover:bg-gray-50"
                              : "text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                          }`}
                        >
                          {markingPhone === r.fullPhone
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : checked ? <Undo2 className="w-3 h-3" /> : <CheckCheck className="w-3 h-3" />}
                          {checked ? "رجوع" : "تم الفحص"}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="p-4 border-t flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronRight className="w-4 h-4 ml-1" /> السابق
                </Button>
                <PageJump page={page} totalPages={totalPages} onJump={setPage} />
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  التالي <ChevronLeft className="w-4 h-4 mr-1" />
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
