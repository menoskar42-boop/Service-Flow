import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, FileSpreadsheet, ClipboardList, Search, FileText } from "lucide-react";
import { printVisualInspection, printTechnicalData, printCentralManagerLetter } from "@/lib/inspection-print";

// «تقارير التفتيش» — فلتر واحد (سنترال + كابينة/كباين) يغذّى كل التقارير:
//   • تصدير Excel (شيت القياسات + البيانات + الفحص الظاهرى) — كل الخانات ما عدا خانات العزل.
//   • محاضر PDF مطابقة للنماذج الرسمية (تُضاف لاحقاً).
// مصدر البيانات: /api/reports/inspection (phone_lines + cabinet_technicians).

interface LineRow {
  central: string; cabinNumber: string; boxNumber: string; dpTerminal: string;
  secBlockNo: string; cabinetOut: string; cabinetIn: string; primaryBlockNo: string;
  telNo: string; msanCode: string | null;
}
interface BoxRow {
  central: string; cabinNumber: string; boxNumber: string; msanCode: string;
  secBlockNo: string; dpTerminal: string; comb: string; capacity: number; occupancy: number;
  linkFrom: string; linkTo: string;
}
interface CabinetRow {
  central: string; cabinNumber: string; msanCode: string; boxCount: number; closedBoxes: number;
}
interface InspectionData { lines: LineRow[]; boxes: BoxRow[]; cabinets: CabinetRow[]; }
interface Options { centrals: string[]; copperCabins: Record<string, string[]>; }

export function InspectionReports() {
  const [central, setCentral] = useState("");
  const [cabins, setCabins] = useState<string[]>([]);
  const [cabinSearch, setCabinSearch] = useState("");

  const { data: opts } = useQuery<Options>({
    queryKey: ["/api/reports/cabinet-score-avg/options"],
    queryFn: async () => {
      const r = await fetch("/api/reports/cabinet-score-avg/options", { credentials: "include" });
      if (!r.ok) throw new Error("فشل تحميل الفلاتر");
      return r.json();
    },
  });

  const cabinOptions = useMemo(() => {
    const list = (central && opts?.copperCabins?.[central]) || [];
    const q = cabinSearch.trim();
    return q ? list.filter((c) => c.includes(q)) : list;
  }, [opts, central, cabinSearch]);

  const { data, isFetching } = useQuery<InspectionData>({
    queryKey: ["/api/reports/inspection", central, cabins.join(",")],
    enabled: !!central,
    queryFn: async () => {
      const p = new URLSearchParams({ central });
      if (cabins.length) p.set("cabins", cabins.join(","));
      const r = await fetch(`/api/reports/inspection?${p}`, { credentials: "include" });
      if (!r.ok) throw new Error("فشل التحميل");
      return r.json();
    },
  });

  const lines = data?.lines ?? [];
  const boxes = data?.boxes ?? [];

  const toggleCabin = (c: string) =>
    setCabins((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  const selectAllCabins = () => setCabins(cabinOptions);
  const clearCabins = () => setCabins([]);

  // ── تصدير Excel: 3 شيتات (القياسات / البيانات / الفحص الظاهرى) — كل الخانات ما عدا خانات العزل ──
  const handleExportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const thin = { style: "thin" as const, color: { argb: "FF999999" } };
    const border = { top: thin, bottom: thin, left: thin, right: thin };
    const styleHeader = (row: ExcelJS.Row) => {
      row.height = 26;
      row.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3D9C6" } };
        c.font = { bold: true, size: 11 };
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        c.border = border;
      });
    };
    const styleBody = (row: ExcelJS.Row) => {
      row.eachCell((c) => {
        c.alignment = { horizontal: "center", vertical: "middle" };
        c.border = border;
      });
    };
    const addSheet = (name: string, headers: [string, number][], rows: (string | number)[][]) => {
      const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true }] });
      // صف عنوان علوى: السنترال (+ الكابينة لو واحدة)
      const info = ws.addRow([`سنترال / ${central}${cabins.length === 1 ? `   —   رقم النحاس / ${cabins[0]}` : ""}`]);
      info.font = { bold: true, size: 12 };
      ws.mergeCells(1, 1, 1, headers.length);
      info.getCell(1).alignment = { horizontal: "right" };
      const hr = ws.addRow(headers.map(([h]) => h));
      styleHeader(hr);
      rows.forEach((r) => styleBody(ws.addRow(r)));
      ws.columns.forEach((col, i) => { col.width = headers[i]?.[1] ?? 14; });
    };

    // شيت القياسات (لكل خط) — عمودا العزل يُتركان فارغين
    addSheet("القياسات",
      [["Cabinet No", 14], ["DP No", 12], ["Sec Block No", 14], ["Cabinet Out", 14], ["قياس العزل B", 14], ["قياس العزل A", 14]],
      lines.map((l) => [l.cabinNumber, l.boxNumber, l.secBlockNo, l.cabinetOut, "", ""]),
    );
    // شيت البيانات (لكل خط)
    addSheet("البيانات",
      [["Cabinet No", 14], ["Dp No", 12], ["Dp Terminal", 14], ["Sec Block No", 14], ["Cabinet Out", 14], ["Tel No", 16], ["دقة البيانات", 14]],
      lines.map((l) => [l.cabinNumber, l.boxNumber, l.dpTerminal, l.secBlockNo, l.cabinetOut, l.telNo, ""]),
    );
    // شيت الفحص الظاهرى (لكل بكس)
    addSheet("ظاهري",
      [["رقم الكابينة", 14], ["رقم البكس", 12], ["السعة", 10], ["المشغولية", 12], ["رقم البلوك", 14], ["الربط في الكابينة (من)", 16], ["الربط في الكابينة (الي)", 16], ["عنوان البكس", 18]],
      boxes.map((b) => [b.cabinNumber, b.boxNumber, b.capacity, b.occupancy, b.secBlockNo, b.linkFrom, b.linkTo, ""]),
    );

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `تقارير-التفتيش-${central}-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="p-4 space-y-4" dir="rtl">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-amber-600" /> تقارير التفتيش
        </h2>
        <p className="text-xs text-muted-foreground">اختر السنترال والكابينة/الكباين، ثم صدّر النماذج المطلوبة.</p>
      </div>

      {/* الفلتر: سنترال + كباين متعددة */}
      <div className="grid gap-3 md:grid-cols-[220px_1fr] items-start">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">السنترال</label>
          <select
            value={central}
            onChange={(e) => { setCentral(e.target.value); setCabins([]); }}
            className="border rounded-md px-3 py-2 text-sm bg-background"
            dir="rtl"
          >
            <option value="">اختر السنترال</option>
            {opts?.centrals?.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="grid gap-1">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs text-muted-foreground">
              الكباين النحاسية {cabins.length > 0 && <span className="text-indigo-700 font-bold">({cabins.length} مختارة)</span>}
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={selectAllCabins} disabled={!central} className="text-xs text-indigo-700 hover:underline disabled:opacity-40">تحديد الكل</button>
              <button type="button" onClick={clearCabins} disabled={!cabins.length} className="text-xs text-red-600 hover:underline disabled:opacity-40">مسح</button>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute right-2 top-2.5 text-muted-foreground" />
            <input
              value={cabinSearch}
              onChange={(e) => setCabinSearch(e.target.value)}
              placeholder="بحث عن كابينة..."
              disabled={!central}
              className="w-full border rounded-md pr-8 pl-3 py-2 text-sm bg-background disabled:opacity-50"
              dir="rtl"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto rounded-md border p-2 bg-muted/20">
            {!central ? (
              <span className="text-xs text-muted-foreground">اختر السنترال أولاً</span>
            ) : cabinOptions.length === 0 ? (
              <span className="text-xs text-muted-foreground">لا توجد كباين</span>
            ) : cabinOptions.map((c) => {
              const on = cabins.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCabin(c)}
                  className={`text-xs rounded-md border px-2 py-1 transition-colors ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-background hover:bg-muted"}`}
                >{c}</button>
              );
            })}
          </div>
          <span className="text-[11px] text-muted-foreground">لو لم تختر أى كابينة، سيشمل التقرير كل كباين السنترال.</span>
        </div>
      </div>

      {/* أزرار التصدير */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleExportExcel} variant="outline" size="sm" disabled={!central || (!lines.length && !boxes.length)} className="gap-1 text-green-700 border-green-200">
          <FileSpreadsheet className="w-4 h-4" /> تصدير Excel (القياسات + البيانات + الظاهرى)
        </Button>
        <Button onClick={() => printVisualInspection(central, boxes)} variant="outline" size="sm" disabled={!boxes.length} className="gap-1 text-red-700 border-red-200">
          <FileText className="w-4 h-4" /> محضر الفحص الظاهرى (PDF)
        </Button>
        <Button onClick={() => printTechnicalData(central, boxes)} variant="outline" size="sm" disabled={!boxes.length} className="gap-1 text-red-700 border-red-200">
          <FileText className="w-4 h-4" /> محضر البيانات الفنية (PDF)
        </Button>
        <Button onClick={() => printCentralManagerLetter(central, data?.cabinets ?? [])} variant="outline" size="sm" disabled={!(data?.cabinets?.length)} className="gap-1 text-red-700 border-red-200">
          <FileText className="w-4 h-4" /> خطاب مدير السنترال (PDF)
        </Button>
        {isFetching && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> جارِ التحميل...</span>}
      </div>

      {/* معاينة على مستوى البكس */}
      <div className="rounded-md border max-h-[55vh] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {["رقم الكابينة", "رقم البكس", "كود MSAN", "رقم البلوك", "السعة", "المشغولية", "الربط من", "الربط الي"].map((h) => (
                <TableHead key={h} className="text-right whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!central ? (
              <TableRow><TableCell colSpan={8} className="text-center h-24 text-muted-foreground">اختر السنترال لعرض البكسيات</TableCell></TableRow>
            ) : boxes.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center h-24 text-muted-foreground">{isFetching ? "جارِ التحميل..." : "لا توجد بكسيات"}</TableCell></TableRow>
            ) : boxes.map((b, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap">{b.cabinNumber || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{b.boxNumber || "-"}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs">{b.msanCode || "-"}</TableCell>
                <TableCell className="whitespace-nowrap">{b.secBlockNo || "-"}</TableCell>
                <TableCell className="text-center">{b.capacity}</TableCell>
                <TableCell className="text-center font-semibold">{b.occupancy}</TableCell>
                <TableCell className="text-center">{b.linkFrom || "-"}</TableCell>
                <TableCell className="text-center">{b.linkTo || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="text-xs text-muted-foreground">
        عدد الخطوط: <strong>{lines.length}</strong> — عدد البكسيات: <strong>{boxes.length}</strong>
      </div>
    </Card>
  );
}
