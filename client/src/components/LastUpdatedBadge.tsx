import { useQuery } from "@tanstack/react-query";

// وقت الرفع بصيغة مختصرة: "اليوم HH:MM" أو "DD/MM HH:MM"
function fmtUploadTime(iso?: string | null): string {
  if (!iso) return "لم يُرفع";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sameDay ? `اليوم ${time}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`;
}

// شارة "آخر تحديث" لملف مصدر معيّن (مثلاً FCC / WFM / OSS) — تقرأ من /api/upload-times
export function LastUpdatedBadge({ endpoint, label }: { endpoint: string; label: string }) {
  const { data: uploadTimes = {} } = useQuery<Record<string, string | null>>({
    queryKey: ["/api/upload-times"],
    queryFn: () => fetch("/api/upload-times", { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 60000,
    staleTime: 30000,
  });
  return (
    <span className="text-xs px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-700 whitespace-nowrap">
      {label}: <strong>{fmtUploadTime(uploadTimes[endpoint])}</strong>
    </span>
  );
}
