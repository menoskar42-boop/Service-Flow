import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer } from "lucide-react";
import { format } from "date-fns";

interface UnassignedRow { msanCode: string; fccCode: string | null; subEx: string | null; fbbSubs: number }

interface CabinetRow {
  centralName: string;
  cabinNumber: string;
  msanCode: string;
  techName: string;
  workingAdsl: number;
  faultCount: number;
}

interface BoxRow {
  centralName: string;
  cabinNumber: string;
  boxNumber: string;
  techName: string;
  workingLines: number;
  faultCount: number;
}

const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];

export function CabinetAdslFaultsReport() {
  const today      = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo,   setDateTo]   = useState(today);
  const [central, setCentral]   = useState("");
  const [q, setQ]               = useState("");
  const [minFaults, setMinFaults]       = useState("");
  const [minProjected, setMinProjected] = useState("");
  const [tab, setTab] = useState<"tech" | "cabinet" | "box">("tech");
  const isBox  = tab === "box";
  const isTech = tab === "tech";

  const buildParams = () => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo)   p.set("dateTo",   dateTo);
    if (central)  p.set("central",  central);
    if (q.trim()) p.set("q", q.trim());
    return p;
  };

  const { data: cabinetData = [], isFetching: fetchingCabinet } = useQuery<CabinetRow[]>({
    queryKey: ["/api/reports/cabinet-adsl-faults", dateFrom, dateTo, central, q],
    queryFn: async () => {
      const res = await fetch(`/api/reports/cabinet-adsl-faults?${buildParams()}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const { data: boxData = [], isFetching: fetchingBox } = useQuery<BoxRow[]>({
    queryKey: ["/api/reports/box-faults", dateFrom, dateTo, central, q],
    queryFn: async () => {
      const res = await fetch(`/api/reports/box-faults?${buildParams()}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  const isFetching = fetchingCabinet || fetchingBox;

  // حساب أيام الفترة والشهر
  const periodDays = (() => {
    if (!dateFrom || !dateTo) return 31;
    const d = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
    return d > 0 ? d : 1;
  })();
  const monthDays = (() => {
    if (!dateFrom || !dateTo) return 31;
    const [y1, m1] = dateFrom.split("-").map(Number);
    const [y2, m2] = dateTo.split("-").map(Number);
    if (y1 === y2 && m1 === m2) return new Date(y1, m1, 0).getDate();
    return 31;
  })();

  const per1000   = (f: number, w: number) => (Number(w) > 0 ? Math.round(Number(f) * 1000 / Number(w) * 100) / 100 : 0);
  const projected = (f: number, w: number) => (Number(w) > 0 ? Math.round(Number(f) / periodDays * monthDays * 1000 / Number(w) * 100) / 100 : 0);

  const passMin = (f: number, w: number) => {
    if (minFaults    !== "" && !(Number(f) > Number(minFaults)))           return false;
    if (minProjected !== "" && !(projected(f, w) > Number(minProjected))) return false;
    return true;
  };

  // تاب لكل كابينه
  const cabinetRows = cabinetData
    .filter((r) => passMin(r.faultCount, r.workingAdsl))
    .sort((a, b) => per1000(b.faultCount, b.workingAdsl) - per1000(a.faultCount, a.workingAdsl));

  // تاب لكل فنى (تجميع من بيانات الكابينه)
  const techRows = (() => {
    const m = new Map<string, { techName: string; workingAdsl: number; faultCount: number }>();
    for (const r of cabinetData) {
      const key = r.techName || "غير معروف";
      const cur = m.get(key) ?? { techName: key, workingAdsl: 0, faultCount: 0 };
      cur.workingAdsl += Number(r.workingAdsl) || 0;
      cur.faultCount  += Number(r.faultCount)  || 0;
      m.set(key, cur);
    }
    return Array.from(m.values())
      .filter((r) => passMin(r.faultCount, r.workingAdsl))
      // ترتيب تصاعدى: الأقل أعطال/1000 = الأفضل = الأول (كل ما تزيد الأعطال يبقى أوحش)
      .sort((a, b) => per1000(a.faultCount, a.workingAdsl) - per1000(b.faultCount, b.workingAdsl));
  })();

  // تاب لكل بكس
  const boxRows = boxData
    .filter((r) => passMin(r.faultCount, r.workingLines))
    .sort((a, b) => per1000(b.faultCount, b.workingLines) - per1000(a.faultCount, a.workingLines));

  const displayRows: any[] = isBox ? boxRows : (isTech ? techRows : cabinetRows);
  const getW = (r: any) => isBox ? Number(r.workingLines) : Number(r.workingAdsl);
  const totWorking  = displayRows.reduce((s, r) => s + getW(r), 0);
  const totFaults   = displayRows.reduce((s, r) => s + (Number(r.faultCount) || 0), 0);
  const totPer1000  = per1000(totFaults, totWorking);
  const totProjected = projected(totFaults, totWorking);

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    const makeSheet = (data: any[], sheetName: string) => {
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    };
    if (isBox) {
      const data = boxRows.map((r, i) => ({
        "#": i + 1, "السنترال": r.centralName, "رقم الكابينه": r.cabinNumber,
        "رقم البكس": r.boxNumber, "اسم الفنى": r.techName,
        "عدد الخطوط": r.workingLines, "عدد الأعطال": r.faultCount,
        "أعطال لكل 1000 خط": per1000(r.faultCount, r.workingLines),
        "أعطال الألف المتوقع (نهاية الشهر)": projected(r.faultCount, r.workingLines),
      }));
      data.push({ "#": "", "السنترال": "إجمالى الإدارة", "رقم الكابينه": "", "رقم البكس": "", "اسم الفنى": "",
        "عدد الخطوط": totWorking, "عدد الأعطال": totFaults,
        "أعطال لكل 1000 خط": totPer1000, "أعطال الألف المتوقع (نهاية الشهر)": totProjected });
      makeSheet(data, "البكسيات");
    } else if (isTech) {
      const data = techRows.map((r, i) => ({
        "#": i + 1, "اسم الفنى": r.techName, "الشغال ADSL": r.workingAdsl,
        "عدد الأعطال": r.faultCount, "أعطال لكل 1000 مشترك": per1000(r.faultCount, r.workingAdsl),
        "أعطال الألف المتوقع (نهاية الشهر)": projected(r.faultCount, r.workingAdsl),
      }));
      data.push({ "#": "", "اسم الفنى": "إجمالى الإدارة", "الشغال ADSL": totWorking,
        "عدد الأعطال": totFaults, "أعطال لكل 1000 مشترك": totPer1000,
        "أعطال الألف المتوقع (نهاية الشهر)": totProjected });
      makeSheet(data, "بالفنى");
    } else {
      const data = cabinetRows.map((r, i) => ({
        "#": i + 1, "السنترال": r.centralName, "رقم الكابينه": r.cabinNumber,
        "كود الكابينه (MSAN)": r.msanCode, "اسم الفنى": r.techName,
        "الشغال ADSL": r.workingAdsl, "عدد الأعطال": r.faultCount,
        "أعطال لكل 1000 مشترك": per1000(r.faultCount, r.workingAdsl),
        "أعطال الألف المتوقع (نهاية الشهر)": projected(r.faultCount, r.workingAdsl),
      }));
      data.push({ "#": "", "السنترال": "إجمالى الإدارة", "رقم الكابينه": "", "كود الكابينه (MSAN)": "", "اسم الفنى": "",
        "الشغال ADSL": totWorking, "عدد الأعطال": totFaults,
        "أعطال لكل 1000 مشترك": totPer1000, "أعطال الألف المتوقع (نهاية الشهر)": totProjected });
      makeSheet(data, "الكابينه");
    }
    const suffix = isBox ? "box" : (isTech ? "tech" : "cabinet");
    XLSX.writeFile(wb, `faults-per-1000-${suffix}-${dateFrom}-${dateTo}.xlsx`);
  };

  const handleExportPDF = () => {
    const tabLabel = isBox ? "لكل بكس" : (isTech ? "لكل فنى" : "لكل كابينه");
    const title = `تقرير عدد الأعطال فى الألف ${tabLabel} — ${dateFrom} إلى ${dateTo}`;
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const colSpanTotal = isBox ? 5 : (isTech ? 2 : 5);
    const workingLabel = isBox ? "عدد الخطوط" : "الشغال ADSL";
    const per1000Label = isBox ? "أعطال / 1000 خط" : "أعطال / 1000";

    const head = isBox
      ? `<th>#</th><th>السنترال</th><th>رقم الكابينه</th><th>رقم البكس</th><th>اسم الفنى</th><th>${workingLabel}</th><th>عدد الأعطال</th><th>${per1000Label}</th><th>متوقع نهاية الشهر</th>`
      : isTech
        ? `<th>#</th><th>اسم الفنى</th><th>${workingLabel}</th><th>عدد الأعطال</th><th>${per1000Label}</th><th>متوقع نهاية الشهر</th>`
        : `<th>#</th><th>السنترال</th><th>رقم الكابينه</th><th>كود الكابينه (MSAN)</th><th>اسم الفنى</th><th>${workingLabel}</th><th>عدد الأعطال</th><th>${per1000Label}</th><th>متوقع نهاية الشهر</th>`;

    const cells = (r: any, n: number) => {
      const w = getW(r);
      const m = `<td>${esc(w)}</td><td>${esc(r.faultCount)}</td><td>${esc(per1000(r.faultCount, w))}</td><td>${esc(projected(r.faultCount, w))}</td>`;
      if (isBox)   return `<td>${n}</td><td>${esc(r.centralName)}</td><td>${esc(r.cabinNumber)}</td><td>${esc(r.boxNumber)}</td><td>${esc(r.techName)}</td>${m}`;
      if (isTech)  return `<td>${n}</td><td>${esc(r.techName)}</td>${m}`;
      return `<td>${n}</td><td>${esc(r.centralName)}</td><td>${esc(r.cabinNumber)}</td><td>${esc(r.msanCode)}</td><td>${esc(r.techName)}</td>${m}`;
    };

    const totalRow = `<tr class="total"><td colspan="${colSpanTotal}">إجمالى الإدارة</td><td>${esc(totWorking)}</td><td>${esc(totFaults)}</td><td>${esc(totPer1000)}</td><td>${esc(totProjected)}</td></tr>`;
    const ROWS_PER_PAGE = 22;
    const total = Math.max(1, Math.ceil(displayRows.length / ROWS_PER_PAGE));
    let pages = "";
    for (let pg = 0; pg < total; pg++) {
      const chunk = displayRows.slice(pg * ROWS_PER_PAGE, (pg + 1) * ROWS_PER_PAGE);
      let body = chunk.map((r, ci) => `<tr>${cells(r, pg * ROWS_PER_PAGE + ci + 1)}</tr>`).join("");
      if (pg === total - 1) body += totalRow;
      pages += `
        <section class="page">
          <h2>${esc(title)}</h2>
          <div class="pageno">صفحة ${pg + 1} من ${total}</div>
          <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 15px; margin: 0 0 4px; }
        .pageno { text-align: center; font-size: 10px; color: #64748b; margin-bottom: 8px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; } td, th { word-break: break-word; overflow-wrap: anywhere; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 7px 4px; border: 1px solid #15407f; font-size: 12px; }
        td { border: 1px solid #ccc; padding: 5px 4px; text-align: center; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        tr.total td { background: #1e50a0 !important; color: #fff !important; font-weight: bold; }
        .page { background: #fff; padding: 14px; margin: 12px auto; max-width: 900px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0; padding: 10px 14px; display: flex; gap: 10px; align-items: center; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; font-family: inherit; }
        @media print { body { background: #fff; } .toolbar { display: none; } .page { box-shadow: none; margin: 0; max-width: none; page-break-after: always; } @page { size: A4 landscape; margin: 10mm; } }
      </style></head><body>
      <div class="toolbar"><button onclick="try{window.close()}catch(e){};setTimeout(function(){history.length>1?history.back():location.href='/'},150)" style="padding:6px 14px;background:#475569;color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;margin-left:8px">↩ رجوع</button><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
        <span>اختر "حفظ بصيغة PDF" كوجهة الطباعة.</span></div>
      ${pages}</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const countLabel = isBox ? "عدد البكسيات" : (isTech ? "عدد الفنيين" : "عدد الكباين");
  // كباين موجودة فى ملف المشتركين ومش مسجّلة عندنا فى «فنيى الكباين» — مشتركينها
  // مش داخلين فى «الشغال ADSL»، وده بيفسّر أى فرق بين إجمالى التقرير وإجمالى الشيت.
  const { data: unassigned } = useQuery<{ rows: UnassignedRow[]; missingSubs: number; totalSheet: number }>({
    queryKey: ["/api/reports/cabinet-adsl-faults/unassigned"],
    queryFn: async () => {
      const res = await fetch("/api/reports/cabinet-adsl-faults/unassigned", { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchOnMount: "always",
  });
  const [showUnassigned, setShowUnassigned] = useState(false);

  const workingLabel = isBox ? "إجمالى الخطوط" : "إجمالى الشغال ADSL";

  return (
    <div className="space-y-4" dir="rtl">
      {/* Toolbar */}
      <Card className="p-4 bg-white border-0 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap items-end gap-2 w-full sm:w-auto">
            <div className="flex-1 sm:flex-none">
              <label className="text-xs text-muted-foreground block mb-1">من تاريخ</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-40 text-sm" />
            </div>
            <div className="flex-1 sm:flex-none">
              <label className="text-xs text-muted-foreground block mb-1">إلى تاريخ</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-40 text-sm" />
            </div>
          </div>
          <select
            value={central}
            onChange={(e) => setCentral(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm w-full sm:w-auto"
            dir="rtl"
          >
            <option value="">كل السنترالات</option>
            {CENTRALS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Input
            placeholder="بحث برقم الكابينه / كود الكابينه / البكس / الفنى"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full sm:max-w-xs text-sm"
            dir="rtl"
          />
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الأعطال أكبر من</label>
            <Input type="number" inputMode="numeric" value={minFaults} onChange={(e) => setMinFaults(e.target.value)} placeholder="مثال: 5" className="w-full sm:w-28 text-sm" dir="ltr" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">المتوقع أكبر من</label>
            <Input type="number" inputMode="decimal" value={minProjected} onChange={(e) => setMinProjected(e.target.value)} placeholder="مثال: 20" className="w-full sm:w-28 text-sm" dir="ltr" />
          </div>
          <div className="flex-1" />
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={displayRows.length === 0} className="text-green-700 border-green-200 gap-1">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={displayRows.length === 0} className="text-red-700 border-red-200 gap-1">
            <Printer className="w-4 h-4" /> PDF
          </Button>
        </div>
      </Card>

      {/* ثلاث تبويبات */}
      <div className="flex rounded-lg border overflow-hidden text-sm">
        {([["tech", "لكل فنى"], ["cabinet", "لكل كابينه"], ["box", "لكل بكس"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 px-4 py-2 font-medium transition-colors ${
              tab === key ? "bg-blue-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            عدد الأعطال فى الألف {label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-white p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-foreground">{displayRows.length}</div>
          <div className="text-xs text-muted-foreground mt-1">{countLabel}</div>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-green-700">{totWorking}</div>
          <div className="text-xs text-green-700 mt-1">{workingLabel}</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center shadow-sm">
          <div className="text-2xl font-bold text-red-700">{totFaults}</div>
          <div className="text-xs text-red-700 mt-1">إجمالى الأعطال</div>
        </div>
      </div>

      {/* كباين فى الشيت ومش مسجّلة عندنا — بتفسّر الفرق بين إجمالى التقرير وإجمالى الشيت */}
      {!isBox && !!unassigned && unassigned.missingSubs > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm" dir="rtl">
          <button onClick={() => setShowUnassigned((v) => !v)} className="w-full text-right font-medium text-amber-900">
            ⚠️ {unassigned.rows.length} كابينة فى ملف المشتركين مش مسجّلة عندنا فى «فنيى الكباين» —
            مشتركينها ({unassigned.missingSubs}) مش داخلين فى «الشغال ADSL»
            <span className="text-xs font-normal mr-2">({showUnassigned ? "إخفاء" : "عرض الأكواد"})</span>
          </button>
          {showUnassigned && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-amber-900">
                  <tr>
                    <th className="text-right py-1">كود MSAN</th>
                    <th className="text-right py-1">FCC</th>
                    <th className="text-right py-1">السنترال</th>
                    <th className="text-right py-1">شغال ADSL</th>
                  </tr>
                </thead>
                <tbody>
                  {unassigned.rows.map((r) => (
                    <tr key={r.msanCode} className="border-t border-amber-200">
                      <td className="py-1 font-mono">{r.msanCode}</td>
                      <td className="py-1">{r.fccCode ?? "-"}</td>
                      <td className="py-1">{r.subEx ?? "-"}</td>
                      <td className="py-1 font-semibold">{r.fbbSubs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-amber-800 mt-2">
                إجمالى الشيت (نحاس): {unassigned.totalSheet} — لو الكابينة تخصنا ضيفها فى «فنيى
                الكباين» بكود الـ MSAN وهتدخل التقرير تلقائياً.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-right font-bold w-10">#</TableHead>
                {!isTech && <TableHead className="text-right font-bold">السنترال</TableHead>}
                {!isTech && <TableHead className="text-right font-bold">رقم الكابينه</TableHead>}
                {tab === "cabinet" && <TableHead className="text-right font-bold">كود الكابينه (MSAN)</TableHead>}
                {tab === "box"     && <TableHead className="text-right font-bold">رقم البكس</TableHead>}
                <TableHead className="text-right font-bold">اسم الفنى</TableHead>
                <TableHead className="text-right font-bold">{isBox ? "عدد الخطوط" : "الشغال ADSL"}</TableHead>
                <TableHead className="text-right font-bold">عدد الأعطال</TableHead>
                <TableHead className="text-right font-bold">{isBox ? "أعطال / ١٠٠٠ خط" : "أعطال / ١٠٠٠ مشترك"}</TableHead>
                <TableHead className="text-right font-bold">المتوقع نهاية الشهر</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isBox || tab === "cabinet" ? 9 : 6} className="text-center py-14 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : isBox
                      ? "لا توجد بيانات — تأكد من رفع ملف بيان التليفونات وملف الأعطال 430D"
                      : "لا توجد بيانات — تأكد من رفع ملف الفنيين وملف مشتركى FTTH/ADSL"}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {displayRows.map((r, idx) => {
                    const w = getW(r);
                    const key = isBox
                      ? `${r.centralName}-${r.cabinNumber}-${r.boxNumber}-${idx}`
                      : isTech ? r.techName
                      : `${r.centralName}-${r.cabinNumber}-${r.msanCode}-${idx}`;
                    return (
                      <TableRow key={key} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        {!isTech && <TableCell className="whitespace-nowrap">{r.centralName}</TableCell>}
                        {!isTech && <TableCell className="font-semibold">{r.cabinNumber}</TableCell>}
                        {tab === "cabinet" && <TableCell className="font-mono text-xs">{r.msanCode}</TableCell>}
                        {tab === "box"     && <TableCell className="font-semibold">{r.boxNumber}</TableCell>}
                        <TableCell className="whitespace-nowrap">{r.techName}</TableCell>
                        <TableCell className="text-center font-bold text-green-700">{w}</TableCell>
                        <TableCell className="text-center font-bold text-red-700">{r.faultCount}</TableCell>
                        <TableCell className="text-center font-bold text-blue-700">{per1000(r.faultCount, w)}</TableCell>
                        <TableCell className="text-center font-bold text-purple-700">{projected(r.faultCount, w)}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-blue-900 hover:bg-blue-900">
                    <TableCell colSpan={isBox || tab === "cabinet" ? 5 : 2} className="text-white font-bold text-center">إجمالى الإدارة</TableCell>
                    <TableCell className="text-center text-white font-bold">{totWorking}</TableCell>
                    <TableCell className="text-center text-white font-bold">{totFaults}</TableCell>
                    <TableCell className="text-center text-white font-bold">{totPer1000}</TableCell>
                    <TableCell className="text-center text-white font-bold">{totProjected}</TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
