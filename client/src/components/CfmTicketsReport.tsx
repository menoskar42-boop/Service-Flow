import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";

const REFRESH_INTERVAL = 30;

interface CfmTicket {
  id: string;
  ticketNumber: string;
  centralDepartment?: string;
  central?: { name: string; code?: string } | null;
  cable?: { number?: string; cableNumber?: string; cabinetNumber?: string; type?: string } | null;
  box?: string | null;
  faultType?: { name: string; category?: string } | null;
  notes?: string | null;
  status: "open" | "pending_confirmation" | "closed" | "cancelled" | string;
  createdAt: string;
  createdByUser?: { name: string } | null;
  works?: { performedBy?: string }[];
  // مُضافة من الـ proxy: متوسط قياس بكسات التذكرة من Service Flow
  boxAvgScore?: number | null;
  boxMeasuredLines?: number;
  boxCount?: number;
  boxesWithData?: number;
  boxBreakdown?: { box: string; avg: number | null; measured: number }[];
}

function avgScoreBadge(v: number | null | undefined) {
  if (v == null) return <span className="text-gray-400">-</span>;
  const cls =
    v > 33 ? "bg-red-100 text-red-800" :
    v > 15 ? "bg-amber-100 text-amber-700" :
             "bg-green-100 text-green-800";
  return <span className={`text-xs px-2 py-0.5 rounded font-semibold ${cls}`}>{v}</span>;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  open:                 { label: "مفتوحة",        cls: "bg-blue-100 text-blue-800" },
  pending_confirmation: { label: "تحت التأكيد",   cls: "bg-amber-100 text-amber-800" },
  closed:               { label: "مغلقة",         cls: "bg-green-100 text-green-800" },
  cancelled:            { label: "ملغية",         cls: "bg-red-100 text-red-800" },
};

function statusBadge(s: string) {
  const { label, cls } = STATUS_LABELS[s] ?? { label: s, cls: "bg-gray-100 text-gray-700" };
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>{label}</span>;
}

function getTechs(ticket: CfmTicket) {
  if (!ticket.works?.length) return "-";
  const all = ticket.works.map((w) => w.performedBy).filter(Boolean);
  return all.length ? [...new Set(all)].join("، ") : "-";
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}

export function CfmTicketsReport() {
  const [data, setData] = useState<CfmTicket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/proxy/cfm-tickets", { credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any).message || `خطأ ${res.status}`);
      }
      const json = await res.json();
      setData(Array.isArray(json) ? json : (json.data ?? json.tickets ?? []));
      setLastFetch(new Date());
      setCountdown(REFRESH_INTERVAL);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { fetchData(); return REFRESH_INTERVAL; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [fetchData]);

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="overflow-hidden shadow-sm border-0 bg-white">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base">تذاكر أعطال الشبكات الأرضية</h3>
            {lastFetch && (
              <p className="text-xs text-muted-foreground mt-0.5">
                آخر تحديث: {lastFetch.toLocaleTimeString("ar-EG")} — يتجدد خلال {countdown}ث
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data && <span className="text-sm text-muted-foreground">{data.length} تذكرة</span>}
            <Button variant="outline" size="sm" onClick={() => { fetchData(); setCountdown(REFRESH_INTERVAL); }} disabled={loading} className="gap-1">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              تحديث
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-50 text-red-700 text-sm border-b">
            <AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : data && data.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">لا توجد تذاكر</div>
        ) : data ? (
          <div className="overflow-x-auto">
            <Table className="text-right text-sm" dir="rtl">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="text-right font-bold">#</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم التذكرة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">تاريخ الإنشاء</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">السنترال</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">رقم الكابينة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">بوكس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">متوسط القياس</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">نوع العطل</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الحالة</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">الفنى</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">ملاحظات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((t, idx) => (
                  <TableRow key={t.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-mono font-semibold text-blue-700 whitespace-nowrap">{t.ticketNumber}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(t.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{t.central?.name ?? t.centralDepartment ?? "-"}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{t.cable?.number || "-"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap font-medium">{t.box || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {avgScoreBadge(t.boxAvgScore)}
                      {t.boxCount != null && t.boxCount > 0 && (
                        <span className="text-[10px] text-muted-foreground block mt-0.5">
                          {t.boxesWithData}/{t.boxCount} بكس · {t.boxMeasuredLines ?? 0} خط
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {t.faultType ? (
                        <span className="text-xs">{t.faultType.name}</span>
                      ) : "-"}
                    </TableCell>
                    <TableCell>{statusBadge(t.status)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{getTechs(t)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">{t.notes || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
