import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Server, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";
import { executeJob, type ExecJob } from "@/lib/exec-queue";

// زر «جهاز التنفيذ» — للسوبر أدمن فقط. لما يتفعّل، البراوزر ده يبقى هو المنفّذ:
// يبعت نبضة كل 20ث، ويسحب المهام من الطابور كل 4ث وينفّذها (رفع سرعة/قياس/إيقاف).
// أى جهاز تانى يعمل رفع سرعة/قياس/إيقاف بيروح للطابور فينفّذه الجهاز ده.
export function ExecutorButton() {
  const { user } = useAuth();
  const [active, setActive] = useState(() => {
    try { return localStorage.getItem("sf_exec_active") === "1"; } catch { return false; }
  });
  const [pending, setPending] = useState(0);
  const busy = useRef(false);

  const toggle = () => {
    setActive((v) => {
      const nv = !v;
      try { localStorage.setItem("sf_exec_active", nv ? "1" : "0"); } catch {}
      return nv;
    });
  };

  useEffect(() => {
    if (!active) return;
    let stopped = false;

    const heartbeat = () => { fetch("/api/exec-queue/heartbeat", { method: "POST", credentials: "include" }).catch(() => {}); };

    const claimAndRun = async () => {
      if (busy.current || stopped) return;
      busy.current = true;
      try {
        const r = await fetch("/api/exec-queue/claim", { method: "POST", credentials: "include" });
        const job: ExecJob | null = r.ok ? await r.json() : null;
        if (job && job.id) {
          executeJob(job);
          await fetch(`/api/exec-queue/${job.id}/done`, { method: "POST", credentials: "include" }).catch(() => {});
        }
      } catch {} finally { busy.current = false; }
    };

    const refreshPending = () => {
      fetch("/api/exec-queue/pending", { credentials: "include" })
        .then((r) => r.json()).then((d) => setPending(d?.pending ?? 0)).catch(() => {});
    };

    heartbeat(); refreshPending();
    const hb = setInterval(heartbeat, 20 * 1000);
    const poll = setInterval(() => { claimAndRun(); refreshPending(); }, 4 * 1000);
    return () => { stopped = true; clearInterval(hb); clearInterval(poll); };
  }, [active]);

  if (user?.role !== ROLES.SUPER_ADMIN) return null;

  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={toggle}
      className={active ? "bg-indigo-600 hover:bg-indigo-700 gap-1" : "text-indigo-700 border-indigo-200 gap-1"}
      title="جهاز التنفيذ المركزى: لما يتفعّل، رفع السرعة/القياس/الإيقاف من أى جهاز بيتنفّذ هنا عبر طابور"
    >
      {active ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
      {active ? `جهاز التنفيذ: مُفعَّل${pending ? ` (${pending})` : ""}` : "جهاز التنفيذ"}
    </Button>
  );
}
