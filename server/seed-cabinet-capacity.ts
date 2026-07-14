// ============================================================================
// server/seed-cabinet-capacity.ts
// سعة الكباين النحاسية من صور FCC (Copper → Cabinet) للسنترالات الأربعة.
// تُدخَّل يدوياً بدل الرفع من FCC. full replace. secondary_capacity = "السعة" فى خطة الصيانة.
// كل صف: [exch_code, cabin_number, cabinet_type, primary_capacity, secondary_capacity]
// ============================================================================
import { pool } from "./db";

const EXCH_TO_CENTRAL: Record<string, string> = {
  GHNAT: "الغنايم",
  DRGAT: "الغنايم-دير الجنادله",
  AMZAT: "الغنايم-العزايزة",
  NGOAT: "الغنايم-نجع العمدة",
};

const DATA: [string, string, string, number, number][] = [
  // ── DRGAT — الغنايم-دير الجنادله (7 كباين) ──
  ["DRGAT", "1-2", "reltec", 1000, 1000],
  ["DRGAT", "3-1", "reltec", 470, 470],
  ["DRGAT", "1-1", "reltec", 640, 660],
  ["DRGAT", "2-2", "reltec", 620, 850],
  ["DRGAT", "3-2", "reltec", 600, 600],
  ["DRGAT", "2-1", "reltec", 820, 820],
  ["DRGAT", "tb", "reltec", 400, 400],

  // ── AMZAT — الغنايم-العزايزة ──
  ["AMZAT", "sheltr", "reltec", 1300, 1500],

  // ── NGOAT — الغنايم-نجع العمدة ──
  ["NGOAT", "shlter", "reltec", 600, 570],

  // ── GHNAT — الغنايم (50 كابينة) ──
  ["GHNAT", "co", "reltec", 100, 100],
  ["GHNAT", "1-8", "reltec", 600, 600],
  ["GHNAT", "2-1", "reltec", 600, 600],
  ["GHNAT", "2-2", "reltec", 600, 600],
  ["GHNAT", "2-3", "reltec", 600, 600],
  ["GHNAT", "2-4", "reltec", 300, 700],
  ["GHNAT", "2-5", "reltec", 400, 420],
  ["GHNAT", "2-6", "reltec", 200, 500],
  ["GHNAT", "2-7", "reltec", 200, 500],
  ["GHNAT", "2-8", "reltec", 200, 500],
  ["GHNAT", "3-1", "Krone", 350, 600],
  ["GHNAT", "3-2", "reltec", 300, 600],
  ["GHNAT", "3-3", "reltec", 200, 500],
  ["GHNAT", "3-4", "reltec", 250, 600],
  ["GHNAT", "3-5", "reltec", 200, 500],
  ["GHNAT", "3-6", "reltec", 200, 500],
  ["GHNAT", "3-7", "reltec", 200, 500],
  ["GHNAT", "3-8", "reltec", 250, 600],
  ["GHNAT", "3-9", "MSAN", 200, 200],
  ["GHNAT", "4-1", "reltec", 600, 600],
  ["GHNAT", "4-2", "reltec", 400, 400],
  ["GHNAT", "4-3", "reltec", 300, 600],
  ["GHNAT", "4-4", "reltec", 690, 690],
  ["GHNAT", "4-5", "reltec", 500, 500],
  ["GHNAT", "4-6", "reltec", 200, 500],
  ["GHNAT", "4-7", "reltec", 600, 600],
  ["GHNAT", "4-8", "reltec", 200, 650],
  ["GHNAT", "5-1", "reltec", 600, 600],
  ["GHNAT", "5-2", "reltec", 500, 500],
  ["GHNAT", "5-3", "reltec", 300, 600],
  ["GHNAT", "5-4", "reltec", 600, 600],
  ["GHNAT", "5-5", "reltec", 200, 500],
  ["GHNAT", "5-6", "reltec", 200, 500],
  ["GHNAT", "5-7", "reltec", 250, 600],
  ["GHNAT", "5-8", "reltec", 500, 500],
  ["GHNAT", "6-1", "reltec", 500, 500],
  ["GHNAT", "6-2", "reltec", 600, 600],
  ["GHNAT", "6-3", "reltec", 500, 500],
  ["GHNAT", "6-4", "reltec", 200, 500],
  ["GHNAT", "6-5", "reltec", 200, 500],
  ["GHNAT", "6-6", "reltec", 600, 600],
  ["GHNAT", "6-7", "reltec", 300, 600],
  ["GHNAT", "7-1", "reltec", 350, 500],
  ["GHNAT", "7-2", "reltec", 750, 750],
  ["GHNAT", "7-3", "reltec", 700, 700],
  ["GHNAT", "8-1", "reltec", 600, 600],
  ["GHNAT", "8-2", "reltec", 700, 750],
  ["GHNAT", "8-3", "reltec", 650, 650],
  ["GHNAT", "8-4", "reltec", 710, 710],
  ["GHNAT", "TB07", "MSAN", 200, 200],
];

// يشغّل الـ seed تلقائياً عند الإقلاع لو الجدول فاضى فقط — عشان يشتغل مع النشر
// بدون كونسول، ومن غير ما يمسح أى داتا تترفع لاحقاً من بطاقة الرفع.
export async function seedCabinetCapacityIfEmpty(): Promise<void> {
  try {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM cabinet_capacity");
    if ((rows[0]?.n ?? 0) === 0) {
      const inserted = await seedCabinetCapacity();
      console.log(`[seedCabinetCapacity] auto-seeded ${inserted} cabinets (table was empty)`);
    }
  } catch (e) {
    console.error("[seedCabinetCapacity] auto-seed skipped:", (e as Error).message);
  }
}

export async function seedCabinetCapacity(): Promise<number> {
  await pool.query("DELETE FROM cabinet_capacity");
  const BATCH = 200;
  let inserted = 0;
  for (let s = 0; s < DATA.length; s += BATCH) {
    const chunk = DATA.slice(s, s + BATCH);
    const params: any[] = [];
    const tuples = chunk.map((r) => {
      const vals = [EXCH_TO_CENTRAL[r[0]] || null, r[0], EXCH_TO_CENTRAL[r[0]] || null, r[1], r[2], r[3], r[4]];
      const ph = vals.map((_, k) => `$${params.length + k + 1}`);
      params.push(...vals);
      return `(${ph.join(",")})`;
    });
    const res = await pool.query(
      `INSERT INTO cabinet_capacity
         (central_name, exch_code, exch_name, cabin_number, cabinet_type, primary_capacity, secondary_capacity)
       VALUES ${tuples.join(",")}`,
      params,
    );
    inserted += res.rowCount || 0;
  }
  return inserted;
}
