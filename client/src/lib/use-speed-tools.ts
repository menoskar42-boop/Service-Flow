import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";

// أزرار القياس / رفع السرعة / إيقاف PO تظهر لـ super_admin فقط فى كل التقارير،
// ماعدا تقرير «بحث برقم التليفون» اللى يشوفها فيه كل المستخدمين (alwaysShow=true).
export function useSpeedToolsVisible(alwaysShow = false): boolean {
  const { user } = useAuth();
  return alwaysShow || user?.role === ROLES.SUPER_ADMIN;
}
