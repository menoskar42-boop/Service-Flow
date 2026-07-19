import { Input } from "@/components/ui/input";

// مؤشّر الصفحة + خانة انتقال سريع: اكتب رقم الصفحة واضغط Enter (أو اخرج من الخانة) للانتقال إليها
// مباشرة (زى الـ PDF reader). يُستخدم فى كل تقرير له أكثر من صفحة.
export function PageJump({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (n: number) => void }) {
  const go = (raw: string) => {
    const v = Math.min(totalPages, Math.max(1, parseInt(raw) || 1));
    if (v !== page) onJump(v);
  };
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>صفحة</span>
      <Input
        type="number"
        min={1}
        max={totalPages}
        key={page}
        defaultValue={page}
        onKeyDown={(e) => { if (e.key === "Enter") go((e.target as HTMLInputElement).value); }}
        onBlur={(e) => go(e.target.value)}
        className="w-16 h-8 text-center"
        title="اكتب رقم الصفحة واضغط Enter للانتقال إليها"
      />
      <span>من {totalPages}</span>
    </div>
  );
}
