import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshButton } from "@/components/RefreshButton";
import { ReviewSubscriberInfoButton } from "@/components/ReviewSubscriberInfoButton";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, PlugZap, Search, X } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";

// أرقام لها بيان فنى (131) لكن مالهاش بورت/فريم على المسان.
// دى بالظبط الأرقام اللى بتتستبعد من تقارير القياسات وبيان التليفونات.
interface Row {
  fullPhone: string; telNo: string | null; central: string | null;
  cabinNumber: string | null; boxNumber: string | null; dpTerminal: string | null;
  iduNo: string | null; oduNo: string | null;
  primaryBlockNo: string | null; cabinetIn: string | null;
  secBlockNo: string | null; cabinetOut: string | null;
  port131: string | null; len: string | null;
  accountNo: string | null; subName: string | null; subAdd: string | null;
  lastMeasTime: string | null;
}
interface FilterOptions { centrals: string[]; cabins: Record<string, string[]>; boxes: Record<string, string[]>; }

const fmt = (t: string | null) => {
  if (!t) return "—";
  const d = new Date(t);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`;
};

export function LinesWithoutPortReport() {
  const [central, setCentral] = useState("");
  const [cabin, setCabin] = useState("");
  const [box, setBox] = useState("");
  const [search, setSearch] = useState("");

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ["/api/phone-lines/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/phone-lines/filter-options", { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data, isFetching } = useQuery<{ data: Row[]; total: number }>({
    queryKey: ["/api/reports/lines-without-port", central, cabin, box],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (central) p.set("central", central);
      if (cabin) p.set("cabin", cabin);
      if (box) p.set("box", box);
      const res = await fetch(`/api/reports/lines-without-port?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
    refetchOnMount: "always",
  });

  const all = data?.data ?? [];
  const cabins = central && filterOptions ? (filterOptions.cabins[central] ?? []) : [];
  const boxes = central && cabin && filterOptions ? (filterOptions.boxes[`${central}||${cabin}`] ?? []) : [];

  // بحث محلى فورى (أرقام فقط للتليفون، ونص لباقى الأعمدة)
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return all;
    const digits = s.replace(/\D/g, "");
    return all.filter((r) => {
      if (digits && (String(r.telNo ?? "").replace(/\D/g, "").includes(digits)
                  || String(r.fullPhone ?? "").replace(/\D/g, "").includes(digits))) return true;
      return [r.central, r.cabinNumber, r.boxNumber, r.subName, r.subAdd, r.accountNo]
        .some((v) => String(v ?? "").toLowerCase().includes(s));
    });
  }, [all, search]);

  const COLS = ["#", "رقم التليفون", "اسم العميل", "العنوان", "رقم الأكونت",
    "السنترال", "الكابينة", "البكس", "DP Terminal",
    "IDU", "ODU", "Primary Block", "Cabinet In", "Sec Block", "Cabinet Out",
    "البورت (131)", "LEN", "آخر قياس"];

  const asRow = (r: Row, i: number) => [
    i + 1, r.telNo ?? r.fullPhone, r.subName ?? "—", r.subAdd ?? "—", r.accountNo ?? "—",
    r.central ?? "—", r.cabinNumber ?? "—", r.boxNumber ?? "—",
    r.dpTerminal ?? "—", r.iduNo ?? "—", r.oduNo ?? "—", r.primaryBlockNo ?? "—", r.cabinetIn ?? "—",
    r.secBlockNo ?? "—", r.cabinetOut ?? "—", r.port131 ?? "—", r.len ?? "—",
    fmt(r.lastMeasTime),
  ];

  const handleExportExcel = () => {
    const out = rows.map((r, i) => Object.fromEntries(COLS.map((c, ci) => [c, asRow(r, i)[ci]])));
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بيان فنى بدون بورت");
    XLSX.writeFile(wb, "lines-without-port.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "أرقام لها بيان فنى وليس لها بورت",
      // نختصر الأعمدة فى الـ PDF عشان تبقى مقروءة
      columns: ["#", "رقم التليفون", "اسم العميل", "العنوان", "رقم الأكونت", "السنترال", "الكابينة", "البكس", "DP Terminal"],
      rows: rows.map((r, i) => [
        i + 1, r.telNo ?? r.fullPhone, r.subName ?? "—", r.subAdd ?? "—", r.accountNo ?? "—",
        r.central ?? "—", r.cabinNumber ?? "—", r.boxNumber ?? "—", r.dpTerminal ?? "—",
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
                <PlugZap className="w-4 h-4 text-amber-600" />
                أرقام لها بيان فنى وليس لها بورت
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                أرقام موجودة فى بيان 131 لكن مالهاش فريم/بورت على المسان — دى المستبعَدة من
                تقارير القياسات وبيان التليفونات.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RefreshButton queryKeys={["/api/reports/lines-without-port"]} />
              {/* جلب اسم/عنوان العميل من FCC لأرقام النطاق المعروض (سوبر أدمن) */}
              <ReviewSubscriberInfoButton filters={{ central, cabin, box }} />
              <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!rows.length} className="text-green-700 border-green-200">
                تصدير Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!rows.length} className="text-red-700 border-red-200">
                تصدير PDF
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <SearchableCombobox
              options={filterOptions?.centrals ?? []} value={central}
              onChange={(v) => { setCentral(v); setCabin(""); setBox(""); }}
              placeholder="كل السنترالات" searchPlaceholder="ابحث فى السنترالات..."
              className="w-full sm:w-44 text-sm"
            />
            <SearchableCombobox
              options={cabins} value={cabin}
              onChange={(v) => { setCabin(v); setBox(""); }}
              placeholder="كل الكباين" searchPlaceholder="ابحث فى الكباين..."
              disabled={!central} className="w-full sm:w-40 text-sm"
            />
            <SearchableCombobox
              options={boxes} value={box} onChange={setBox}
              placeholder="كل البكسيات" searchPlaceholder="ابحث فى البكسيات..."
              disabled={!central || !cabin} className="w-full sm:w-36 text-sm"
            />
            <div className="flex-1 min-w-[200px] relative">
              <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم التليفون أو الأكونت أو اسم العميل…" className="text-sm pr-8" />
              {search && (
                <button type="button" onClick={() => setSearch("")} title="مسح البحث"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>إجمالى: <strong className="text-foreground">{rows.length}</strong> رقم</span>
            {search && <span className="text-xs">(نتيجة البحث — من {all.length})</span>}
          </div>
        </div>

        {isFetching && !all.length ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="overflow-x-auto [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
            <Table className="text-right text-xs min-w-max" dir="rtl">
              <TableHeader className="bg-amber-800">
                <TableRow>
                  {COLS.map((c) => <TableHead key={c} className="text-white font-bold text-center">{c}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={COLS.length} className="text-center py-14 text-muted-foreground">
                    {search ? "مفيش أرقام مطابقة للبحث" : "مفيش أرقام لها بيان فنى بدون بورت 🎉"}
                  </TableCell></TableRow>
                ) : rows.map((r, i) => (
                  <TableRow key={r.fullPhone} className="hover:bg-muted/30">
                    <TableCell className="text-center text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-center font-mono font-semibold text-blue-700">{r.telNo ?? r.fullPhone}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{r.subName ?? "—"}</TableCell>
                    <TableCell className="max-w-[260px] truncate" title={r.subAdd ?? ""}>{r.subAdd ?? "—"}</TableCell>
                    <TableCell className="text-center font-mono">{r.accountNo ?? "—"}</TableCell>
                    <TableCell>{r.central ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.cabinNumber ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.boxNumber ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.dpTerminal ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.iduNo ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.oduNo ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.primaryBlockNo ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.cabinetIn ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.secBlockNo ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.cabinetOut ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.port131 ?? "—"}</TableCell>
                    <TableCell className="text-center">{r.len ?? "—"}</TableCell>
                    <TableCell className="text-center">{fmt(r.lastMeasTime)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
