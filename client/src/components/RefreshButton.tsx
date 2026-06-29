import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

/**
 * زر "تحديث" عام لتقارير React Query — يعيد جلب بيانات الصفحة بدون عمل refresh للمتصفح.
 * بدون queryKeys: يبطّل كل الكويريز النشطة (يكفى للتقرير الحالى).
 */
export function RefreshButton({ queryKeys, className = "" }: { queryKeys?: string[]; className?: string }) {
  const qc = useQueryClient();
  const [spinning, setSpinning] = useState(false);

  const onClick = async () => {
    setSpinning(true);
    try {
      if (queryKeys?.length) {
        await Promise.all(queryKeys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      } else {
        await qc.invalidateQueries();
      }
    } finally {
      setTimeout(() => setSpinning(false), 600);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={onClick} className={`gap-1 ${className}`} title="تحديث بيانات الصفحة">
      <RefreshCw className={`w-4 h-4 ${spinning ? "animate-spin" : ""}`} /> تحديث
    </Button>
  );
}
