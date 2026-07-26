import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileSpreadsheet, Printer, Repeat2, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";

interface RepDetailRow {
  phoneNumber: string; centralName: string; lineCabin: string | null; lineBox: string | null;
  msanCode: string | null; frame: string | null; appearances: number; complainNo: string;
  complainTime: string | null; closeTime: string | null; closeCode: string | null;
  closeByName: string; areaTechName: string;
}
interface Beyond24Row {
  complainNo: string; phoneNumber: string; centralName: string; cabinetNo: string;
  complainTime: string; closeTime: string; closeCode: string | null; hours: number;
  closeByName: string; areaTechName: string; lineCabin: string | null; lineBox: string | null;
  msanCode: string | null; frame: string | null;
}

const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];
const REP_TARGET  = 4;  // مستهدف التكرار 4%
const ADSL_TARGET = 25; // مستهدف أعطال/1000 = 25
const MAX_OM    = 10;
const MAX_REP   = 35;
const MAX_ADSL  = 35;
const MAX_REM   = 20;
const MAX_TOTAL = MAX_OM + MAX_REP + MAX_ADSL + MAX_REM; // 75

const fmt1 = (v: number | null | undefined) =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toFixed(1);
const fmt2 = (v: number | null | undefined) =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toFixed(2);

function omScore(pct: number | null): number {
  if (pct == null) return 0;
  return Math.round(Math.min(MAX_OM, (Number(pct) / 100) * MAX_OM) * 10) / 10;
}
function repScore(ratio: number | null): number {
  if (ratio == null) return MAX_REP; // لا توجد تكرارات = ممتاز
  if (Number(ratio) <= 0) return MAX_REP;
  if (Number(ratio) <= REP_TARGET) return MAX_REP;
  return Math.round(Math.min(MAX_REP, MAX_REP * REP_TARGET / Number(ratio)) * 10) / 10;
}
function adslScore(per1000: number | null): number {
  if (per1000 == null) return 0;
  if (Number(per1000) <= 0) return MAX_ADSL; // صفر أعطال = ممتاز
  if (Number(per1000) <= ADSL_TARGET) return MAX_ADSL; // عند المستهدف أو أفضل
  return Math.round(Math.min(MAX_ADSL, MAX_ADSL * ADSL_TARGET / Number(per1000)) * 10) / 10;
}
function remScore(pct24: number | null): number {
  if (pct24 == null) return 0;
  return Math.round(Math.min(MAX_REM, (Number(pct24) / 100) * MAX_REM) * 10) / 10;
}

interface TechRow {
  techName: string;
  // OM
  omPct: number | null;
  omScore: number;
  // Repetition
  repRatio: number | null;
  repScore: number;
  // Faults/1000
  per1000: number | null;
  adslScore: number;
  // Removal
  pct24h: number | null;
  remScore: number;
  // Total
  total: number;
}

export function TechPerformanceReport() {
  const { user } = useAuth();
  const today      = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo,   setDateTo]   = useState(today);
  // حوارات التفاصيل (نفس منطق تقارير التكرار/الإزالة)
  const [repOpen, setRepOpen] = useState(false);
  const [repDetailData, setRepDetailData] = useState<RepDetailRow[] | null>(null);
  const [repLoading, setRepLoading] = useState(false);
  const [b24Open, setB24Open] = useState(false);
  const [b24Data, setB24Data] = useState<Beyond24Row[] | null>(null);
  const [b24Loading, setB24Loading] = useState(false);
  const [central, setCentral]   = useState("");

  const buildParams = (extra?: Record<string, string>) => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo)   p.set("dateTo",   dateTo);
    if (central)  p.set("central",  central);
    if (extra) Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    return p.toString();
  };

  // عدد أيام الفترة ومُضاعِف الشهر (لحساب المتوقع بنهاية الشهر)
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

  const fetchJson = async (url: string) => {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("فشل التحميل");
    return res.json();
  };

  const { data: removalData, isFetching: f1 } = useQuery({
    queryKey: ["/api/reports/combined-stats", dateFrom, dateTo, central],
    queryFn: () => fetchJson(`/api/reports/combined-stats?${buildParams()}`),
  });
  const { data: repData, isFetching: f2 } = useQuery({
    queryKey: ["/api/reports/repetition-combined", dateFrom, dateTo, central],
    queryFn: () => fetchJson(`/api/reports/repetition-combined?${buildParams()}`),
  });
  const { data: cabinetData, isFetching: f3 } = useQuery<any[]>({
    queryKey: ["/api/reports/cabinet-adsl-faults", dateFrom, dateTo, central],
    queryFn: () => fetchJson(`/api/reports/cabinet-adsl-faults?${buildParams()}`),
  });
  const { data: omData, isFetching: f4 } = useQuery({
    // نسبة تحقيق المتعذرات فى أداء الفنيين تُحسب على متعذرات السنة الحالية (2026) فقط
    queryKey: ["/api/reports/om-stats", "current"],
    queryFn: () => fetchJson(`/api/reports/om-stats?yearFilter=current`),
  });

  const isFetching = f1 || f2 || f3 || f4;

  const rows = useMemo<TechRow[]>(() => {
    if (!removalData && !repData && !cabinetData && !omData) return [];

    // --- بيانات الإزالة (byTechOnly) ---
    const remMap = new Map<string, number>(); // techName → pct24h
    for (const r of removalData?.byTechOnly ?? []) {
      if (r.techName) remMap.set(r.techName, Number(r.pct24h) || 0);
    }

    // --- بيانات التكرار (byTechOnly) ---
    const repMap = new Map<string, number | null>(); // techName → repRatio
    for (const r of repData?.byTechOnly ?? []) {
      if (r.techName) repMap.set(r.techName, r.repRatio != null ? Number(r.repRatio) : null);
    }

    // --- بيانات الأعطال فى الألف (cabinet → aggregate by techName) ---
    const adslMap = new Map<string, { working: number; faults: number }>();
    for (const r of cabinetData ?? []) {
      const names = String(r.techName || "غير معروف").split(" , ").map((n: string) => n.trim()).filter(Boolean);
      const share = names.length || 1;
      for (const name of names) {
        const cur = adslMap.get(name) ?? { working: 0, faults: 0 };
        cur.working += Math.round((Number(r.workingAdsl) || 0) / share);
        cur.faults  += Math.round((Number(r.faultCount)  || 0) / share);
        adslMap.set(name, cur);
      }
    }

    // --- بيانات المتعذرات OM (byTech) ---
    const omMap = new Map<string, number>(); // techName → pctResolved
    for (const r of omData?.byTech ?? []) {
      if (r.techName) omMap.set(r.techName, Number(r.pctResolved) || 0);
    }

    // --- تجميع أسماء الفنيين من كل المصادر ---
    const allTechs = new Set<string>([
      ...remMap.keys(), ...repMap.keys(), ...adslMap.keys(), ...omMap.keys(),
    ]);
    allTechs.delete("غير معروف");

    // المتوقع بنهاية الشهر = (أعطال ÷ أيام الفترة) × أيام الشهر × 1000 ÷ الشغال
    const per1000Map = new Map<string, number | null>();
    for (const name of allTechs) {
      const d = adslMap.get(name);
      if (d && d.working > 0 && periodDays > 0) {
        per1000Map.set(name, Math.round(d.faults / periodDays * monthDays * 1000 / d.working * 100) / 100);
      } else {
        per1000Map.set(name, null);
      }
    }
    const result: TechRow[] = [];
    for (const name of allTechs) {
      const omPct   = omMap.get(name) ?? null;
      const repRatio = repMap.get(name) ?? null;
      const p1000   = per1000Map.get(name) ?? null;
      const pct24h  = remMap.get(name) ?? null;

      const s_om  = omScore(omPct);
      const s_rep = repScore(repRatio);
      const s_asl = adslScore(p1000);
      const s_rem = remScore(pct24h);

      result.push({
        techName: name,
        omPct, omScore: s_om,
        repRatio, repScore: s_rep,
        per1000: p1000, adslScore: s_asl,
        pct24h, remScore: s_rem,
        total: Math.round((s_om + s_rep + s_asl + s_rem) * 10) / 10,
      });
    }

    return result.sort((a, b) => b.total - a.total);
  }, [removalData, repData, cabinetData, omData, periodDays, monthDays]);

  // صف إجمالى الإدارة
  const overall = useMemo(() => {
    const remO = removalData?.overall;
    const repO = repData?.overall;
    const omO  = omData?.overall;

    const adslWorking = (cabinetData ?? []).reduce((s: number, r: any) => s + (Number(r.workingAdsl) || 0), 0);
    const adslFaults  = (cabinetData ?? []).reduce((s: number, r: any) => s + (Number(r.faultCount)  || 0), 0);
    const overallP1000 = adslWorking > 0 && periodDays > 0
      ? Math.round(adslFaults / periodDays * monthDays * 1000 / adslWorking * 100) / 100
      : null;

    const omPct   = omO  ? Number(omO.pctResolved)  : null;
    const repRatio = repO ? Number(repO.repRatio)    : null;
    const pct24h  = remO ? Number(remO.pct24h)       : null;

    return {
      omPct, omScore: omScore(omPct),
      repRatio, repScore: repScore(repRatio),
      per1000: overallP1000, adslScore: adslScore(overallP1000),
      pct24h, remScore: remScore(pct24h),
      total: Math.round((omScore(omPct) + repScore(repRatio) + adslScore(overallP1000) + remScore(pct24h)) * 10) / 10,
    };
  }, [removalData, repData, cabinetData, omData, periodDays, monthDays]);

  const handleExportExcel = () => {
    const data = rows.map((r, i) => ({
      "#": i + 1,
      "اسم الفنى": r.techName,
      "نسبة تحقيق المتعذرات %": r.omPct ?? "",
      [`درجة المتعذرات /${MAX_OM}`]: r.omScore,
      "نسبة التكرار %": r.repRatio ?? "",
      [`درجة التكرار /${MAX_REP}`]: r.repScore,
      "أعطال/1000 متوقع نهاية الشهر": r.per1000 ?? "",
      [`درجة الأعطال /${MAX_ADSL}`]: r.adslScore,
      "نسبة الإزالة 24h %": r.pct24h ?? "",
      [`درجة الإزالة /${MAX_REM}`]: r.remScore,
      [`الدرجة النهائية /${MAX_TOTAL}`]: r.total,
    }));
    data.push({
      "#": "" as any,
      "اسم الفنى": "إجمالى الإدارة",
      "نسبة تحقيق المتعذرات %": overall.omPct ?? "",
      [`درجة المتعذرات /${MAX_OM}`]: overall.omScore,
      "نسبة التكرار %": overall.repRatio ?? "",
      [`درجة التكرار /${MAX_REP}`]: overall.repScore,
      "أعطال/1000 متوقع نهاية الشهر": overall.per1000 ?? "",
      [`درجة الأعطال /${MAX_ADSL}`]: overall.adslScore,
      "نسبة الإزالة 24h %": overall.pct24h ?? "",
      [`درجة الإزالة /${MAX_REM}`]: overall.remScore,
      [`الدرجة النهائية /${MAX_TOTAL}`]: overall.total,
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أداء الفنيين");
    XLSX.writeFile(wb, `tech-performance-${dateFrom}-${dateTo}.xlsx`);
  };

  const handleExportPDF = () => {
    const title = `تقرير أداء الفنيين — ${dateFrom} إلى ${dateTo}`;
    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const scoreCell = (v: number) =>
      `<td style="background:${v >= 18 ? "#dcfce7" : v >= 12 ? "#fef9c3" : "#fee2e2"}">${esc(v)}</td>`;
    const totalCell = (v: number) =>
      `<td style="font-weight:bold;background:${v >= 55 ? "#bbf7d0" : v >= 40 ? "#fef08a" : "#fecaca"}">${esc(v)}</td>`;

    const head = `<th>#</th><th>اسم الفنى</th>
      <th>نسبة تحقيق<br/>المتعذرات %</th><th>درجة المتعذرات<br/>/${MAX_OM}</th>
      <th>نسبة التكرار %</th><th>درجة التكرار<br/>/${MAX_REP}</th>
      <th>أعطال/1000<br/>(متوقع نهاية الشهر)</th><th>درجة الأعطال<br/>/${MAX_ADSL}</th>
      <th>نسبة الإزالة<br/>24h %</th><th>درجة الإزالة<br/>/${MAX_REM}</th>
      <th>الدرجة النهائية<br/>/${MAX_TOTAL}</th>`;

    const rowHtml = (r: any, n: number | string) =>
      `<td>${esc(n)}</td><td>${esc(r.techName)}</td>
       <td>${esc(r.omPct != null ? fmt1(r.omPct) : "—")}</td>${scoreCell(r.omScore)}
       <td>${esc(r.repRatio != null ? fmt1(r.repRatio) : "—")}</td>${scoreCell(r.repScore)}
       <td>${esc(r.per1000 != null ? fmt2(r.per1000) : "—")}</td>${scoreCell(r.adslScore)}
       <td>${esc(r.pct24h != null ? fmt1(r.pct24h) : "—")}</td>${scoreCell(r.remScore)}
       ${totalCell(r.total)}`;

    const ROWS_PER_PAGE = 18;
    const total = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    let pages = "";
    for (let pg = 0; pg < total; pg++) {
      const chunk = rows.slice(pg * ROWS_PER_PAGE, (pg + 1) * ROWS_PER_PAGE);
      let body = chunk.map((r, ci) => `<tr>${rowHtml(r, pg * ROWS_PER_PAGE + ci + 1)}</tr>`).join("");
      if (pg === total - 1) {
        body += `<tr class="total"><td colspan="2">إجمالى الإدارة</td>
          <td>${esc(fmt1(overall.omPct))}</td><td>${esc(overall.omScore)}</td>
          <td>${esc(fmt1(overall.repRatio))}</td><td>${esc(overall.repScore)}</td>
          <td>${esc(fmt2(overall.per1000))}</td><td>${esc(overall.adslScore)}</td>
          <td>${esc(fmt1(overall.pct24h))}</td><td>${esc(overall.remScore)}</td>
          <td>${esc(overall.total)}</td></tr>`;
      }
      pages += `<section class="page">
        <h2>${esc(title)}</h2>
        <div class="pageno">صفحة ${pg + 1} من ${total}</div>
        <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      </section>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:11px;direction:rtl;margin:0;background:#f1f5f9}
        h2{text-align:center;font-size:14px;margin:0 0 4px}
        .pageno{text-align:center;font-size:10px;color:#64748b;margin-bottom:8px}
        *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
        table{width:100%;border-collapse:collapse}
        th{background:#1e50a0!important;color:#fff!important;padding:6px 3px;border:1px solid #15407f;font-size:11px;text-align:center}
        td{border:1px solid #ccc;padding:4px 3px;text-align:center;color:#111}
        tbody tr:nth-child(even){background:#eef2fb!important}
        tr.total td{background:#1e50a0!important;color:#fff!important;font-weight:bold}
        .page{background:#fff;padding:12px;margin:10px auto;max-width:1100px;box-shadow:0 1px 4px rgba(0,0,0,.15)}
        .toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #e2e8f0;padding:10px 14px;display:flex;gap:10px;align-items:center}
        .toolbar button{background:#dc2626;color:#fff;border:0;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer;font-family:inherit}
        @media print{body{background:#fff}.toolbar{display:none}.page{box-shadow:none;margin:0;max-width:none;page-break-after:always}@page{size:A4 landscape;margin:8mm}}
      </style></head><body>
      <div class="toolbar"><button onclick="window.print()">🖸️ طباعة / حفظ PDF</button>
        <span>اختر "حفظ بصيغة PDF" كوجهة الطباعة.</span></div>
      ${pages}</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  // ألوان بطاقات الدرجات
  const scoreBg = (v: number, max: number) => {
    const pct = max > 0 ? v / max : 0;
    if (pct >= 0.75) return "text-green-700 bg-green-50 border-green-200";
    if (pct >= 0.5)  return "text-yellow-700 bg-yellow-50 border-yellow-200";
    return "text-red-700 bg-red-50 border-red-200";
  };

  const cellScore = (v: number, max: number) => {
    const pct = max > 0 ? v / max : 0;
    const cls = pct >= 0.75 ? "text-green-700 font-bold" : pct >= 0.5 ? "text-yellow-600 font-bold" : "text-red-600 font-bold";
    return <TableCell className={`text-center ${cls}`}>{v}</TableCell>;
  };
  const cellTotal = (v: number) => {
    const pct = MAX_TOTAL > 0 ? v / MAX_TOTAL : 0;
    const cls = pct >= 0.75 ? "bg-green-100 text-green-800 font-bold" : pct >= 0.5 ? "bg-yellow-100 text-yellow-800 font-bold" : "bg-red-100 text-red-700 font-bold";
    return <TableCell className={`text-center text-sm ${cls}`}>{v}</TableCell>;
  };

  // 🆕 عرض الفني: سطره فقط (برقم ترتيبه الحقيقى) + سطر الإجمالى — من غير باقى الفنيين
  const myTech = (((user as any)?.techName) || user?.username || "").trim();
  const techView = user?.role === ROLES.TECH && !!myTech;
  const myIdx = rows.findIndex((r) => String(r.techName || "").trim() === myTech);
  const visRows = techView ? (myIdx >= 0 ? [rows[myIdx]] : []) : rows;

  // ── حوارات التفاصيل: الأرقام المكررة + أعطال تجاوزت 24 ساعة ──
  const fmtDT = (d: string | null) => (d ? new Date(d).toLocaleString("ar-EG") : "");
  // الفلترة بتتم على مستوى الـ server (الفني يرى أرقامه فقط — فنى الإغلاق أو فنى المنطقة؛
  // الأدمن يرى الكل)، فهنا بنعرض اللى رجع من الـ API مباشرة.
  // فلتر اسم الفنى داخل النوافذ (يطابق فنى الإغلاق أو فنى المنطقة)
  const [detailTech, setDetailTech] = useState("");
  const techOptsFrom = (arr: any[] | null) => {
    const s = new Set<string>();
    for (const r of (arr ?? [])) {
      if (r.closeByName && r.closeByName !== "غير معروف") s.add(r.closeByName);
      if (r.areaTechName && r.areaTechName !== "غير معروف") s.add(r.areaTechName);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "ar"));
  };
  const repTechOptions = useMemo(() => techOptsFrom(repDetailData), [repDetailData]);
  const b24TechOptions = useMemo(() => techOptsFrom(b24Data), [b24Data]);
  const repFiltered = useMemo(() => {
    const d = repDetailData ?? [];
    return detailTech ? d.filter((r: any) => r.closeByName === detailTech || r.areaTechName === detailTech) : d;
  }, [repDetailData, detailTech]);
  const b24Filtered = useMemo(() => {
    const d = b24Data ?? [];
    return detailTech ? d.filter((r: any) => r.closeByName === detailTech || r.areaTechName === detailTech) : d;
  }, [b24Data, detailTech]);

  const loadDetail = async (
    endpoint: string,
    setData: (v: any) => void,
    setLoading: (v: boolean) => void,
    setOpen: (v: boolean) => void,
  ) => {
    setOpen(true);
    setLoading(true);
    const p = new URLSearchParams({ tab: "combined" });
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (central) p.set("central", central);
    try {
      const r = await fetch(`${endpoint}?${p}`, { credentials: "include" });
      setData(r.ok ? await r.json() : []);
    } catch { setData([]); }
    setLoading(false);
  };
  const loadRep = () => loadDetail("/api/reports/repetition-detail", setRepDetailData, setRepLoading, setRepOpen);
  const loadB24 = () => loadDetail("/api/reports/removal-beyond24", setB24Data, setB24Loading, setB24Open);

  const exportRep = () => {
    if (!repFiltered.length) return;
    const ws = XLSX.utils.json_to_sheet(repFiltered.map((r, i) => ({
      "#": i + 1, "رقم التليفون": r.phoneNumber, "السنترال": r.centralName,
      "الكابينه": r.lineCabin ?? "", "البكس": r.lineBox ?? "", "MSAN": r.msanCode ?? "", "الفريم": r.frame ?? "",
      "عدد المرات": r.appearances, "رقم الشكوى": r.complainNo,
      "سبب الإغلاق": r.closeCode ?? "",
      "تاريخ الشكوى": fmtDT(r.complainTime), "تاريخ الإغلاق": fmtDT(r.closeTime),
      "فنى الإغلاق": r.closeByName, "فنى المنطقة": r.areaTechName,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الأرقام المكررة");
    XLSX.writeFile(wb, `repeated-${dateFrom}-${dateTo}.xlsx`);
  };
  const exportB24 = () => {
    if (!b24Filtered.length) return;
    const ws = XLSX.utils.json_to_sheet(b24Filtered.map((r, i) => ({
      "#": i + 1, "رقم التليفون": r.phoneNumber, "السنترال": r.centralName,
      "الكابينه": r.lineCabin ?? r.cabinetNo ?? "", "البكس": r.lineBox ?? "", "MSAN": r.msanCode ?? "",
      "رقم الشكوى": r.complainNo, "تاريخ الشكوى": fmtDT(r.complainTime), "تاريخ الإغلاق": fmtDT(r.closeTime),
      "عدد الساعات": Math.round(r.hours), "فنى الإغلاق": r.closeByName, "فنى المنطقة": r.areaTechName,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تجاوزت 24 ساعة");
    XLSX.writeFile(wb, `beyond24-${dateFrom}-${dateTo}.xlsx`);
  };

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
          <select value={central} onChange={(e) => setCentral(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm w-full sm:w-auto" dir="rtl">
            <option value="">كل السنترالات</option>
            {CENTRALS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex-1" />
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" size="sm" onClick={loadRep} className="text-purple-700 border-purple-200 gap-1">
            <Repeat2 className="w-4 h-4" /> الأرقام المكررة
          </Button>
          <Button variant="outline" size="sm" onClick={loadB24} className="text-orange-700 border-orange-200 gap-1">
            <Clock className="w-4 h-4" /> تجاوزت 24 ساعة
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={rows.length === 0} className="text-green-700 border-green-200 gap-1">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={rows.length === 0} className="text-red-700 border-red-200 gap-1">
            <Printer className="w-4 h-4" /> PDF
          </Button>
        </div>
      </Card>

      {/* بطاقات الأوزان */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "المتعذرات OM", max: MAX_OM, note: "مطلق — 100% تحقيق = 25" },
          { label: "التكرار", max: MAX_REP, note: `مستهدف ${REP_TARGET}% = 20 درجة` },
          { label: "الأعطال فى الألف", max: MAX_ADSL, note: `مستهدف ${ADSL_TARGET}/ألف = 20 درجة` },
          { label: "نسبة الإزالة 24h", max: MAX_REM, note: "مطلق — 100% = 10 درجات" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border bg-white p-3 text-center shadow-sm">
            <div className="text-xl font-bold text-blue-800">{item.max} <span className="text-sm font-normal">درجة</span></div>
            <div className="text-sm font-semibold mt-1">{item.label}</div>
            <div className="text-xs text-muted-foreground mt-1">{item.note}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="text-right text-sm" dir="rtl">
            <TableHeader>
              <TableRow className="bg-blue-900 hover:bg-blue-900">
                <TableHead className="text-white font-bold text-center w-8">#</TableHead>
                <TableHead className="text-white font-bold text-center">اسم الفنى</TableHead>
                <TableHead className="text-white font-bold text-center">نسبة تحقيق<br/>المتعذرات %</TableHead>
                <TableHead className="text-white font-bold text-center">درجة<br/>المتعذرات<br/>/{MAX_OM}</TableHead>
                <TableHead className="text-white font-bold text-center">نسبة<br/>التكرار %</TableHead>
                <TableHead className="text-white font-bold text-center">درجة<br/>التكرار<br/>/{MAX_REP}</TableHead>
                <TableHead className="text-white font-bold text-center">أعطال/1000<br/>(نهاية الشهر)</TableHead>
                <TableHead className="text-white font-bold text-center">درجة<br/>الأعطال<br/>/{MAX_ADSL}</TableHead>
                <TableHead className="text-white font-bold text-center">نسبة الإزالة<br/>24h %</TableHead>
                <TableHead className="text-white font-bold text-center">درجة<br/>الإزالة<br/>/{MAX_REM}</TableHead>
                <TableHead className="text-white font-bold text-center">الدرجة<br/>النهائية<br/>/{MAX_TOTAL}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-14 text-muted-foreground">
                    {isFetching ? "جاري التحميل..." : "لا توجد بيانات — تأكد من رفع الملفات وتوفر بيانات الفترة المحددة"}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {visRows.map((r, idx) => (
                    <TableRow key={r.techName} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="text-center text-muted-foreground">{techView ? myIdx + 1 : idx + 1}</TableCell>
                      <TableCell className="font-semibold whitespace-nowrap text-center">{r.techName}</TableCell>
                      <TableCell className="text-center">{r.omPct != null ? fmt1(r.omPct) : "—"}</TableCell>
                      {cellScore(r.omScore, MAX_OM)}
                      <TableCell className="text-center">{r.repRatio != null ? fmt1(r.repRatio) : "—"}</TableCell>
                      {cellScore(r.repScore, MAX_REP)}
                      <TableCell className="text-center">{r.per1000 != null ? fmt2(r.per1000) : "—"}</TableCell>
                      {cellScore(r.adslScore, MAX_ADSL)}
                      <TableCell className="text-center">{r.pct24h != null ? fmt1(r.pct24h) : "—"}</TableCell>
                      {cellScore(r.remScore, MAX_REM)}
                      {cellTotal(r.total)}
                    </TableRow>
                  ))}
                  {/* إجمالى الإدارة */}
                  <TableRow className="bg-blue-900 hover:bg-blue-900">
                    <TableCell colSpan={2} className="text-white font-bold text-center">إجمالى الإدارة</TableCell>
                    <TableCell className="text-center text-white">{fmt1(overall.omPct)}</TableCell>
                    <TableCell className="text-center text-white font-bold">{overall.omScore}</TableCell>
                    <TableCell className="text-center text-white">{fmt1(overall.repRatio)}</TableCell>
                    <TableCell className="text-center text-white font-bold">{overall.repScore}</TableCell>
                    <TableCell className="text-center text-white">{fmt2(overall.per1000)}</TableCell>
                    <TableCell className="text-center text-white font-bold">{overall.adslScore}</TableCell>
                    <TableCell className="text-center text-white">{fmt1(overall.pct24h)}</TableCell>
                    <TableCell className="text-center text-white font-bold">{overall.remScore}</TableCell>
                    <TableCell className="text-center text-white font-bold text-base">{overall.total}</TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* ── حوار: الأرقام المكررة ── */}
      <Dialog open={repOpen} onOpenChange={setRepOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Repeat2 className="w-5 h-5 text-purple-700" />
              الأرقام المكررة{repFiltered.length ? ` (${repFiltered.length})` : ""}
              {techView && <span className="text-xs font-normal text-muted-foreground">— أرقامك فقط</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <select value={detailTech} onChange={(e) => setDetailTech(e.target.value)} className="border rounded-md px-2 py-1 text-xs bg-background" dir="rtl">
              <option value="">كل الفنيين</option>
              {repTechOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={exportRep} disabled={!repFiltered.length} className="text-green-700 border-green-200 gap-1">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button>
          </div>
          <div className="overflow-auto [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
            {repLoading ? (
              <div className="py-14 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />جارٍ التحميل…</div>
            ) : !repFiltered.length ? (
              <div className="py-14 text-center text-muted-foreground">لا توجد أرقام مكررة</div>
            ) : (
              <Table className="text-right text-xs min-w-max" dir="rtl">
                <TableHeader>
                  <TableRow className="bg-purple-800 hover:bg-purple-800">
                    {["#", "رقم التليفون", "السنترال", "الكابينة", "البكس", "MSAN", "الفريم", "مرات", "رقم الشكوى", "سبب الإغلاق", "فنى الإغلاق", "فنى المنطقة"].map((h) => (
                      <TableHead key={h} className="text-white font-bold text-center whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repFiltered.map((r, i) => (
                    <TableRow key={r.complainNo + "-" + i} className="hover:bg-muted/30">
                      <TableCell className="text-center">{i + 1}</TableCell>
                      <TableCell className="text-center">{r.phoneNumber}</TableCell>
                      <TableCell>{r.centralName}</TableCell>
                      <TableCell className="text-center">{r.lineCabin ?? "-"}</TableCell>
                      <TableCell className="text-center">{r.lineBox ?? "-"}</TableCell>
                      <TableCell className="text-center">{r.msanCode ?? "-"}</TableCell>
                      <TableCell className="text-center">{r.frame ?? "-"}</TableCell>
                      <TableCell className="text-center font-bold">{r.appearances}</TableCell>
                      <TableCell className="text-center">{r.complainNo}</TableCell>
                      <TableCell className="whitespace-nowrap text-center">{r.closeCode ?? "-"}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.closeByName}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.areaTechName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── حوار: أعطال تجاوزت 24 ساعة ── */}
      <Dialog open={b24Open} onOpenChange={setB24Open}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-orange-700" />
              أعطال تجاوزت 24 ساعة{b24Filtered.length ? ` (${b24Filtered.length})` : ""}
              {techView && <span className="text-xs font-normal text-muted-foreground">— أرقامك فقط</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <select value={detailTech} onChange={(e) => setDetailTech(e.target.value)} className="border rounded-md px-2 py-1 text-xs bg-background" dir="rtl">
              <option value="">كل الفنيين</option>
              {b24TechOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={exportB24} disabled={!b24Filtered.length} className="text-green-700 border-green-200 gap-1">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button>
          </div>
          <div className="overflow-auto [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
            {b24Loading ? (
              <div className="py-14 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />جارٍ التحميل…</div>
            ) : !b24Filtered.length ? (
              <div className="py-14 text-center text-muted-foreground">لا توجد أعطال تجاوزت 24 ساعة</div>
            ) : (
              <Table className="text-right text-xs min-w-max" dir="rtl">
                <TableHeader>
                  <TableRow className="bg-orange-700 hover:bg-orange-700">
                    {["#", "رقم التليفون", "السنترال", "الكابينة", "البكس", "رقم الشكوى", "وقت الشكوى", "ساعات", "فنى الإغلاق", "فنى المنطقة"].map((h) => (
                      <TableHead key={h} className="text-white font-bold text-center whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {b24Filtered.map((r, i) => (
                    <TableRow key={r.complainNo + "-" + i} className="hover:bg-muted/30">
                      <TableCell className="text-center">{i + 1}</TableCell>
                      <TableCell className="text-center">{r.phoneNumber}</TableCell>
                      <TableCell>{r.centralName}</TableCell>
                      <TableCell className="text-center">{r.lineCabin ?? r.cabinetNo ?? "-"}</TableCell>
                      <TableCell className="text-center">{r.lineBox ?? "-"}</TableCell>
                      <TableCell className="text-center">{r.complainNo}</TableCell>
                      <TableCell className="text-center whitespace-nowrap">{fmtDT(r.complainTime)}</TableCell>
                      <TableCell className="text-center font-bold text-red-600">{Math.round(r.hours)}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.closeByName}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.areaTechName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
