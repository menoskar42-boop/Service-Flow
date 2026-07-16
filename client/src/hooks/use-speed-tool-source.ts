import { useEffect } from "react";
import { setSpeedToolSource } from "@/lib/exec-queue";

// يضبط «مصدر» عمليات القياس/الرفع/الإيقاف باسم التقرير الحالى — بيتسجّل مع كل مهمة تنفيذ
// (فى note) فيظهر فى تقرير معاملات التنفيذ «القياس ده جه من تقرير إيه». التقارير بتتعرض واحد
// فى المرة، فالمصدر واضح ومفيش تعارض. بيتصفّر عند إغلاق التقرير.
export function useSpeedToolSource(name: string): void {
  useEffect(() => {
    setSpeedToolSource(name);
    return () => setSpeedToolSource("");
  }, [name]);
}
