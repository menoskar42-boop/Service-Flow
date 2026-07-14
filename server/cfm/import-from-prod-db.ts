// ============================================================================
// server/cfm/import-from-prod-db.ts
// نسخ كل بيانات Cable-Fault-Manager مباشرةً من قاعدة الإنتاج (Neon) إلى قاعدة
// Service-Flow. بيقرأ كل جدول من المصدر بأسماء الأعمدة صراحةً ويكتبه فى الهدف
// بنفس الأسماء — فاختلاف ترتيب الأعمدة الفيزيائى بين القاعدتين لا يهم إطلاقاً.
// يحافظ على هاش كلمات السر الحقيقية لكل المستخدمين (users → cfm_users).
// idempotent: ON CONFLICT (id) DO NOTHING. بيشتغل جوّه السيرفر المنشور (اللى
// بيقدر يوصل Neon على 5432). المصدر من env: CFM_PROD_DATABASE_URL.
// ============================================================================
import { Pool } from "pg";
import { pool as destPool } from "../db";

// الترتيب مهم لقيود المفاتيح الأجنبية (الأب قبل الابن).
// src = اسم الجدول فى قاعدة CFM، dest = اسمه فى Service-Flow (users → cfm_users).
// cols = أسماء الأعمدة صراحةً (نفس الأسماء فى المصدر والهدف).
// jsonCols = أعمدة json/jsonb تحتاج JSON.stringify قبل الإدراج.
const TABLES: { src: string; dest: string; cols: string[]; jsonCols?: string[] }[] = [
  { src: "users", dest: "cfm_users",
    cols: ["id", "username", "password", "name", "role", "avatar", "is_initial_password", "created_at"] },
  { src: "centrals", dest: "centrals",
    cols: ["id", "name", "code", "created_at"] },
  { src: "fault_types", dest: "fault_types",
    cols: ["id", "name", "category", "created_at"] },
  { src: "task_types", dest: "task_types",
    cols: ["id", "name", "created_at"] },
  { src: "contractors", dest: "contractors",
    cols: ["id", "name", "created_at"] },
  { src: "excavation_workers", dest: "excavation_workers",
    cols: ["id", "name", "national_id", "created_at"] },
  { src: "work_types", dest: "work_types",
    cols: ["id", "name", "associated_materials", "created_at"], jsonCols: ["associated_materials"] },
  { src: "cables", dest: "cables",
    cols: ["id", "central_id", "number", "cable_number", "cabinet_number", "type", "created_at"] },
  { src: "tickets", dest: "tickets",
    cols: ["id", "ticket_number", "central_department", "central_id", "cable_id", "cabinet", "box",
      "fault_type_id", "notes", "latitude", "longitude", "status", "final_repair_id",
      "final_repair_description", "final_repair_repaired_at", "final_repair_repaired_by",
      "closed_at", "closed_by", "created_by", "created_at", "updated_at"] },
  { src: "measurement_entries", dest: "measurement_entries",
    cols: ["id", "ticket_id", "reading", "distance", "direction", "notes", "performed_by",
      "created_by", "recorded_at", "created_at"] },
  { src: "work_entries", dest: "work_entries",
    cols: ["id", "ticket_id", "measurement_id", "items", "notes", "performed_by", "works_by",
      "contractor_id", "created_by", "recorded_at", "created_at"], jsonCols: ["items"] },
  { src: "used_task_entries", dest: "used_task_entries",
    cols: ["id", "ticket_id", "measurement_id", "items", "notes", "performed_by", "created_by",
      "recorded_at", "created_at"], jsonCols: ["items"] },
  { src: "inventory_transactions", dest: "inventory_transactions",
    cols: ["id", "type", "task_type_id", "quantity", "date", "ticket_id", "notes", "created_at"] },
];

async function insertRows(dest: string, cols: string[], jsonCols: string[], rows: any[]): Promise<number> {
  if (!rows.length) return 0;
  const jset = new Set(jsonCols);
  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params: any[] = [];
    const tuples = chunk.map((row) => {
      const ph = cols.map((c) => {
        let v = row[c];
        if (v != null && jset.has(c) && typeof v === "object") v = JSON.stringify(v);
        params.push(v ?? null);
        return `$${params.length}`;
      });
      return `(${ph.join(",")})`;
    });
    const r = await destPool.query(
      `INSERT INTO ${dest} (${cols.join(", ")}) VALUES ${tuples.join(",")} ON CONFLICT (id) DO NOTHING`,
      params,
    );
    inserted += r.rowCount || 0;
  }
  return inserted;
}

export async function importCfmFromProdDb(): Promise<Record<string, number>> {
  const url = process.env.CFM_PROD_DATABASE_URL;
  if (!url) throw new Error("CFM_PROD_DATABASE_URL غير مضبوط (Replit Secrets)");

  const src = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 3 });
  const result: Record<string, number> = {};
  try {
    for (const t of TABLES) {
      const { rows } = await src.query(`SELECT ${t.cols.join(", ")} FROM ${t.src}`);
      result[t.dest] = await insertRows(t.dest, t.cols, t.jsonCols || [], rows);
    }
  } finally {
    await src.end();
  }
  return result;
}
