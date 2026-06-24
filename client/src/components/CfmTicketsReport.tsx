import { useEffect, useState, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";

const REFRESH_INTERVAL = 30; // seconds

export function CfmTicketsReport() {
  const [data, setData] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // أول تحميل
  useEffect(() => { fetchData(); }, [fetchData]);

  // تحديث تلقائى كل 30 ثانية
  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { fetchData(); return REFRESH_INTERVAL; }
        return c - 1;
      });
    }, 1000);
    timerRef.current = id;
    return () => clearInterval(id);
  }, [fetchData]);

  const columns = data && data.length > 0 ? Object.keys(data[0]) : [];

  const fmt = (v: unknown) => {
    if (v == null) return "-";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

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
            {data && <span className="text-sm text-muted-foreground">{data.length} سجل</span>}
            <Button
              variant="outline"
              size="sm"
              onClick={() => { fetchData(); setCountdown(REFRESH_INTERVAL); }}
              disabled={loading}
              className="gap-1"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              تحديث
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-50 text-red-700 text-sm border-b">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
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
                  <TableHead className="text-right font-bold w-10">#</TableHead>
                  {columns.map((col) => (
                    <TableHead key={col} className="text-right font-bold whitespace-nowrap">{col}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    {columns.map((col) => (
                      <TableCell key={col} className="whitespace-nowrap">{fmt(row[col])}</TableCell>
                    ))}
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
