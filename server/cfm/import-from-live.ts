// ============================================================================
// server/cfm/import-from-live.ts
// يسحب كل بيانات Cable-Fault-Manager من الـ API بتاع التطبيق المنشور (الإنتاج)
// ويحمّلها فى قاعدة Service-Flow. بيشتغل جوّه سيرفر Service-Flow فبيكتب فى قاعدته
// (prod عند النشر) — من غير أى رابط قاعدة بيانات. idempotent (ON CONFLICT DO NOTHING).
// ============================================================================
import { pool } from "../db";

const CFM_BASE = process.env.CFM_BASE || "https://cable-fault-manager.replit.app";
const CFM_CREDS = { username: "admin", password: process.env.CFM_ADMIN_PASS || "Mon_oskar11" };
// هاش bcryptjs لـ Mon_oskar11 (يُضبط لـ admin عشان الدخول يشتغل)
const ADMIN_HASH = "$2b$10$/Vd5QZju2YtZfFHV5CbZZutjBHbgO7fFHFd.m6TlZjRGdJY3QIWTG";
// هاش placeholder لباقى المستخدمين (مايعرفوش يسجّلوا دخول لحد ما تعيد ضبط كلمتهم من إدارة المستخدمين)
const PLACEHOLDER_HASH = "$2b$10$3vEIJV04O0Irc7cQ/L0TbOWUCIhZb41pOP0YCgc/AcbcxoxN6E9UW";

async function cfmLogin(): Promise<string> {
  const res = await fetch(`${CFM_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(CFM_CREDS),
  });
  if (!res.ok) throw new Error(`CFM login failed: ${res.status}`);
  let cookies: string[] = [];
  try { cookies = (res.headers as any).getSetCookie?.() || []; } catch {}
  if (!cookies.length) { const sc = res.headers.get("set-cookie"); if (sc) cookies = [sc]; }
  const cookie = cookies.map((c) => c.split(";")[0].trim()).join("; ");
  if (!cookie) throw new Error("CFM login: no session cookie");
  return cookie;
}

async function cfmGet(path: string, cookie: string): Promise<any> {
  const r = await fetch(`${CFM_BASE}${path}`, { headers: { Cookie: cookie } });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : (data.data ?? data.tickets ?? data);
}

// إدراج دفعات بأعمدة صريحة + ON CONFLICT (id) DO NOTHING
async function insertRows(table: string, cols: string[], rows: any[], valueFn: (r: any) => any[]): Promise<number> {
  if (!rows.length) return 0;
  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params: any[] = [];
    const tuples = chunk.map((row) => {
      const vals = valueFn(row);
      const ph = vals.map((_, k) => `$${params.length + k + 1}`);
      params.push(...vals);
      return `(${ph.join(",")})`;
    });
    const r = await pool.query(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES ${tuples.join(",")} ON CONFLICT (id) DO NOTHING`,
      params,
    );
    inserted += r.rowCount || 0;
  }
  return inserted;
}

const j = (v: any) => (v == null ? null : JSON.stringify(v));
const d = (v: any) => (v == null || v === "" ? null : v);

export async function importCfmFromLive(): Promise<Record<string, number>> {
  const cookie = await cfmLogin();
  // 1) جلب كل الداتا من الـ API
  const [centrals, cables, faultTypes, workTypes, taskTypes, contractors, excavationWorkers, users, tickets, inventory] =
    await Promise.all([
      cfmGet("/api/master-data/centrals", cookie),
      cfmGet("/api/master-data/cables", cookie),
      cfmGet("/api/master-data/fault-types", cookie),
      cfmGet("/api/master-data/work-types", cookie),
      cfmGet("/api/master-data/task-types", cookie),
      cfmGet("/api/master-data/contractors", cookie),
      cfmGet("/api/master-data/excavation-workers", cookie),
      cfmGet("/api/users", cookie),
      cfmGet("/api/tickets", cookie),
      cfmGet("/api/inventory/transactions", cookie),
    ]);

  const result: Record<string, number> = {};

  // 2) المستخدمين أولاً (FK) — بدون باسورد فى الـ API؛ admin=Mon_oskar11 والباقى placeholder
  result.cfm_users = await insertRows(
    "cfm_users",
    ["id", "username", "password", "name", "role", "avatar", "is_initial_password", "created_at"],
    users,
    (u) => [u.id, u.username, u.username === "admin" ? ADMIN_HASH : PLACEHOLDER_HASH, u.name, u.role, d(u.avatar), u.isInitialPassword ?? true, d(u.createdAt)],
  );

  // 3) الماستر داتا
  result.centrals = await insertRows("centrals", ["id", "name", "code", "created_at"], centrals,
    (c) => [c.id, c.name, c.code, d(c.createdAt)]);
  result.fault_types = await insertRows("fault_types", ["id", "name", "category", "created_at"], faultTypes,
    (f) => [f.id, f.name, f.category, d(f.createdAt)]);
  result.work_types = await insertRows("work_types", ["id", "name", "associated_materials", "created_at"], workTypes,
    (w) => [w.id, w.name, j(w.associatedMaterials), d(w.createdAt)]);
  result.task_types = await insertRows("task_types", ["id", "name", "created_at"], taskTypes,
    (t) => [t.id, t.name, d(t.createdAt)]);
  result.contractors = await insertRows("contractors", ["id", "name", "created_at"], contractors,
    (c) => [c.id, c.name, d(c.createdAt)]);
  result.excavation_workers = await insertRows("excavation_workers", ["id", "name", "national_id", "created_at"], excavationWorkers,
    (e) => [e.id, e.name, e.nationalId, d(e.createdAt)]);
  result.cables = await insertRows("cables", ["id", "central_id", "number", "cable_number", "cabinet_number", "type", "created_at"], cables,
    (c) => [c.id, c.centralId, c.number, d(c.cableNumber), d(c.cabinetNumber), c.type, d(c.createdAt)]);

  // 4) التذاكر
  result.tickets = await insertRows(
    "tickets",
    ["id", "ticket_number", "central_department", "central_id", "cable_id", "cabinet", "box", "fault_type_id", "notes",
     "latitude", "longitude", "status", "final_repair_id", "final_repair_description", "final_repair_repaired_at",
     "final_repair_repaired_by", "closed_at", "closed_by", "created_by", "created_at", "updated_at"],
    tickets,
    (t) => [t.id, t.ticketNumber, t.centralDepartment, t.centralId, t.cableId, t.cabinet, t.box, t.faultTypeId, d(t.notes),
      t.latitude ?? null, t.longitude ?? null, t.status, d(t.finalRepairId), d(t.finalRepairDescription), d(t.finalRepairRepairedAt),
      d(t.finalRepairRepairedBy), d(t.closedAt), d(t.closedBy), t.createdBy, d(t.createdAt), d(t.updatedAt)],
  );

  // 5) القياسات/الأعمال/المهام المتداخلة جوّه التذاكر
  const measurements: any[] = [];
  const works: any[] = [];
  const usedTasks: any[] = [];
  for (const t of tickets) {
    for (const m of (t.measurements || [])) measurements.push(m);
    for (const w of (t.works || [])) works.push(w);
    for (const u of (t.usedTasks || [])) usedTasks.push(u);
  }
  // القياسات الأول (الأعمال/المهام بتشير ليها)
  result.measurement_entries = await insertRows(
    "measurement_entries",
    ["id", "ticket_id", "reading", "distance", "direction", "notes", "performed_by", "created_by", "recorded_at", "created_at"],
    measurements,
    (m) => [m.id, m.ticketId, m.reading, m.distance ?? null, d(m.direction), d(m.notes), d(m.performedBy), m.createdBy, d(m.recordedAt), d(m.createdAt)],
  );
  result.work_entries = await insertRows(
    "work_entries",
    ["id", "ticket_id", "measurement_id", "items", "notes", "performed_by", "works_by", "contractor_id", "created_by", "recorded_at", "created_at"],
    works,
    (w) => [w.id, w.ticketId, d(w.measurementId), j(w.items), d(w.notes), w.performedBy, d(w.worksBy), d(w.contractorId), w.createdBy, d(w.recordedAt), d(w.createdAt)],
  );
  result.used_task_entries = await insertRows(
    "used_task_entries",
    ["id", "ticket_id", "measurement_id", "items", "notes", "performed_by", "created_by", "recorded_at", "created_at"],
    usedTasks,
    (u) => [u.id, u.ticketId, d(u.measurementId), j(u.items), d(u.notes), u.performedBy, u.createdBy, d(u.recordedAt), d(u.createdAt)],
  );

  // 6) المخزون
  result.inventory_transactions = await insertRows(
    "inventory_transactions",
    ["id", "type", "task_type_id", "quantity", "date", "ticket_id", "notes", "created_at"],
    inventory,
    (i) => [i.id, i.type, i.taskTypeId, i.quantity, i.date, d(i.ticketId), d(i.notes), d(i.createdAt)],
  );

  // 7) تأكيد باسورد admin = Mon_oskar11 (لو موجود قبل كده بهاش تانى)
  await pool.query(`UPDATE cfm_users SET password = $1, is_initial_password = false WHERE username = 'admin'`, [ADMIN_HASH]);

  return result;
}
