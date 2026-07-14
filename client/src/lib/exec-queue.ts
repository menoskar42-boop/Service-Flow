// ============================================================================
// client/src/lib/exec-queue.ts
// طابور التنفيذ المركزى: رفع السرعة/القياس/الإيقاف يتنفّذ على «جهاز التنفيذ»
// (براوزر سوبر أدمن مفعّل الزر). أى جهاز تانى يضيف المهمة للطابور بدل ما ينفّذ عنده.
// ============================================================================
import { openProfileOptimization } from "./profile-optimization";

export type ExecJobType = "raise" | "stop" | "measure";
export interface ExecJob { id: number; type: ExecJobType; accounts: string[]; requestedBy?: string | null; }

const DZS_URL = "https://10.42.187.101:8080/expresse/";

// تنفيذ مهمة واحدة على جهاز التنفيذ (نفس فتح التاب اللى بيعمله الزر عادى)
export function executeJob(job: ExecJob): void {
  const accs = (job.accounts || []).map((a) => String(a).trim()).filter(Boolean);
  if (!accs.length) return;
  if (job.type === "raise") openProfileOptimization(accs);
  else if (job.type === "stop") openProfileOptimization(accs, { stopOnly: true });
  else if (job.type === "measure") {
    window.open(`${DZS_URL}#sf_accounts=${encodeURIComponent(accs.join(","))}`, "_blank");
  }
}

// هل فيه جهاز تنفيذ مفعّل حالياً؟
export async function isExecutorActive(): Promise<boolean> {
  try {
    const r = await fetch("/api/exec-queue/status", { credentials: "include" });
    if (!r.ok) return false;
    const d = await r.json();
    return !!d.active;
  } catch { return false; }
}

// إضافة مهمة للطابور
export async function enqueueJob(type: ExecJobType, accounts: (string | number)[], note?: string): Promise<{ ok: boolean; count?: number; message?: string }> {
  try {
    const accs = [...new Set(accounts.map((a) => String(a ?? "").trim()).filter(Boolean))];
    const r = await fetch("/api/exec-queue/enqueue", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, accounts: accs, note }),
    });
    return await r.json();
  } catch (e: any) { return { ok: false, message: e?.message }; }
}

// لو فيه جهاز تنفيذ مفعّل → أضف للطابور وارجع true؛ غير كده ارجع false (نفّذ محلياً).
export async function enqueueIfExecutorActive(type: ExecJobType, accounts: (string | number)[], note?: string): Promise<boolean> {
  if (!(await isExecutorActive())) return false;
  const res = await enqueueJob(type, accounts, note);
  return !!res.ok;
}
