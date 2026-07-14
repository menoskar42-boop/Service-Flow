// ============================================================================
// client/src/lib/exec-queue.ts
// طابور التنفيذ المركزى: رفع السرعة/القياس/الإيقاف يتنفّذ على «جهاز التنفيذ»
// (براوزر سوبر أدمن مفعّل الزر). أى جهاز تانى يضيف المهمة للطابور بدل ما ينفّذ عنده.
// ============================================================================
import { openProfileOptimization } from "./profile-optimization";

export type ExecJobType = "raise" | "stop" | "measure";
export interface ExecJob { id: number; type: ExecJobType; accounts: string[]; requestedBy?: string | null; }

const DZS_URL = "https://10.42.187.101:8080/expresse/";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// تنفيذ **خط واحد** (رقم أكونت واحد) — عشان جهاز التنفيذ يباعد بينهم بمهلة ويمنع التداخل
export function executeSingle(type: ExecJobType, account: string | number): void {
  const acc = String(account ?? "").trim();
  if (!acc) return;
  if (type === "raise") openProfileOptimization([acc]);
  else if (type === "stop") openProfileOptimization([acc], { stopOnly: true });
  // sf_autoclose=1 → سكربت DZS يقفل التاب بعد ما يخلّص القياس (النتيجة بترفع لـ 138 تلقائياً)
  // بدل ما يفضل مفتوح للـ CSV — عشان جهاز التنفيذ يفتح الخط اللى بعده.
  else if (type === "measure") window.open(`${DZS_URL}#sf_accounts=${encodeURIComponent(acc)}&sf_autoclose=1`, "_blank");
}

// آخر وقت قياس لرقم أكونت (للتأكد إن القياس اتحدّث) — millis أو 0
export async function latestMeasureAt(account: string | number): Promise<number> {
  try {
    const r = await fetch(`/api/exec-queue/measure-check?account=${encodeURIComponent(String(account).trim())}`, { credentials: "include" });
    const d = await r.json();
    return d?.at ? new Date(d.at).getTime() : 0;
  } catch { return 0; }
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
