// ============================================================================
// shared/roles-access.ts
// الأدوار الموحّدة للبوابة: كل دور → صلاحيته فى موقع الطلبات (Service-Flow)
// وموقع الكوابل (CFM). null = لا يدخل هذا الموقع. مطابق لجدول الأدوار المتفق عليه:
//
//  دور موحّد        | الطلبات (SF)   | الكوابل (CFM)      | يفتح
//  ----------------- | -------------- | ----------------- | ---------
//  super_admin       | super_admin    | admin             | الموقعين
//  central_manager   | admin          | external_affairs  | الموقعين (مدير السنترال: أدمن طلبات + شئون خارجية كوابل)
//  external          | external       | external_affairs  | الموقعين
//  splice_tech       | —              | splice_tech       | الكوابل فقط (فنى لحام)
//  cable_engineer    | external       | cable_engineer    | الموقعين (طلبات كشئون خارجية + كوابل كمهندس)
//  sales             | sales          | —                 | الطلبات فقط (مبيعات)
//  tech              | tech           | external_affairs  | الموقعين (فنى ↔ شئون خارجية)
//  data_manager      | data_manager   | —                 | الطلبات فقط (بيانات)
//  supervisor        | —              | supervisor        | الكوابل فقط (مشرف)
//  ext_tech          | —              | ext_tech          | الكوابل فقط (فنى خارجى)
// ============================================================================

export type UnifiedRole =
  | "super_admin" | "admin" | "central_manager" | "external" | "splice_tech" | "cable_engineer"
  | "sales" | "sales_admin" | "tech" | "data_manager" | "supervisor" | "ext_tech"
  | "maintenance_tech";

export interface RoleAccess {
  labelAr: string;      // الاسم بالعربى
  sf: string | null;    // الدور فى موقع الطلبات (null = لا يدخل)
  cfm: string | null;   // الدور فى موقع الكوابل (null = لا يدخل)
  maint: string | null; // الدور فى موقع الصيانة (admin/inspector/technician) — null = لا يدخل
}

export const UNIFIED_ROLE_ACCESS: Record<UnifiedRole, RoleAccess> = {
  super_admin:    { labelAr: "أدمن أعلى",        sf: "super_admin",  cfm: "admin",             maint: "admin" },
  admin:          { labelAr: "أدمن",              sf: "admin",        cfm: "admin",             maint: "admin" },
  central_manager:{ labelAr: "مدير السنترال",     sf: "admin",        cfm: "external_affairs",  maint: "admin" },
  external:       { labelAr: "الشئون الخارجية",  sf: "external",     cfm: "external_affairs",  maint: "inspector" },
  splice_tech:    { labelAr: "فنى لحام",          sf: null,           cfm: "splice_tech",       maint: null },
  cable_engineer: { labelAr: "مهندس كوابل",       sf: "external",     cfm: "cable_engineer",    maint: "inspector" },
  sales:          { labelAr: "مبيعات",            sf: "sales",        cfm: null,                maint: null },
  sales_admin:    { labelAr: "أدمن مبيعات",        sf: "sales_admin",  cfm: null,                maint: null },
  tech:           { labelAr: "فنى",               sf: "tech",         cfm: "external_affairs",  maint: "technician" },
  data_manager:   { labelAr: "بيانات",            sf: "data_manager", cfm: null,                maint: null },
  supervisor:     { labelAr: "مشرف",              sf: null,           cfm: "supervisor",        maint: null },
  ext_tech:       { labelAr: "فنى خارجى",          sf: null,           cfm: "ext_tech",          maint: null },
  maintenance_tech:{ labelAr: "فنى صيانة",         sf: "maintenance_tech", cfm: null,            maint: "technician" },
};

const access = (role: string): RoleAccess | undefined =>
  UNIFIED_ROLE_ACCESS[role as UnifiedRole];

export const canAccessSF  = (role: string) => !!access(role)?.sf;
export const canAccessCFM = (role: string) => !!access(role)?.cfm;
export const canAccessMaint = (role: string) => !!access(role)?.maint;
export const sfRoleOf  = (role: string): string | null => access(role)?.sf ?? null;
export const cfmRoleOf = (role: string): string | null => access(role)?.cfm ?? null;
export const maintRoleOf = (role: string): string | null => access(role)?.maint ?? null;

// خريطة دور «موقع الطلبات» (users.role) → دور موقع الصيانة، للـ SSO داخل تطبيق الصيانة.
// ملاحظة: بعض الأدوار الموحّدة بتتخزّن فى users.role بنفس قيمة sf (مثلاً مدير السنترال = admin،
// مهندس الكوابل = external)، فالمفاتيح هنا هى قيم users.role الفعلية مش أسماء الأدوار الموحّدة.
export const SF_ROLE_TO_MAINT: Record<string, string> = {
  super_admin: "admin",
  admin: "admin",
  external: "inspector",
  tech: "technician",
  maintenance_tech: "technician",
};

// المواقع اللى يفتحها الدور (للتوجيه بعد الدخول): "sf" | "cfm"
export const sitesForRole = (role: string): ("sf" | "cfm")[] => {
  const a = access(role);
  const out: ("sf" | "cfm")[] = [];
  if (a?.sf)  out.push("sf");
  if (a?.cfm) out.push("cfm");
  return out;
};
