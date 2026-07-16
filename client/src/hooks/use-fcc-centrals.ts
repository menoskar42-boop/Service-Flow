import { useQuery } from "@tanstack/react-query";
import { getCentrals } from "@/lib/technical-data";
import { CENTRAL_NAMES } from "@shared/schema";

// أسماء السنترالات لدروب‌ليست المعاينة (الفنى/الشئون الخارجية):
// دمج أسماء FCC الحيّة (phone_lines) + الأسماء الثابتة (CENTRAL_NAMES) + مفاتيح البيانات الفنية
// (getCentrals) — عشان الكباين/البكسيات تفضل شغّالة للسنترالات المعروفة، وأى سنترال جديد فى FCC
// يظهر تلقائياً. القيم القديمة المحفوظة فى الطلبات ما تتأثرش (بنعرض الأسماء بس).
export function useFccCentrals(): string[] {
  const { data } = useQuery<string[]>({
    queryKey: ["/api/fcc-centrals"],
    staleTime: 5 * 60 * 1000,
  });
  const merged = new Set<string>([
    ...getCentrals(),
    ...Object.values(CENTRAL_NAMES),
    ...(data ?? []),
  ]);
  return Array.from(merged).sort((a, b) => a.localeCompare(b, "ar"));
}
