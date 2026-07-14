// ============================================================================
// shared/roles-access.ts
// الأدوار الموحّدة للبوابة: كل دور → صلاحيته فى موقع الطلبات (Service-Flow)
// وموقع الكوابل (CFM). null = لا يدخل هذا الموقع. مطابق لجدول الأدوار المتفق عليه:
//
//  دور موحّد        | الطلبات (SF)   | الكوابل (CFM)      | يفتح
//  ----------------- | -------------- | ----------------- | ---------
//  super_admin       | super_admin    | admin             | الموقعين
//  external          | external       | external_affairs  | الموقعين
//  splice_tech       | —              | splice_tech       | الكوابل فقط (فنى لحام)
//  cable_engineer    | —              | cable_engineer    | الكوابل فقط (مهندس كوابل)
//  sales             | sales          | —                 | الطلبات فقط (مبيعات)
//  tech              | tech           | external_affairs  | الموقعين (فنى ↔ شئون خارجية)
//  data_manager      | data_manager   | —                 | الطلبات فقط (بيانات)
// ============================================================================

export type UnifiedRole =
  | "super_admin" | "admin" | "external" | "splice_tech" | "cable_engineer"
  | "sales" | "sales_admin" | "tech" | "data_manager";

export interface RoleAccess {
  labelAr: string;      // الاسم بالعربى
  sf: string | null;    // الدور فى موقع الطلبات (null = لا يدخل)
  cfm: string | null;   // الدور فى موقع الكوابل (null = لا يدخل)
}

export const UNIFIED_ROLE_ACCESS: Record<UnifiedRole, RoleAccess> = {
  super_admin:    { labelAr: "أدمن أعلى",        sf: "super_admin",  cfm: "admin" },
  admin:          { labelAr: "أدمن",              sf: "admin",        cfm: "admin" },
  external:       { labelAr: "الشئون الخارجية",  sf: "external",     cfm: "external_affairs" },
  splice_tech:    { labelAr: "فنى لحام",          sf: null,           cfm: "splice_tech" },
  cable_engineer: { labelAr: "مهندس كوابل",       sf: null,           cfm: "cable_engineer" },
  sales:          { labelAr: "مبيعات",            sf: "sales",        cfm: null },
  sales_admin:    { labelAr: "أدمن مبيعات",        sf: "sales_admin",  cfm: null },
  tech:           { labelAr: "فنى",               sf: "tech",         cfm: "external_affairs" },
  data_manager:   { labelAr: "بيانات",            sf: "data_manager", cfm: null },
};

const access = (role: string): RoleAccess | undefined =>
  UNIFIED_ROLE_ACCESS[role as UnifiedRole];

export const canAccessSF  = (role: string) => !!access(role)?.sf;
export const canAccessCFM = (role: string) => !!access(role)?.cfm;
export const sfRoleOf  = (role: string): string | null => access(role)?.sf ?? null;
export const cfmRoleOf = (role: string): string | null => access(role)?.cfm ?? null;

// المواقع اللى يفتحها الدور (للتوجيه بعد الدخول): "sf" | "cfm"
export const sitesForRole = (role: string): ("sf" | "cfm")[] => {
  const a = access(role);
  const out: ("sf" | "cfm")[] = [];
  if (a?.sf)  out.push("sf");
  if (a?.cfm) out.push("cfm");
  return out;
};
