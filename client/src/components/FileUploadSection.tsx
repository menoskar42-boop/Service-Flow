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
import { Upload, Loader2, Wrench, PhoneCall, FileSearch, Wifi, Gauge } from "lucide-react";

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

function UploadCard({
  label, icon: Icon, endpoint, queryKey, color, extraKeys = [],
}: {
  label: string;
  icon: any;
  endpoint: string;
  queryKey: string;
  color: string;
  extraKeys?: string[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const mut = useMutation({
    mutationFn: async (file: File) => {
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
        desc = `تفاصيل: ${d.details?.inserted ?? 0} جديد — متبقى: ${d.remaining?.inserted ?? 0}`;
      } else if (d.current !== undefined) {
        const sod = d.startOfDay >= 0 ? `بداية اليوم: ${d.startOfDay} (تم التحديث)` : "بداية اليوم: لم تتغير";
        desc = `تاريخي: ${d.hist} جديد — حالي: ${d.current} — ${sod}`;
      } else {
        desc = `${d.inserted} سجل جديد — تخطى ${d.skipped ?? 0}`;
      }
      toast({ title: "تم الاستيراد", description: desc, duration: 4500 });
      [queryKey, ...extraKeys].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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
          {mut.isPending ? "جاري الاستيراد..." : "اختر ملف Excel"}
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
  const [tab, setTab] = useState<"maintenance" | "tickets" | "ticketsFtth" | "details" | "remaining" | "ftth" | "case138">("maintenance");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQ, setSearchQ] = useState("");
  // bucket for tables that keep 3 snapshots: تاريخي / بداية اليوم / حالي
  const [bucket, setBucket] = useState<"historical" | "sod" | "current">("historical");

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
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo", dateTo);
      if (searchQ)  p.set("q", searchQ);
      const res = await fetch(`/api/complaint-details?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: remaining = [], isFetching: fetchR } = useQuery<RemainingComplaint[]>({
    queryKey: ["/api/remaining-complaints", dateFrom, dateTo, searchQ],
    queryFn: async () => {
      const p = new URLSearchParams();
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

  const isFetching =
    tab === "maintenance" ? fetchM :
    tab === "tickets" ? fetchT :
    tab === "ticketsFtth" ? fetchTF :
    tab === "details" ? fetchD :
    tab === "remaining" ? fetchR :
    tab === "ftth" ? fetchF : fetchC;

  // bucket selector applies to tabs that keep 3 snapshots
  const showBucket = tab === "maintenance" || tab === "tickets" || tab === "ticketsFtth";

  return (
    <div className="space-y-5" dir="rtl">
      {/* Upload Cards */}
      <Card className="p-4 bg-white border-0 shadow-sm space-y-3">
        <p className="text-sm font-semibold text-muted-foreground">رفع الملفات</p>
        <UploadCard
          label="أوامر شغل الأعطال (Work_Orders)"
          icon={Wrench}
          endpoint="/api/maintenance-orders/import"
          queryKey="/api/maintenance-orders"
          color="border-orange-200 bg-orange-50/50"
        />
        <UploadCard
          label="شكاوى DSL/نحاس (TicketQueue)"
          icon={PhoneCall}
          endpoint="/api/ticket-queue/import"
          queryKey="/api/tickets"
          color="border-purple-200 bg-purple-50/50"
        />
        <UploadCard
          label="شكاوى FTTH (TicketQueue FTTH)"
          icon={PhoneCall}
          endpoint="/api/ticket-queue-ftth/import"
          queryKey="/api/tickets"
          color="border-fuchsia-200 bg-fuchsia-50/50"
        />
        <UploadCard
          label="تفاصيل الأعطال (430D_Trial) — التفاصيل تتراكم / المتبقى يُستبدل"
          icon={FileSearch}
          endpoint="/api/complaint-details/import"
          queryKey="/api/complaint-details"
          extraKeys={["/api/remaining-complaints"]}
          color="border-teal-200 bg-teal-50/50"
        />
        <UploadCard
          label="مشتركين FTTH / ADSL — يستبدل القديم"
          icon={Wifi}
          endpoint="/api/ftth-subscribers/import"
          queryKey="/api/ftth-subscribers"
          color="border-indigo-200 bg-indigo-50/50"
        />
        <UploadCard
          label="حاله 138 (أعطال DSL) — يستبدل القديم"
          icon={Gauge}
          endpoint="/api/case-138/import"
          queryKey="/api/case-138"
          color="border-amber-200 bg-amber-50/50"
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
              تفاصيل الأعطال ({details.length})
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
              FTTH/ADSL ({ftth.length})
            </button>
            <button
              onClick={() => setTab("case138")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "case138" ? "bg-amber-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              حاله 138 ({case138.length})
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
      </Card>

      {/* Summary */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
        {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
        <span>
          إجمالي:{" "}
          <strong className="text-foreground">
            {tab === "maintenance" ? maintenance.length : tab === "tickets" ? tickets.length : tab === "ticketsFtth" ? ticketsFtth.length : tab === "details" ? details.length : tab === "remaining" ? remaining.length : tab === "ftth" ? ftth.length : case138.length}
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
          {/* Search box for details tab */}
          <div className="px-1">
            <Input
              placeholder="بحث برقم الشكوى / التليفون / السنترال / الكابينة"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="max-w-sm text-sm"
              dir="rtl"
            />
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
                    <TableHead className="text-right font-bold">الكابينة</TableHead>
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
          {/* Search box for remaining tab */}
          <div className="px-1">
            <Input
              placeholder="بحث برقم الشكوى / التليفون / السنترال / الكابينة"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="max-w-sm text-sm"
              dir="rtl"
            />
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
                    <TableHead className="text-right font-bold">الكابينة</TableHead>
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
              placeholder="بحث برقم الشكوى / التليفون / السنترال / الكابينة"
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
                    <TableHead className="text-right font-bold">الكابينة</TableHead>
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
                  <TableHead className="text-right font-bold">الكابينة</TableHead>
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
                  <TableHead className="text-right font-bold">الكابينة</TableHead>
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
