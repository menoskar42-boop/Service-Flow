// ============================================================================
// server/seed-dp-inventory.ts
// بكسيات (DP) من صور Network Inventory للسنترالات الأربعة — تُدخَّل تلقائياً عند الإقلاع
// لو الجدول فاضى فقط (زى seed-cabinet-capacity)، من غير ما تمسح أى داتا تترفع لاحقاً باللصق.
// كل صف: [central, cabinet_no, dp_no, capacity].  Mdf: GHN/NGO/DRG/AMZ.
// ملاحظة: دى الصفوف اللى ظهرت فى الصور (قد تكون جزئية) — للاختبار/التشغيل الأولى؛
// استخدم زر «استيراد باللصق» للقوائم الكاملة وقت الحاجة.
// ============================================================================
import { pool } from "./db";

const GHN = "الغنايم", NGO = "الغنايم-نجع العمدة", DRG = "الغنايم-دير الجنادله", AMZ = "الغنايم-العزايزة";
const MDF: Record<string, string> = { [GHN]: "GHN", [NGO]: "NGO", [DRG]: "DRG", [AMZ]: "AMZ" };

type Row = [string, string, string, number]; // [central, cabinet, dp, capacity]
const dps = (central: string, cabinet: string, list: string[], cap = 10): Row[] =>
  list.map((d) => [central, cabinet, d, cap] as Row);

const DATA: Row[] = [
  // ── NGO — نجع العمدة (كابينة shlter، سعة 10) ──
  ...dps(NGO, "shlter", ["52","53","54","55","56","57","1","2","3","4","5","7","8","10","11","12","14","15","17","18","21","23","24","26","28","30","31","33","34","36","37","39","40","41"]),
  // ── GHN — الغنايم ──
  [GHN, "1-8", "20م", 10],
  ...dps(GHN, "7-2", ["55","56","57","58","59","60","61","62","63","64","65","66","67","53","54"]),
  ...dps(GHN, "4-5", ["11","14"]),
  [GHN, "7-3", "58", 10],
  ...dps(GHN, "8-2", ["58","60","61","63","67","65","64"]),
  [GHN, "8-3", "58", 10],
  ...dps(GHN, "8-4", ["59","60","62","63"]),
  ...dps(GHN, "5-8", ["2","20","21"]),
  // ── DRG — دير الجنادله ──
  [DRG, "1-1", "61", 10], [DRG, "1-1", "62", 20], [DRG, "1-1", "63", 10],
  ...dps(DRG, "2-2", ["63","64","65","66","67","68","70","71","72","73","74","75","76","77","78"]),
  [DRG, "2-2", "69", 20],
  [DRG, "3-1", "46", 20],
  ...dps(DRG, "3-1", ["1","4","9","11","34","35","36","39","42","45"]),
  ...dps(DRG, "tb", ["5","6","15","16"]),
  // ── AMZ — العزايزة (كابينة sheltr، سعة 10) ──
  ...dps(AMZ, "sheltr", ["1","3","4","6","7","9","10","11","13","14","15","17","19","20","22","23","25","26","28","31","32","33","35","36","40","43","45","48","49","53","56","58","61","62"]),
];

export async function seedDpInventory(): Promise<number> {
  let inserted = 0;
  for (const [central, cabinet, dp, cap] of DATA) {
    const res = await pool.query(
      `INSERT INTO dp_inventory (central, mdf_code, cabinet_no, dp_no, dp_type, capacity)
       VALUES ($1,$2,$3,$4,'weather proof',$5)
       ON CONFLICT (central, cabinet_no, dp_no) DO NOTHING`,
      [central, MDF[central] || null, cabinet, dp, cap],
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

// يشغّل الـ seed تلقائياً عند الإقلاع لو الجدول فاضى فقط.
export async function seedDpInventoryIfEmpty(): Promise<void> {
  try {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM dp_inventory");
    if ((rows[0]?.n ?? 0) === 0) {
      const inserted = await seedDpInventory();
      console.log(`[seedDpInventory] auto-seeded ${inserted} DPs (table was empty)`);
    }
  } catch (e) {
    console.error("[seedDpInventory] auto-seed skipped:", (e as Error).message);
  }
}
