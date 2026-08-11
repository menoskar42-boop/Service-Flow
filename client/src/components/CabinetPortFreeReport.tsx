import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshButton } from "@/components/RefreshButton";
import { Loader2, Search, X, FileSpreadsheet, Printer } from "lucide-react";
import * as XLSX from "xlsx";
import { printTablePDF } from "@/lib/print-pdf";
import { cardCapacity, cardFree } from "@/components/SlotCardsReport";

// «الفاضى لكل نوع بورت فى الكابينة» — جدول محوري: سطر واحد لكل كابينة MSAN، وكل
// نوع بورت (SV / VDSL / ADSL / ...) عمود مزدوج (شغّال | فاضى) تحت عنوان النوع.
// مصدره ملف البورتات وحده (نفس مصدر تقرير «الكروت (شيلف/سلوت)») ومالوش أى علاقة
// بالمتعذرات.
//  • الشغّال = البورت اللى ليه فريم (نفس تعريف الشغّال فى باقى التقارير).
//  • الكارت (السلوت) نوعه واحد، فسعته والفاضى فيه بيتحسبوا على نوعه. لو سلوت شاذ
//    فيه أكتر من نوع بيتحسب كله على النوع الغالب عليه (portType من السيرفر).
//  • سعة الكارت مش موجودة فى الملف فبتتحسب بقواعد السنترال — نفس الدوال
//    (cardCapacity / cardFree) المستخدمة فى تقرير الكروت عشان الرقمين مايختلفوش.
interface SlotRow {
  msanCode: string | null;
  shelf: string | null;
  slot: string | null;
  workingCount: number;
  portsCount: number;
  cardType: string | null;
  cardTypeCount: number;
  portType: string | null;
}

interface TypeCell { working: number; free: number; cards: number; capacity: number }

// ترتيب الأنواع المعروفة أولاً، وأى نوع تانى غريب بعدهم أبجدياً — بدل ما يتخفى.
const KNOWN_TYPES_ORDER = ["SV", "VDSL", "ADSL", "ESL"];

// pivot: كابينة → (نوع بورت → شغّال/فاضى/كروت/سعة)
function pivotByCabinet(rows: SlotRow[]): { cabinets: string[]; types: string[]; table: Map<string, Map<string, TypeCell>> } {
  const table = new Map<string, Map<string, TypeCell>>();
  const typesSeen = new Set<string>();
  for (const r of rows) {
    const msanCode = (r.msanCode || "").trim() || "—";
    const portType = (r.portType || "").trim() || "غير محدّد";
    typesSeen.add(portType);
    if (!table.has(msanCode)) table.set(msanCode, new Map());
    const cabMap = table.get(msanCode)!;
    if (!cabMap.has(portType)) cabMap.set(portType, { working: 0, free: 0, cards: 0, capacity: 0 });
    const cell = cabMap.get(portType)!;
    cell.cards += 1;
    cell.capacity += cardCapacity(r);
    cell.working += r.workingCount || 0;
    cell.free += cardFree(r);
  }
  const known = KNOWN_TYPES_ORDER.filter((t) => typesSeen.has(t));
  const rest = Array.from(typesSeen).filter((t) => !KNOWN_TYPES_ORDER.includes(t)).sort((a, b) => a.localeCompare(b, "ar"));
  const types = [...known, ...rest];
  const cabinets = Array.from(table.keys()).sort((a, b) => a.localeCompare(b, "ar"));
  return { cabinets, types, table };
}

// أنواع البورت اللى زرار «مفيش فاضى» بيتحقق منها — الكابينة بتظهر لو **كل** نوع
// من دول موجود عندها وفاضيه صفر (النوع اللى مش موجود أصلاً فى الكابينة بيتجاهل،
// عشان كابينة مالهاش ADSS خالص ماتتحسبش «مليانة ADSL»).
const ZERO_FREE_TYPES = ["SV", "VDSL", "ADSL"];

export function CabinetPortFreeReport() {
  const [q, setQ] = useState("");
  // فلتر «الفاضى أكبر من N» — بيقارن إجمالى الفاضى فى الكابينة (كل الأنواع مجمّعة)
  const [freeGt, setFreeGt] = useState("");
  // فلتر «مفيش فاضى (SV/VDSL/ADSL)» — الكباين المخنوقة فى الأنواع الأساسية
  const [zeroFreeOnly, setZeroFreeOnly] = useState(false);

  // نفس مصدر تقرير الكروت: سطر لكل سلوت — والتجميع بيتم هنا عشان السعة والفاضى
  // يتحسبوا بنفس القواعد بالظبط ومايبقاش فيه رقمين مختلفين لنفس الحاجة.
  const url = `/api/phone-ports/slot-cards?q=${encodeURIComponent(q)}`;
  const { data, isLoading } = useQuery({
    queryKey: [url],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "تعذّر التحميل");
      return res.json() as Promise<{ data: SlotRow[]; total: number }>;
    },
    refetchOnMount: "always",
  });

  const { cabinets: allCabinets, types, table } = pivotByCabinet(data?.data ?? []);
  const cellOf = (msan: string, type: string): TypeCell =>
    table.get(msan)?.get(type) ?? { working: 0, free: 0, cards: 0, capacity: 0 };
  const totalFreeOf = (msan: string) => types.reduce((s, t) => s + cellOf(msan, t).free, 0);
  const totalWorkingOf = (msan: string) => types.reduce((s, t) => s + cellOf(msan, t).working, 0);
  const totalCardsOf = (msan: string) => types.reduce((s, t) => s + cellOf(msan, t).cards, 0);

  const lim = parseInt(freeGt);
  const afterFreeGt = freeGt !== "" && !isNaN(lim) ? allCabinets.filter((c) => totalFreeOf(c) > lim) : allCabinets;
  // «مفيش فاضى»: كل نوع من (SV/VDSL/ADSL) موجود فى الكابينة لازم يكون فاضيه صفر.
  // لازم يكون فيه نوع واحد على الأقل من دول عندها (يعنى مش كابينة فايبر بحتة مثلاً).
  const cabinets = zeroFreeOnly
    ? afterFreeGt.filter((c) => {
        const present = ZERO_FREE_TYPES.filter((t) => cellOf(c, t).cards > 0);
        return present.length > 0 && present.every((t) => cellOf(c, t).free === 0);
      })
    : afterFreeGt;

  // إجماليات لكل نوع (عمود) + إجمالى عام
  const typeTotals = types.map((t) => ({
    type: t,
    cards: cabinets.reduce((s, c) => s + cellOf(c, t).cards, 0),
    working: cabinets.reduce((s, c) => s + cellOf(c, t).working, 0),
    free: cabinets.reduce((s, c) => s + cellOf(c, t).free, 0),
  }));
  const grandWorking = cabinets.reduce((s, c) => s + totalWorkingOf(c), 0);
  const grandFree = cabinets.reduce((s, c) => s + totalFreeOf(c), 0);
  const grandCapacity = cabinets.reduce((s, c) => s + types.reduce((s2, t) => s2 + cellOf(c, t).capacity, 0), 0);
  const grandCards = cabinets.reduce((s, c) => s + totalCardsOf(c), 0);

  const handleExportExcel = () => {
    // هيدر مزدوج بدمج خلايا (نفس شكل الشاشة): صف1 = اسم النوع (colSpan=3)، صف2 = كروت/شغال/فاضى
    const header1 = ["كود كابينة المسان", ...types.flatMap((t) => [t, "", ""]), "الإجمالى", "", ""];
    const header2 = ["", ...types.flatMap(() => ["عدد الكروت", "شغّال", "فاضى"]), "عدد الكروت", "شغّال", "فاضى"];
    const body = cabinets.map((c) => [
      c, ...types.flatMap((t) => [cellOf(c, t).cards, cellOf(c, t).working, cellOf(c, t).free]),
      totalCardsOf(c), totalWorkingOf(c), totalFreeOf(c),
    ]);
    const totalsRow = ["الإجمالى", ...typeTotals.flatMap((t) => [t.cards, t.working, t.free]), grandCards, grandWorking, grandFree];
    const aoa = [header1, header2, ...body, totalsRow];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const merges: XLSX.Range[] = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }, // كود كابينة المسان (رأسى صفين)
      ...types.map((_, i) => ({ s: { r: 0, c: 1 + i * 3 }, e: { r: 0, c: 3 + i * 3 } })), // كل نوع أفقى 3 أعمدة
      { s: { r: 0, c: 1 + types.length * 3 }, e: { r: 0, c: 3 + types.length * 3 } }, // الإجمالى
    ];
    ws["!merges"] = merges;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الفاضى بالنوع");
    XLSX.writeFile(wb, "الفاضى-لكل-نوع-بورت.xlsx");
  };

  const handleExportPDF = () => {
    // printTablePDF بياخد هيدر مستوى واحد بس — بندمج الاسمين فى عنوان واحد لكل عمود
    const columns = ["كود كابينة المسان", ...types.flatMap((t) => [`${t} — كروت`, `${t} — شغّال`, `${t} — فاضى`]),
      "الإجمالى — كروت", "الإجمالى — شغّال", "الإجمالى — فاضى"];
    const rows = cabinets.map((c) => [
      c, ...types.flatMap((t) => [cellOf(c, t).cards, cellOf(c, t).working, cellOf(c, t).free]),
      totalCardsOf(c), totalWorkingOf(c), totalFreeOf(c),
    ]);
    printTablePDF({ title: "الفاضى لكل نوع بورت فى الكابينة — من بيانات البورتات", columns, rows });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">الفاضى لكل نوع بورت فى الكابينة</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              سطر لكل كابينة، وكل نوع بورت عمود شغّال/فاضى. الشغّال = الخط اللى ليه فريم.
              {data && (
                <span className="text-purple-600">
                  {" "}({cabinets.length.toLocaleString("ar-EG")} كابينة — {grandCards.toLocaleString("ar-EG")} كارت —{" "}
                  {grandWorking.toLocaleString("ar-EG")} شغّال من سعة {grandCapacity.toLocaleString("ar-EG")} —{" "}
                  <span className="text-green-700 font-semibold">
                    فاضى {grandFree.toLocaleString("ar-EG")} بورت
                  </span>)
                </span>
              )}
              <br />
              <span className="text-[11px]">
                سعة الكارت: 64 بورت للكل، ما عدا كابينة 11-2-76-01 (32)، وأى كارت عليه أكتر من
                68 خط شغّال بيتحسب كارت 128.
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث بكود المسان / نوع البورت…"
                className="h-9 w-64 pr-8 text-sm"
              />
              {q && (
                <button type="button" onClick={() => setQ("")} title="مسح البحث"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <Input
              type="number" min={0} value={freeGt}
              onChange={(e) => setFreeGt(e.target.value)}
              placeholder="الفاضى أكبر من…"
              title="يعرض بس الكباين اللى إجمالى الفاضى فيها (كل الأنواع) أكبر من العدد ده"
              className="h-9 w-36 text-sm"
            />
            <Button
              variant={zeroFreeOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setZeroFreeOnly((v) => !v)}
              title="يعرض الكباين اللى الفاضى فيها = صفر فى SV و VDSL و ADSL (الأنواع الموجودة عندها فقط)"
              className={zeroFreeOnly ? "bg-red-600 hover:bg-red-700 gap-1" : "gap-1 text-red-700 border-red-200"}
            >
              مفيش فاضى (SV/VDSL/ADSL)
            </Button>
            <RefreshButton />
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="gap-1 text-green-700 border-green-200">
              <FileSpreadsheet className="w-4 h-4" /> تصدير Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="gap-1 text-red-700 border-red-200">
              <Printer className="w-4 h-4" /> تصدير PDF
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-auto">
        {isLoading ? (
          <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : cabinets.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">مفيش بيانات — ارفع ملف البورتات الأول</div>
        ) : (
          <Table>
            <TableHeader>
              {/* الصف الأول: كود الكابينة (ممتد صفين) + اسم كل نوع بورت (ممتد 3 أعمدة) */}
              <TableRow>
                <TableHead rowSpan={2} className="text-right align-bottom whitespace-nowrap border-l">كود كابينة المسان</TableHead>
                {types.map((t) => (
                  <TableHead key={t} colSpan={3} className="text-center font-bold border-l whitespace-nowrap">{t}</TableHead>
                ))}
                <TableHead colSpan={3} className="text-center font-bold whitespace-nowrap">الإجمالى</TableHead>
              </TableRow>
              {/* الصف الثانى: عدد الكروت / شغّال / فاضى تحت كل نوع */}
              <TableRow>
                {types.map((t) => (
                  <Fragment key={t}>
                    <TableHead className="text-center text-xs whitespace-nowrap">كروت</TableHead>
                    <TableHead className="text-center text-xs whitespace-nowrap">شغّال</TableHead>
                    <TableHead className="text-center text-xs whitespace-nowrap border-l">فاضى</TableHead>
                  </Fragment>
                ))}
                <TableHead className="text-center text-xs whitespace-nowrap">كروت</TableHead>
                <TableHead className="text-center text-xs whitespace-nowrap">شغّال</TableHead>
                <TableHead className="text-center text-xs whitespace-nowrap">فاضى</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cabinets.map((c) => (
                <TableRow key={c}>
                  <TableCell className="whitespace-nowrap text-sm font-mono border-l">{c}</TableCell>
                  {types.map((t) => {
                    const cell = cellOf(c, t);
                    const has = cell.cards > 0;
                    return (
                      <Fragment key={`${c}-${t}`}>
                        <TableCell className="text-center whitespace-nowrap text-sm text-muted-foreground">
                          {has ? cell.cards : "-"}
                        </TableCell>
                        <TableCell className="text-center whitespace-nowrap text-sm">
                          {has ? <span className="font-semibold">{cell.working}</span> : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="text-center whitespace-nowrap text-sm border-l">
                          {has ? <span className={cell.free > 0 ? "font-bold text-green-700" : "text-red-600"}>{cell.free}</span> : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                      </Fragment>
                    );
                  })}
                  <TableCell className="text-center whitespace-nowrap text-sm text-muted-foreground">{totalCardsOf(c)}</TableCell>
                  <TableCell className="text-center whitespace-nowrap text-sm font-semibold">{totalWorkingOf(c)}</TableCell>
                  <TableCell className="text-center whitespace-nowrap text-sm font-bold text-green-700">{totalFreeOf(c)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell className="whitespace-nowrap text-sm border-l">الإجمالى ({cabinets.length} كابينة)</TableCell>
                {typeTotals.map((t) => (
                  <Fragment key={t.type}>
                    <TableCell className="text-center whitespace-nowrap text-sm">{t.cards}</TableCell>
                    <TableCell className="text-center whitespace-nowrap text-sm">{t.working}</TableCell>
                    <TableCell className="text-center whitespace-nowrap text-sm text-green-700 border-l">{t.free}</TableCell>
                  </Fragment>
                ))}
                <TableCell className="text-center whitespace-nowrap text-sm">{grandCards}</TableCell>
                <TableCell className="text-center whitespace-nowrap text-sm">{grandWorking}</TableCell>
                <TableCell className="text-center whitespace-nowrap text-sm text-green-700">{grandFree}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
