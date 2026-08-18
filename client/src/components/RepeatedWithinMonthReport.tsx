import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer, Info, Radar, Gauge, CircleSlash, X } from "lucide-react";
import { useSpeedToolsVisible, useIsSuperAdmin } from "@/lib/use-speed-tools";
import { useSpeedToolSource } from "@/hooks/use-speed-tool-source";
import { dispatchSpeedTool } from "@/lib/exec-queue";
import { openProfileOptimization } from "@/lib/profile-optimization";
import { LineDetailsDialog } from "@/components/LineDetailsDialog";

const DZS_URL = "https://10.42.187.101:8080/expresse/";
const buildDZSUrl = (accounts: string[]) =>
  `${DZS_URL}#sf_accounts=${encodeURIComponent(accounts.join(","))}`;

interface RepeatedRow {
  phoneShort: string | null;
  centralName: string | null;
  cabinetNo: string | null;
  boxNo: string | null;
  dpTerminal: string | null;
  techName: string | null;
  lastComplainNo: string | null;
  lastComplainTime: string | null;
  prevComplainNo: string | null;
  prevComplainTime: string | null;
  repeatCount: number | null;
  accountNo: string | null;
  lastMeasScore: number | null;
  lineCurrentSpeed: string | null;
  lineMaxSpeed: string | null;
  lastMeasTime: string | null;
}

// الأوقات مخزَّنة كـ UTC — تُعرض كما هى دون إزاحة المتصفح.
const fmtDt = (d: string | null) => {
  if (!d) return "-";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

const scoreBadge = (v: number | null | undefined) => {
  if (v == null) return <span className="text-gray-400">-</span>;
  const n = Number(v);
  const cls =
    n > 33 ? "bg-red-100 text-red-800" :
    n > 15 ? "bg-amber-100 text-amber-700" :
             "bg-green-100 text-green-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{n}</span>;
};

const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];

export function RepeatedWithinMonthReport() {
  const showSpeedTools = useSpeedToolsVisible();
  const isSuper = useIsSuperAdmin();
  useSpeedToolSource("الأعطال المكررة خلال شهر");
  const [detailPhone, setDetailPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [central, setCentral] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  // فلتر باسم الفنى — بيتفلتر على النتيجة المحمّلة (مش طلب جديد للسيرفر) فبيشتغل
  // فوراً، والقايمة نفسها بتتبنى من الأسماء الموجودة فى النتيجة الحالية.
  const [tech, setTech] = useState("");
  const { data: allRows = [], isFetching } = useQuery<RepeatedRow[]>({
    queryKey: ["/api/reports/repeated-within-month", central, q, dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (central) p.set("central", central);
      if (q) p.set("q", q);
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`/api/reports/repeated-within-month?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("فشل التحميل");
      return res.json();
    },
  });

  // أسماء الفنيين الموجودة فى النتيجة الحالية (مرتّبة عربى) + «بدون فنى» لو فيه صفوف ملهاش فنى
  const techOptions = Array.from(new Set(allRows.map((r) => (r.techName || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "ar"));
  const hasNoTech = allRows.some((r) => !(r.techName || "").trim());
  const NO_TECH = "__none__";
  const rows = !tech
    ? allRows
    : tech === NO_TECH
      ? allRows.filter((r) => !(r.techName || "").trim())
      : allRows.filter((r) => (r.techName || "").trim() === tech);

  const rangeLabel = `تاريخ آخر شكوى من ${dateFrom || "البداية"} إلى ${dateTo || "النهاية"}`;

  // أرقام الأكونت للصفوف المعروضة (بعد كل الفلاتر) — من غير تكرار
  const shownAccounts = () => {
    const seen = new Set<string>();
    return rows.map((r) => (r.accountNo ?? "").toString().trim())
               .filter((a) => a && !seen.has(a) && seen.add(a));
  };

  // قياس DZS لخط واحد
  const measureOne = async (r: RepeatedRow) => {
    const acc = (r.accountNo ?? "").toString().trim();
    if (!acc) { alert("لا يوجد رقم أكونت لهذا الخط"); return; }
    if (await dispatchSpeedTool("measure", [acc], isSuper)) return;
    window.open(buildDZSUrl([acc]), "dzs_measure");
  };

  // قياس كل الأرقام المعروضة
  const measureAll = async () => {
    const accounts = shownAccounts();
    if (!accounts.length) { alert("لا توجد أرقام أكونت فى الصفوف المعروضة"); return; }
    setBusy(true);
    const w = window.open("about:blank", "dzs_measure");
    try {
      if (await dispatchSpeedTool("measure", accounts, isSuper)) { try { w?.close(); } catch {} return; }
      if (w) w.location.href = buildDZSUrl(accounts);
    } finally { setBusy(false); }
  };

  // رفع السرعة / إيقاف الـ PO لكل الأرقام المعروضة
  const raiseOrStop = async (kind: "raise" | "stop") => {
    const accounts = shownAccounts();
    if (!accounts.length) { alert("لا توجد أرقام أكونت فى الصفوف المعروضة"); return; }
    const afterStop = kind === "raise"
      ? window.confirm("رفع السرعة والإيقاف؟\n\nموافق = رفع السرعة لكل الأرقام ثم إيقاف الـ Nightly الناتج لكلهم\nإلغاء = رفع السرعة فقط")
      : false;
    setBusy(true);
    try {
      if (await dispatchSpeedTool(kind === "stop" ? "stop" : "raise", accounts, isSuper)) return;
      openProfileOptimization(accounts, kind === "stop" ? { stopOnly: true } : { afterStop });
    } finally { setBusy(false); }
  };

  const handleExportExcel = () => {
    const data = rows.map((r, i) => ({
      "#": i + 1,
      "السنترال": r.centralName,
      "رقم التليفون": r.phoneShort,
      "رقم الأكونت": r.accountNo,
      "عدد التكرار خلال الشهر": r.repeatCount,
      "رقم آخر شكوى": r.lastComplainNo,
      "تاريخ آخر شكوى": fmtDt(r.lastComplainTime),
      "رقم الشكوى السابقة": r.prevComplainNo,
      "تاريخ الشكوى السابقة": fmtDt(r.prevComplainTime),
      "الكابينه": r.cabinetNo,
      "البكس": r.boxNo,
      "ترمنال": r.dpTerminal,
      "اسم الفنى": r.techName,
      "آخر اسكور": r.lastMeasScore,
      "السرعة الحالية": r.lineCurrentSpeed,
      "أقصى سرعة": r.lineMaxSpeed,
      "تاريخ آخر قياس": fmtDt(r.lastMeasTime),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "مكررة خلال شهر");
    XLSX.writeFile(wb, `repeated-within-month-${dateFrom || "all"}_${dateTo || "all"}.xlsx`);
  };

  const handleExportPDF = () => {
    const title = `الأعطال المكررة خلال شهر من تاريخه (${rangeLabel})`;
    const esc = (v: any) =>
      String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ROWS_PER_PAGE = 12;
    const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    const headRow = `<tr>
      <th>#</th><th>السنترال</th><th>التليفون</th><th>الأكونت</th><th>عدد التكرار</th>
      <th>رقم آخر شكوى</th><th>تاريخ آخر شكوى</th><th>رقم الشكوى السابقة</th><th>تاريخ الشكوى السابقة</th>
      <th>الكابينه</th><th>البكس</th><th>ترمنال</th><th>اسم الفنى</th><th>آخر اسكور</th>
    </tr>`;
    let pages = "";
    for (let p = 0; p < totalPages; p++) {
      const chunk = rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
      const body = chunk.map((r, ci) => `
        <tr>
          <td>${p * ROWS_PER_PAGE + ci + 1}</td>
          <td>${esc(r.centralName)}</td>
          <td>${esc(r.phoneShort)}</td>
          <td>${esc(r.accountNo)}</td>
          <td>${esc(r.repeatCount)}</td>
          <td>${esc(r.lastComplainNo)}</td>
          <td style="font-size:9px">${esc(fmtDt(r.lastComplainTime))}</td>
          <td>${esc(r.prevComplainNo)}</td>
          <td style="font-size:9px">${esc(fmtDt(r.prevComplainTime))}</td>
          <td>${esc(r.cabinetNo)}</td>
          <td>${esc(r.boxNo)}</td>
          <td>${esc(r.dpTerminal)}</td>
          <td>${esc(r.techName)}</td>
          <td>${esc(r.lastMeasScore)}</td>
        </tr>`).join("");
      pages += `
        <section class="page">
          <h2>${esc(title)}</h2>
          <div class="pageno">صفحة ${p + 1} من ${totalPages} — إجمالي: ${rows.length} رقم</div>
          <table><thead>${headRow}</thead><tbody>${body}</tbody></table>
        </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>${esc(title)}</title>
      <style>
        body { font-family: Arial, "Segoe UI", sans-serif; font-size: 11px; direction: rtl; margin: 0; background: #f1f5f9; }
        h2 { text-align: center; font-size: 14px; margin: 0 0 4px; }
        .pageno { text-align: center; font-size: 10px; color: #64748b; margin-bottom: 8px; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { width: 100%; border-collapse: collapse; } td, th { word-break: break-word; overflow-wrap: anywhere; }
        th { background: #1e50a0 !important; color: #fff !important; padding: 6px 3px; border: 1px solid #15407f; font-size: 11px; }
        td { border: 1px solid #ccc; padding: 5px 3px; text-align: right; color: #111; }
        tbody tr:nth-child(even) { background: #eef2fb !important; }
        .page { background: #fff; padding: 12px; margin: 12px auto; max-width: 1150px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
        .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e2e8f0;
          padding: 8px 12px; display: flex; gap: 10px; align-items: center; z-index: 10; }
        .toolbar button.back { background: #475569; }
        .toolbar button { background: #dc2626; color: #fff; border: 0; border-radius: 6px;
          padding: 7px 14px; font-size: 12px; cursor: pointer; font-family: inherit; }
        .toolbar span { color: #475569; font-size: 11px; }
        @media print {
          body { background: #fff; }
          .toolbar { display: none; }
          .page { box-shadow: none; margin: 0; padding: 0; max-width: none; page-break-after: always; }
          .page:last-child { page-break-after: auto; }
          @page { size: A4 landscape; margin: 8mm; }
        }
      </style></head><body>
      <div class="toolbar">
        <button class="back" onclick="try{window.close()}catch(e){};setTimeout(function(){history.length>1?history.back():location.href='/'},150)">↩ رجوع</button>
        <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
        <span>في نافذة الطباعة اختر &quot;حفظ بصيغة PDF&quot; كوجهة الطباعة.</span>
      </div>
      ${pages}
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">تاريخ آخر شكوى من</span>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-sm w-auto" dir="ltr" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">إلى</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-sm w-auto" dir="ltr" />
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
        <select
          value={tech}
          onChange={(e) => setTech(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm w-full sm:w-auto"
          dir="rtl"
          title="فلترة بالفنى — الأسماء من نتيجة الفترة المعروضة"
        >
          <option value="">كل الفنيين</option>
          {techOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          {hasNoTech && <option value={NO_TECH}>— بدون فنى —</option>}
        </select>
        <Input
          placeholder="بحث برقم التليفون"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:max-w-xs text-sm"
          dir="rtl"
        />
        <div className="flex-1" />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        <span className="text-sm text-muted-foreground">إجمالي: <strong>{rows.length}</strong> رقم مكرر</span>
        {showSpeedTools && (
          <>
            <Button
              variant="outline" size="sm" onClick={measureAll}
              disabled={busy || rows.length === 0}
              title="قياس DZS لكل الأرقام المعروضة (بعد الفلاتر)"
              className="text-blue-700 border-blue-200 gap-1"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />} قياس DZS
            </Button>
            <Button
              variant="outline" size="sm" onClick={() => raiseOrStop("raise")}
              disabled={busy || rows.length === 0}
              title="رفع السرعة لكل الأرقام المعروضة"
              className="text-emerald-700 border-emerald-200 gap-1"
            >
              <Gauge className="w-4 h-4" /> رفع سرعة
            </Button>
            <Button
              variant="outline" size="sm" onClick={() => raiseOrStop("stop")}
              disabled={busy || rows.length === 0}
              title="إيقاف الـ PO لكل الأرقام المعروضة"
              className="text-orange-700 border-orange-200 gap-1"
            >
              <CircleSlash className="w-4 h-4" /> إيقاف PO
            </Button>
          </>
        )}
        <Button
          variant="outline" size="sm"
          onClick={handleExportExcel}
          disabled={rows.length === 0}
          className="text-green-700 border-green-200 gap-1"
        >
          <FileSpreadsheet className="w-4 h-4" /> Excel
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={handleExportPDF}
          disabled={rows.length === 0}
          className="text-red-700 border-red-200 gap-1"
        >
          <Printer className="w-4 h-4" /> PDF
        </Button>
      </div>

      {detailPhone && <LineDetailsDialog phone={detailPhone} onClose={() => setDetailPhone(null)} />}

      {/* Table */}
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-xs" dir="rtl">
            <TableHeader className="bg-blue-900">
              <TableRow>
                <TableHead className="text-right font-bold text-white w-8">#</TableHead>
                <TableHead className="text-right font-bold text-white">السنترال</TableHead>
                <TableHead className="text-right font-bold text-white">التليفون</TableHead>
                <TableHead className="text-right font-bold text-white">الأكونت</TableHead>
                <TableHead className="text-right font-bold text-white">عدد التكرار خلال الشهر</TableHead>
                <TableHead className="text-right font-bold text-white">رقم آخر شكوى</TableHead>
                <TableHead className="text-right font-bold text-white">تاريخ آخر شكوى</TableHead>
                <TableHead className="text-right font-bold text-white">رقم الشكوى السابقة</TableHead>
                <TableHead className="text-right font-bold text-white">تاريخ الشكوى السابقة</TableHead>
                <TableHead className="text-right font-bold text-white">الكابينه</TableHead>
                <TableHead className="text-right font-bold text-white">البكس</TableHead>
                <TableHead className="text-right font-bold text-white">ترمنال</TableHead>
                <TableHead className="text-right font-bold text-white">اسم الفنى</TableHead>
                <TableHead className="text-right font-bold text-white">آخر اسكور</TableHead>
                <TableHead className="text-right font-bold text-white">تاريخ آخر قياس</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={15} className="text-center py-16 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : "لا توجد أرقام مكررة خلال شهر في هذه الفترة"}
                  </TableCell>
                </TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i} className="hover:bg-muted/30">
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>{r.centralName || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left font-mono font-semibold text-blue-700">
                    <span className="inline-flex items-center gap-1.5">
                      {r.phoneShort || "-"}
                      {r.phoneShort && (
                        <button
                          type="button"
                          onClick={() => setDetailPhone(r.phoneShort!)}
                          title="تفاصيل أكتر (الاسم والعنوان وبيانات الخط)"
                          className="text-purple-600 hover:text-purple-800"
                        >
                          <Info className="w-4 h-4" />
                        </button>
                      )}
                    </span>
                  </TableCell>
                  <TableCell dir="ltr" className="text-left font-mono">
                    <span className="inline-flex items-center gap-1.5">
                      {r.accountNo || "-"}
                      {showSpeedTools && r.accountNo && (
                        <button
                          type="button"
                          onClick={() => measureOne(r)}
                          title="قياس DZS للخط ده لوحده"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <Radar className="w-4 h-4" />
                        </button>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs px-2 py-0.5 rounded font-semibold bg-purple-100 text-purple-800">{r.repeatCount ?? "-"}</span>
                  </TableCell>
                  <TableCell dir="ltr" className="text-left font-mono">{r.lastComplainNo || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left whitespace-nowrap">{fmtDt(r.lastComplainTime)}</TableCell>
                  <TableCell dir="ltr" className="text-left font-mono">{r.prevComplainNo || "-"}</TableCell>
                  <TableCell dir="ltr" className="text-left whitespace-nowrap">{fmtDt(r.prevComplainTime)}</TableCell>
                  <TableCell>{r.cabinetNo || "-"}</TableCell>
                  <TableCell>{r.boxNo || "-"}</TableCell>
                  <TableCell>{r.dpTerminal || "-"}</TableCell>
                  <TableCell className="max-w-[120px] truncate">{r.techName || "-"}</TableCell>
                  <TableCell>{scoreBadge(r.lastMeasScore)}</TableCell>
                  <TableCell dir="ltr" className="text-left whitespace-nowrap">{fmtDt(r.lastMeasTime)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
