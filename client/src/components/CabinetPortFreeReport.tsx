import { useState } from "react";
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

// «الفاضى لكل نوع بورت فى الكابينة» — سطر لكل (كابينة MSAN + نوع بورت):
// كام كارت، وسعتهم كام، وعليهم كام خط شغّال، وفاضل كام. مصدره ملف البورتات وحده
// (نفس مصدر تقرير «الكروت (شيلف/سلوت)») ومالوش أى علاقة بالمتعذرات.
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

interface Group {
  msanCode: string;
  portType: string;
  cards: number;
  capacity: number;
  working: number;
  free: number;
}

const groupByCabAndType = (rows: SlotRow[]): Group[] => {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const msanCode = (r.msanCode || "").trim() || "—";
    const portType = (r.portType || "").trim() || "غير محدّد";
    const k = `${msanCode}|${portType}`;
    let g = m.get(k);
    if (!g) { g = { msanCode, portType, cards: 0, capacity: 0, working: 0, free: 0 }; m.set(k, g); }
    g.cards += 1;
    g.capacity += cardCapacity(r);
    g.working += r.workingCount || 0;
    g.free += cardFree(r);
  }
  // ترتيب: الكابينة، وجوّه الكابينة الأكتر فاضى الأول
  return Array.from(m.values()).sort(
    (a, b) => a.msanCode.localeCompare(b.msanCode, "ar") || b.free - a.free
             || a.portType.localeCompare(b.portType, "ar"));
};

const COLS: [string, (g: Group) => any][] = [
  ["كود كابينة المسان", (g) => g.msanCode],
  ["نوع البورت", (g) => g.portType],
  ["عدد الكروت", (g) => g.cards],
  ["السعة", (g) => g.capacity],
  ["عدد الشغال", (g) => g.working],
  ["الفاضى", (g) => g.free],
];

export function CabinetPortFreeReport() {
  const [q, setQ] = useState("");
  // فلتر «الفاضى أكبر من N» — الكباين اللى لسه فيها مكان يستحمّل تركيبات
  const [freeGt, setFreeGt] = useState("");

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

  const all = groupByCabAndType(data?.data ?? []);
  const lim = parseInt(freeGt);
  const rows = freeGt !== "" && !isNaN(lim) ? all.filter((g) => g.free > lim) : all;

  const totalCards = rows.reduce((s, g) => s + g.cards, 0);
  const totalCapacity = rows.reduce((s, g) => s + g.capacity, 0);
  const totalWorking = rows.reduce((s, g) => s + g.working, 0);
  const totalFree = rows.reduce((s, g) => s + g.free, 0);
  const cabinets = new Set(rows.map((g) => g.msanCode)).size;

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      rows.map((g) => Object.fromEntries(COLS.map(([h, f]) => [h, f(g) ?? ""]))),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الفاضى بالنوع");
    XLSX.writeFile(wb, "الفاضى-لكل-نوع-بورت.xlsx");
  };

  const handleExportPDF = () => {
    printTablePDF({
      title: "الفاضى لكل نوع بورت فى الكابينة — من بيانات البورتات",
      columns: COLS.map(([h]) => h),
      rows: rows.map((g) => COLS.map(([, f]) => String(f(g) ?? "-"))),
    });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">الفاضى لكل نوع بورت فى الكابينة</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              سطر لكل (كابينة + نوع بورت): عدد الكروت وسعتها وعدد الشغّال عليها والفاضى منها.
              الشغّال = الخط اللى ليه فريم.
              {data && (
                <span className="text-purple-600">
                  {" "}({cabinets.toLocaleString("ar-EG")} كابينة — {totalCards.toLocaleString("ar-EG")} كارت —{" "}
                  {totalWorking.toLocaleString("ar-EG")} شغّال من سعة {totalCapacity.toLocaleString("ar-EG")} —{" "}
                  <span className="text-green-700 font-semibold">
                    فاضى {totalFree.toLocaleString("ar-EG")} بورت
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
              title="يعرض بس الكباين/الأنواع اللى الفاضى فيها أكبر من العدد ده"
              className="h-9 w-36 text-sm"
            />
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
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">مفيش بيانات — ارفع ملف البورتات الأول</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {COLS.map(([h]) => <TableHead key={h} className="text-right whitespace-nowrap">{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((g) => (
                <TableRow key={`${g.msanCode}|${g.portType}`}>
                  <TableCell className="whitespace-nowrap text-sm font-mono">{g.msanCode}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm font-semibold">{g.portType}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{g.cards}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{g.capacity}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm font-semibold">{g.working}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    <span className={g.free > 0 ? "font-bold text-green-700" : "text-red-600"}>{g.free}</span>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-bold">
                <TableCell className="whitespace-nowrap text-sm">الإجمالى</TableCell>
                <TableCell className="whitespace-nowrap text-sm">{cabinets} كابينة</TableCell>
                <TableCell className="whitespace-nowrap text-sm">{totalCards}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">{totalCapacity}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">{totalWorking}</TableCell>
                <TableCell className="whitespace-nowrap text-sm text-green-700">{totalFree}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
