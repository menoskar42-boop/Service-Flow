import { useAuth } from "@/hooks/use-auth";
import { ROLES } from "@shared/schema";

// أزرار القياس / رفع السرعة / إيقاف PO فى التقارير: تظهر للسوبر أدمن + الأدمن (ومنه مدير
// السنترال) + الشئون الخارجية (ومنها مهندس الكوابل). الضغط بيمرّ عبر جهاز التنفيذ (طابور)
// لو مفعّل، وإلا رسالة عدم الإتاحة لغير السوبر أدمن، والسوبر أدمن ينفّذ محلياً.
// تقرير «بحث برقم التليفون» بيمرّر alwaysShow=true (الفنى كمان بيشوفها لخطوط منطقته).
export function useSpeedToolsVisible(alwaysShow = false): boolean {
  const { user } = useAuth();
  return alwaysShow
    || user?.role === ROLES.SUPER_ADMIN
    || user?.role === ROLES.ADMIN
    || user?.role === ROLES.EXTERNAL;
}

// هل المستخدم سوبر أدمن؟ (يُستخدم مع dispatchSpeedTool: السوبر أدمن ينفّذ محلياً لو مفيش جهاز تنفيذ)
export function useIsSuperAdmin(): boolean {
  const { user } = useAuth();
  return user?.role === ROLES.SUPER_ADMIN;
}
