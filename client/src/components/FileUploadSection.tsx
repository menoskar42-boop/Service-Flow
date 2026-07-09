import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Upload, Loader2, Wrench, PhoneCall, FileSearch, Wifi, Gauge, Network, ClipboardList, Users, RefreshCw, BarChart3 } from "lucide-react";
import * as XLSX from "xlsx";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MaintenanceOrder {
  id: number;
  centralName: string;
  workOrderId: number;
  phoneNumber: string;
  workOrderType: string | null;
  stage: string | null;
  status: string | null;
  priority: string | null;
  currentWorkspec: string | null;
  notes: string | null;
  description: string | null;
  creationDate: string | null;
}

interface TicketRow {
  id: number;
  ticketId: string;
  centralCode: string;
  centralName: string;
  phoneNumber: string | null;
  complaintTime: string | null;
  techCode: string | null;
  lineTypeCode: string | null;
  cabinetNo: string | null;
  priorityCode: string | null;
  closeDate: string | null;
  operationType: string | null;
  complainTypeName: string | null;
  statusCode: string | null;
}

interface ComplaintDetail {
  id: number;
  complainNo: string;
  sector: string | null;
  region: string | null;
  exchangeName: string | null;
  phoneNumber: string | null;
  msanId: string | null;
  cabinetNo: string | null;
  complainTime: string | null;
  closeTime: string | null;
  closeCode: string | null;
  complainSideName: string | null;
  complainTypeName: string | null;
  closeBy: string | null;
}

interface RemainingComplaint {
  id: number;
  complainNo: string;
  sector: string | null;
  region: string | null;
  exchangeName: string | null;
  phoneNumber: string | null;
  complainTime: string | null;
  dispatchTime: string | null;
  dispatchUser: string | null;
  msanId: string | null;
  closeTime: string | null;
  closeCode: string | null;
  closeBy: string | null;
  statusCode: string | null;
  cabinetNo: string | null;
  complainType: string | null;
}

interface FtthSubscriber {
  id: number;
  sector: string | null;
  region: string | null;
  mainEx: string | null;
  subEx: string | null;
  fccCode: string | null;
  type: string | null;
  msanGponCode: string | null;
  fbbSubs: number | null;
  fvSubs: number | null;
}

interface Case138 {
  id: number;
  centralName: string | null;
  phoneShort: string | null;
  complainNo: string | null;
  score: number | null;
  currentSpeed: string | null;
  maxSpeed: string | null;
  fullPhone: string | null;
  accountNo: string | null;
  statusCode: string | null;
  cabinetNo: string | null;
  boxNo: string | null;
  complainTypeName: string | null;
  complainTime: string | null;
  customerName: string | null;
  dispatchTime: string | null;
  techCode: string | null;
  closeDate: string | null;
  onu: string | null;
  faultType: string | null;
}

interface FtthOrder {
  id: number;
  serviceOrderId: string;
  customerOrderId: string | null;
  product: string | null;
  serviceNumber: string | null;
  customerName: string | null;
  orderStatus: string | null;
  orderCreateTime: string | null;
  exchangeName: string | null;
  serviceType: string | null;
  msanCode: string | null;
  areaCode: string | null;
  customerMobile: string | null;
  currentActivity: string | null;
  errorName: string | null;
  governorate: string | null;
  lineType: string | null;
  fccExchange: string | null;
  archivedYear?: number | null;
}

interface PhonePort {
  id: number;
  phoneNumber: string;
  areaCode: string | null;
  msanCode: string | null;
  frame: string | null;
  shelf: string | null;
  slot: string | null;
  portNumber: string | null;
  portType: string | null;
  voiceStatus: string | null;
  dataStatus: string | null;
  operator: string | null;
}

interface CabinetTechnician {
  id: number;
  centralName: string | null;
  cabinNumber: string | null;
  workerCode: string | null;
  hayaKarima: string | null;
  regionName: string | null;
  active: string | null;
  centralFinish: string | null;
  villageCode: string | null;
  cabinCode: string | null;
  idu: string | null;
}

interface TechnicianName {
  id: number;
  workerCode: string;
  techName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (d: string | null) =>
  d ? format(new Date(d), "yyyy/MM/dd HH:mm") : "-";

const priorityBadge = (p: string | null) => {
  if (!p) return null;
  const map: Record<string, string> = {
    Low: "bg-blue-50 text-blue-700",
    Mid: "bg-yellow-50 text-yellow-700",
    High: "bg-red-50 text-red-700",
    Normal: "bg-gray-100 text-gray-700",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[p] ?? "bg-gray-100 text-gray-600"}`}>
      {p}
    </span>
  );
};

// ─── Sub-component: Upload Card ───────────────────────────────────────────────

// Extract normalized FTTH rows from a single worksheet; null if no header row.
function extractFtthRows(ws: XLSX.WorkSheet): any[][] | null {
  const all: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
  const norm = (v: any) => String(v ?? "").trim().toLowerCase();
  const hIdx = all.findIndex((r) =>
    r.some((c) => norm(c).includes("fcc code") || norm(c).includes("msan/gpon") || norm(c) === "msan"),
  );
  if (hIdx < 0) return null;
  const header = all[hIdx].map(norm);
  const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iSector = find("sector");
  const iRegion = find("regoin", "region");
  const iMainEx = find("main ex");
  const iSubEx  = find("sub ex");
  const iFcc    = find("fcc code", "fcc");
  const iType   = find("type");
  const iMsan   = find("msan/gpon", "msan", "gpon code");
  const iFbb    = find("fbb subs", "fbb");
  const iFv     = find("fv subs", "fv");
  const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

  const data: any[][] = [];
  for (let i = hIdx + 1; i < all.length; i++) {
    const r = all[i];
    const fcc = String(g(r, iFcc)).trim();
    const msan = String(g(r, iMsan)).trim();
    if (!fcc && !msan) continue;
    data.push([
      String(g(r, iSector)), String(g(r, iRegion)), String(g(r, iMainEx)), String(g(r, iSubEx)),
      fcc, String(g(r, iType)), msan, g(r, iFbb), g(r, iFv),
    ]);
  }
  return data;
}

// Staged FTTH/ADSL import: parse the Excel file in the browser (no server RAM /
// file-size limits) and send normalized rows to the server in JSON batches.
// Scans every sheet and uses the one with the most data rows — the subscribers
// sheet may not be first in the workbook.
async function importFtthStaged(file: File): Promise<{ inserted: number; skipped: number; sheet: string }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  let data: any[][] = [];
  let sheetName = "";
  for (const name of wb.SheetNames) {
    const rows = extractFtthRows(wb.Sheets[name]);
    if (rows && rows.length > data.length) {
      data = rows;
      sheetName = name;
    }
  }
  if (data.length === 0) {
    throw new Error(
      `لم يتم العثور على بيانات (FCC Code / MSAN) في أي شيت — الشيتات الموجودة: ${wb.SheetNames.join("، ")}`,
    );
  }

  let inserted = 0;
  const STEP = 5000;
  for (let s = 0; s < data.length; s += STEP) {
    const res = await fetch("/api/ftth-subscribers/import-rows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ rows: data.slice(s, s + STEP), mode: s === 0 ? "replace" : "append" }),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("الخادم غير محدّث — أعد نشر التطبيق (Republish) ثم سجّل الدخول من جديد");
    }
    if (!res.ok) throw new Error(json.message || "خطأ");
    inserted += json.inserted ?? 0;
  }
  return { inserted, skipped: data.length - inserted, sheet: sheetName };
}

function fmtUploadTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth()    === now.getMonth()    &&
    d.getDate()     === now.getDate();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return `اليوم ${time}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`;
}

function UploadCard({
  label, icon: Icon, endpoint, queryKey, color, extraKeys = [], staged, lastUpload,
}: {
  label: string;
  icon: any;
  endpoint: string;
  queryKey: string;
  color: string;
  extraKeys?: string[];
  staged?: "ftth";
  lastUpload?: string | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const mut = useMutation({
    mutationFn: async (file: File) => {
      if (staged === "ftth") return importFtthStaged(file);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(endpoint, { method: "POST", body: fd, credentials: "include" });
      // read as text first so a non-JSON (HTML) response gives a clear message
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("الخادم غير محدّث — أعد نشر التطبيق (Republish) ثم سجّل الدخول من جديد");
      }
      if (!res.ok) throw new Error(json.message || "خطأ");
      return json;
    },
    onSuccess: (d) => {
      let desc: string;
      if (d.details || d.remaining) {
        desc = `تفاصيل: ${d.details?.inserted ?? 0} جديد (${d.details?.total ?? 0} في الملف) — متبقى: ${d.remaining?.inserted ?? 0} جديد (${d.remaining?.total ?? 0} في الملف)`;
      } else if (d.archivedYear !== undefined) {
        const arch = d.archivedYear ? ` — تمت أرشفة سنة ${d.archivedYear}` : "";
        const soy = d.soyTotal !== undefined ? ` — بداية السنة: +${d.soyAdded ?? 0} (إجمالى ${d.soyTotal})` : "";
        desc = `تاريخي: ${d.hist} جديد — حالي: ${d.current}${arch}${soy}`;
      } else if (d.soyTotal !== undefined) {
        desc = `أُضيف ${d.soyAdded ?? 0} مسلسل جديد — إجمالى متعذرات بداية السنة: ${d.soyTotal}`;
      } else if (d.current !== undefined) {
        const sod = d.sodReplaced
          ? `بداية اليوم: ${d.startOfDay} (لقطة جديدة لليوم)`
          : `بداية اليوم: +${d.startOfDay} عطل جديد (إضافة)`;
        desc = `تاريخي: ${d.hist} جديد — حالي: ${d.current} — ${sod}`;
      } else {
        desc = `${d.inserted} سجل جديد — تخطى ${d.skipped ?? 0}`;
        if (d.sheet) desc += ` — من شيت «${d.sheet}»`;
      }
      toast({ title: "تم الاستيراد", description: desc, duration: 4500 });
      [queryKey, ...extraKeys, "/api/upload-times"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => {
      toast({ title: "خطأ", description: e.message, variant: "destructive", duration: 5000 });
    },
  });

  return (
    <div className={`flex items-center gap-3 p-4 rounded-lg border ${color}`}>
      <Icon className="w-6 h-6 shrink-0" />
      <div className="flex-1">
        <p className="font-medium text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">
          {mut.isPending ? "جاري الاستيراد..." : lastUpload ? `آخر رفع: ${fmtUploadTime(lastUpload)}` : "لم يُرفع بعد"}
        </p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) mut.mutate(f);
          e.target.value = "";
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={mut.isPending}
        onClick={() => fileRef.current?.click()}
        className="gap-1"
      >
        {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        رفع
      </Button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function FileUploadSection() {
  const [tab, setTab] = useState<"maintenance" | "tickets" | "ticketsFtth" | "details" | "remaining" | "ftth" | "case138" | "ports" | "orders" | "cabinTech" | "techNames">("maintenance");
  const [orderBucket, setOrderBucket] = useState<"historical" | "current" | "archive">("historical");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQ, setSearchQ] = useState("");
  // bucket for tables that keep 3 snapshots: تاريخي / بداية اليوم / حالي
  const [bucket, setBucket] = useState<"historical" | "sod" | "current">("historical");

  const { data: uploadTimes = {} } = useQuery<Record<string, string | null>>({
    queryKey: ["/api/upload-times"],
    queryFn: () => fetch("/api/upload-times", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const ut = (ep: string) => uploadTimes[ep];

  const { data: maintenance = [], isFetching: fetchM } = useQuery<MaintenanceOrder[]>({
    queryKey: ["/api/maintenance-orders", dateFrom, dateTo, bucket],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo", dateTo);
      p.set("bucket", bucket);
      const res = await fetch(`/api/maintenance-orders?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: tickets = [], isFetching: fetchT } = useQuery<TicketRow[]>({
    queryKey: ["/api/tickets", "dsl", dateFrom, dateTo, searchQ, bucket],
    queryFn: async () => {
      const p = new URLSearchParams({ type: "dsl", bucket });
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo", dateTo);
      if (searchQ)  p.set("q", searchQ);
      const res = await fetch(`/api/tickets?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: ticketsFtth = [], isFetching: fetchTF } = useQuery<TicketRow[]>({
    queryKey: ["/api/tickets", "ftth", dateFrom, dateTo, searchQ, bucket],
    queryFn: async () => {
      const p = new URLSearchParams({ type: "ftth", bucket });
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo", dateTo);
      if (searchQ)  p.set("q", searchQ);
      const res = await fetch(`/api/tickets?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: details = [], isFetching: fetchD } = useQuery<ComplaintDetail[]>({
    queryKey: ["/api/complaint-details", dateFrom, dateTo, searchQ],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("all", "true");
      p.set("limit", "5000");
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo", dateTo);
      if (searchQ)  p.set("q", searchQ);
      const res = await fetch(`/api/complaint-details?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: dbCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/complaint-details/counts"],
    queryFn: async () => {
      const res = await fetch("/api/complaint-details/counts", { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
  });
  const detailsCount = dbCounts.complaint_details ?? 0;
  const ftthCount    = dbCounts.ftth_subscribers  ?? 0;

  const { data: remaining = [], isFetching: fetchR } = useQuery<RemainingComplaint[]>({
    queryKey: ["/api/remaining-complaints", dateFrom, dateTo, searchQ],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("all", "true");
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo", dateTo);
      if (searchQ)  p.set("q", searchQ);
      const res = await fetch(`/api/remaining-complaints?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: ftth = [], isFetching: fetchF } = useQuery<FtthSubscriber[]>({
    queryKey: ["/api/ftth-subscribers", searchQ],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (searchQ) p.set("q", searchQ);
      const res = await fetch(`/api/ftth-subscribers?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: case138 = [], isFetching: fetchC } = useQuery<Case138[]>({
    queryKey: ["/api/case-138", dateFrom, dateTo, searchQ],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo", dateTo);
      if (searchQ)  p.set("q", searchQ);
      const res = await fetch(`/api/case-138?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: ports = [], isFetching: fetchP } = useQuery<PhonePort[]>({
    queryKey: ["/api/phone-ports", searchQ],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (searchQ) p.set("q", searchQ);
      const res = await fetch(`/api/phone-ports?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: orders = [], isFetching: fetchO } = useQuery<FtthOrder[]>({
    queryKey: ["/api/ftth-orders", orderBucket, searchQ],
    queryFn: async () => {
      const p = new URLSearchParams({ bucket: orderBucket });
      if (searchQ) p.set("q", searchQ);
      const res = await fetch(`/api/ftth-orders?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: cabinTech = [], isFetching: fetchCT } = useQuery<CabinetTechnician[]>({
    queryKey: ["/api/cabinet-technicians", searchQ],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (searchQ) p.set("q", searchQ);
      const res = await fetch(`/api/cabinet-technicians?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: techNames = [], isFetching: fetchTN } = useQuery<TechnicianName[]>({
    queryKey: ["/api/technician-names", searchQ],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (searchQ) p.set("q", searchQ);
      const res = await fetch(`/api/technician-names?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const isFetching =
    tab === "maintenance" ? fetchM :
    tab === "tickets" ? fetchT :
    tab === "ticketsFtth" ? fetchTF :
    tab === "details" ? fetchD :
    tab === "remaining" ? fetchR :
    tab === "ftth" ? fetchF :
    tab === "case138" ? fetchC :
    tab === "ports" ? fetchP :
    tab === "cabinTech" ? fetchCT :
    tab === "techNames" ? fetchTN : fetchO;

  // bucket selector applies to tabs that keep 3 snapshots
  const showBucket = tab === "maintenance" || tab === "tickets" || tab === "ticketsFtth";

  return (
    <div className="space-y-5" dir="rtl">
      {/* زر تشغيل التقارير اليومية + زر تحديث منافذ MSAN من Provisioning Portal */}
      <div className="flex justify-end gap-2">
        <Button
          onClick={() => window.open("https://we-oas.te.eg/analytics/saw.dll?bipublisherEntry&action=open&bippath=%2FFCC%20Prod%2F131%20%D8%A7%D8%B1%D9%82%D8%A7%D9%85%20%D8%A7%D9%84%D8%AA%D9%84%D9%8A%D9%81%D9%88%D9%86%D8%A7%D8%AA%20%D8%B9%D9%84%D9%89%20%D9%83%D8%A7%D8%A8%D9%8A%D9%86%D8%A9.xdo&itemtype=.xdo", "_blank", "noopener,noreferrer")}
          className="gap-2 bg-teal-600 hover:bg-teal-700 text-white"
          title="يفتح تقرير 131 أرقام التليفونات على كابينة (نحاسي/فيبر/دوائر) ويصدّره Excel تلقائياً"
        >
          <BarChart3 className="w-4 h-4" />
          131
        </Button>
        <Button
          onClick={() => window.open("https://we-oas.te.eg/bi-security-login/login.jsp?msi=false&mt=false&profileMust=true&redirect=L2R2L3VpL2hvbWUuanNwP3BhZ2VpZD1ob21lJmhhc2g9aTRPeDNTVkNPXzVLUUswc2lHUThxUTFNQVp6MGRTLVg5aXgzRGQ5RmlHUVJKd3M5cnNZcGQyaURJRjZUZEZWZQ==", "_blank", "noopener,noreferrer")}
          className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
          title="يفتح WE OAS BI ويسجّل الدخول ويشغّل تقرير 430D تلقائياً"
        >
          <BarChart3 className="w-4 h-4" />
          430D
        </Button>
        <Button
          onClick={() => window.open("https://provisioningportal.te.eg/provisioningPortal/?sf_ports=1#/login", "_blank", "noopener,noreferrer")}
          className="gap-2 bg-cyan-600 hover:bg-cyan-700 text-white"
          title="يفتح Provisioning Portal ويشغّل سكربت تحديث ملف البورتات تلقائياً لكل أكواد الأمسان المخزّنة"
        >
          <Network className="w-4 h-4" />
          تحديث منافذ MSAN
        </Button>
        <Button
          onClick={() => {
            // يفتح FCC دائماً؛ وأول ضغطة فى اليوم يفتح كمان تحديث منافذ MSAN تلقائياً
            const today = new Date().toISOString().slice(0, 10);
            if (localStorage.getItem("sf_msan_auto_date") !== today) {
              localStorage.setItem("sf_msan_auto_date", today);
              window.open("https://provisioningportal.te.eg/provisioningPortal/?sf_ports=1#/login", "_blank", "noopener,noreferrer");
            }
            window.open("https://fcc.te.eg/TroubleTicket/faces/security/pages/Login.jsf", "_blank", "noopener,noreferrer");
          }}
          className="gap-2 bg-green-600 hover:bg-green-700 text-white"
        >
          <RefreshCw className="w-4 h-4" />
          حدث التقارير اليومية
        </Button>
      </div>

      {/* Upload Cards */}
      <Card className="p-4 bg-white border-0 shadow-sm space-y-3">
        <p className="text-sm font-semibold text-muted-foreground">رفع الملفات</p>
        <UploadCard
          label="ملف wfm"
          icon={Wrench}
          endpoint="/api/maintenance-orders/import"
          queryKey="/api/maintenance-orders"
          color="border-orange-200 bg-orange-50/50"
          lastUpload={ut("/api/maintenance-orders/import")}
        />
        <UploadCard
          label="شكاوى DSL/نحاس (fcc)"
          icon={PhoneCall}
          endpoint="/api/ticket-queue/import"
          queryKey="/api/tickets"
          color="border-purple-200 bg-purple-50/50"
          lastUpload={ut("/api/ticket-queue/import")}
        />
        <UploadCard
          label="شكاوى FTTH (fcc )"
          icon={PhoneCall}
          endpoint="/api/ticket-queue-ftth/import"
          queryKey="/api/tickets"
          color="border-fuchsia-200 bg-fuchsia-50/50"
          lastUpload={ut("/api/ticket-queue-ftth/import")}
        />
        <UploadCard
          label="تفاصيل الأعطال (430D_Trial) — التفاصيل تتراكم / المتبقى يُستبدل (مع تسجيل تاريخي)"
          icon={FileSearch}
          endpoint="/api/complaint-details/import"
          queryKey="/api/complaint-details"
          extraKeys={["/api/remaining-complaints"]}
          color="border-teal-200 bg-teal-50/50"
          lastUpload={ut("/api/complaint-details/import")}
        />
        <UploadCard
          label="طلبات متعذرات OM — تاريخي + حالي + أرشيف سنوي"
          icon={ClipboardList}
          endpoint="/api/ftth-orders/import"
          queryKey="/api/ftth-orders"
          color="border-emerald-200 bg-emerald-50/50"
          lastUpload={ut("/api/ftth-orders/import")}
        />
        <UploadCard
          label="متعذرات بداية السنة (OM) — يضاف يدوياً (تراكمى)"
          icon={ClipboardList}
          endpoint="/api/ftth-orders/import-soy"
          queryKey="/api/ftth-orders"
          color="border-teal-200 bg-teal-50/50"
          lastUpload={ut("/api/ftth-orders/import-soy")}
        />
        <UploadCard
          label="مشتركين FTTH / ADSL — يستبدل القديم (رفع على مراحل)"
          icon={Wifi}
          endpoint="/api/ftth-subscribers/import"
          queryKey="/api/ftth-subscribers"
          color="border-indigo-200 bg-indigo-50/50"
          staged="ftth"
          lastUpload={ut("/api/ftth-subscribers/import")}
        />
        <UploadCard
          label="قياسات خطوط (أعطال DSL) — يستبدل القديم"
          icon={Gauge}
          endpoint="/api/case-138/import"
          queryKey="/api/case-138"
          color="border-amber-200 bg-amber-50/50"
          lastUpload={ut("/api/case-138/import")}
        />
        <UploadCard
          label="منافذ MSAN ( Provisional Ports) — تحديث برقم التليفون"
          icon={Network}
          endpoint="/api/phone-ports/import"
          queryKey="/api/phone-ports"
          color="border-cyan-200 bg-cyan-50/50"
          lastUpload={ut("/api/phone-ports/import")}
        />
        <button
          type="button"
          onClick={() => window.open("https://provisioningportal.te.eg/provisioningPortal/?sf_ports=1#/login", "_blank")}
          className="w-full flex items-center justify-center gap-2 rounded-md border border-cyan-300 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold py-2.5 transition-colors"
          title="يفتح Provisioning Portal ويشغّل سكربت تحديث ملف البورتات تلقائياً لكل أكواد الأمسان المخزّنة"
        >
          <Network className="w-4 h-4" />
          تحديث منافذ MSAN تلقائياً من Provisioning Portal
        </button>
        <UploadCard
          label="الفنيين بأرقام الكباين — يستبدل القديم"
          icon={Users}
          endpoint="/api/cabinet-technicians/import"
          queryKey="/api/cabinet-technicians"
          color="border-lime-200 bg-lime-50/50"
          lastUpload={ut("/api/cabinet-technicians/import")}
        />
        <UploadCard
          label="أسماء الفنيين (كود العامل + الاسم) — يستبدل القديم"
          icon={Users}
          endpoint="/api/technician-names/import"
          queryKey="/api/technician-names"
          color="border-violet-200 bg-violet-50/50"
          lastUpload={ut("/api/technician-names/import")}
        />
      </Card>

      {/* Date filter + Tabs */}
      <Card className="p-4 bg-white border-0 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          {/* Tabs */}
          <div className="flex rounded-md overflow-hidden border">
            <button
              onClick={() => setTab("maintenance")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "maintenance" ? "bg-orange-500 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              أوامر الشغل ({maintenance.length})
            </button>
            <button
              onClick={() => setTab("tickets")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "tickets" ? "bg-purple-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              شكاوى DSL ({tickets.length})
            </button>
            <button
              onClick={() => setTab("ticketsFtth")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "ticketsFtth" ? "bg-fuchsia-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              شكاوى FTTH ({ticketsFtth.length})
            </button>
            <button
              onClick={() => setTab("details")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "details" ? "bg-teal-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              تفاصيل الأعطال ({detailsCount || details.length})
            </button>
            <button
              onClick={() => setTab("remaining")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "remaining" ? "bg-rose-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              المتبقى ({remaining.length})
            </button>
            <button
              onClick={() => setTab("ftth")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "ftth" ? "bg-indigo-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              FTTH/ADSL ({ftthCount || ftth.length})
            </button>
            <button
              onClick={() => setTab("case138")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "case138" ? "bg-amber-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              حاله 138 ({case138.length})
            </button>
            <button
              onClick={() => setTab("ports")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "ports" ? "bg-cyan-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              منافذ MSAN ({ports.length})
            </button>
            <button
              onClick={() => setTab("orders")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "orders" ? "bg-emerald-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              طلبات FTTH ({orders.length})
            </button>
            <button
              onClick={() => setTab("cabinTech")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "cabinTech" ? "bg-lime-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              فنيين الكباين ({cabinTech.length})
            </button>
            <button
              onClick={() => setTab("techNames")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "techNames" ? "bg-violet-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              أسماء الفنيين ({techNames.length})
            </button>
          </div>

          <div className="flex-1" />

          {/* Date range */}
          <div className="flex items-end gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">من</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">إلى</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36 text-sm" />
            </div>
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-muted-foreground">مسح</Button>
            )}
          </div>
        </div>

        {/* Bucket selector — only for tables with 3 snapshots */}
        {showBucket && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t">
            <span className="text-xs text-muted-foreground">العرض:</span>
            {([
              ["historical", "تاريخي"],
              ["sod", "بداية اليوم"],
              ["current", "حالي"],
            ] as const).map(([val, lbl]) => (
              <button
                key={val}
                onClick={() => setBucket(val)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${bucket === val ? "bg-slate-800 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
              >
                {lbl}
              </button>
            ))}
          </div>
        )}

        {/* Order bucket selector — historical / current / yearly archive */}
        {tab === "orders" && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t">
            <span className="text-xs text-muted-foreground">العرض:</span>
            {([
              ["historical", "تاريخي (السنة الحالية)"],
              ["current", "حالي"],
              ["archive", "الأرشيف"],
            ] as const).map(([val, lbl]) => (
              <button
                key={val}
                onClick={() => setOrderBucket(val)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${orderBucket === val ? "bg-emerald-700 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
              >
                {lbl}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Summary */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
        {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
        <span>
          إجمالي:{" "}
          <strong className="text-foreground">
            {tab === "maintenance" ? maintenance.length : tab === "tickets" ? tickets.length : tab === "ticketsFtth" ? ticketsFtth.length : tab === "details" ? details.length : tab === "remaining" ? remaining.length : tab === "ftth" ? ftth.length : tab === "case138" ? case138.length : tab === "ports" ? ports.length : tab === "cabinTech" ? cabinTech.length : tab === "techNames" ? techNames.length : orders.length}
          </strong>{" "}
          سجل
        </span>
      </div>

      {/* Tables */}
      {tab === "maintenance" && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <div className="overflow-x-auto">
            <Table className="text-right text-sm" dir="rtl">
              <TableHeader className="bg-orange-50">
                <TableRow>
                  <TableHead className="text-right font-bold w-8">#</TableHead>
                  <TableHead className="text-right font-bold">السنترال</TableHead>
                  <TableHead className="text-right font-bold">رقم الأمر</TableHead>
                  <TableHead className="text-right font-bold">رقم التليفون</TableHead>
                  <TableHead className="text-right font-bold">نوع الأمر</TableHead>
                  <TableHead className="text-right font-bold">المرحلة</TableHead>
                  <TableHead className="text-right font-bold">الحالة</TableHead>
                  <TableHead className="text-right font-bold">الأهمية</TableHead>
                  <TableHead className="text-right font-bold">الوصف</TableHead>
                  <TableHead className="text-right font-bold">تاريخ الإنشاء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {maintenance.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-16 text-muted-foreground">
                    {fetchM ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف Work_Orders"}
                  </TableCell></TableRow>
                ) : maintenance.map((o, i) => (
                  <TableRow key={o.id} className="hover:bg-muted/30">
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="whitespace-nowrap">{o.centralName}</TableCell>
                    <TableCell><span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{o.workOrderId}</span></TableCell>
                    <TableCell dir="ltr" className="text-left">{o.phoneNumber}</TableCell>
                    <TableCell className="text-xs">{o.workOrderType || "-"}</TableCell>
                    <TableCell className="text-xs">{o.stage || "-"}</TableCell>
                    <TableCell className="text-xs">{o.status || "-"}</TableCell>
                    <TableCell>{priorityBadge(o.priority)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{o.description || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(o.creationDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {tab === "details" && (
        <>
          {/* Search box + export for details tab */}
          <div className="px-1 flex items-center gap-2 flex-wrap">
            <Input
              placeholder="بحث برقم الشكوى / التليفون / السنترال / الكابينه"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="max-w-sm text-sm"
              dir="rtl"
            />
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1"
              onClick={async () => {
                // جلب سنترالات الغنايم الأربعة فقط (بدون all=true) بحد مرتفع
                const p = new URLSearchParams();
                p.set("limit", "100000");
                if (dateFrom) p.set("dateFrom", dateFrom);
                if (dateTo)   p.set("dateTo", dateTo);
                if (searchQ)  p.set("q", searchQ);
                const res = await fetch(`/api/complaint-details?${p}`, { credentials: "include" });
                const rows: ComplaintDetail[] = res.ok ? await res.json() : [];
                const ws = XLSX.utils.json_to_sheet(rows.map(d => ({
                  "رقم الشكوى": d.complainNo,
                  "السنترال": d.exchangeName ?? "",
                  "رقم التليفون": d.phoneNumber ?? "",
                  "الكابينه": d.cabinetNo ?? "",
                  "MSAN": d.msanId ?? "",
                  "نوع العطل": d.complainTypeName ?? "",
                  "كود الإغلاق": d.closeCode ?? "",
                  "أغلق بواسطة": d.closeBy ?? "",
                  "وقت الشكوى": d.complainTime ?? "",
                  "وقت الإغلاق": d.closeTime ?? "",
                  "القطاع": d.sector ?? "",
                  "المنطقة": d.region ?? "",
                })));
                const wb2 = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb2, ws, "تفاصيل الأعطال");
                XLSX.writeFile(wb2, "complaint_details_ghonaim.xlsx");
              }}
            >
              📥 تصدير الغنايم (Excel)
            </Button>
          </div>
          <Card className="overflow-hidden shadow-sm border-0 bg-white">
            <div className="overflow-x-auto">
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-teal-50">
                  <TableRow>
                    <TableHead className="text-right font-bold w-8">#</TableHead>
                    <TableHead className="text-right font-bold">رقم الشكوى</TableHead>
                    <TableHead className="text-right font-bold">السنترال</TableHead>
                    <TableHead className="text-right font-bold">رقم التليفون</TableHead>
                    <TableHead className="text-right font-bold">الكابينه</TableHead>
                    <TableHead className="text-right font-bold">MSAN</TableHead>
                    <TableHead className="text-right font-bold">نوع العطل</TableHead>
                    <TableHead className="text-right font-bold">كود الإغلاق</TableHead>
                    <TableHead className="text-right font-bold">وقت الشكوى</TableHead>
                    <TableHead className="text-right font-bold">وقت الإغلاق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {details.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-16 text-muted-foreground">
                      {fetchD ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف 430D_Trial"}
                    </TableCell></TableRow>
                  ) : details.map((d, i) => (
                    <TableRow key={d.id} className="hover:bg-muted/30">
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell><span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{d.complainNo}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{d.exchangeName || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left">{d.phoneNumber || "-"}</TableCell>
                      <TableCell className="text-xs">{d.cabinetNo || "-"}</TableCell>
                      <TableCell className="text-xs">{d.msanId || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">{d.complainTypeName || "-"}</TableCell>
                      <TableCell className="text-xs">{d.closeCode || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(d.complainTime)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(d.closeTime)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {tab === "remaining" && (
        <>
          {/* Search box + export for remaining tab */}
          <div className="px-1 flex items-center gap-2 flex-wrap">
            <Input
              placeholder="بحث برقم الشكوى / التليفون / السنترال / الكابينه"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="max-w-sm text-sm"
              dir="rtl"
            />
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1"
              onClick={async () => {
                // جلب سنترالات الغنايم الأربعة فقط (بدون all=true)
                const p = new URLSearchParams();
                if (dateFrom) p.set("dateFrom", dateFrom);
                if (dateTo)   p.set("dateTo", dateTo);
                if (searchQ)  p.set("q", searchQ);
                const res = await fetch(`/api/remaining-complaints?${p}`, { credentials: "include" });
                const rows: RemainingComplaint[] = res.ok ? await res.json() : [];
                const ws = XLSX.utils.json_to_sheet(rows.map(d => ({
                  "رقم الشكوى": d.complainNo,
                  "السنترال": d.exchangeName ?? "",
                  "رقم التليفون": d.phoneNumber ?? "",
                  "الكابينه": d.cabinetNo ?? "",
                  "MSAN": d.msanId ?? "",
                  "نوع العطل": d.complainType ?? "",
                  "كود الحالة": d.statusCode ?? "",
                  "كود الإغلاق": d.closeCode ?? "",
                  "أغلق بواسطة": d.closeBy ?? "",
                  "وقت الشكوى": d.complainTime ?? "",
                  "وقت التسليم": d.dispatchTime ?? "",
                  "وقت الإغلاق": d.closeTime ?? "",
                  "القطاع": d.sector ?? "",
                  "المنطقة": d.region ?? "",
                })));
                const wb2 = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb2, ws, "المتبقى");
                XLSX.writeFile(wb2, "remaining_complaints_ghonaim.xlsx");
              }}
            >
              📥 تصدير الغنايم (Excel)
            </Button>
          </div>
          <Card className="overflow-hidden shadow-sm border-0 bg-white">
            <div className="overflow-x-auto">
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-rose-50">
                  <TableRow>
                    <TableHead className="text-right font-bold w-8">#</TableHead>
                    <TableHead className="text-right font-bold">رقم الشكوى</TableHead>
                    <TableHead className="text-right font-bold">السنترال</TableHead>
                    <TableHead className="text-right font-bold">رقم التليفون</TableHead>
                    <TableHead className="text-right font-bold">الكابينه</TableHead>
                    <TableHead className="text-right font-bold">MSAN</TableHead>
                    <TableHead className="text-right font-bold">نوع العطل</TableHead>
                    <TableHead className="text-right font-bold">الحالة</TableHead>
                    <TableHead className="text-right font-bold">وقت الشكوى</TableHead>
                    <TableHead className="text-right font-bold">وقت التسليم</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {remaining.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-16 text-muted-foreground">
                      {fetchR ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف 430D_Trial"}
                    </TableCell></TableRow>
                  ) : remaining.map((d, i) => (
                    <TableRow key={d.id} className="hover:bg-muted/30">
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell><span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{d.complainNo}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{d.exchangeName || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left">{d.phoneNumber || "-"}</TableCell>
                      <TableCell className="text-xs">{d.cabinetNo || "-"}</TableCell>
                      <TableCell className="text-xs">{d.msanId || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">{d.complainType || "-"}</TableCell>
                      <TableCell className="text-xs">{d.statusCode || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(d.complainTime)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(d.dispatchTime)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {tab === "ftth" && (
        <>
          <div className="px-1">
            <Input
              placeholder="بحث بكود السنترال / المركز / MSAN / النوع"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="max-w-sm text-sm"
              dir="rtl"
            />
          </div>
          <Card className="overflow-hidden shadow-sm border-0 bg-white">
            <div className="overflow-x-auto">
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-indigo-50">
                  <TableRow>
                    <TableHead className="text-right font-bold w-8">#</TableHead>
                    <TableHead className="text-right font-bold">المركز الرئيسي</TableHead>
                    <TableHead className="text-right font-bold">المركز الفرعي</TableHead>
                    <TableHead className="text-right font-bold">كود FCC</TableHead>
                    <TableHead className="text-right font-bold">النوع</TableHead>
                    <TableHead className="text-right font-bold">MSAN/GPON</TableHead>
                    <TableHead className="text-right font-bold">FBB</TableHead>
                    <TableHead className="text-right font-bold">FV</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ftth.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-16 text-muted-foreground">
                      {fetchF ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف FTTH/ADSL"}
                    </TableCell></TableRow>
                  ) : ftth.map((f, i) => (
                    <TableRow key={f.id} className="hover:bg-muted/30">
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{f.mainEx || "-"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{f.subEx || "-"}</TableCell>
                      <TableCell><span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{f.fccCode}</span></TableCell>
                      <TableCell className="text-xs">{f.type || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left text-xs">{f.msanGponCode || "-"}</TableCell>
                      <TableCell className="font-medium">{f.fbbSubs ?? "-"}</TableCell>
                      <TableCell className="font-medium">{f.fvSubs ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {tab === "case138" && (
        <>
          <div className="px-1">
            <Input
              placeholder="بحث برقم الشكوى / التليفون / السنترال / الكابينه"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="max-w-sm text-sm"
              dir="rtl"
            />
          </div>
          <Card className="overflow-hidden shadow-sm border-0 bg-white">
            <div className="overflow-x-auto">
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-amber-50">
                  <TableRow>
                    <TableHead className="text-right font-bold w-8">#</TableHead>
                    <TableHead className="text-right font-bold">السنترال</TableHead>
                    <TableHead className="text-right font-bold">رقم الشكوى</TableHead>
                    <TableHead className="text-right font-bold">التليفون</TableHead>
                    <TableHead className="text-right font-bold">الكابينه</TableHead>
                    <TableHead className="text-right font-bold">البكس</TableHead>
                    <TableHead className="text-right font-bold">السرعة الحالية</TableHead>
                    <TableHead className="text-right font-bold">أقصى سرعة</TableHead>
                    <TableHead className="text-right font-bold">نوع العطل</TableHead>
                    <TableHead className="text-right font-bold">وقت الشكوى</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {case138.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-16 text-muted-foreground">
                      {fetchC ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف حاله 138"}
                    </TableCell></TableRow>
                  ) : case138.map((c, i) => (
                    <TableRow key={c.id} className="hover:bg-muted/30">
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{c.centralName || "-"}</TableCell>
                      <TableCell><span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{c.complainNo}</span></TableCell>
                      <TableCell dir="ltr" className="text-left">{c.fullPhone || c.phoneShort || "-"}</TableCell>
                      <TableCell className="text-xs">{c.cabinetNo || "-"}</TableCell>
                      <TableCell className="text-xs">{c.boxNo || "-"}</TableCell>
                      <TableCell className="text-center">{c.currentSpeed || "-"}</TableCell>
                      <TableCell className="text-center">{c.maxSpeed || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">{c.complainTypeName || c.faultType || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(c.complainTime)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {tab === "orders" && (
        <>
          <div className="px-1">
            <Input
              placeholder="بحث برقم الطلب / رقم الخدمة / العميل / MSAN / السنترال"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="max-w-sm text-sm"
              dir="rtl"
            />
          </div>
          <Card className="overflow-hidden shadow-sm border-0 bg-white">
            <div className="overflow-x-auto">
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-emerald-50">
                  <TableRow>
                    <TableHead className="text-right font-bold w-8">#</TableHead>
                    {orderBucket === "archive" && <TableHead className="text-right font-bold">السنة</TableHead>}
                    <TableHead className="text-right font-bold">رقم الطلب</TableHead>
                    <TableHead className="text-right font-bold">رقم الخدمة</TableHead>
                    <TableHead className="text-right font-bold">العميل</TableHead>
                    <TableHead className="text-right font-bold">المنتج</TableHead>
                    <TableHead className="text-right font-bold">الحالة</TableHead>
                    <TableHead className="text-right font-bold">السنترال</TableHead>
                    <TableHead className="text-right font-bold">MSAN</TableHead>
                    <TableHead className="text-right font-bold">النشاط الحالي</TableHead>
                    <TableHead className="text-right font-bold">الخطأ</TableHead>
                    <TableHead className="text-right font-bold">تاريخ الإنشاء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.length === 0 ? (
                    <TableRow><TableCell colSpan={orderBucket === "archive" ? 12 : 11} className="text-center py-16 text-muted-foreground">
                      {fetchO ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف طلبات FTTH"}
                    </TableCell></TableRow>
                  ) : orders.map((o, i) => (
                    <TableRow key={o.id} className="hover:bg-muted/30">
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      {orderBucket === "archive" && <TableCell className="text-xs font-medium">{o.archivedYear ?? "-"}</TableCell>}
                      <TableCell dir="ltr" className="text-left font-mono text-xs">{o.serviceOrderId}</TableCell>
                      <TableCell dir="ltr" className="text-left text-xs">{o.serviceNumber || "-"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap max-w-[160px] truncate">{o.customerName || "-"}</TableCell>
                      <TableCell className="text-xs">{o.product || "-"}</TableCell>
                      <TableCell className="text-xs">{o.orderStatus || "-"}</TableCell>
                      <TableCell className="text-xs">{o.fccExchange || o.exchangeName || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left text-xs">{o.msanCode || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{o.currentActivity || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{o.errorName || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(o.orderCreateTime)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {tab === "ports" && (
        <>
          <div className="px-1">
            <Input
              placeholder="بحث برقم التليفون / MSAN / المشغّل"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="max-w-sm text-sm"
              dir="rtl"
            />
          </div>
          <Card className="overflow-hidden shadow-sm border-0 bg-white">
            <div className="overflow-x-auto">
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-cyan-50">
                  <TableRow>
                    <TableHead className="text-right font-bold w-8">#</TableHead>
                    <TableHead className="text-right font-bold">رقم التليفون</TableHead>
                    <TableHead className="text-right font-bold">كود MSAN</TableHead>
                    <TableHead className="text-right font-bold">Frame</TableHead>
                    <TableHead className="text-right font-bold">Shelf</TableHead>
                    <TableHead className="text-right font-bold">Slot</TableHead>
                    <TableHead className="text-right font-bold">Port</TableHead>
                    <TableHead className="text-right font-bold">نوع المنفذ</TableHead>
                    <TableHead className="text-right font-bold">Voice</TableHead>
                    <TableHead className="text-right font-bold">Data</TableHead>
                    <TableHead className="text-right font-bold">المشغّل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ports.length === 0 ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-16 text-muted-foreground">
                      {fetchP ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف المنافذ"}
                    </TableCell></TableRow>
                  ) : ports.map((p, i) => (
                    <TableRow key={p.id} className="hover:bg-muted/30">
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell dir="ltr" className="text-left font-mono text-xs">{p.phoneNumber}</TableCell>
                      <TableCell dir="ltr" className="text-left text-xs">{p.msanCode || "-"}</TableCell>
                      <TableCell className="text-xs">{p.frame || "-"}</TableCell>
                      <TableCell className="text-xs">{p.shelf || "-"}</TableCell>
                      <TableCell className="text-xs">{p.slot || "-"}</TableCell>
                      <TableCell className="text-xs">{p.portNumber || "-"}</TableCell>
                      <TableCell className="text-xs">{p.portType || "-"}</TableCell>
                      <TableCell className="text-xs">{p.voiceStatus || "-"}</TableCell>
                      <TableCell className="text-xs">{p.dataStatus || "-"}</TableCell>
                      <TableCell className="text-xs">{p.operator || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {tab === "cabinTech" && (
        <>
          <div className="px-1">
            <Input
              placeholder="بحث بالسنترال / الكابينه / كود العامل / المنطقة / IDU"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="max-w-sm text-sm"
              dir="rtl"
            />
          </div>
          <Card className="overflow-hidden shadow-sm border-0 bg-white">
            <div className="overflow-x-auto">
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-lime-50">
                  <TableRow>
                    <TableHead className="text-right font-bold w-8">#</TableHead>
                    <TableHead className="text-right font-bold">السنترال</TableHead>
                    <TableHead className="text-right font-bold">رقم الكابينه</TableHead>
                    <TableHead className="text-right font-bold">كود العامل</TableHead>
                    <TableHead className="text-right font-bold">حياة كريمة</TableHead>
                    <TableHead className="text-right font-bold">المنطقة</TableHead>
                    <TableHead className="text-right font-bold">الشغال</TableHead>
                    <TableHead className="text-right font-bold">كود القرية</TableHead>
                    <TableHead className="text-right font-bold">كود الكابينه</TableHead>
                    <TableHead className="text-right font-bold">IDU</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cabinTech.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-16 text-muted-foreground">
                      {fetchCT ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف الفنيين بأرقام الكباين"}
                    </TableCell></TableRow>
                  ) : cabinTech.map((c, i) => (
                    <TableRow key={c.id} className="hover:bg-muted/30">
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs">{c.centralName || "-"}</TableCell>
                      <TableCell className="text-xs">{c.cabinNumber || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left font-mono text-xs">{c.workerCode || "-"}</TableCell>
                      <TableCell className="text-xs">{c.hayaKarima || "-"}</TableCell>
                      <TableCell className="text-xs">{c.regionName || "-"}</TableCell>
                      <TableCell className="text-xs">{c.active || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left text-xs">{c.villageCode || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left text-xs">{c.cabinCode || "-"}</TableCell>
                      <TableCell dir="ltr" className="text-left text-xs">{c.idu || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {tab === "techNames" && (
        <>
          <div className="px-1">
            <Input
              placeholder="بحث بكود العامل / اسم الفنى"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="max-w-sm text-sm"
              dir="rtl"
            />
          </div>
          <Card className="overflow-hidden shadow-sm border-0 bg-white">
            <div className="overflow-x-auto">
              <Table className="text-right text-sm" dir="rtl">
                <TableHeader className="bg-violet-50">
                  <TableRow>
                    <TableHead className="text-right font-bold w-8">#</TableHead>
                    <TableHead className="text-right font-bold">كود العامل</TableHead>
                    <TableHead className="text-right font-bold">اسم الفنى</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {techNames.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-16 text-muted-foreground">
                      {fetchTN ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف أسماء الفنيين"}
                    </TableCell></TableRow>
                  ) : techNames.map((t, i) => (
                    <TableRow key={t.id} className="hover:bg-muted/30">
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell dir="ltr" className="text-left font-mono text-xs">{t.workerCode}</TableCell>
                      <TableCell className="font-medium">{t.techName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {tab === "tickets" && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <div className="overflow-x-auto">
            <Table className="text-right text-sm" dir="rtl">
              <TableHeader className="bg-purple-50">
                <TableRow>
                  <TableHead className="text-right font-bold w-8">#</TableHead>
                  <TableHead className="text-right font-bold">رقم الشكوى</TableHead>
                  <TableHead className="text-right font-bold">السنترال</TableHead>
                  <TableHead className="text-right font-bold">رقم التليفون</TableHead>
                  <TableHead className="text-right font-bold">الكابينه</TableHead>
                  <TableHead className="text-right font-bold">الفنى</TableHead>
                  <TableHead className="text-right font-bold">نوع الخط</TableHead>
                  <TableHead className="text-right font-bold">الأولوية</TableHead>
                  <TableHead className="text-right font-bold">نوع العطل</TableHead>
                  <TableHead className="text-right font-bold">وقت الشكوى</TableHead>
                  <TableHead className="text-right font-bold">تاريخ الإغلاق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-16 text-muted-foreground">
                    {fetchT ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف TicketQueue"}
                  </TableCell></TableRow>
                ) : tickets.map((t, i) => (
                  <TableRow key={t.id} className="hover:bg-muted/30">
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell><span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{t.ticketId}</span></TableCell>
                    <TableCell className="whitespace-nowrap">{t.centralName}</TableCell>
                    <TableCell dir="ltr" className="text-left">{t.phoneNumber || "-"}</TableCell>
                    <TableCell>{t.cabinetNo || "-"}</TableCell>
                    <TableCell className="text-xs">{t.techCode || "-"}</TableCell>
                    <TableCell className="text-xs">{t.lineTypeCode || "-"}</TableCell>
                    <TableCell>{priorityBadge(t.priorityCode)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{t.complainTypeName || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(t.complaintTime)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(t.closeDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {tab === "ticketsFtth" && (
        <Card className="overflow-hidden shadow-sm border-0 bg-white">
          <div className="overflow-x-auto">
            <Table className="text-right text-sm" dir="rtl">
              <TableHeader className="bg-fuchsia-50">
                <TableRow>
                  <TableHead className="text-right font-bold w-8">#</TableHead>
                  <TableHead className="text-right font-bold">رقم الشكوى</TableHead>
                  <TableHead className="text-right font-bold">السنترال</TableHead>
                  <TableHead className="text-right font-bold">رقم التليفون</TableHead>
                  <TableHead className="text-right font-bold">الكابينه</TableHead>
                  <TableHead className="text-right font-bold">الفنى</TableHead>
                  <TableHead className="text-right font-bold">نوع الخط</TableHead>
                  <TableHead className="text-right font-bold">الأولوية</TableHead>
                  <TableHead className="text-right font-bold">نوع العطل</TableHead>
                  <TableHead className="text-right font-bold">وقت الشكوى</TableHead>
                  <TableHead className="text-right font-bold">تاريخ الإغلاق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ticketsFtth.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-16 text-muted-foreground">
                    {fetchTF ? "جاري التحميل..." : "لا توجد بيانات — ارفع ملف TicketQueue FTTH"}
                  </TableCell></TableRow>
                ) : ticketsFtth.map((t, i) => (
                  <TableRow key={t.id} className="hover:bg-muted/30">
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell><span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{t.ticketId}</span></TableCell>
                    <TableCell className="whitespace-nowrap">{t.centralName}</TableCell>
                    <TableCell dir="ltr" className="text-left">{t.phoneNumber || "-"}</TableCell>
                    <TableCell>{t.cabinetNo || "-"}</TableCell>
                    <TableCell className="text-xs">{t.techCode || "-"}</TableCell>
                    <TableCell className="text-xs">{t.lineTypeCode || "-"}</TableCell>
                    <TableCell>{priorityBadge(t.priorityCode)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{t.complainTypeName || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(t.complaintTime)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(t.closeDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
