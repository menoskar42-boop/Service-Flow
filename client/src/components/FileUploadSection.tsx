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
import { Upload, Loader2, Wrench, PhoneCall, FileSearch } from "lucide-react";

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
  label, icon: Icon, endpoint, queryKey, color,
}: {
  label: string;
  icon: any;
  endpoint: string;
  queryKey: string;
  color: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const mut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(endpoint, { method: "POST", body: fd, credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "خطأ");
      return json;
    },
    onSuccess: (d) => {
      toast({ title: "تم الاستيراد", description: `${d.inserted} سجل جديد — تخطى ${d.skipped}`, duration: 4000 });
      qc.invalidateQueries({ queryKey: [queryKey] });
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
  const [tab, setTab] = useState<"maintenance" | "tickets" | "details">("maintenance");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQ, setSearchQ] = useState("");

  const { data: maintenance = [], isFetching: fetchM } = useQuery<MaintenanceOrder[]>({
    queryKey: ["/api/maintenance-orders", dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo", dateTo);
      const res = await fetch(`/api/maintenance-orders?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: tickets = [], isFetching: fetchT } = useQuery<TicketRow[]>({
    queryKey: ["/api/ticket-queue", dateFrom, dateTo],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo", dateTo);
      const res = await fetch(`/api/ticket-queue?${p}`, { credentials: "include" });
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

  const isFetching = tab === "maintenance" ? fetchM : tab === "tickets" ? fetchT : fetchD;

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
          label="قائمة الشكاوى (TicketQueue)"
          icon={PhoneCall}
          endpoint="/api/ticket-queue/import"
          queryKey="/api/ticket-queue"
          color="border-purple-200 bg-purple-50/50"
        />
        <UploadCard
          label="تفاصيل الأعطال (430D_Trial) — يستبدل القديم"
          icon={FileSearch}
          endpoint="/api/complaint-details/import"
          queryKey="/api/complaint-details"
          color="border-teal-200 bg-teal-50/50"
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
              الشكاوى ({tickets.length})
            </button>
            <button
              onClick={() => setTab("details")}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "details" ? "bg-teal-600 text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
            >
              تفاصيل الأعطال ({details.length})
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
      </Card>

      {/* Summary */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
        {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
        <span>
          إجمالي:{" "}
          <strong className="text-foreground">
            {tab === "maintenance" ? maintenance.length : tickets.length}
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
    </div>
  );
}
