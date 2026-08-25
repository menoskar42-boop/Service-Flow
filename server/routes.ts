import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { pool } from "./db";
import type { User as SchemaUser } from "@shared/schema";
import { insertOrderSchema, updateOrderSchema, updateExternalResponseSchema, ROLES, WS_EVENTS, CONTRACT_STATUS, ORDER_STATUS, REJECTION_REASONS, SHIFT_COVER_STATES_SQL } from "@shared/schema";
import { api } from "@shared/routes";
import { z } from "zod";
import multer from "multer";
import * as XLSX from "xlsx";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import MemoryStore from "memorystore";
import connectPgSimple from "connect-pg-simple";
import bcryptjs from "bcryptjs";
import { sfRoleOf, cfmRoleOf, sitesForRole, UNIFIED_ROLE_ACCESS } from "@shared/roles-access";
import { arNorm } from "@shared/ar-norm";
import { phoneNormSql } from "./phone-norm";
import { nameMatch, nameMatchTokens, nameTokens, buildFirstNameIndex, NAME_MATCH_THRESHOLD } from "@shared/name-match";
import { registerCfmRoutes } from "./cfm/routes";
import { storage as cfmStorage } from "./cfm/storage";
import { openBoxFaultTicket, findCoveringOpenTicket, resolveCable, settleBoxTicketIfCleared } from "./box-fault-ticket";
import { normCab } from "@shared/cab-norm";
import { cardCapacityOf, cardFreeOf } from "@shared/card-capacity";

const scryptAsync = promisify(scrypt);
const MemStore = MemoryStore(session);
// جلسات دائمة فى Postgres (جدول sf_session المُنشأ فى ensureSchema). لو فشلت التهيئة
// لأى سبب نرجع لـ MemoryStore عشان الدخول مايتعطّلش أبداً.
function buildSessionStore() {
  try {
    const PgSession = connectPgSimple(session);
    // pruneSessionInterval: connect-pg-simple بيمسح الجلسات المنتهية كل ساعة.
    // من غيره الجدول بيكبر بلا حدود (الفهرس على expire كان موجود بس مفيش حد بيمسح).
    return new PgSession({
      pool, tableName: "sf_session", createTableIfMissing: false,
      pruneSessionInterval: 60 * 60,
    });
  } catch (e) {
    console.error("[session] PgSession init failed → MemoryStore fallback:", (e as Error).message);
    return new MemStore({ checkPeriod: 86400000 });
  }
}

// Work-order reports are restricted to these centrals (الغنايم وفروعها).
// Matching is tolerant of differences in dashes, spaces, hamza, ة/ه, ى/ي.
const normalizeCentral = (s: any): string =>
  String(s ?? "")
    .replace(/[ً-ْٰ]/g, "")   // tashkeel/diacritics
    .replace(/ـ/g, "")                    // tatweel ـ
    .replace(/[إأآٱ]/g, "ا")                    // alef variants → ا
    .replace(/ى/g, "ي")                         // alef maksura → ي
    .replace(/ة/g, "ه")                         // taa marbuta → ه
    .replace(/[ؤئء]/g, "")                       // hamza forms removed
    .replace(/[\s_]/g, "")                       // spaces/underscore
    .replace(/[-‐-―−]/g, "")      // all dash types
    .trim();

const ALLOWED_WORK_ORDER_CENTRALS = new Set(
  ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"].map(
    normalizeCentral,
  ),
);

const isAllowedCentral = (name: any): boolean =>
  ALLOWED_WORK_ORDER_CENTRALS.has(normalizeCentral(name));

// Central code (Organization / Field3 in the attached sheet) → Arabic name.
// The work-orders import derives the central from this code, so sub-centrals
// that share the same generic name in the file are still separated correctly.
const CENTRAL_CODE_TO_NAME: Record<string, string> = {
  GHNAT: "الغنايم",
  AMZAT: "الغنايم-العزايزة",
  DRGAT: "الغنايم-دير الجنادله",
  NGOAT: "الغنايم-نجع العمدة",
};

// Some telecom exports are HTML files with an .xls extension. SheetJS parses
// them but leaves text as HTML numeric entities (&#1578;... instead of Arabic
// letters), which breaks header detection and stores garbage values. Decode
// &#NNNN; / &#xHHHH; and the common named entities back to real characters.
function decodeHtmlEntities(s: string): string {
  if (s.indexOf("&") === -1) return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
}

// Smart sheet reader: scans the first `scanRows` rows to locate the header row
// (the one containing any of the anchor keywords), then exposes a name-based
// column finder. This makes imports tolerant of reordered columns and of files
// that prepend report-title rows above the real header (e.g. 430D exports).
function smartSheet(rows: any[][], anchors: string[], scanRows = 25) {
  // Decode HTML entities in every string cell (headers AND data) so that
  // HTML-disguised .xls exports behave exactly like real Excel files.
  for (const row of rows) {
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      if (typeof row[j] === "string") row[j] = decodeHtmlEntities(row[j]);
    }
  }
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(scanRows, rows.length); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").trim().toLowerCase());
    if (anchors.some((a) => cells.some((c) => c.includes(a.toLowerCase())))) {
      headerRowIdx = i;
      break;
    }
  }
  const header = (rows[headerRowIdx] || []).map((c) => String(c ?? "").trim().toLowerCase());
  // exact-match finder (avoids "complain type" matching "complain type code")
  const findExact = (...names: string[]) =>
    header.findIndex((h) => h !== "" && names.some((n) => h === n.toLowerCase()));
  // partial-match finder
  const find = (...keywords: string[]) =>
    header.findIndex((h) => h !== "" && keywords.some((k) => h.includes(k.toLowerCase())));
  const dataRows = rows.slice(headerRowIdx + 1);
  return { headerRowIdx, header, find, findExact, dataRows };
}

// بعض ملفات التصدير (خصوصاً ملفات Order/متعذرات OM) تكتب وسم النطاق
// <dimension ref="A1:BS2"/> بقيمة خاطئة لا تعكس عدد الصفوف الفعلى، فـ SheetJS
// يثق فى هذا النطاق ويقرأ صفاً واحداً فقط رغم وجود آلاف الصفوف. نعيد حساب
// النطاق الحقيقى من عناوين الخلايا الفعلية قبل القراءة حتى تُقرأ كل الصفوف.
function fixSheetRange(ws: any): void {
  if (!ws) return;
  let maxR = -1, maxC = -1, minR = Infinity, minC = Infinity;
  for (const k of Object.keys(ws)) {
    if (k[0] === "!") continue;
    const cell = XLSX.utils.decode_cell(k);
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
    if (cell.r < minR) minR = cell.r;
    if (cell.c < minC) minC = cell.c;
  }
  if (maxR < 0 || maxC < 0) return; // ورقة فارغة
  const real = { s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } };
  if (!ws["!ref"]) { ws["!ref"] = XLSX.utils.encode_range(real); return; }
  const cur = XLSX.utils.decode_range(ws["!ref"]);
  // وسّع النطاق فقط إذا كانت الخلايا الفعلية تتجاوز النطاق المعلن (لا نُقلّصه أبداً).
  if (maxR > cur.e.r || maxC > cur.e.c || cur.s.r > minR || cur.s.c > minC) {
    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: Math.min(cur.s.r, 0), c: Math.min(cur.s.c, 0) },
      e: { r: Math.max(cur.e.r, maxR), c: Math.max(cur.e.c, maxC) },
    });
  }
}

// قراءة ورقة كصفوف (header:1) بعد تصحيح النطاق — البديل الموحَّد لاستدعاء
// XLSX.utils.sheet_to_json المباشر فى كل أماكن استيراد الملفات.
function sheetRows(ws: any): any[][] {
  fixSheetRange(ws);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
}

// Duration cell → hours (number) | null.
// Handles the formats found in 430D:
//   • Numeric fraction-of-day (تفاصيل متبقى الملف القومى): 0.8285 → 19.9 h
//   • **نص** رقم عشرى بنفس المعنى (تصدير الغنايم): "0.39" → 9.4 h
//   • Text "d:h:m" (التفاصيل):  "0:21:34" → 21.6 h
// ⚠️ النص العشرى كان بيرجّع null (الكود كان بيطلب ':')، فعمود «فترة الاستمرار»
// كان بيضيع بالكامل من تصدير الغنايم. إنه أيام مش ساعات مُثبت بالبيانات: لو
// حسبناه أيام كل صفوف الملف بتشاور على نفس لحظة توليد التقرير (تشتّت 0.2 ساعة)،
// ولو ساعات بيبقى التشتّت 128 ساعة (يعنى مستحيل).
function toHours(v: any): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v > 0) return Math.round(v * 24 * 10) / 10;
  const s = String(v).trim();
  if (!s) return null;
  if (!s.includes(":")) {
    const num = parseFloat(s.replace(/[^\d.\-]/g, ""));
    return Number.isFinite(num) && num > 0 ? Math.round(num * 24 * 10) / 10 : null;
  }
  const parts = s.split(":");
  if (parts.length < 2) return null;
  const d = parseFloat(parts[0]) || 0;
  const h = parseFloat(parts[1]) || 0;
  const m = parts.length > 2 ? (parseFloat(parts[2]) || 0) : 0;
  const total = d * 24 + h + m / 60;
  return total > 0 ? Math.round(total * 10) / 10 : null;
}

// Excel serial date (or string) → JS Date | null
function toDate(v: any): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && v > 1) {
    // ⚠️ كان بيستخدم XLSX.SSF.parse_date_code — و`XLSX.SSF` بيطلع undefined فى
    // تشغيل السيرفر (namespace الـ ESM مابيشوفش الـ named export ده من حزمة CJS)،
    // فأى خلية تاريخ رقمية (Excel serial) كانت بترمى TypeError وترجّع 500 على
    // **رفعة 430D كلها**. التحويل هنا يدوى ومالوش أى اعتماد خارجى:
    //   السيريال 25569 = 1970-01-01، فـ (v − 25569) × 86400000 = ملّى ثانية UTC.
    // بنقرا المكوّنات بتوقيت UTC وبنبنى بيها Date محلّى — نفس سلوك parse_date_code
    // بالظبط (بيتعامل مع السيريال كوقت حائط مش كلحظة زمنية).
    const ms = Math.round((v - 25569) * 86400000);
    const u = new Date(ms);
    if (isNaN(u.getTime())) return null;
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(),
                    u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
  }
  const s = String(v).trim().replace(" ", "T").replace(/\.0$/, "");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Ticket column order shared by all ticket destination tables (DSL & FTTH).
const TICKET_COLS = [
  "ticket_id", "central_code", "central_name", "phone_number", "complaint_time",
  "tech_code", "line_type_code", "cabinet_no", "priority_code", "close_date",
  "operation_type", "complain_type_name", "status_code", "onu",
];
// Work-order column order shared by all wfm destination tables.
const WFM_COLS = [
  "central_name", "work_order_id", "phone_number", "work_order_type", "stage",
  "status", "priority", "current_workspec", "notes", "description", "creation_date",
  "mobile", "customer_name", "address", "reference_no", "exch_cabinet",
];

// أنواع أوامر الشغل التى تُعتبر "تركيبات / نقل" (حالات التركيب wfm).
// تُستخدم لفلترة تقريرى التركيبات الحالية والتركيبات المنتظمة.
// المقارنة تتم بعد lower(trim(...)) لتجاوز فروق الأحرف/المسافات.
// أنواع أوامر الشغل اللى معناها **رفع/إلغاء الخط نهائياً** — مش تركيب ولا نقل،
// ومابيتصرفلهاش سلك. بتتسجّل فى جدول «الرفع النهائى» (line_deactivations) ومابتدخلش
// جدول أوامر الشغل خالص، عشان ماتظهرش فى تقارير التركيبات/النقل ولا فى تقرير
// «أوامر شغل بدون كمية سلك». المطابقة على النوع، وسبب الإغلاق كتأكيد إضافى.
const DEACTIVATION_WO_TYPES_LC = [
  "fixed voice deactivation",
  "tdm termination order (without release technical data)",
  "tdm termination order",
];
const DEACTIVATION_CLOSE_REASONS_LC = ["line deactivated successfully"];
function isDeactivationWO(rawType: string, closeReason: string): boolean {
  const t = String(rawType || "").trim().toLowerCase();
  const r = String(closeReason || "").trim().toLowerCase();
  if (DEACTIVATION_WO_TYPES_LC.some((x) => t === x || t.startsWith(x))) return true;
  // شبكة أمان: النوع مكتوب بصيغة مختلفة لكن سبب الإغلاق صريح إن الخط اترفع
  return DEACTIVATION_CLOSE_REASONS_LC.includes(r);
}

const INSTALL_TYPES = [
  "FVInstallationMSAN",
  "FVChPhoneNoNewLoc",
  "FVInstallationTDM",
  "FTTHNewSubVS",
  "FV TDM Change Phone Number New Location",
  "Fixed Voice Installation MSAN",
  "FVTDMCHGPhNoNewLoc",
  "FTTHMigrationVS",
  "FTTHMigrationSurvey",
  "FixPassiveCC",
  "ChPhoneNoSurv",
];
const INSTALL_TYPES_LC = INSTALL_TYPES.map((s) => s.toLowerCase());

// أنواع أوامر الشغل التى تُعتبر "معاينات" (حالات معاينات wfm).
const SURVEY_TYPES = [
  "FVManualSurvey",
];
const SURVEY_TYPES_LC = SURVEY_TYPES.map((s) => s.toLowerCase());

// Normalize FCC status codes to short canonical form (e.g. "173Re-open TTS" → "173-DSL")
function normalizeStatusCode(raw: string): string {
  if (/^173|re-open\s*tts|tts\s*173/i.test(raw)) return "173-DSL";
  return raw;
}

// Parse a TicketQueue sheet (Arabic OR English headers) into value arrays
// matching TICKET_COLS. Stores ALL centrals (name falls back to the code).
// Deduplicated by (ticket_id, status_code) for the historical unique key.
function parseTicketFile(buffer: Buffer): any[][] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = sheetRows(ws);
  const { find, dataRows } = smartSheet(rows, ["رقم الشكوي", "رقم الشكوى", "complain no", "ticket"]);
  const iTicket   = find("رقم الشكوي", "رقم الشكوى", "complain no", "complainno", "ticket no", "ticketno");
  const iStatus   = find("status code", "statuscode", "status_code");
  const iOrg      = find("كود السنترال", "exch code", "exchange code", "exch", "central code", "centralcode");
  const iTime     = find("وقت الشكوي", "وقت الشكوى", "complain time", "complaintime", "complain_time");
  const iTech     = find("كود الفنى", "كود الفني", "repman code", "repman", "tech code", "technician");
  const iLineType = find("line type");
  const iPhone    = find("رقم التلفون", "رقم التليفون", "tel no", "telno", "phone no", "phone number");
  const iCabinet  = find("cabinet no", "رقم الكابينة", "رقم الكابينه", "cabinetno", "cabinet");
  const iPriority = find("كود الأولوية", "كود الاولويه", "priority", "customer segment", "segment");
  const iCloseDate = find("تاريخ الإغلاق", "تاريخ الاغلاق", "close date", "closing date", "closedate", "close_date");
  const iOperation = find("نوع العملية", "نوع العمليه", "process type", "operation type", "processtype", "operationtype");
  const iType     = find("complaintypename", "نوع العطل", "complain type", "complaint type", "complaint type name");
  const iOnu      = find("onu");
  const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

  const out: any[][] = [];
  const seen = new Set<string>();
  for (const r of dataRows) {
    const ticketId = String(g(r, iTicket)).trim();
    if (!ticketId) continue;
    const status = normalizeStatusCode(String(g(r, iStatus)).trim());
    const key = ticketId + "|" + status;
    if (seen.has(key)) continue;
    seen.add(key);
    const code = String(g(r, iOrg)).trim().toUpperCase();
    const name = CENTRAL_CODE_TO_NAME[code] || code;
    out.push([
      ticketId, code, name,
      String(g(r, iPhone))    || null,
      toDate(g(r, iTime)),
      String(g(r, iTech))     || null,
      String(g(r, iLineType)) || null,
      String(g(r, iCabinet))  || null,
      String(g(r, iPriority)) || null,
      toDate(g(r, iCloseDate)),
      String(g(r, iOperation)) || null,
      String(g(r, iType))     || null,
      status || null,
      String(g(r, iOnu))      || null,
    ]);
  }
  return out;
}

// First upload "today" (Africa/Cairo) for the given table? Empty table = yes.
async function isFirstUploadToday(table: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT (MAX(uploaded_at) AT TIME ZONE 'Africa/Cairo')::date
            = (now() AT TIME ZONE 'Africa/Cairo')::date AS today FROM ${table}`,
  );
  return rows[0]?.today !== true;
}

// Full-replace a table with the given value rows (+ uploaded_by_id appended).
// Transactional: the DELETE and all INSERTs run in one transaction, so if any
// INSERT fails (e.g. a column mismatch) the whole thing rolls back and the old
// data is preserved — never leaving the table empty on a failed upload.
async function replaceTable(table: string, cols: string[], rows: any[][], userId: number): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM ${table}`);
    const allCols = [...cols, "uploaded_by_id"];
    const n = allCols.length;
    let inserted = 0;
    const BATCH = 200;
    for (let s = 0; s < rows.length; s += BATCH) {
      const chunk = rows.slice(s, s + BATCH);
      const ph = chunk.map((_, ci) => {
        const o = ci * n;
        return "(" + Array.from({ length: n }, (_, k) => `$${o + k + 1}`).join(",") + ")";
      }).join(",");
      const vals = chunk.flatMap((r) => [...r, userId]);
      const res = await client.query(`INSERT INTO ${table} (${allCols.join(",")}) VALUES ${ph}`, vals);
      inserted += res.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return inserted;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Accumulate into a historical table.
// • updateCols    → ON CONFLICT DO UPDATE SET col = COALESCE(EXCLUDED.col, table.col)
//                   (fill previously-null columns on re-upload, never overwrite real data)
// • overwriteCols → ON CONFLICT DO UPDATE SET col = EXCLUDED.col
//                   (latest snapshot is authoritative — e.g. a fault's status_code/close_time
//                    that changes as it progresses 135→138; keeps the historical table fresh
//                    instead of "بايت"/stale on the first-seen status)
// • neither       → DO NOTHING (original behaviour)
async function accumulateTable(
  table: string, cols: string[], conflict: string, rows: any[][], userId: number,
  updateCols?: string[], overwriteCols?: string[],
): Promise<number> {
  if (!rows.length) return 0;
  const allCols = [...cols, "uploaded_by_id"];
  const n = allCols.length;
  let inserted = 0;
  const BATCH = 200;
  const setParts = [
    ...(updateCols ?? []).map(c => `${c} = COALESCE(EXCLUDED.${c}, ${table}.${c})`),
    ...(overwriteCols ?? []).map(c => `${c} = EXCLUDED.${c}`),
  ];
  const conflictClause = setParts.length
    ? `ON CONFLICT (${conflict}) DO UPDATE SET ${setParts.join(", ")}`
    : `ON CONFLICT (${conflict}) DO NOTHING`;
  for (let s = 0; s < rows.length; s += BATCH) {
    const chunk = rows.slice(s, s + BATCH);
    const ph = chunk.map((_, ci) => {
      const o = ci * n;
      return "(" + Array.from({ length: n }, (_, k) => `$${o + k + 1}`).join(",") + ")";
    }).join(",");
    const vals = chunk.flatMap((r) => [...r, userId]);
    const res = await pool.query(
      `INSERT INTO ${table} (${allCols.join(",")}) VALUES ${ph} ${conflictClause}`,
      vals,
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

// Write the same rows to the 3 destinations:
//  - historical (accumulate — add new only, never delete)
//  - current (full replace every upload)
//  - start-of-day: first upload of a NEW day → fresh snapshot (clear + insert);
//    subsequent uploads the SAME day → accumulate new faults only (don't delete
//    previous) — exactly like the historical table within the day.
async function writeThreeDestinations(opts: {
  histTable: string; sodTable: string; curTable: string;
  cols: string[]; conflict: string; rows: any[][]; userId: number;
  updateCols?: string[]; overwriteCols?: string[];
}) {
  const firstToday = await isFirstUploadToday(opts.sodTable);
  const hist = await accumulateTable(opts.histTable, opts.cols, opts.conflict, opts.rows, opts.userId, opts.updateCols, opts.overwriteCols);
  const current = await replaceTable(opts.curTable, opts.cols, opts.rows, opts.userId);
  if (firstToday) await pool.query(`DELETE FROM ${opts.sodTable}`);
  const startOfDay = await accumulateTable(opts.sodTable, opts.cols, opts.conflict, opts.rows, opts.userId, opts.updateCols, opts.overwriteCols);
  return { hist, current, startOfDay, sodReplaced: firstToday, total: opts.rows.length };
}

// FTTH-order data columns (shared by historical / current / soy / archive tables).
const FTTH_ORDER_COLS = [
  "service_order_id", "customer_order_id", "product", "service_number", "customer_name",
  "order_status", "order_create_time", "exchange_name", "service_type", "msan_code",
  "area_code", "customer_mobile", "current_activity", "error_name", "governorate",
  "line_type", "fcc_exchange", "serial_number", "service_name", "install_address", "raw",
];
// مؤشرات الأعمدة المفتاحية داخل صف القيم (بترتيب FTTH_ORDER_COLS):
const FO_SERVICE_ORDER = 0, FO_CUSTOMER_ORDER = 1, FO_MSAN = 9, FO_FCC = 16, FO_SERIAL = 17, FO_SERVICE_NAME = 18;
// مفتاح هوية المتعذر = المسلسل + Customer Order ID + Service Order ID
const foKey = (r: any[]) => `${r[FO_SERIAL] ?? ""}|${r[FO_CUSTOMER_ORDER] ?? ""}|${r[FO_SERVICE_ORDER] ?? ""}`;
// متعذرات غنايم المعنية: FCC ضمن أكواد غنايم الأربعة + Service Name = FV Survey
const FO_GHANAIM_FCC = ["GHNAT", "AMZAT", "DRGAT", "NGOAT"];
const foIsGhanaimFv = (r: any[]) =>
  FO_GHANAIM_FCC.includes(String(r[FO_FCC] ?? "").trim()) &&
  String(r[FO_SERVICE_NAME] ?? "").trim() === "FV Survey";

// يحلّل ملف "Order" (متعذرات OM) ويُرجع صفوف القيم بترتيب FTTH_ORDER_COLS (deduped by service_order_id).
function parseFtthOrderRows(buffer: Buffer): any[][] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const ws = wb.Sheets["Order"] || wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = sheetRows(ws);
  const { find, findExact, dataRows, headerRowIdx } = smartSheet(rows, ["service order id", "service number"]);
  const origHeaders = (rows[headerRowIdx] || []).map((h) => String(h ?? "").trim());
  const iSO = find("service order id"), iCO = find("customer order id"), iProduct = findExact("product");
  const iServiceNo = find("service number"), iCustomer = findExact("customer name"), iStatus = findExact("order status");
  const iCreate = find("order create time"), iExch = findExact("exchange name"), iSvcType = findExact("service type");
  const iMsan = find("msan code"), iArea = findExact("area code"), iMobile = find("customer mobile number", "customer mobile");
  const iActivity = findExact("current activity"), iError = find("error name"), iGov = find("governorate");
  const iLineType = findExact("line type"), iFcc = find("fcc exchange");
  const iSerial = findExact("serial number"), iSvcName = findExact("service name");
  const iInstallAddr = find("install address", "installation address", "customer address", "العنوان");
  const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");
  const byId = new Map<string, any[]>();
  for (const r of dataRows) {
    const soId = String(g(r, iSO)).trim();
    if (!soId) continue;
    const raw: Record<string, any> = {};
    origHeaders.forEach((h, idx) => { if (h) raw[h] = r[idx] ?? null; });
    byId.set(soId, [
      soId, String(g(r, iCO)) || null, String(g(r, iProduct)) || null, String(g(r, iServiceNo)) || null,
      String(g(r, iCustomer)) || null, String(g(r, iStatus)) || null, toDate(g(r, iCreate)),
      String(g(r, iExch)) || null, String(g(r, iSvcType)) || null, String(g(r, iMsan)) || null,
      String(g(r, iArea)) || null, String(g(r, iMobile)) || null, String(g(r, iActivity)) || null,
      String(g(r, iError)) || null, String(g(r, iGov)) || null, String(g(r, iLineType)) || null,
      String(g(r, iFcc)) || null, String(g(r, iSerial)) || null, String(g(r, iSvcName)) || null,
      String(g(r, iInstallAddr)) || null, JSON.stringify(raw),
    ]);
  }
  // منع تكرار المسلسل: نُبقى صفاً واحداً فقط لكل رقم مسلسل (أول ظهور).
  // الصفوف بدون مسلسل تبقى كما هى (مميَّزة بالفعل بـ service_order_id).
  const seenSerial = new Set<string>();
  const deduped: any[][] = [];
  for (const r of byId.values()) {
    const serial = String(r[FO_SERIAL] ?? "").trim();
    if (serial) { if (seenSerial.has(serial)) continue; seenSerial.add(serial); }
    deduped.push(r);
  }
  return deduped;
}

// هوية الصف لمنع التكرار: رقم المسلسل (إن وُجد) وإلا مفتاح order ids.
const foIdentity = (serial: any, co: any, so: any) => {
  const s = String(serial ?? "").trim();
  return s ? "S|" + s : "K|" + `${co ?? ""}|${so ?? ""}`;
};

// يضيف إلى ftth_orders_soy صفوف غنايم (FV Survey) الجديدة فقط (بدون تكرار المسلسل). يُرجع عدد المُضاف.
async function accumulateSoy(rows: any[][], userId: number): Promise<number> {
  rows = rows.filter(foIsGhanaimFv); // بداية السنة: غنايم الأربعة + Service Name = FV Survey فقط
  if (!rows.length) return 0;
  const { rows: ex } = await pool.query(
    `SELECT serial_number, customer_order_id, service_order_id FROM ftth_orders_soy`,
  );
  const seen = new Set(ex.map((r: any) => foIdentity(r.serial_number, r.customer_order_id, r.service_order_id)));
  // فلترة المُدخلات: نتخطّى أى مسلسل موجود فى SOY أو تكرّر داخل نفس الرفعة.
  const fresh: any[][] = [];
  for (const r of rows) {
    const id = foIdentity(r[FO_SERIAL], r[FO_CUSTOMER_ORDER], r[FO_SERVICE_ORDER]);
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push(r);
  }
  if (!fresh.length) return 0;
  const allCols = [...FTTH_ORDER_COLS, "uploaded_by_id"];
  const n = allCols.length;
  let inserted = 0;
  const BATCH = 200;
  for (let s = 0; s < fresh.length; s += BATCH) {
    const chunk = fresh.slice(s, s + BATCH);
    const ph = chunk.map((_, ci) => {
      const o = ci * n;
      return "(" + Array.from({ length: n }, (_, k) => `$${o + k + 1}`).join(",") + ")";
    }).join(",");
    const vals = chunk.flatMap((r) => [...r, userId]);
    const res = await pool.query(`INSERT INTO ftth_orders_soy (${allCols.join(",")}) VALUES ${ph}`, vals);
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

// يملأ كود MSAN فى ftth_orders_soy من الرفعة لكل مسلسل (حيث SOY فارغ والرفعة بها كود). يُرجع عدد المحدَّث.
async function enrichSoyMsan(rows: any[][]): Promise<number> {
  const map = new Map<string, string>(); // serial -> msan_code
  for (const r of rows) {
    const serial = String(r[FO_SERIAL] ?? "").trim();
    const msan = String(r[FO_MSAN] ?? "").trim();
    if (serial && msan && !map.has(serial)) map.set(serial, msan);
  }
  if (!map.size) return 0;
  let updated = 0;
  const entries = Array.from(map.entries());
  const BATCH = 500;
  for (let s = 0; s < entries.length; s += BATCH) {
    const chunk = entries.slice(s, s + BATCH);
    const values = chunk.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(",");
    const params = chunk.flatMap(([serial, msan]) => [serial, msan]);
    const res = await pool.query(
      `UPDATE ftth_orders_soy soy SET msan_code = v.msan
       FROM (VALUES ${values}) AS v(serial, msan)
       WHERE soy.serial_number = v.serial
         AND (soy.msan_code IS NULL OR soy.msan_code = '')`,
      params,
    );
    updated += res.rowCount ?? 0;
  }
  return updated;
}

// يحذف الصفوف المكرَّرة بنفس رقم المسلسل من جدول متعذرات OM ويُبقى أقدم صف (أصغر id).
// يُنظّف أى تكرارات قديمة تراكمت قبل تطبيق منع التكرار. (table قيمة داخلية ثابتة.)
async function dedupBySerial(table: string): Promise<number> {
  // إزالة التكرار بالمسلسل (serial) ثم بـ Service Order ID — الاثنان معرّفان فريدان للطلب.
  const r1 = await pool.query(
    `DELETE FROM ${table} a USING ${table} b
     WHERE a.id > b.id
       AND COALESCE(TRIM(a.serial_number), '') <> ''
       AND TRIM(a.serial_number) = TRIM(b.serial_number)`,
  );
  const r2 = await pool.query(
    `DELETE FROM ${table} a USING ${table} b
     WHERE a.id > b.id
       AND COALESCE(TRIM(a.service_order_id), '') <> ''
       AND TRIM(a.service_order_id) = TRIM(b.service_order_id)`,
  );
  return (r1.rowCount ?? 0) + (r2.rowCount ?? 0);
}

const COMPLAINT_DETAILS_COLS = [
  "complain_no","sector","region","exchange_name","phone_number","msan_id","cabinet_no",
  "complain_time","close_time","close_code","status_code","complain_side_name","complain_type_name","close_by","time_till_now","time_till_now_full",
];

const REMAINING_COMPLAINTS_COLS = [
  "complain_no","sector","region","exchange_name","phone_number","complain_time",
  "dispatch_time","dispatch_user","msan_id","close_time","close_code","close_by",
  "status_code","cabinet_no","complain_type","time_till_now","time_till_now_full",
];

// ترتيب الفنيين من الأفضل للأسوأ — الأفضل أولاً، وعند التساوى أبجدياً بالاسم.
const arName = (a: any, b: any) =>
  String(a.techName ?? "").localeCompare(String(b.techName ?? ""), "ar");
// تقارير الإزالة: الأعلى نسبة إزالة (24س ثم 48س ثم 120س) هو الأفضل.
const cmpRemovalTech = (a: any, b: any) =>
  (Number(b.pct24h ?? 0)  - Number(a.pct24h ?? 0))  ||
  (Number(b.pct48h ?? 0)  - Number(a.pct48h ?? 0))  ||
  (Number(b.pct120h ?? 0) - Number(a.pct120h ?? 0)) ||
  arName(a, b);
// تقارير التكرار: الأقل نسبة تكرار هو الأفضل (تصاعدى).
const cmpRepetitionTech = (a: any, b: any) =>
  (Number(a.repRatio ?? 0) - Number(b.repRatio ?? 0)) || arName(a, b);
// مقارِن موحّد: صفوف التكرار فيها repRatio، وصفوف الإزالة فيها نِسب pct.
const cmpTechBest = (a: any, b: any) =>
  ("repRatio" in (a || {}) || "repRatio" in (b || {})) ? cmpRepetitionTech(a, b) : cmpRemovalTech(a, b);
// نسخة "بالفنى لكل سنترال": تُبقى السنترالات مجمّعة ثم ترتّب الفنيين داخل كل سنترال.
const byCentralThen = (cmp: (a: any, b: any) => number) => (a: any, b: any) =>
  String(a.centralName ?? "").localeCompare(String(b.centralName ?? ""), "ar") || cmp(a, b);

// «رقم الفريم» مصدره منافذ MSAN (phone_ports.frame). أى رقم مالوش فريم = مش متركّب
// على المسان فعلياً، فبيتستبعد من تقارير القياسات ومن بيان التليفونات — حتى لو ليه
// رقم أكونت أو بيانات فنية (بيان 131). الاستثناء الوحيد: تقرير «بيان فنى بدون بورت»
// اللى الغرض منه بالظبط إظهار الأرقام دى.
// ── ساعات العطل المقفول ──
// المرجع الرسمى هو عمود الشيت «فترة الاستمرار — باستبعاد الحالة 135»
// (time_till_now)، لأنه بيشيل مدة تعليق الشكوى، وده اللى الشركة بتحاسب عليه.
// لكنه **مقيّد** بالفرق الفعلى (إغلاق − شكوى): الاستبعاد بيقلّل المدة ومايزوّدهاش،
// فأى قيمة أكبر من الفرق الفعلى معناها إن اللى اتخزّن هو عمود «Time untill now»
// (المدة لحد لحظة توليد التقرير، مش لحد الإغلاق) — وده كان بيخلّى عطل اتقفل بعد
// 23 ساعة يظهر فى «تجاوزت 24 ساعة» بـ29 ساعة.
// «الآن» بعرف تخزين أوقات الشيتات.
// ⚠️ أعمدة وقت الشكوى/الإغلاق جاية من شيتات 430D/FCC، والاستيراد بيبنى الـ Date من
// **مكوّنات وقت الحائط** (new Date(y, m, d, h, mi)) والعملية شغّالة TZ=UTC — يعنى
// «13:24 بتوقيت القاهرة» بتتخزّن كـ 13:24 UTC. العرض بيرجّعها خام والواجهة بتقراها
// بـ getUTC* فبتظهر 13:24 صح.
// لكن مقارنتها بـ now() الحقيقى بتنقص فرق توقيت القاهرة (3 ساعات صيفاً)، فعطل عدّى
// عليه يومين وساعة كان بيظهر «يوم و23 ساعة». المقارنة الصحيحة مع **وقت حائط القاهرة**
// عشان الطرفين يبقوا بنفس العرف. (متقاس: 48.00 بالغلط مقابل 51.00 الصح.)
// بيتحطّ فقط مع أعمدة الشيتات — أعمدة زى claimed_at/updated_at لحظات حقيقية وبتتقارن بـ now().
const NOW_SHEET = `(now() AT TIME ZONE 'Africa/Cairo')`;

// «الوقت الفعلى» للعطل المفتوح = (الآن − وقت الشكوى) − المدة اللى قضاها على
// الحالة 135/138 (معلّق). ثابت مشترك عشان **العمود والتصنيف** يستخدموا نفس
// الرقم — قبل كده العمود كان بيخصم مدة التعليق والتصنيف بياخد الزمن الخام،
// فعطل ظاهر «1ي 3س» كان بيتصنّف «المتبقيات» لأن الخام تعدّى 48 ساعة.
const openEffectiveHoursSql = (t: string, rcd: string) => `CASE WHEN ${t}.complaint_time IS NULL THEN NULL
     ELSE GREATEST(0, EXTRACT(EPOCH FROM (${NOW_SHEET} - ${t}.complaint_time)) / 3600.0
                      - COALESCE(
                          ${rcd}.time_till_now_full - ${rcd}.time_till_now,
                          GREATEST(0, EXTRACT(EPOCH FROM (${rcd}.uploaded_at - ${rcd}.complain_time)) / 3600.0
                                      - COALESCE(${rcd}.time_till_now, 0))
                        ))
END`;

const closedHoursSql = (t: string) => `CASE
  WHEN ${t}.close_time IS NULL THEN ${t}.time_till_now
  WHEN ${t}.time_till_now IS NULL
    THEN EXTRACT(EPOCH FROM (${t}.close_time - ${t}.complain_time)) / 3600.0
  ELSE LEAST(${t}.time_till_now,
             EXTRACT(EPOCH FROM (${t}.close_time - ${t}.complain_time)) / 3600.0)
END`;

// ── بحث عربى غير حرفى ──
// الفكرة: نطبّع الطرفين قبل المقارنة — العمود بدالة sf_ar_norm() فى الداتابيز، وكلمة البحث
// بدالة arNorm() فى الـ JS (نفس المنطق بالظبط). فـ«ايمن» تلاقى «أيمن» و«فاطمه» تلاقى «فاطمة».
// الدالتين بيعملوا lower() كمان، فمش محتاجين LOWER() ولا ILIKE — LIKE عادى بيكفى.
//   n("col")     → sf_ar_norm(COALESCE(col::text,''))  للعمود
//   arQ("كلمة")  → '%كلمه%'  للـ param
// req.user بتاعنا هو صف users من قاعدة البيانات (فيه role و workerCode …).
// من غير التوسعة دى Express بيعتبره {} فارغ، فـ req.user?.role كانت خطأ ترجمة
// وكل استخدام كان محتاج (req.user as any) — يعنى صفر حماية من الأنواع فى أهم
// شرط أمان فى السيرفر (تحديد الدور).
declare global {
  namespace Express {
    interface User extends SchemaUser {}
  }
}

const n = (expr: string) => `sf_ar_norm(COALESCE(${expr}::text, ''))`;
const arQ = (q: unknown) => `%${arNorm(String(q ?? "").trim())}%`;

// ── مطابقة أرقام التليفون بين الجداول ──
// أرقام 430D (complaint_details / remaining_complaints) وticket_dsl_current مخزّنة بصيغ
// مختلفة: بعضها فيه مسافات/شرطات، وبعضها بالبادئة 88، وبعضها بأصفار بادئة. المقارنة كانت
// بـ «=» على القيمة الخام، فأى اختلاف فى الصيغة كان بيخلّى الشكوى مش تتلاقى أصلاً.
// sp() بترجّع الرقم القصير المعيارى: أرقام فقط، وتشيل بادئة 88 بس لو الطول أكبر من 7
// (عشان رقم محلى بيبدأ بـ 88 مايتقصّش بالغلط) — نفس المنطق المستخدم فى تقارير أوامر الشغل.
// نفس التعبير المستخدَم فى فهارس server/db.ts بالحرف — لازم يتطابقوا عشان الـ planner
// يستخدم الفهرس (وإلا الـ LATERAL بتاع الشكاوى يرجع seq scan لكل صف ويعلّق التقارير).
const sp = phoneNormSql;

// «أى حاجة فى طابور التنفيذ ماتتكررش»: شرط بيستبعد أرقام الأكونت اللى الباتش بتاعها
// **لسه تحت التنفيذ** (قياس/رفع سرعة/إيقاف). بيتحطّ فى تقارير القياسات اللى بتتبعت منها
// باتشات، عشان الرقم مايتبعتش تانى وهو أصلاً فى الدور.
//
// ⚠️ الاستبعاد على مستوى **الباتش** مش على مستوى الخط:
// الباتش بيتقسّم لمهام (صف لكل خط) بنفس batch_id، وأول ما الخط يتنفّذ مهمته تبقى done.
// لو استبعدنا اللى status بتاعه pending/claimed بس، الخطوط اللى اتنفّذت جوّه باتش لسه
// شغّال بترجع تظهر فى التقرير فوراً، فالمستخدم يبعتها تانى وهى لسه فى نفس الجولة.
// فالقاعدة: أى خط داخل باتش عنده أى مهمة pending/claimed يتستبعد — سواء مهمته هو
// اتنفّذت أو لأ. ودى بالظبط نفس شروط ظهور الباتش فى تقرير «ترتيب الطابور»
// (الإلغاء بيحوّل المهام لـ stale، فالباتش الملغى بيخرج من الاتنين مع بعض).
//
// subquery **غير مرتبطة** عن قصد: الـ planner بيعملها Hash Anti Join فبتتحسب مرة
// واحدة بدل مرة لكل صف (اتقاست: 10 آلاف خط × 6500 مهمة = 15ms). والـ IN جوّاها
// كمان غير مرتبطة (بتتبنى مرة واحدة كقائمة batch_id نشطة، وعليها exec_jobs_batch_idx).
// الزر اللى فى الواجهة: ?excludeQueued=1
const excludeQueuedOn = (req: any) => {
  const v = String(req?.query?.excludeQueued ?? "");
  return v === "1" || v === "true";
};
// الأرقام اللى ليها رقم موبايل من أى مصدر (يدوى/أوامر شغل/طلبات FTTH) — نفس أولوية
// البحث المستخدَمة فى «بحث برقم التليفون». مجموعة **غير مرتبطة** بالصف عن قصد: الـ
// planner بيبنيها مرة واحدة ويعمل Hash Anti Join بدل ما يعيد الحساب لكل صف.
// ⚠️ كانت LATERAL بتتنفّذ لكل صف من عشرات الآلاف وبتمسح maintenance_orders و
// ftth_orders_current كاملين فى كل مرة — تقرير «بدون موبايل» كان بياخد دقايق.
// المفتاح الموحّد هو الرقم القصير (sp) لأن المصادر مخزّنة بصيغ مختلفة (بـ 88 أو من غيرها).
const HAS_MOBILE_SET = `(
  SELECT ${phoneNormSql("lm.full_phone")} AS ph FROM line_mobiles lm
    WHERE NULLIF(btrim(lm.mobile), '') IS NOT NULL
  UNION
  SELECT ${phoneNormSql("mo.phone_number")} FROM maintenance_orders mo
    WHERE NULLIF(btrim(mo.mobile), '') IS NOT NULL
      AND mo.mobile !~ '[A-Za-z=/]' AND mo.mobile ~ '[0-9]{5,}'
  UNION
  SELECT ${phoneNormSql("fo.service_number")} FROM ftth_orders_current fo
    WHERE NULLIF(btrim(fo.customer_mobile), '') IS NOT NULL
      AND fo.customer_mobile !~ '[A-Za-z=/]' AND fo.customer_mobile ~ '[0-9]{5,}'
)`;

// أرقام البورتات الصالحة لمراجعة الاسم/العنوان: **88 + 7 أرقام بالظبط**.
// ⚠️ جدول phone_ports فيه صفوف مش أرقام تليفون عادية (أرقام أطول من 7 خانات وخدمات
// وخلافه). من غير الفلتر ده كانت بتتبعت لمراجعة FCC وتتفتح واحدة واحدة من غير أى
// فايدة — وده اللى خلّى زر «مراجعة الاسم والعنوان» يفتح أرقام أطول من 7 خانات.
// نفس الشرط المستخدَم فى تقرير «أرقام بدون رقم موبايل» بالحرف.
// (phone_lines مصدر موثوق — بيان التليفونات نفسه — فبيعدّى زى ما هو.)
const PORTS_LOCAL_PHONES_SQL = `SELECT phone_number FROM phone_ports
          WHERE regexp_replace(phone_number, '[^0-9]', '', 'g') ~ '^0*88[0-9]{7}$'`;

const notQueuedSql = (accCol: string) => `NOT EXISTS (
  SELECT 1 FROM exec_jobs e, jsonb_array_elements_text(e.accounts) qa(acc)
   WHERE e.type IN ('measure','raise','stop')
     AND qa.acc = ${accCol}
     AND (e.status IN ('pending','claimed')
          OR e.batch_id IN (SELECT b.batch_id FROM exec_jobs b
                             WHERE b.status IN ('pending','claimed')
                               AND b.batch_id IS NOT NULL)))`;

// «جدول الخطوط المرفوعة»: بدل ما نمسح الرقم اللى اختفى من الشيت، بننقله بكل بياناته
// لـ removed_phone_ports ثم نشيله من phone_ports. لو رجع فى شيت بعدين بيتشال من هناك
// تلقائياً (فالجدول معناه «المرفوعة حالياً» مش سجل تاريخى).
// whereSql بيتنفّذ على phone_ports وبياخد نفس البارامترات.
async function archiveRemovedPorts(whereSql: string, params: any[], source: string): Promise<number> {
  await pool.query(
    `INSERT INTO removed_phone_ports
       (phone_number, area_code, msan_code, frame, shelf, slot, port_number, port_type,
        voice_status, data_status, operator, onu, row_no, column_no, last_uploaded_at, removed_at, removed_source)
     SELECT phone_number, area_code, msan_code, frame, shelf, slot, port_number, port_type,
            voice_status, data_status, operator, onu, row_no, column_no, uploaded_at, now(), $${params.length + 1}
       FROM phone_ports WHERE ${whereSql}
     ON CONFLICT (phone_number) DO UPDATE SET
       area_code = EXCLUDED.area_code, msan_code = EXCLUDED.msan_code, frame = EXCLUDED.frame,
       shelf = EXCLUDED.shelf, slot = EXCLUDED.slot, port_number = EXCLUDED.port_number,
       port_type = EXCLUDED.port_type, voice_status = EXCLUDED.voice_status,
       data_status = EXCLUDED.data_status, operator = EXCLUDED.operator, onu = EXCLUDED.onu,
       row_no = EXCLUDED.row_no, column_no = EXCLUDED.column_no,
       last_uploaded_at = EXCLUDED.last_uploaded_at, removed_at = now(), removed_source = EXCLUDED.removed_source`,
    [...params, source]);
  const del = await pool.query(`DELETE FROM phone_ports WHERE ${whereSql}`, params);
  return del.rowCount ?? 0;
}

// تنفيذ مجموعة أوامر كوحدة واحدة (BEGIN/COMMIT/ROLLBACK): المستوردات اللى بتمسح
// قبل ما تدخّل كانت بتسيب الجدول ناقص لو الرفع فشل فى نصه (نت وقع/قيمة بايظة) —
// جوه الـ transaction الفشل بيرجّع كل حاجة زى ما كانت.
async function withTx<T>(fn: (tx: { query: (q: string, p?: any[]) => Promise<any> }) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client as any);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally { client.release(); }
}

const hasFrameSql = (fullPhoneExpr: string) => `EXISTS (
    SELECT 1 FROM phone_ports pf
     WHERE pf.phone_number = ${fullPhoneExpr}
       AND COALESCE(btrim(pf.frame::text), '') <> ''
  )`;

// ── تبعية الخط لفنى (تُستخدم فى نسبة الإزالة ونسبة التكرار وتقارير التفاصيل) ──
// فنى المنطقة = صاحب الكابينة (cabinet_technicians)، لكن لو كان فى «راحه/إجازة» يوم
// الشكوى فالمسؤول فعلياً هو فنى الوردية القائم بالعمل مكانه (shift_schedules.covers).
// جدول الورديات: صف لكل (أسبوع يبدأ الجمعة، فنى)، وdays/covers 7 قيم من الجمعة للخميس.
//   dateExpr = تعبير timestamp للشكوى (بيتحوّل لتوقيت القاهرة جوّه).
// phoneExpr (اختيارى): رقم التليفون. لما يتبعت بنحدّد «فنى المنطقة» من **بيان الخط**
// (phone_lines) بالظبط زى تقرير «بحث برقم التليفون» — نفس المفتاح ونفس الترتيب ونفس
// أولوية الإسناد اليدوى لكود الكابينة. من غير كده التقريرين كانوا بيدّوا فنيين
// مختلفين لنفس الكابينة، لأن:
//   • الشيت (430D) هو اللى كان بيحدّد الكابينة بدل بيان الخط، و
//   • الاختيار من cabinet_technicians كان LIMIT 1 من غير ORDER BY — والكابينة الواحدة
//     ليها أكتر من صف، فكان بيرجع صف عشوائى (اسم فنى غير صاحب الكابينة).
// الترتيب: (1) إسناد السوبر أدمن اليدوى لكود الكابينة، (2) صاحب كابينة الخط من بيان
// الخط، (3) الطريقة القديمة برقم الكابينة من الشيت — بس لو الخط مش موجود فى بيان الخطوط.
const areaTechSql = (centralExpr: string, cabinExpr: string, dateExpr: string, phoneExpr?: string) => {
  const cairo = `(${dateExpr} AT TIME ZONE 'Africa/Cairo')`;
  const dt = `${cairo}::date`;                                              // يوم الشكوى
  const di = `((EXTRACT(DOW FROM ${cairo})::int - 5 + 7) % 7)`;             // 0=الجمعة … 6=الخميس
  // نفس ترتيب «بحث برقم التليفون»: الصف اللى ليه كود كابينة الأول، وبعدين بالاسم —
  // عشان الاختيار يبقى ثابت ومطابق للتقرير التانى مهما كان عدد الصفوف المكررة.
  const CT_ORDER = `ORDER BY (ct.cabin_code IS NOT NULL AND ct.cabin_code <> '') DESC, tn.tech_name NULLS LAST`;
  const bySheetCabin = `
      (SELECT tn.tech_name FROM cabinet_technicians ct
         LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
        WHERE ct.central_name = ${centralExpr} AND ct.cabin_number = ${cabinExpr}
        ${CT_ORDER} LIMIT 1)`;
  // من غير رقم تليفون: الطريقة القديمة (كابينة الشيت) بس بترتيب ثابت
  const owner = phoneExpr
    ? `COALESCE(
         (SELECT mto.tech_name FROM msan_tech_overrides mto
           WHERE mto.cabin_code = ctc.cabin_code
             AND COALESCE(btrim(ctc.cabin_code), '') <> '' LIMIT 1),
         ctc.ct_tech,
         ${bySheetCabin}
       )`
    : bySheetCabin;
  const ownerFrom = phoneExpr
    ? `FROM (VALUES (1)) AS one(x)
       LEFT JOIN LATERAL (
         SELECT ct.cabin_code, tn.tech_name AS ct_tech
           FROM phone_lines pl
           JOIN cabinet_technicians ct
             ON ct.central_name = pl.central AND ct.cabin_number = pl.cabin_number
           LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
          WHERE pl.tel_no = ${phoneExpr}
          ${CT_ORDER} LIMIT 1
       ) ctc ON true`
    : "";
  return `
  (SELECT COALESCE(NULLIF(btrim(COALESCE(s.covers->>${di}, '')), ''), o.name)
     FROM (SELECT ${owner} AS name ${ownerFrom}) o
     LEFT JOIN shift_schedules s
       ON s.week_start = ${dt} - ${di}
      AND btrim(s.tech_name) = btrim(o.name)
      AND COALESCE(s.days->>${di}, '') IN (${SHIFT_COVER_STATES_SQL})
    WHERE o.name IS NOT NULL
    LIMIT 1)`;
};

// التبعية الكاملة بالترتيب: (1) فنى الإغلاق المُدخَل يدوياً من السوبر أدمن — مرجع أساسى،
// (2) كود عامل الإغلاق من 430D، (3) فنى المنطقة/الوردية أعلاه، (4) غير معروف.
const effTechSql = (complainNoExpr: string, closeByExpr: string, centralExpr: string, cabinExpr: string, dateExpr: string, phoneExpr?: string) => `
  COALESCE(
    (SELECT mcb.tech_name FROM manual_close_by mcb WHERE mcb.complain_no = ${complainNoExpr} LIMIT 1),
    (SELECT tn.tech_name FROM technician_names tn WHERE tn.worker_code = ${closeByExpr} LIMIT 1),
    ${areaTechSql(centralExpr, cabinExpr, dateExpr, phoneExpr)},
    'غير معروف'
  )`;

// يُرفق بكل طلب اسم فنى الكابينة المالك (cabinet_technicians) حسب (السنترال + رقم
// الكابينة) — بصرف النظر عن من ردّ على الطلب. يُستخدم لفلتر "متعذراتى" للفنى.
async function attachCabinetTech(orders: any[]): Promise<any[]> {
  if (!orders.length) return orders;
  // DISTINCT ON بنفس ترتيب «بحث برقم التليفون» — الكابينة الواحدة ليها أكتر من صف،
  // ومن غير ترتيب ثابت كان آخر صف عشوائى هو اللى بيكسب فيظهر فنى غير صاحبها.
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ct.central_name, ct.cabin_number)
            ct.central_name AS c, ct.cabin_number AS n, tn.tech_name AS t
     FROM cabinet_technicians ct JOIN technician_names tn ON tn.worker_code = ct.worker_code
     ORDER BY ct.central_name, ct.cabin_number,
              (ct.cabin_code IS NOT NULL AND ct.cabin_code <> '') DESC, tn.tech_name NULLS LAST`,
  );
  const map = new Map<string, string>();
  for (const r of rows) map.set(`${r.c}|${r.n}`, r.t);
  return orders.map((o) => ({ ...o, cabinetTechName: map.get(`${o.centralName}|${o.cabinNumber}`) ?? null }));
}

// Archive a historical table into its archive table when the year (Africa/Cairo)
// has rolled over since the last upload. Returns the archived year or null.
async function archiveIfNewYear(histTable: string, archiveTable: string, cols: string[]): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT EXTRACT(YEAR FROM MAX(uploaded_at) AT TIME ZONE 'Africa/Cairo')::int AS y FROM ${histTable}`,
  );
  const lastYear = rows[0]?.y;
  if (lastYear == null) return null; // empty → nothing to archive
  const { rows: cur } = await pool.query(
    `SELECT EXTRACT(YEAR FROM now() AT TIME ZONE 'Africa/Cairo')::int AS y`,
  );
  const curYear = cur[0].y as number;
  if (lastYear >= curYear) return null;
  const colList = cols.join(", ");
  await pool.query(
    `INSERT INTO ${archiveTable} (archived_year, ${colList}, uploaded_at, uploaded_by_id)
     SELECT $1, ${colList}, uploaded_at, uploaded_by_id FROM ${histTable}`,
    [lastYear],
  );
  await pool.query(`DELETE FROM ${histTable}`);
  return lastYear;
}

// أنواع التركيب/المعاينة المسموحة — معرّفة لاحقاً (INSTALL/SURVEY) ولكن دوال
// الاستعلام التالية تستقبلها كوسيط حتى تعمل كدوال مستوى-وحدة قابلة للمشاركة بين
// الـ endpoints وجدولة الحفظ اليومى.

// الأعطال المنتظمة اليوم — تُرجع الصفوف (مع ticketId للمفتاح الفريد).
async function queryRegularizedFaults(opts: { central?: string; q?: string; date?: string }) {
  const { central = "", q = "", date = "" } = opts;
  const params: any[] = [];
  // الفلترة بتاريخ الإغلاق: لو date محدد يُستخدم، وإلا اليوم الحالى بتوقيت القاهرة.
  let dateExpr: string;
  if (date) { params.push(date); dateExpr = `$${params.length}::date`; }
  else { dateExpr = `(now() AT TIME ZONE 'Africa/Cairo')::date`; }
  const conds: string[] = [
    `(t.status_code ~ '^(160|173|122|73|72|60)' OR t.complain_type_name ~ '^(160|173|122|73|72|60)')`,
    `(t.central_name = 'الغنايم' OR t.central_name = 'الغنايم-العزايزة' OR t.central_name = 'الغنايم-دير الجنادله' OR t.central_name = 'الغنايم-نجع العمدة')`,
  ];
  if (central) { params.push(central); conds.push(`t.central_name = $${params.length}`); }
  if (q.trim()) {
    params.push(arQ(q));
    const p = `$${params.length}`;
    conds.push(`(${n("t.phone_number")} LIKE ${p} OR ${n("t.cabinet_no")} LIKE ${p} OR ${n("t.status_code")} LIKE ${p} OR ${n("pl.box_number")} LIKE ${p})`);
  }
  const where = "WHERE " + conds.join(" AND ");
  const { rows } = await pool.query(
    `SELECT x.*, (pe.last_raise_at AT TIME ZONE 'Africa/Cairo') AS "lastPoRaiseAt",
            (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') AS "lastPoStopAt" FROM (
       SELECT DISTINCT ON (t.ticket_id)
         t.ticket_id             AS "ticketId",
         t.central_name          AS "centralName",
         t.phone_number          AS "phoneShort",
         CASE WHEN t.phone_number IS NOT NULL AND t.phone_number <> '' AND t.complaint_time IS NOT NULL
                   AND EXISTS (
                     SELECT 1 FROM complaint_details cd
                     WHERE cd.close_time IS NOT NULL
                       AND regexp_replace(COALESCE(cd.phone_number,''), '\\D', '', 'g') LIKE '%' || t.phone_number
                       AND date_trunc('month', cd.complain_time) = date_trunc('month', t.complaint_time)
                       AND (cd.complain_time IS NULL OR cd.complain_time::date <> t.complaint_time::date)
                   )
              THEN 'مكرر' ELSE '' END AS "repeatStatus",
         t.status_code           AS "statusCode",
         ct.cabin_code           AS "msanCode",
         pp.frame                AS "frame",
         t.cabinet_no            AS "cabinetNo",
         pl.box_number           AS "boxNo",
         pl.dp_terminal          AS "dpTerminal",
         t.complaint_time        AS "complainTime",
         t.complain_type_name    AS "complainTypeName",
         t.reg_source            AS "regStatus",
         t.close_date            AS "closeDate",
         t.onu                   AS "onu",
         ct.worker_code          AS "workerCode",
         tn.tech_name            AS "techName",
         ct.haya_karima          AS "hayaKarima",
         pp.voice_status         AS "voiceStatus",
         pp.data_status          AS "dataStatus",
         pp.shelf                AS "shelf",
         pp.slot                 AS "slot",
         pp.port_number          AS "portNumber",
         t.central_code          AS "centralCode",
         c138p.account_no        AS "accountNo",
         c138p.current_speed     AS "lineCurrentSpeed",
         c138p.max_speed         AS "lineMaxSpeed",
         c138p.score             AS "lastMeasScore",
         c138p.complain_no       AS "lastMeasComplainNo",
         (c138p.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime",
         c138c.score             AS "curMeasScore",
         c138c.current_speed     AS "curMeasCurrentSpeed",
         c138c.max_speed         AS "curMeasMaxSpeed",
         (c138c.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "curMeasTime",
         -- الوقت الفعلى للشكوى = (الآن − وقت الشكوى) − الوقت على الحالة 135/138 (من شيت المتبقى)
         -- لو time_till_now_full فارغ: نقدّر وقت الحالة 135 = (uploaded_at − complain_time) − time_till_now
         CASE WHEN t.complaint_time IS NULL THEN NULL
              ELSE GREATEST(0, EXTRACT(EPOCH FROM (${NOW_SHEET} - t.complaint_time)) / 3600.0
                               - COALESCE(
                                   rcd.time_till_now_full - rcd.time_till_now,
                                   GREATEST(0, EXTRACT(EPOCH FROM (rcd.uploaded_at - rcd.complain_time)) / 3600.0
                                               - COALESCE(rcd.time_till_now, 0))
                                 ))
         END                     AS "effectiveFaultHours"
       FROM (
         SELECT *, 'مغلق اليوم' AS reg_source FROM ticket_dsl_current
         WHERE close_date IS NOT NULL
           AND (close_date AT TIME ZONE 'Africa/Cairo')::date = ${dateExpr}
         UNION ALL
         SELECT *, 'اختفى من الحالى' AS reg_source FROM ticket_dsl_sod s
         WHERE NOT EXISTS (SELECT 1 FROM ticket_dsl_current c WHERE c.ticket_id = s.ticket_id)
           -- الحالات 138/135 حالات وسيطة (قيد التنفيذ) لا تُعتبر "اختفى/منتظم" أبداً
           AND NOT (s.status_code ~ '^(135|138)')
       ) t
       -- ⚠️ phone_ports بيخزّن الرقم **كامل** (88+القصير) وجداول التذاكر بتخزّنه
       -- **قصير** — فالمقارنة المباشرة كانت مابتطابقش ولا صف واحد، وعمود Frame
       -- (والشيلف/السلوت/حالة الصوت والداتا) كان بيطلع فاضى دايماً. التطبيع بـ sp()
       -- بيشيل بادئة 88 من الطرفين فيتطابقوا (وفيه فهرس على نفس التعبير).
       -- LATERAL + LIMIT 1: لو رفعة قديمة خزّنت نفس الرقم مرتين (قصير + كامل)
       -- الجوين العادى كان هيكرّر سطر العطل — بنختار الصيغة الكاملة (الأطول).
       LEFT JOIN LATERAL (
         SELECT p.* FROM phone_ports p
          WHERE ${sp("p.phone_number")} = ${sp("t.phone_number")}
          ORDER BY length(p.phone_number) DESC LIMIT 1
       ) pp ON true
       LEFT JOIN phone_lines pl ON pl.tel_no = t.phone_number
       LEFT JOIN cabinet_technicians ct ON ct.central_name = t.central_name AND ct.cabin_number = t.cabinet_no
       LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
       -- آخر قياس للرقم من شيت 138 (أى شكوى) — المطابقة بالتليفون الكامل (88+الرقم)
       LEFT JOIN LATERAL (
         SELECT c.account_no, c.current_speed, c.max_speed, c.score, c.complain_no, c.complain_time, c.uploaded_at
         FROM case_138 c WHERE c.full_phone = '88' || t.phone_number
         ORDER BY c.id DESC LIMIT 1
       ) c138p ON true
       -- القياس الحالى لنفس رقم الشكوى (آخر قياس لو مكرر)
       LEFT JOIN LATERAL (
         SELECT c.score, c.current_speed, c.max_speed, c.complain_time, c.uploaded_at
         FROM case_138 c WHERE c.complain_no = t.ticket_id
         ORDER BY c.id DESC LIMIT 1
       ) c138c ON true
       -- وقت الحالة 135/138 من شيت تفاصيل المتبقى — مطابقة برقم الشكوى
       LEFT JOIN LATERAL (
         SELECT rc.time_till_now, rc.time_till_now_full, rc.uploaded_at, rc.complain_time
         FROM remaining_complaints rc WHERE rc.complain_no = t.ticket_id
         ORDER BY rc.id DESC LIMIT 1
       ) rcd ON true
       ${where}
       ORDER BY t.ticket_id, t.id DESC
     ) x
     LEFT JOIN line_po_events pe ON pe.account_no = x."accountNo"
     ORDER BY x."complainTime" ASC NULLS LAST`,
    params,
  );
  return rows;
}

// SQL مشترك لتقارير التركيبات/المعاينات (أعمدة + وصلات الإثراء).
const WFM_REPORT_SELECT = `
    t.central_name        AS "centralName",
    t.work_order_id       AS "workOrderId",
    t.phone_number        AS "phoneNumber",
    t.work_order_type     AS "workOrderType",
    t.stage               AS "stage",
    t.status              AS "status",
    t.priority            AS "priority",
    COALESCE(NULLIF(t.exch_cabinet, ''), pl.cabin_number) AS "cabinetNo",
    pl.box_number         AS "boxNo",
    pl.dp_terminal        AS "dpTerminal",
    ct.worker_code        AS "workerCode",
    tn.tech_name          AS "techName",
    t.creation_date       AS "creationDate",
    t.description         AS "description",
    t.mobile              AS "mobile",
    t.customer_name       AS "customerName",
    t.address             AS "address",
    t.reference_no        AS "referenceNo"`;
const WFM_REPORT_JOINS = `
    LEFT JOIN phone_lines pl ON pl.tel_no = t.phone_number
    LEFT JOIN cabinet_technicians ct ON ct.central_name = t.central_name
         AND ct.cabin_number = COALESCE(NULLIF(t.exch_cabinet, ''), pl.cabin_number)
    LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code`;

// تقرير تركيبات/معاينات (حالى أو منتظم اليوم) — يُرجع الصفوف.
async function queryWfmReport(
  typesLc: string[], regularized: boolean,
  opts: { central?: string; q?: string; workerCode?: string },
) {
  const { central = "", q = "", workerCode = "" } = opts;
  const params: any[] = [typesLc];
  const conds: string[] = [
    `lower(trim(t.work_order_type)) = ANY($1::text[])`,
    `(t.central_name = 'الغنايم' OR t.central_name = 'الغنايم-العزايزة' OR t.central_name = 'الغنايم-دير الجنادله' OR t.central_name = 'الغنايم-نجع العمدة')`,
  ];
  if (regularized) {
    conds.push(`NOT EXISTS (SELECT 1 FROM wfm_current c WHERE c.central_name = t.central_name AND c.work_order_id = t.work_order_id)`);
  }
  if (central) { params.push(central); conds.push(`t.central_name = $${params.length}`); }
  // الفنى يشوف أوامر كباينه هو بس — الكابينة بتتحدد من exch_cabinet أو من البيان
  // الفنى للخط، وصاحبها من cabinet_technicians (نفس الـ join المستخدم فى العرض).
  if (workerCode.trim()) {
    params.push(workerCode.trim());
    conds.push(`btrim(ct.worker_code) = btrim($${params.length})`);
  }
  if (q.trim()) {
    params.push(arQ(q));
    const p = `$${params.length}`;
    conds.push(`(${n("t.phone_number")} LIKE ${p} OR ${n("t.work_order_type")} LIKE ${p} OR ${n("pl.cabin_number")} LIKE ${p} OR ${n("pl.box_number")} LIKE ${p} OR ${n("t.description")} LIKE ${p})`);
  }
  const where = "WHERE " + conds.join(" AND ");
  const sourceTable = regularized ? "wfm_sod" : "wfm_current";
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (t.central_name, t.work_order_id)
         ${WFM_REPORT_SELECT}
       FROM ${sourceTable} t
       ${WFM_REPORT_JOINS}
       ${where}
       ORDER BY t.central_name, t.work_order_id, t.id DESC
     ) x
     ORDER BY x."creationDate" DESC NULLS LAST`,
    params,
  );
  return rows;
}

// المنتظمة لفترة (تركيبات/معاينات) — تُحسب مباشرة عند فتح التقرير بدون أرشيف يومى:
// الأمر منتظم = موجود فى maintenance_orders (التاريخى المتراكم) وغير موجود فى
// wfm_current (الملف الحالى)؛ تُفلتر بتاريخ الإنشاء ضمن [dateFrom, dateTo] (توقيت القاهرة).
async function queryWfmRegularizedRange(
  typesLc: string[],
  opts: { dateFrom?: string; dateTo?: string; central?: string; q?: string },
) {
  const { dateFrom = "", dateTo = "", central = "", q = "" } = opts;
  const params: any[] = [typesLc];
  const conds: string[] = [
    `lower(trim(t.work_order_type)) = ANY($1::text[])`,
    `(t.central_name = 'الغنايم' OR t.central_name = 'الغنايم-العزايزة' OR t.central_name = 'الغنايم-دير الجنادله' OR t.central_name = 'الغنايم-نجع العمدة')`,
    `NOT EXISTS (SELECT 1 FROM wfm_current c WHERE c.central_name = t.central_name AND c.work_order_id = t.work_order_id)`,
  ];
  if (dateFrom) { params.push(dateFrom); conds.push(`(t.creation_date AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}::date`); }
  if (dateTo)   { params.push(dateTo);   conds.push(`(t.creation_date AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}::date`); }
  if (central) { params.push(central); conds.push(`t.central_name = $${params.length}`); }
  if (q.trim()) {
    params.push(arQ(q));
    const p = `$${params.length}`;
    conds.push(`(${n("t.phone_number")} LIKE ${p} OR ${n("t.work_order_type")} LIKE ${p} OR ${n("pl.cabin_number")} LIKE ${p} OR ${n("pl.box_number")} LIKE ${p} OR ${n("t.description")} LIKE ${p})`);
  }
  const where = "WHERE " + conds.join(" AND ");
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (t.central_name, t.work_order_id)
         ${WFM_REPORT_SELECT}
       FROM maintenance_orders t
       ${WFM_REPORT_JOINS}
       ${where}
       ORDER BY t.central_name, t.work_order_id, t.id DESC
     ) x
     ORDER BY x."creationDate" DESC NULLS LAST`,
    params,
  );
  return rows;
}

// يحفظ منتظمات يوم محدد فى regularized_daily (مرة واحدة لكل عنصر).
// dateStr بصيغة YYYY-MM-DD (تاريخ القاهرة). يُستدعى من الـ cron والتعويض.
async function recordDailySnapshot(dateStr: string) {
  const insertRows = async (
    category: string, rows: any[], keyOf: (r: any) => string,
  ) => {
    for (const r of rows) {
      await pool.query(
        `INSERT INTO regularized_daily (snapshot_date, category, item_key, central_name, data)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (category, item_key) DO NOTHING`,
        [dateStr, category, keyOf(r), r.centralName ?? null, JSON.stringify(r)],
      );
    }
  };
  const faults = await queryRegularizedFaults({});
  await insertRows("faults", faults, (r) => String(r.ticketId ?? `${r.centralName}|${r.phoneShort}|${r.complainTime}`));
  const installs = await queryWfmReport(INSTALL_TYPES_LC, true, {});
  await insertRows("installations", installs, (r) => `${r.centralName}|${r.workOrderId}`);
  const surveys = await queryWfmReport(SURVEY_TYPES_LC, true, {});
  await insertRows("surveys", surveys, (r) => `${r.centralName}|${r.workOrderId}`);
  return { faults: faults.length, installations: installs.length, surveys: surveys.length };
}

// تاريخ القاهرة (YYYY-MM-DD) وساعة القاهرة الحالية.
function cairoNow() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = parseInt(get("hour"), 10);
  return { date, hour };
}

// يحسب آخر تاريخ يُفترض وجود لقطة له (اليوم لو تعدّينا 11 مساءً، وإلا أمس)
// ويسجّلها لو غير موجودة — يُستدعى عند الإقلاع وكل فترة (تعويض عند الصحيان).
let lastSnapshotCheck = "";
async function checkAndSnapshot() {
  try {
    const { date, hour } = cairoNow();
    const targetDate = hour >= 23 ? date
      : new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    if (lastSnapshotCheck === targetDate) return; // فحصناه بالفعل هذه الدورة
    const { rows } = await pool.query(
      `SELECT 1 FROM regularized_daily WHERE snapshot_date = $1 LIMIT 1`, [targetDate],
    );
    if (rows.length === 0) {
      // بنسجّل بس لو احنا لسه فى نفس اليوم المستهدف (الساعة ≥ 23) — الاستعلامات
      // بتحسب «المنتظم النهارده» من دلوقتى، فتسجيل يوم فات بعد منتصف الليل كان
      // بيكتب بيانات اليوم الجديد بتاريخ الأمس ويمنع الصح من التسجيل للأبد
      // (ON CONFLICT DO NOTHING). يوم فات السيرفر نايم فيه مش قابل للاسترجاع.
      if (hour >= 23) {
        const r = await recordDailySnapshot(targetDate);
        console.log(`[daily-snapshot] recorded ${targetDate}:`, r);
      } else {
        console.warn(`[daily-snapshot] ${targetDate} مافيهوش لقطة والوقت عدّى — مش هنسجّل بيانات غلط بدلها`);
      }
    }
    lastSnapshotCheck = targetDate;
  } catch (e: any) {
    console.error("[daily-snapshot] check failed:", e.message);
  }
}

// يبدأ جدولة الحفظ اليومى: تعويض فورى عند الإقلاع + فحص كل 15 دقيقة.
// (cron داخلى — عند صحيان السيرفر يلتقط لقطة الساعة 11 خلال 15 دقيقة كحد أقصى،
//  ولو كان نائماً يُعوّض بمجرد وصول أى طلب يوقظه.)
function startDailySnapshotScheduler() {
  setTimeout(checkAndSnapshot, 10_000);           // بعد الإقلاع بقليل
  setInterval(checkAndSnapshot, 15 * 60 * 1000);  // كل 15 دقيقة
}

// ── Cable-Fault-Manager live proxy ──────────────────────────────────────────
const CFM_BASE = "https://cable-fault-manager.replit.app";
const CFM_CREDS = { username: "admin", password: "Mon_oskar11" };
let cfmCookie: string | null = null;

async function cfmLogin() {
  const res = await fetch(`${CFM_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(CFM_CREDS),
  });
  if (!res.ok) throw new Error(`CFM login failed: ${res.status}`);
  const cookies: string[] =
    typeof (res.headers as any).getSetCookie === "function"
      ? (res.headers as any).getSetCookie()
      : (res.headers.get("set-cookie") ?? "").split(/,(?=[^ ])/).filter(Boolean);
  cfmCookie = cookies.map((c: string) => c.split(";")[0].trim()).join("; ");
  if (!cfmCookie) throw new Error("CFM login: no cookie received");
}

async function cfmFetch(path: string): Promise<Response> {
  if (!cfmCookie) await cfmLogin();
  let r = await fetch(`${CFM_BASE}${path}`, { headers: { Cookie: cfmCookie! } });
  if (r.status === 401 || r.status === 403) {
    cfmCookie = null;
    await cfmLogin();
    r = await fetch(`${CFM_BASE}${path}`, { headers: { Cookie: cfmCookie! } });
  }
  return r;
}

// ── Maintenance (نظام صيانة البوكسات) live proxy ─────────────────────────────
// موقع الصيانة بقى مدمج جوّه Service-Flow تحت /maintenance (نفس السيرفر ونفس القاعدة)، فبنكلّم
// النسخة المحلّية بدل الـ Repl القديم اللى اتقفل. يمكن override بـ MAINTENANCE_API_BASE لو اتفصل.
const MAINT_BASE  = process.env.MAINTENANCE_API_BASE
  || `http://127.0.0.1:${process.env.PORT || 5000}/maintenance`;
const MAINT_TOKEN = process.env.MAINTENANCE_API_TOKEN || "sf-comprehensive-2026-GHNAT-7Kx9";

async function maintFetch(path: string): Promise<Response> {
  return fetch(`${MAINT_BASE}${path}`, { headers: { "X-API-Token": MAINT_TOKEN } });
}

// تفكيك رقم البكس فى تذاكر Cable Guardian إلى قائمة أرقام بكسات:
//   "1:15" → من 1 إلى 15 (مدى)   |   "1&15" → [1, 15] (مجموعة)   |   "5" → [5]
function parseTicketBoxes(boxStr: string | null | undefined): string[] {
  if (!boxStr) return [];
  const s = String(boxStr).trim();
  if (!s) return [];
  // مدى: 1:15
  if (s.includes(":")) {
    const parts = s.split(":").map((x) => parseInt(x.replace(/[^0-9]/g, ""), 10));
    const [a, b] = parts;
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const out: string[] = [];
      for (let i = lo; i <= hi && i - lo < 1000; i++) out.push(String(i));
      return out;
    }
  }
  // مجموعة: 1&15 (أو 1،15 / 1,15)
  if (/[&،,]/.test(s)) {
    return s.split(/[&،,]/).map((x) => x.replace(/[^0-9]/g, "")).filter(Boolean);
  }
  // بكس واحد
  const single = s.replace(/[^0-9]/g, "");
  return single ? [single] : [];
}

// توحيد اسم السنترال للمطابقة بين النظامين (إزالة المسافات حول الشرطات)
function normCentral(s: string | null | undefined): string {
  return String(s ?? "").replace(/\s+/g, "").trim();
}

// تجميع مجاميع القياسات لكل (سنترال، كابينة، بكس) للخطوط التى لها أكونت — مع كاش قصير
let boxAggCache: { at: number; map: Map<string, { sum: number; measured: number; lines: number }> } | null = null;
async function getBoxScoreAgg() {
  const now = Date.now();
  if (boxAggCache && now - boxAggCache.at < 60_000) return boxAggCache.map;
  const { rows } = await pool.query(`
    SELECT t.central, t.cabin_number, t.box_number,
           COUNT(*) FILTER (WHERE t.score IS NOT NULL AND t.score <= 100)::int AS measured,
           COALESCE(SUM(t.score) FILTER (WHERE t.score IS NOT NULL AND t.score <= 100), 0)::numeric AS sum_score,
           COUNT(*)::int AS lines
    FROM (
      SELECT pl.central, pl.cabin_number, pl.box_number, pl.full_phone,
        (SELECT c.score FROM case_138 c WHERE c.full_phone = pl.full_phone ORDER BY c.id DESC LIMIT 1) AS score
      FROM line_accounts la
      JOIN phone_lines pl ON pl.full_phone = la.full_phone
    ) t
    GROUP BY t.central, t.cabin_number, t.box_number
  `);
  const map = new Map<string, { sum: number; measured: number; lines: number }>();
  for (const r of rows) {
    const key = `${normCentral(r.central)}|${String(r.cabin_number ?? "").trim()}|${String(r.box_number ?? "").trim()}`;
    map.set(key, { sum: Number(r.sum_score) || 0, measured: Number(r.measured) || 0, lines: Number(r.lines) || 0 });
  }
  boxAggCache = { at: now, map };
  return map;
}
// ────────────────────────────────────────────────────────────────────────────

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // === WebSocket Setup ===
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const broadcast = (data: any) => {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');
    ws.on('error', console.error);
  });

  // أى رفع ملف ناجح (POST /api/*/import…) بيبعت إشعار لكل المتصفحات المفتوحة، فالتقارير
  // المعتمدة على الملف ده تتحدّث لوحدها فوراً — من غير ما تعمل refresh أو تضغط «تحديث».
  // متسجّل هنا (قبل أى app.post للرفع) عشان يلفّها كلها — الموجودة دلوقتى وأى واحدة تتضاف
  // بعدين — بدل ما نكرّر broadcast فى نهاية كل handler وننسى واحد.
  app.use((req, res, next) => {
    if (req.method === "POST" && /^\/api\/[^/]+\/import/.test(req.path)) {
      res.on("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          broadcast({ type: WS_EVENTS.DATA_IMPORT, payload: { key: req.path } });
        }
      });
    }
    next();
  });

  // Notify the sales rep who created the order + all admins when an order
  // becomes feasible (by tech or external affairs).
  const notifyOrderFeasible = async (order: any, source: "tech" | "external") => {
    const sourceLabel = source === "external" ? "الشئون الخارجية" : "القسم الفني";
    const recipientIds = new Set<number>();
    if (order.salesId) recipientIds.add(order.salesId); // موظف المبيعات اللى نزّل الطلب
    // الأدمن + السوبر أدمن + أدمن المبيعات (يشوف كل إشعارات الطلبات)
    const admins = (await storage.getUsers()).filter(
      (u) => u.role === ROLES.ADMIN || u.role === ROLES.SUPER_ADMIN || u.role === ROLES.SALES_ADMIN,
    );
    admins.forEach((a) => recipientIds.add(a.id));

    await Promise.all(
      Array.from(recipientIds).map((userId) =>
        storage.createNotification({
          userId,
          orderId: order.id,
          type: "order_feasible",
          message: `طلب العميل ${order.customerName} أصبح قابلاً للتنفيذ (${sourceLabel})`,
        }),
      ),
    );
    broadcast({ type: WS_EVENTS.NOTIFICATION });
  };

  // === Auth Setup ===
  async function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
  }

  async function comparePassword(supplied: string, stored: string) {
    const [hashed, salt] = stored.split(".");
    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
    return timingSafeEqual(hashedBuf, suppliedBuf);
  }

  // Seed users if they don't exist
  const seedUsers = async () => {
    const roles = [
      { user: "sales", pass: "sales", role: ROLES.SALES },
      { user: "tech", pass: "tech", role: ROLES.TECH },
      { user: "admin", pass: "admin", role: ROLES.ADMIN },
      { user: "superadmin", pass: "Mon_oskar11", role: ROLES.SUPER_ADMIN },
    ];

    for (const r of roles) {
      const existing = await storage.getUserByUsername(r.user);
      if (!existing) {
        const password = await hashPassword(r.pass);
        await storage.createUser({ username: r.user, password, role: r.role });
        console.log(`Created user: ${r.user}`);
      }
    }
  };
  seedUsers();

  app.use(
    session({
      store: buildSessionStore(),
      secret: process.env.SESSION_SECRET || "super-secret-session-key",
      resave: false,
      saveUninitialized: false,
      rolling: true, // كل طلب (ومنه التحديث التلقائى كل نص ساعة) يمدّد عمر الجلسة
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // أسبوع
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // === Cable-Fault-Manager (CFM) المدموج — راوتس تحت /api/cfm/* (تعيد استخدام نفس الجلسة) ===
  registerCfmRoutes(app);

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user) return done(null, false);
        if (user.suspended) return done(null, false, { message: "User is suspended" });
        const isValid = await comparePassword(password, user.password);
        if (!isValid) return done(null, false);
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user: any, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  // 🆕 يضيف اسم الفني (tech_name) للمستخدم — من رقم العامل عبر technician_names — عشان
  // الواجهة تقدر تفلتر تقارير الفني على بياناته. fallback: اسم المستخدم لو مفيش رقم عامل/تطابق.
  async function userResponse(user: any) {
    if (!user) return user;
    if (user.role === ROLES.TECH) {
      const c = await coverageCodes(user);
      return { ...user, techName: c.techName ?? user.username, coveredTechNames: c.coveredNames };
    }
    return { ...user, techName: null, coveredTechNames: [] };
  }

  // تغطية الفنى: own = كوده (كل خطوطه) ؛ covered = أكواد الزملاء المشمولين (منح دائمة + تغطية اليوم
  // من جدول الورديات: زميل «راحه/إجازة» اليوم والمستخدم هو «القائم بالعمل»). خطوط الزملاء متاحة
  // **فقط** لو عليها عطل حالى أو عطل خارج الشاشة مفتوح — يُتحقّق فى استعلام البحث. coveredNames للعرض.
  async function coverageCodes(user: any): Promise<{ techName: string | null; own: string[]; covered: string[]; coveredNames: string[] }> {
    const own = new Set<string>();
    const covered = new Set<string>();
    const coveredNames = new Set<string>();
    const ownCode = String(user?.workerCode || "").trim();
    if (ownCode) own.add(ownCode);
    let techName: string | null = null;
    if (user?.role === ROLES.TECH) {
      if (ownCode) {
        try { const r = await pool.query(`SELECT tech_name FROM technician_names WHERE worker_code = $1 ORDER BY id DESC LIMIT 1`, [ownCode]); techName = r.rows[0]?.tech_name ?? null; } catch (e) {}
      }
      if (!techName) techName = user?.username ?? null;
      if (techName) {
        const tn = String(techName).trim();
        // (1) منح التغطية الدائمة
        try {
          const { rows } = await pool.query(
            `SELECT DISTINCT g.covered_tech_name AS name, tnm.worker_code AS code
             FROM tech_coverage_grants g
             LEFT JOIN technician_names tnm ON btrim(tnm.tech_name) = btrim(g.covered_tech_name)
             WHERE btrim(g.grantee_tech_name) = btrim($1)`, [tn]);
          for (const r of rows) { if (r.name) coveredNames.add(String(r.name).trim()); if (r.code) covered.add(String(r.code).trim()); }
        } catch (e) {}
        // (2) تغطية اليوم من جدول الورديات: زميل «راحه/إجازة» النهارده والمستخدم هو القائم بالعمل
        try {
          const { rows } = await pool.query(
            `SELECT DISTINCT s.tech_name AS name, tnm.worker_code AS code
             FROM shift_schedules s
             LEFT JOIN technician_names tnm ON btrim(tnm.tech_name) = btrim(s.tech_name)
             CROSS JOIN LATERAL (
               SELECT (now() AT TIME ZONE 'Africa/Cairo')::date AS today,
                      ((EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Cairo'))::int - 5 + 7) % 7) AS di
             ) d
             WHERE s.week_start = d.today - d.di
               AND btrim(COALESCE(s.covers->>d.di, '')) = btrim($1)
               AND COALESCE(s.days->>d.di, '') IN (${SHIFT_COVER_STATES_SQL})`, [tn]);
          for (const r of rows) { if (r.name) coveredNames.add(String(r.name).trim()); if (r.code) covered.add(String(r.code).trim()); }
        } catch (e) {}
      }
    }
    return { techName, own: [...own], covered: [...covered], coveredNames: [...coveredNames] };
  }

  // يجهّز جلسة الكوابل تلقائياً بعد الدخول على الطلبات لو دور المستخدم يفتح الكوابل
  // (super_admin/admin → admin كوابل، external/tech → شئون خارجية...). يستخدم الحساب
  // المربوط (cfm_user_id) وإلا أول حساب كوابل بنفس الدور. إضافى — لو فشل يتجاهل بهدوء.
  async function setupCfmSessionForSf(req: any) {
    try {
      const sfUser = req.user;
      // امسح أى جلسة كوابل قديمة دايماً (عشان مستخدم جديد على نفس الجلسة مايرثش
      // صلاحية اللى قبله — الفنى كان بياخد أدمن من جلسة سوبر أدمن سابقة)
      delete (req.session as any).cfmUser;
      if (!sfUser) return;
      const cfmRole = cfmRoleOf(sfUser.role);
      if (!cfmRole) return;
      let cfmUser: any = null;
      // 1) الحساب المربوط يدوياً
      if (sfUser.cfmUserId) {
        const { rows } = await pool.query(`SELECT * FROM cfm_users WHERE id = $1 LIMIT 1`, [sfUser.cfmUserId]);
        cfmUser = rows[0] || null;
      }
      // 2) حساب كوابل بنفس اسم المستخدم (يربطه) — عشان يظهر باسمه هو مش باسم حساب تانى
      if (!cfmUser) {
        const { rows } = await pool.query(`SELECT * FROM cfm_users WHERE username = $1 LIMIT 1`, [sfUser.username]);
        cfmUser = rows[0] || null;
        if (cfmUser) await pool.query(`UPDATE users SET cfm_user_id = $1 WHERE id = $2`, [cfmUser.id, sfUser.id]).catch(() => {});
      }
      // 3) مالوش حساب كوابل → أنشئ واحد بهويته والدور المقابل (يظهر باسمه ويقدر ينشئ تذاكر باسمه)
      if (!cfmUser) {
        const ph = bcryptjs.hashSync(randomBytes(24).toString("hex"), 10);
        const ins = await pool.query(
          `INSERT INTO cfm_users (id, username, password, name, role, is_initial_password, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, $1, $3, false, now())
           ON CONFLICT (username) DO NOTHING RETURNING *`,
          [sfUser.username, ph, cfmRole],
        );
        cfmUser = ins.rows[0]
          || (await pool.query(`SELECT * FROM cfm_users WHERE username = $1 LIMIT 1`, [sfUser.username])).rows[0]
          || null;
        if (cfmUser) await pool.query(`UPDATE users SET cfm_user_id = $1 WHERE id = $2`, [cfmUser.id, sfUser.id]).catch(() => {});
      }
      if (cfmUser) {
        // نفس شكل مستخدم CFM (camelCase) عشان الواجهة تشتغل زى الدخول العادى
        (req.session as any).cfmUser = {
          id: cfmUser.id, username: cfmUser.username, password: cfmUser.password,
          name: cfmUser.name, role: cfmUser.role, avatar: cfmUser.avatar ?? null,
          isInitialPassword: cfmUser.is_initial_password ?? false, createdAt: cfmUser.created_at,
        };
      }
    } catch {}
  }

  // === Auth Routes ===
  app.post(api.auth.login.path, passport.authenticate("local"), async (req, res) => {
    await setupCfmSessionForSf(req);
    res.json(await userResponse(req.user));
  });

  // === البوابة الموحّدة: دخول واحد يشتغل على الموقعين (إضافى — مايلمسش الدخول القديم) ===
  // يجرّب حساب الطلبات (scrypt) الأول؛ ولو الدور بيفتح الكوابل + مربوط بحساب كوابل يجهّز
  // جلسة الكوابل كمان. ولو مش لاقيه فى الطلبات يجرّب حسابات الكوابل (bcrypt) — دخول كوابل فقط.
  app.post("/api/portal/login", async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) return res.status(400).json({ message: "اسم المستخدم وكلمة السر مطلوبين" });

      // 1) حساب الطلبات (Service-Flow)
      const sfUser = await storage.getUserByUsername(String(username));
      if (sfUser && !sfUser.suspended && await comparePassword(String(password), sfUser.password)) {
        await new Promise<void>((resolve, reject) =>
          (req as any).login(sfUser, (e: any) => (e ? reject(e) : resolve())));
        // لو الدور بيفتح الكوابل + مربوط بحساب كوابل → جهّز جلسة الكوابل بهويته الأصلية
        const cfmRole = cfmRoleOf(sfUser.role);
        if (cfmRole && (sfUser as any).cfmUserId) {
          try {
            const { rows } = await pool.query(`SELECT * FROM cfm_users WHERE id = $1 LIMIT 1`, [(sfUser as any).cfmUserId]);
            if (rows[0]) (req.session as any).cfmUser = rows[0];
          } catch {}
        }
        return res.json({
          sites: sitesForRole(sfUser.role),
          sfRole: sfRoleOf(sfUser.role),
          cfmRole,
          user: await userResponse(req.user),
        });
      }

      // 2) حساب الكوابل فقط (CFM) — bcrypt
      const { rows: cfmRows } = await pool.query(`SELECT * FROM cfm_users WHERE username = $1 LIMIT 1`, [String(username)]);
      const cfmUser = cfmRows[0];
      if (cfmUser && await bcryptjs.compare(String(password), cfmUser.password)) {
        (req.session as any).cfmUser = cfmUser;
        return res.json({ sites: ["cfm"], sfRole: null, cfmRole: cfmUser.role, user: null });
      }

      return res.status(401).json({ message: "اسم المستخدم أو كلمة السر غير صحيحة" });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "خطأ فى الدخول" });
    }
  });

  app.post(api.auth.logout.path, (req, res, next) => {
    delete (req.session as any).cfmUser; // امسح جلسة الكوابل كمان
    req.logout((err) => {
      if (err) return next(err);
      res.json({ message: "Logged out" });
    });
  });

  // GET /logout — تسجيل خروج كامل للاستخدام من المواقع المدمجة (الصيانة/الكوابل) عبر تنقّل صفحة
  // كاملة: يمسح جلسة الطلبات (passport) + جلسة الكوابل ثم يوجّه لصفحة دخول الطلبات. لازم يكون
  // مُسجَّل قبل الـ SPA catch-all عشان السيرفر يمسكه بدل ما React يرندر صفحة.
  app.get("/logout", (req: any, res, next) => {
    delete (req.session as any).cfmUser;
    req.logout((err: any) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.redirect("/login");
      });
    });
  });

  app.get(api.auth.me.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(await userResponse(req.user));
  });

  // === Middleware ===
  const requireAuth = (req: any, res: any, next: any) => {
    if (req.isAuthenticated()) return next();
    res.sendStatus(401);
  };

  // الأدمن الأعلى (super_admin) بيعدّى أى فحص أدمن (وصول كامل)
  const hasAdminAccess = (role: string) => role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN;
  // مين يقدر يتحكّم في مين: الأدمن الأعلى يتحكّم في الكل. الأدمن العادى في باقى المستخدمين فقط
  // (مش الأدمنز ولا الأدمنز الأعلى).
  const canManageTarget = (requesterRole: string, targetRole: string) => {
    if (requesterRole === ROLES.SUPER_ADMIN) return true;                 // الأدمن الأعلى: الكل
    if (requesterRole === ROLES.SALES_ADMIN) return targetRole === ROLES.SALES; // أدمن المبيعات: مستخدمى المبيعات فقط
    return targetRole !== ROLES.ADMIN && targetRole !== ROLES.SUPER_ADMIN; // الأدمن العادى: كله ما عدا الأدمنز
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && hasAdminAccess(req.user.role)) return next();
    res.status(403).json({ message: "Admin access required" });
  };

  // إدارة المستخدمين: الأدمن/الأدمن الأعلى + أدمن المبيعات (الأخير لمستخدمى المبيعات فقط)
  const requireUserManager = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && (hasAdminAccess(req.user.role) || req.user.role === ROLES.SALES_ADMIN)) return next();
    res.status(403).json({ message: "Admin access required" });
  };

  const requireTechOrAdmin = (req: any, res: any, next: any) => {
    // الشئون الخارجية (external) تعمل زى الفنى فى البيانات الفنية (تعديل الخطوط/المهمات)
    if (req.isAuthenticated() && (req.user.role === ROLES.TECH || req.user.role === ROLES.EXTERNAL || hasAdminAccess(req.user.role))) return next();
    res.status(403).json({ message: "Tech or Admin access required" });
  };

  const requireDataManager = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && req.user.role === ROLES.DATA_MANAGER) return next();
    res.status(403).json({ message: "Data Manager access required" });
  };

  // === Cross-origin auto-upload (Tampermonkey) ===
  const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || "sf-auto-upload-2026";
  const setUploadCors = (res: any) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Upload-Token");
  };
  // Allows either admin session OR shared token (for Tampermonkey auto-upload)
  const requireAdminOrToken = (req: any, res: any, next: any) => {
    if (req.headers["x-upload-token"] === UPLOAD_TOKEN) { setUploadCors(res); return next(); }
    if (req.isAuthenticated() && hasAdminAccess(req.user.role)) return next();
    res.status(403).json({ message: "Admin access required" });
  };

  // === طابور التنفيذ المركزى (رفع سرعة / قياس / إيقاف) ===
  // جهاز التنفيذ = براوزر سوبر أدمن مفعّل الزر، بيبعت نبضة (heartbeat) ويسحب المهام وينفّذها.
  // أى مستخدم تانى بيضيف مهمة للطابور بدل ما ينفّذ على جهازه.
  const requireSuperAdmin = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && req.user.role === ROLES.SUPER_ADMIN) return next();
    res.status(403).json({ message: "Super admin only" });
  };
  // «الموقع» = **الدومين** اللى المهمة بتفتحه، مهما كانت بتعمل إيه. الطابور بينفّذ مهمة
  // واحدة لكل دومين فى نفس الوقت (تابين من نفس الموقع بيتعارضوا: نفس الجلسة/الكوكيز/الشاشة)،
  // ودومينات مختلفة بتشتغل بالتوازى.
  // ملاحظات مقصودة:
  //  - القياس ورفع السرعة والإيقاف كلهم على 10.42.187.101 (DZS + AXON PO) → مسار واحد.
  //  - غيّر البورت + تحديث البورت + تحديث ملف البورتات كلهم provisioningportal.te.eg → مسار واحد.
  //  - إلغاء الإسناد (Dispatcher) + تقارير WFM + تحديث أوامر الشغل كلهم wfm.te.eg → مسار واحد.
  const SITE_OF_TYPE: Record<string, string> = {
    measure: "10.42.187.101", raise: "10.42.187.101", stop: "10.42.187.101",
    subinfo: "fcc.te.eg", fccdaily: "fcc.te.eg",
    c360: "customer360.te.eg",
    portchange: "provisioningportal.te.eg", portcheck: "provisioningportal.te.eg", ports: "provisioningportal.te.eg",
    wfmcancel: "wfm.te.eg", wfmreport: "wfm.te.eg", wfmdaily: "wfm.te.eg",
    ossdaily: "oss.te.eg",
    weoas: "we-oas.te.eg",
  };
  const ALL_JOB_TYPES = Object.keys(SITE_OF_TYPE);
  // أنواع مابتتقسّمش رقم-رقم: السكربت بتاعها بيلفّ على كل الأرقام جوّه نفس التاب (تسجيل دخول
  // واحد)، فتقسيمها يعنى فتح الموقع وتسجيل دخول لكل رقم — بطىء جداً وبلا فايدة.
  const NO_SPLIT_TYPES = new Set(["c360"]);
  // تحديث الملفات (اليومى + كل نص ساعة): أولوية قصوى وبتقاطع الشغل الجارى على نفس الدومين.
  const DAILY_TYPES = new Set(["ports", "fccdaily", "wfmdaily", "ossdaily", "weoas"]);

  // نافذة «الجهاز مفعّل». النبضة كل ٢٠ ثانية، لكن المتصفح بيخنق مؤقتات التاب
  // اللى فى الخلفية لمرة كل دقيقة (وأكتر مع Sleeping tabs) — فنافذة الـ ٤٥ ثانية
  // القديمة كانت بتقول «مفيش جهاز مفعّل» والتاب شغّال فعلاً. دقيقتين ونص بتستوعب
  // الخنق من غير ما تخفى جهاز واقف فعلاً (وإيقاف التفعيل بيمسح النبضة فوراً برضه).
  const EXEC_ACTIVE_WINDOW = "interval '150 seconds'";

  // نبضة جهاز التنفيذ (كل ~20ث) — تُخزَّن فى app_state
  app.post("/api/exec-queue/heartbeat", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      await pool.query(
        `INSERT INTO app_state (key, value, updated_at) VALUES ('exec_heartbeat', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
        // «اسم المستخدم · المتصفح/النظام · معرّف الجهاز» — عشان يبان الجهاز المفعّل
        [execIdentity(req)],
      );
      // «رمز إعادة التحميل»: أى سوبر أدمن (من الموبايل مثلاً) يقدر يطلب ريفريش لمتصفح
      // جهاز التنفيذ. بنرجّع الرمز الحالى مع النبضة، والجهاز بيقارنه باللى شايله:
      // أول نبضة بيسجّله وبس، وأى **تغيير** بعد كده معناه فيه طلب جديد → يعمل reload.
      // بنركب على النبضة الموجودة (كل ~20 ثانية) فمفيش أى استعلام أو اتصال إضافى.
      const { rows: rl } = await pool.query(`SELECT value FROM app_state WHERE key = 'exec_reload'`);
      res.json({ ok: true, reload: rl[0]?.value ?? null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/exec-queue/request-reload — اطلب ريفريش لمتصفح جهاز التنفيذ (سوبر أدمن).
  // بيتنفّذ خلال أقل من نبضة (~20 ثانية). لو الجهاز مش مفعّل بيرجّع active=false
  // عشان المستخدم يعرف إن مفيش حد هيستقبل الطلب.
  app.post("/api/exec-queue/request-reload", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      const token = new Date().toISOString() + "|" + String(req.user?.username || "");
      await pool.query(
        `INSERT INTO app_state (key, value, updated_at) VALUES ('exec_reload', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`, [token]);
      const { rows } = await pool.query(
        `SELECT (now() - updated_at < ${EXEC_ACTIVE_WINDOW}) AS active, value,
                EXTRACT(EPOCH FROM (now() - updated_at)) AS since
           FROM app_state WHERE key = 'exec_heartbeat'`);
      // lastSeenSec بيخلّى الرسالة تقول «آخر نبضة من ٧ دقايق» بدل «مفيش جهاز» —
      // فرق مهم: الأولى معناها التاب متجمّد، والتانية معناها مفيش جهاز أصلاً.
      res.json({
        ok: true, active: !!rows[0]?.active, executor: rows[0]?.value ?? null,
        lastSeenSec: rows.length ? Number(rows[0].since) : null,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  // حالة جهاز التنفيذ: مفعّل لو فيه نبضة خلال نافذة الحياة
  app.get("/api/exec-queue/status", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT value, updated_at, (now() - updated_at < ${EXEC_ACTIVE_WINDOW}) AS active,
                EXTRACT(EPOCH FROM (now() - updated_at)) AS since
         FROM app_state WHERE key = 'exec_heartbeat'`);
      const r = rows[0];
      res.json({
        active: !!r?.active, executor: r?.active ? r.value : null,
        lastSeenSec: r ? Number(r.since) : null, lastExecutor: r?.value ?? null,
      });
    } catch { res.json({ active: false, executor: null, lastSeenSec: null }); }
  });
  // إضافة مهمة للطابور
  app.post("/api/exec-queue/enqueue", requireAuth, async (req: any, res) => {
    try {
      const { type, accounts, note, params: jobParams } = req.body || {};
      // subinfo = مراجعة اسم/عنوان العميل من FCC (زر «مراجعة» فى بحث برقم التليفون).
      // «الأرقام» هنا أرقام تليفون مش أرقام أكونت، لكن الطابور بيتعامل معاها بنفس الطريقة.
      if (!ALL_JOB_TYPES.includes(type)) return res.status(400).json({ message: "نوع غير صحيح" });
      const uniqAccs = [...new Set((Array.isArray(accounts) ? accounts : []).map((a: any) => String(a).trim()).filter(Boolean))];
      if (!uniqAccs.length) return res.status(400).json({ message: "لا توجد أرقام" });
      // منع تكرار تحديث نفس الملف: لو فيه مهمة تحديث بنفس النوع لسه فى الطابور (منتظرة أو
      // شغّالة) مانضيفش تانية — التحديث الدورى ممكن يتنادى من أكتر من تاب فى نفس اللحظة.
      if (DAILY_TYPES.has(type)) {
        const { rows: dup } = await pool.query(
          `SELECT id FROM exec_jobs WHERE type = $1 AND status IN ('pending','claimed') LIMIT 1`, [type]);
        if (dup.length) return res.json({ ok: true, id: dup[0].id, count: 0, duplicate: true });
      }
      const user = String(req.user.username || "");
      // نقسّم **دايماً** لمهام خط-خط (كل خط مهمة). أولوية الطلب: طلب صغير (≤3 خطوط) = عاجل (1)
      // يتخطّى مهام الباتش؛ باتش كبير (>3) = عادى (0). المنفّذ يبعت رقم-رقم حسب الأولوية، ويخلّص كل
      // خط كامل قبل اللى بعده (مفيش تداخل)، وكل خط فى نفس النافذة (DZS بيقيس خط واحد مفيش chaining).
      // batchId يجمّع كل مهام الطلب الواحد → لتتبّع «تم X من N».
      // أولوية بثلاث درجات:
      //   2 = طلب صغير (≤3 خطوط) من أى تقرير → أعلى أولوية دايماً.
      //   1 = خطوط من تقرير «محتاجة رفع سرعة» (قياس/رفع/إيقاف) حتى لو أكثر من 3.
      //   0 = باتش كبير (>3) من أى تقرير آخر → أقل أولوية، والسوبر أدمن يتحكم فى ترتيبه (queue_order).
      const isNeedsSpeed = /محتاجة رفع سرعة/.test(String(note || ""));
      // 3 = تحديث الملفات اليومية/الدورية: أعلى أولوية على الإطلاق وبتقاطع أى مهمة شغّالة على
      // **نفس الدومين** (مثلاً تحديث ملفات FCC بيوقف مراجعة البيان الفنى، والمراجعة بتكمّل بعده).
      const priority = DAILY_TYPES.has(type) ? 3 : (uniqAccs.length <= 3 ? 2 : (isNeedsSpeed ? 1 : 0));
      const batchId = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const site = SITE_OF_TYPE[type] || "10.42.187.101";
      // أنواع NO_SPLIT بتتحوّل لمهمة واحدة بكل الأرقام (السكربت بيلفّ عليها جوّه نفس التاب).
      const groups: string[][] = NO_SPLIT_TYPES.has(type) ? [uniqAccs] : uniqAccs.map((a) => [a]);
      const extra = jobParams && typeof jobParams === "object" ? JSON.stringify(jobParams) : null;
      // الجهاز اللى اتبعت منه الطلب — بيتسجّل مع المهمة نفسها عشان الرقابة تعرف
      // العملية طُلبت من أى جهاز/متصفح (مش جهاز التنفيذ اللى بينفّذها).
      const from = execIdentity(req);
      const params: any[] = [type, user, note || null, priority, batchId, site, extra, from];
      const valueSql = groups.map((g) => { params.push(JSON.stringify(g)); return `($1, $${params.length}::jsonb, $2, $3, $4, $5, $6, $7::jsonb, $8)`; }).join(",");
      const { rows } = await pool.query(
        `INSERT INTO exec_jobs (type, accounts, requested_by, note, priority, batch_id, site, params, requested_from)
         VALUES ${valueSql} RETURNING id`,
        params);
      res.json({ ok: true, id: rows[0].id, count: uniqAccs.length, split: rows.length, batchId });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  // هوية جهاز التنفيذ: «اسم المستخدم · المتصفح/النظام · معرّف الجهاز». الجزء التانى
  // بيبعته المتصفح نفسه (execDeviceLabel)، ولو مابعتش بنرجع لـ user-agent الخام.
  const execIdentity = (req: any): string => {
    const user = String(req?.user?.username || "").trim() || "غير معروف";
    const dev = String(req?.body?.device || "").trim();
    if (dev) return `${user} · ${dev}`;
    const ua = String(req?.headers?.["user-agent"] || "").slice(0, 120).trim();
    return ua ? `${user} · ${ua}` : user;
  };

  // جهاز التنفيذ يسحب أقدم مهمة (atomic) — SKIP LOCKED
  app.post("/api/exec-queue/claim", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      // نظّف المهام اليتيمة قبل السحب — عشان أى مهمة عالقة ترجع للطابور وتتنفّذ فى مكانها
      // الصحيح حسب الأولوية، بدل ما الجهاز يعدّيها ويكمّل فى باتشات أقل أولوية.
      await expireOrphanedExecJobs();
      // وبعدها: رجّع الخطوط اللى قفلت بإيرور من باتشات خلصت (مرة واحدة، أولوية 1)
      await requeueErroredJobs();
      // ⚠️ فحص «الدومين فاضى» (NOT EXISTS) والـ UPDATE كانوا فى جملة واحدة — فيها الـ
      // planner حر يقرّر ترتيب تقييم الشروط، فمفيش ضمان إن فحص NOT EXISTS بيحصل بعد أى
      // قفل. النتيجة: تسابق حقيقى (مُثبت على Postgres حقيقى بجملتين متزامنتين): جهازين
      // (أو تابين فى نفس الطلب) يسحبوا مهمتين لنفس الموقع (fcc.te.eg) فى نفس اللحظة —
      // وده بالظبط اللى كان بيفتح تابين مراجعة على نفس جلسة FCC ويلخبط خانة البحث
      // (أرقام بتتلزّق ورا بعض فى الحقل، لأن ADF بيشارك الـ view state بين التابات).
      // الإصلاح: قفل transaction-level فى استعلام BEGIN منفصل *قبل* فحص NOT EXISTS —
      // بيضمن إن السحب لأى موقع يبقى متسلسل بالكامل مهما كان عدد التابات/الأجهزة.
      const row = await withTx(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(872634501)");
        const { rows } = await tx.query(
          `UPDATE exec_jobs SET status = 'claimed', claimed_at = now(), executed_by = $1
           WHERE id = (SELECT e.id FROM exec_jobs e
                        WHERE e.status = 'pending' AND e.paused_at IS NULL
                          -- الدومين لازم يكون فاضى: مفيش مهمة شغّالة على نفس الموقع دلوقتى
                          AND NOT EXISTS (SELECT 1 FROM exec_jobs b
                                           WHERE b.status = 'claimed'
                                             AND COALESCE(b.site, '10.42.187.101') = COALESCE(e.site, '10.42.187.101'))
                        ORDER BY e.priority DESC,
                                 CASE WHEN e.queue_order > 0 THEN e.queue_order ELSE 9223372036854775807 END ASC,
                                 e.created_at, e.id
                        LIMIT 1 FOR UPDATE SKIP LOCKED)
           RETURNING id, type, accounts, requested_by AS "requestedBy", note, priority, site, params`,
          [execIdentity(req)]);
        return rows[0] || null;
      });
      res.json(row);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  // تعليم مهمة كمنفّذة
  app.post("/api/exec-queue/:id/done", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      // result اختيارى: done | tab_closed | timeout — بيوضّح إن كان القياس خلص فعلاً ولا اتقفل قبل ما يخلص
      const result = String((req.body || {}).result || "").trim() || null;
      await pool.query(`UPDATE exec_jobs SET status = 'done', done_at = now(), result = $2 WHERE id = $1`, [parseInt(req.params.id), result]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  // تأكيد تحديث القياس: آخر وقت قياس (case_138.uploaded_at) لرقم أكونت — جهاز التنفيذ
  // بيقارنه بالوقت قبل الفتح عشان يتأكد إن القياس اتحدّث قبل ما يعدّى للخط اللى بعده.
  app.get("/api/exec-queue/measure-check", requireAuth, async (req, res) => {
    try {
      const acc = String(req.query.account || "").trim();
      if (!acc) return res.json({ at: null });
      const { rows } = await pool.query(`SELECT MAX(uploaded_at) AS at FROM case_138 WHERE account_no = $1`, [acc]);
      res.json({ at: rows[0]?.at || null });
    } catch { res.json({ at: null }); }
  });

  // تأكيد رفع السرعة/إيقاف PO: آخر وقت رفع/إيقاف (line_po_events) لرقم أكونت — صفحة البحث
  // بتقارنه بالوقت قبل الإرسال عشان تعرف إن العملية اتنفّذت فعلاً وتحدّث الصفحة تلقائياً.
  app.get("/api/exec-queue/po-check", requireAuth, async (req, res) => {
    try {
      const acc = String(req.query.account || "").trim();
      const event = String(req.query.event || "").trim().toLowerCase();
      if (!acc || (event !== "raise" && event !== "stop")) return res.json({ at: null });
      const col = event === "raise" ? "last_raise_at" : "last_stop_at";
      const { rows } = await pool.query(`SELECT ${col} AS at FROM line_po_events WHERE account_no = $1`, [acc]);
      res.json({ at: rows[0]?.at || null });
    } catch { res.json({ at: null }); }
  });

  // تأكيد المراجعة: آخر وقت جلب اسم/عنوان لرقم تليفون من FCC (line_subscriber_info.fetched_at).
  // جهاز التنفيذ بيقارنه بالوقت قبل الفتح عشان يعرف إن المراجعة خلصت فعلاً.
  app.get("/api/exec-queue/subinfo-check", requireAuth, async (req, res) => {
    try {
      const phone = String(req.query.phone || "").trim();
      if (!phone) return res.json({ at: null });
      const { rows } = await pool.query(
        `SELECT MAX(fetched_at) AS at FROM line_subscriber_info WHERE ${sp("phone_number")} = ${sp("$1")}`,
        [phone]);
      res.json({ at: rows[0]?.at || null });
    } catch { res.json({ at: null }); }
  });

  // فحص انتهاء العمليات الجديدة (جلب الأكونت / تغيير أو تحديث البورت / إلغاء الإسناد).
  // بنرجّع وقت آخر أثر للعملية دى على الرقم — جهاز التنفيذ بيقارنه بالوقت قبل الفتح.
  app.get("/api/exec-queue/op-check", requireAuth, async (req, res) => {
    try {
      const type = String(req.query.type || "").trim();
      const key = String(req.query.key || "").trim();
      let sql = "";
      // تحديث ملف البورتات: عملية على مستوى الموقع كله (مش رقم بعينه) — الإشارة هى ختم انتهاء
      // الرفعة فى app_state، فمش محتاجة key.
      if (type === "ports") {
        sql = `SELECT updated_at AS at FROM app_state WHERE key = 'ports_run_completed_at'`;
        const { rows } = await pool.query(sql);
        return res.json({ at: rows[0]?.at || null });
      }
      if (!key) return res.json({ at: null });
      if (type === "c360") {
        sql = `SELECT MAX(updated_at) AS at FROM line_accounts WHERE ${sp("full_phone")} = ${sp("$1")}`;
      } else if (type === "portchange") {
        sql = `SELECT MAX(recorded_at) AS at FROM port_change_requests WHERE ${sp("phone_number")} = ${sp("$1")}`;
      } else if (type === "portcheck") {
        // تحديث البورت بيعيد رفع نفس الـ Request ID (فـ recorded_at مابيتغيّرش) — الأثر الحقيقى
        // هو تحديث بيان البورت نفسه فى phone_ports.
        sql = `SELECT MAX(uploaded_at) AS at FROM phone_ports WHERE ${sp("phone_number")} = ${sp("$1")}`;
      } else if (type === "wfmcancel") {
        sql = `SELECT MAX(canceled_at) AS at FROM wfm_task_cancels WHERE ${sp("phone_number")} = ${sp("$1")}`;
      } else return res.json({ at: null });   // wfmreport مالهاش أثر على رقم — بتعتمد على قفل التاب
      const { rows } = await pool.query(sql, [key]);
      res.json({ at: rows[0]?.at || null });
    } catch { res.json({ at: null }); }
  });

  // استقبال نتيجة إلغاء الإسناد من سكربت WFM (توكن + CORS). «مين عمل إيه» بيتاخد من
  // op_intents (نفس أسلوب القياس ورفع السرعة) لأن السكربت مابيعرفش مين ضغط الزر.
  app.options("/api/wfm-tasks/cancel-ingest", (_req, res) => { setPortsCors(res); res.sendStatus(204); });
  app.post("/api/wfm-tasks/cancel-ingest", async (req: any, res) => {
    setPortsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) return res.status(401).json({ message: "invalid token" });
    const b = req.body || {};
    const phone = String(b.phone || "").replace(/\D/g, "");
    if (!phone) return res.status(400).json({ message: "phone مطلوب" });
    try {
      const who = await pool.query(
        `SELECT username FROM op_intents WHERE account = $1 AND op_type = 'wfmcancel' LIMIT 1`, [phone]);
      const { rows } = await pool.query(
        `INSERT INTO wfm_task_cancels (phone_number, work_order_id, assignment_status, requested_by, canceled_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        [phone, String(b.workOrderId || "").trim() || null, String(b.status || "").trim() || null,
         who.rows[0]?.username || null]);
      res.json({ ok: true, id: rows[0]?.id });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // إيقاف جهاز التنفيذ فوراً: يمسح النبضة عشان /status يرجّع غير-مفعّل حالاً (بدل انتظار 45ث).
  // يُستدعى لما السوبر أدمن يقفل زر جهاز التنفيذ — يمنع إضافة مهام لطابور مفيش حد بينفّذه.
  app.post("/api/exec-queue/offline", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      await pool.query(`DELETE FROM app_state WHERE key = 'exec_heartbeat'`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // تقدّم باتش كامل (كل مهامه ليها نفس batch_id) — لتتبّع «تم X من N» للطلب اللى فيه أرقام كتير.
  app.get("/api/exec-queue/batch-progress", requireAuth, async (req, res) => {
    try {
      await expireOrphanedExecJobs();
      const batchId = String(req.query.batchId || "").trim();
      if (!batchId) return res.json({ found: false });
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'done')::int AS done,
                COUNT(*) FILTER (WHERE status IN ('pending','claimed'))::int AS active,
                COUNT(*) FILTER (WHERE status = 'stale')::int AS canceled,
                COUNT(*) FILTER (WHERE status = 'claimed')::int AS running
         FROM exec_jobs WHERE batch_id = $1`, [batchId]);
      const r = rows[0];
      if (!r || r.total === 0) return res.json({ found: false });
      res.json({ found: true, total: r.total, done: r.done, active: r.active, canceled: r.canceled, running: r.running });
    } catch { res.json({ found: false }); }
  });

  // عدد المهام المنتظرة (للعرض)
  app.get("/api/exec-queue/pending", requireAuth, async (_req, res) => {
    try {
      await expireOrphanedExecJobs();
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM exec_jobs WHERE status IN ('pending','claimed')`);
      res.json({ pending: rows[0]?.n ?? 0 });
    } catch { res.json({ pending: 0 }); }
  });

  // باتشات الأولوية العليا المنتظرة (2 = ≤3 خطوط، 1 = محتاجة رفع سرعة) — للعرض فقط (بدون ترتيب)،
  // بتتنفّذ دايماً قبل باتشات الأولوية المتأخرة (priority=0) بترتيب created_at، ومش قابلة لإعادة ترتيب.
  app.get("/api/exec-queue/priority-preview", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      await expireOrphanedExecJobs();
      const { rows } = await pool.query(
        `SELECT batch_id AS "batchId", MIN(type) AS type, MIN(requested_by) AS "requestedBy", MIN(note) AS note,
                MIN(priority)::int AS priority,
                COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='done')::int AS done,
                bool_or(status IN ('pending','claimed') AND paused_at IS NOT NULL) AS paused,
                -- كام مهمة تحت التنفيذ دلوقتى ومن إمتى — عشان الباتش العالق يبان
                -- إنه عالق (جارٍ التنفيذ من 40 دقيقة) بدل ما يفضل «0 من 1» بلا سبب
                COUNT(*) FILTER (WHERE status='claimed')::int AS claimed,
                ROUND(EXTRACT(EPOCH FROM (now() - MIN(claimed_at) FILTER (WHERE status='claimed'))) / 60.0)::int AS "claimedMins",
                (MIN(created_at) AT TIME ZONE 'Africa/Cairo') AS "createdAt"
         FROM exec_jobs
         WHERE batch_id IN (SELECT DISTINCT batch_id FROM exec_jobs WHERE priority IN (1, 2) AND status IN ('pending','claimed') AND batch_id IS NOT NULL)
         GROUP BY batch_id
         ORDER BY MIN(priority) DESC, MIN(created_at) ASC, batch_id`);
      res.json({ data: rows });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // باتشات الأولوية المتأخرة (>3 خطوط من غير تقرير محتاجة رفع سرعة) المنتظرة — للسوبر أدمن يرتّبها.
  // بترجع بترتيب التنفيذ الفعلى (queue_order اليدوى أولاً ثم الأقدم) مع تقدّم كل باتش.
  app.get("/api/exec-queue/reorderable", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      await expireOrphanedExecJobs();
      const { rows } = await pool.query(
        `SELECT batch_id AS "batchId", MIN(type) AS type, MIN(requested_by) AS "requestedBy", MIN(note) AS note,
                COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='done')::int AS done,
                bool_or(status IN ('pending','claimed') AND paused_at IS NOT NULL) AS paused,
                COUNT(*) FILTER (WHERE status='claimed')::int AS claimed,
                ROUND(EXTRACT(EPOCH FROM (now() - MIN(claimed_at) FILTER (WHERE status='claimed'))) / 60.0)::int AS "claimedMins",
                (MIN(created_at) AT TIME ZONE 'Africa/Cairo') AS "createdAt", MAX(queue_order) AS "queueOrder"
         FROM exec_jobs
         WHERE batch_id IN (SELECT DISTINCT batch_id FROM exec_jobs WHERE priority = 0 AND status IN ('pending','claimed') AND batch_id IS NOT NULL)
         GROUP BY batch_id
         ORDER BY CASE WHEN MAX(queue_order) > 0 THEN MAX(queue_order) ELSE 9223372036854775807 END ASC, MIN(created_at) ASC, batch_id`);
      res.json({ data: rows });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // إعادة ترتيب باتشات الأولوية المتأخرة: السوبر أدمن يبعت قائمة batchIds بالترتيب المطلوب.
  // بنسند queue_order = 1..N للباتشات المرتّبة (لا يؤثر على أولوية ≤3 خطوط أو محتاجة رفع سرعة).
  app.post("/api/exec-queue/reorder", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      const ids = Array.isArray(req.body?.batchIds) ? req.body.batchIds.map((x: any) => String(x)).filter(Boolean) : [];
      if (!ids.length) return res.status(400).json({ message: "لا توجد باتشات" });
      // ⚠️ لازم يتكتب على **كل** صفوف الباتش مش pending/claimed بس:
      // القراءة فى /reorderable بتاخد MAX(queue_order) على الباتش كله، فلو الباتش
      // اتنفّذ منه جزء (فيه صفوف done) الصفوف دى بتفضل شايلة الترتيب القديم، وMAX
      // بيرجّع الرقم القديم الأكبر — فالترتيب اليدوى كان بيتلغى ويرجع لترتيب التاريخ.
      // ده كان بيبان بس فى الباتشات اللى بدأت تتنفّذ (غالباً باتشات نفس التقرير).
      // queue_order صفة للباتش كله مش للمهمة، فمفيش معنى لاختلاف القيمة بين صفوفه.
      //
      // وبقى **بيان واحد** بدل حلقة UPDATE لكل باتش: الترتيب بيتكتب كله مرة واحدة،
      // فمفيش لحظة يكون فيها نص الترتيب القديم ونصه الجديد لو الطابور بيسحب فى نفس الوقت.
      await pool.query(
        `UPDATE exec_jobs e SET queue_order = v.ord
           FROM unnest($1::text[], $2::bigint[]) AS v(batch_id, ord)
          WHERE e.batch_id = v.batch_id AND e.priority = 0`,
        [ids, ids.map((_: string, i: number) => i + 1)]);
      res.json({ ok: true, count: ids.length });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // إعادة ضبط المهام اليتيمة: يُستدعى عند تفعيل جهاز التنفيذ — أى مهمة claimed كانت شغّالة لحظة
  // قفل الجهاز/انقطاع الشحن نرجّعها للطابور (pending) عشان **تتعاد من الأول** (بترتيبها الأصلى
  // حسب created_at)، بدل ما تتلغى. المهام المنتظرة الأخرى تفضل زى ما هى ويكمّلها الجهاز.
  app.post("/api/exec-queue/reset-orphaned", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      // نزوّد attempts هنا كمان — الاسترجاع اليدوى ده إعادة محاولة برضه، فلو مهمة فضلت
      // تعلق كل مرة تتحسب صح وتتلغى فى النهاية بدل ما تلفّ فى الطابور للأبد.
      const { rowCount } = await pool.query(`UPDATE exec_jobs SET status = 'pending', claimed_at = NULL, attempts = attempts + 1 WHERE status = 'claimed'`);
      res.json({ ok: true, requeued: rowCount ?? 0 });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // تقرير معاملات التنفيذ (سوبر أدمن): كل مهام الطابور خلال فترة، مع عدد الخطوط المطلوبة
  // والمتنفّذة فعلاً + مين طلبها + من تقرير إيه + الحالة/النتيجة.
  app.get("/api/exec-queue/history", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      let from = String((req.query.from as string) || "").trim();
      let to = String((req.query.to as string) || "").trim();
      // لو التاريخين مقلوبين (من بعد إلى) بنبدّلهم بدل ما نرجّع نطاق مستحيل يسبب "لا توجد نتائج" بصمت
      if (from && to && from > to) { const t = from; from = to; to = t; }
      const conds: string[] = [];
      const params: any[] = [];
      if (from) { params.push(from); conds.push(`created_at >= $${params.length}`); }
      if (to) { params.push(to + " 23:59:59"); conds.push(`created_at <= $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const { rows } = await pool.query(
        `SELECT id, type, accounts, status, requested_by AS "requestedBy", note AS source,
                created_at AS "createdAt", claimed_at AS "claimedAt", done_at AS "doneAt", result, batch_id AS "batchId"
         FROM exec_jobs ${where} ORDER BY created_at DESC LIMIT 2000`,
        params,
      );
      // نجيب رقم التليفون لكل رقم أكونت (من line_accounts) دفعة واحدة
      const allAccs = new Set<string>();
      for (const j of rows as any[]) {
        try { (Array.isArray(j.accounts) ? j.accounts : JSON.parse(j.accounts || "[]")).forEach((a: any) => allAccs.add(String(a).trim())); } catch {}
      }
      const phoneMap: Record<string, string> = {};
      if (allAccs.size) {
        const { rows: pr } = await pool.query(
          `SELECT account_no, full_phone FROM line_accounts WHERE account_no = ANY($1::text[])`,
          [[...allAccs]]);
        for (const r of pr as any[]) phoneMap[String(r.account_no).trim()] = String(r.full_phone || "");
      }
      // نحسب عدد الخطوط المطلوبة والمتنفّذة فعلاً + رقم الأكونت/التليفون لكل مهمة
      const out = [];
      for (const j of rows as any[]) {
        let accs: string[] = [];
        try { accs = (Array.isArray(j.accounts) ? j.accounts : JSON.parse(j.accounts || "[]")).map((a: any) => String(a).trim()).filter(Boolean); } catch {}
        const prog = await jobProgress(j.accounts, j.type, j.claimedAt);
        out.push({
          id: j.id, type: j.type, status: j.status, result: j.result || null,
          requestedBy: j.requestedBy || null, source: j.source || null,
          createdAt: j.createdAt, doneAt: j.doneAt,
          requested: prog.total, measured: prog.done,
          account: accs.join("، "),
          phone: accs.map((a) => phoneMap[a] || "").filter(Boolean).join("، "),
          batchId: j.batchId || null,
        });
      }
      res.json({ jobs: out });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/exec-queue/batches — كل الباتشات (تاريخياً) مهما كانت أولويتها وحالتها:
  // اكتملت / جزئى / أُلغِيت / لسه فى الطابور / موقّفة مؤقتاً. ?from=&to=
  app.get("/api/exec-queue/batches", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      await expireOrphanedExecJobs();
      let from = String((req.query.from as string) || "").trim();
      let to   = String((req.query.to as string) || "").trim();
      if (from && to && from > to) { const t = from; from = to; to = t; }   // نطاق مقلوب
      const params: any[] = [];
      const conds: string[] = ["batch_id IS NOT NULL"];
      if (from) { params.push(from); conds.push(`created_at >= $${params.length}`); }
      if (to)   { params.push(to + " 23:59:59"); conds.push(`created_at <= $${params.length}`); }

      // نتائج تعتبر «خلصت بإيرور» (المهمة قفلت من غير نتيجة سليمة)
      const ERR = `('tab_closed','timeout','stopped','preempted')`;
      const { rows } = await pool.query(
        `SELECT batch_id                                                        AS "batchId",
                MIN(type)                                                       AS type,
                MIN(priority)::int                                              AS priority,
                MIN(requested_by)                                               AS "requestedBy",
                MIN(note)                                                       AS note,
                COUNT(*)::int                                                   AS total,
                COUNT(*) FILTER (WHERE status = 'done')::int                    AS done,
                COUNT(*) FILTER (WHERE status = 'done'
                   AND (result IS NULL OR result NOT IN ${ERR}))::int           AS "doneOk",
                COUNT(*) FILTER (WHERE status = 'done'
                   AND result IN ${ERR})::int                                   AS "doneErr",
                COUNT(*) FILTER (WHERE status = 'stale')::int                   AS canceled,
                COUNT(*) FILTER (WHERE status = 'pending')::int                 AS pending,
                COUNT(*) FILTER (WHERE status = 'claimed')::int                 AS running,
                bool_or(status IN ('pending','claimed') AND paused_at IS NOT NULL) AS paused,
                (MIN(created_at) AT TIME ZONE 'Africa/Cairo')                   AS "createdAt",
                (MAX(done_at)    AT TIME ZONE 'Africa/Cairo')                   AS "finishedAt"
           FROM exec_jobs
          WHERE ${conds.join(" AND ")}
          GROUP BY batch_id
          ORDER BY MIN(created_at) DESC
          LIMIT 1000`, params);

      // حالة الباتش المحسوبة (نفس منطق العرض فى الطابور)
      const data = rows.map((b: any) => {
        const active = (b.pending || 0) + (b.running || 0);
        let state: string;
        if (active > 0) state = b.paused ? "موقّف مؤقتاً" : (b.running > 0 ? "جارٍ التنفيذ" : "فى الطابور");
        else if (b.total > 0 && b.canceled === b.total) state = "أُلغِيت بالكامل";
        else if (b.done === b.total) state = "اكتملت";
        else if (b.done > 0) state = "اكتملت جزئياً";
        else state = "لم تُنفَّذ";
        return { ...b, active, state };
      });
      res.json({ data });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/exec-queue/batch-details?batchId=… — التفصيلى للرقابة: كل مهمة فى الباتش
  // بأثرها الفعلى فى قاعدة البيانات، مش بس «اكتملت/ألغيت»:
  //   قياس        → الاسكور والسرعة ووقت القياس (واتقاس فعلاً ولا لأ)
  //   رفع/إيقاف   → وقت آخر رفع/إيقاف ومين طلبه
  //   تغيير بورت  → من كابينة إيه لإيه (ونفس الكابينة ولا غيرها) + حالة الطلب على
  //                 البورتال + البورت الجديد لو اكتمل
  //   تحديث بورت  → البورت قبل وبعد (واتغيّر فعلاً ولا لأ)
  //   مراجعة FCC  → الاسم والعنوان اللى اتجابوا ووقتهم
  //   جلب أكونت   → رقم الأكونت ومصدره
  //   إلغاء إسناد → البند (Cancel / Re-assign) والفنى المُسنَد
  // وكمان الجهاز اللى نفّذ كل مهمة (executed_by).
  app.get("/api/exec-queue/batch-details", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const batchId = String(req.query.batchId || "").trim();
      if (!batchId) return res.status(400).json({ message: "batchId مطلوب" });

      const { rows: jobs } = await pool.query(
        `SELECT id, type, accounts, status, result, note, priority, params,
                requested_by AS "requestedBy", requested_from AS "requestedFrom",
                executed_by AS "executedBy", retry_round AS "retryRound",
                (created_at AT TIME ZONE 'Africa/Cairo') AS "createdAt",
                (claimed_at AT TIME ZONE 'Africa/Cairo') AS "claimedAt",
                (done_at    AT TIME ZONE 'Africa/Cairo') AS "doneAt",
                claimed_at AS "claimedAtRaw"
           FROM exec_jobs WHERE batch_id = $1 ORDER BY id`, [batchId]);
      if (!jobs.length) return res.json({ data: [], batchId });

      const keysOf = (t: string) =>
        jobs.filter((j: any) => j.type === t)
            .flatMap((j: any) => (Array.isArray(j.accounts) ? j.accounts : []))
            .map((a: any) => String(a).trim()).filter((a: string) => a && a !== "-");
      const short = (a: string) => a.replace(/\D/g, "").replace(/^88/, "");
      const full  = (a: string) => "88" + short(a);
      const M = <T,>(rows: any[], key: (r: any) => string) =>
        new Map<string, T>(rows.map((r) => [key(r), r as T]));

      // القياس — آخر سجل لكل رقم أكونت
      const measAccs = [...keysOf("measure")];
      const meas = measAccs.length ? M<any>((await pool.query(
        `SELECT DISTINCT ON (account_no) account_no, score, current_speed, max_speed,
                complain_no, measured_by, uploaded_at
           FROM case_138 WHERE account_no = ANY($1::text[])
          ORDER BY account_no, id DESC`, [measAccs])).rows, (r) => String(r.account_no)) : new Map();

      // رفع السرعة / الإيقاف
      const poAccs = [...keysOf("raise"), ...keysOf("stop")];
      const po = poAccs.length ? M<any>((await pool.query(
        `SELECT account_no, last_raise_at, last_raise_by, last_stop_at, last_stop_by
           FROM line_po_events WHERE account_no = ANY($1::text[])`, [poAccs])).rows,
        (r) => String(r.account_no)) : new Map();

      // البورتات: طلب التغيير على البورتال + البورت الحالى دلوقتى
      const portKeys = [...keysOf("portchange"), ...keysOf("portcheck")];
      const pcr = portKeys.length ? M<any>((await pool.query(
        `SELECT DISTINCT ON (phone_number) phone_number, request_id, old_msan, new_msan,
                new_frame, port_type, status, completed, request_date, recorded_at
           FROM port_change_requests
          WHERE regexp_replace(phone_number, '^88', '') = ANY($1::text[])
          ORDER BY phone_number, recorded_at DESC`, [portKeys.map(short)])).rows,
        (r) => short(String(r.phone_number))) : new Map();
      const nowPorts = portKeys.length ? M<any>((await pool.query(
        `SELECT phone_number, msan_code, frame, shelf, slot, port_number, port_type
           FROM phone_ports WHERE phone_number = ANY($1::text[])`, [portKeys.map(full)])).rows,
        (r) => short(String(r.phone_number))) : new Map();

      // مراجعة الاسم والعنوان من FCC
      const siKeys = keysOf("subinfo");
      const si = siKeys.length ? M<any>((await pool.query(
        `SELECT phone_number, sub_name, sub_add, fetched_at
           FROM line_subscriber_info
          WHERE regexp_replace(phone_number, '^88', '') = ANY($1::text[])`, [siKeys.map(short)])).rows,
        (r) => short(String(r.phone_number))) : new Map();

      // جلب رقم الأكونت من Customer360
      const c360Keys = keysOf("c360");
      const accs = c360Keys.length ? M<any>((await pool.query(
        `SELECT full_phone, account_no, source, updated_at, updated_by_name
           FROM line_accounts WHERE full_phone = ANY($1::text[])`, [c360Keys.map(full)])).rows,
        (r) => short(String(r.full_phone))) : new Map();

      const at = (d: any) => (d ? new Date(d).getTime() : 0);
      const data = jobs.map((j: any) => {
        const list: string[] = (Array.isArray(j.accounts) ? j.accounts : []).map((a: any) => String(a).trim());
        const key = list[0] || "";
        const p = j.params || {};
        let detail: any = null;
        if (j.type === "measure") {
          const m = meas.get(key) as any;
          // «اتقاس فى المهمة دى» = فيه قياس بعد وقت سحب المهمة
          const during = !!(m && at(m.uploaded_at) >= at(j.claimedAtRaw));
          detail = m ? {
            measuredInThisJob: during, score: m.score,
            currentSpeed: m.current_speed, maxSpeed: m.max_speed,
            complainNo: m.complain_no, measuredBy: m.measured_by, at: m.uploaded_at,
          } : { measuredInThisJob: false };
        } else if (j.type === "raise" || j.type === "stop") {
          const e = po.get(key) as any;
          const isRaise = j.type === "raise";
          const evAt = isRaise ? e?.last_raise_at : e?.last_stop_at;
          detail = {
            doneInThisJob: !!(evAt && at(evAt) >= at(j.claimedAtRaw)),
            at: evAt ?? null, by: isRaise ? e?.last_raise_by : e?.last_stop_by,
          };
        } else if (j.type === "portchange") {
          const r0 = pcr.get(short(key)) as any;
          const cur = nowPorts.get(short(key)) as any;
          const oldC = String(p.old ?? "").trim(), newC = String(p.new ?? "").trim();
          detail = {
            requestedOldMsan: oldC, requestedNewMsan: newC,
            sameCabinet: !!oldC && !!newC && normCab(oldC) === normCab(newC),
            portType: p.pt ?? null, servicePlan: p.sp ?? null,
            requestId: r0?.request_id ?? null, portalStatus: r0?.status ?? null,
            portalCompleted: r0?.completed ?? null, portalNewFrame: r0?.new_frame ?? null,
            portalRequestDate: r0?.request_date ?? null,
            currentMsan: cur?.msan_code ?? null, currentFrame: cur?.frame ?? null,
            currentPortType: cur?.port_type ?? null,
          };
        } else if (j.type === "portcheck") {
          const r0 = pcr.get(short(key)) as any;
          const cur = nowPorts.get(short(key)) as any;
          detail = {
            msanBefore: String(p.old ?? "").trim() || null,
            frameAfter: cur?.frame ?? null, msanAfter: cur?.msan_code ?? null,
            portalStatus: r0?.status ?? null, portalCompleted: r0?.completed ?? null,
            portalNewFrame: r0?.new_frame ?? null, requestId: r0?.request_id ?? null,
            // اتحدّث فعلاً؟ البورتال قال COMPLETED والفريم الحالى بقى نفس الجديد
            updated: !!(r0?.completed && cur?.frame && String(cur.frame).trim() === String(r0.new_frame ?? "").trim()),
          };
        } else if (j.type === "subinfo") {
          const s0 = si.get(short(key)) as any;
          detail = s0 ? {
            fetchedInThisJob: at(s0.fetched_at) >= at(j.claimedAtRaw),
            subName: s0.sub_name, subAdd: s0.sub_add, at: s0.fetched_at,
          } : { fetchedInThisJob: false };
        } else if (j.type === "c360") {
          detail = { accounts: list.map((a) => {
            const a0 = accs.get(short(a)) as any;
            return { phone: a, accountNo: a0?.account_no ?? null, source: a0?.source ?? null, at: a0?.updated_at ?? null };
          }) };
        } else if (j.type === "wfmcancel") {
          detail = {
            mode: p.mode === "reassign" ? "إعادة إسناد (Re-assign)" : "إلغاء إسناد (Cancel)",
            worker: p.worker ?? null, workerName: p.workerName ?? null,
          };
        }
        const { claimedAtRaw, ...rest } = j;
        return { ...rest, account: key, accountsCount: list.length, detail };
      });
      res.json({ data, batchId });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // إلغاء مهام محددة من الطابور (سوبر أدمن): بالـ id (رقم/خط واحد) أو batch_id (باتش كامل).
  app.post("/api/exec-queue/cancel", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: any) => parseInt(x)).filter((n: number) => !isNaN(n)) : [];
      const batchId = String(req.body?.batchId || "").trim();
      if (!ids.length && !batchId) return res.status(400).json({ message: "لا يوجد ما يُلغى" });
      const params: any[] = [];
      const or: string[] = [];
      if (ids.length) { params.push(ids); or.push(`id = ANY($${params.length}::int[])`); }
      if (batchId) { params.push(batchId); or.push(`batch_id = $${params.length}`); }
      const { rowCount } = await pool.query(
        `UPDATE exec_jobs SET status = 'stale', done_at = now() WHERE status IN ('pending','claimed') AND (${or.join(" OR ")})`,
        params,
      );
      res.json({ ok: true, canceled: rowCount ?? 0 });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/exec-queue/requeue { batchId } — «إعادة تشغيل» باتش عالق (سوبر أدمن).
  // الإنقاذ التلقائى (expireOrphanedExecJobs) بيشتغل بعد مهلة النوع وبحدّ 3 محاولات،
  // وبعد كده المهمة بتبقى stale ومافيش أى طريقة ترجّعها. الزرار ده هو المخرج اليدوى:
  // بيرجّع كل مهام الباتش (claimed العالقة + stale الملغاة) لـ pending، بيصفّر
  // العدّاد (قرار صريح من المستخدم مش إعادة محاولة تلقائية) وبيفكّ الإيقاف المؤقت.
  // اللى اتنفّذ فعلاً (done) مابيتلمسش.
  app.post("/api/exec-queue/requeue", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const batchId = String(req.body?.batchId || "").trim();
      if (!batchId) return res.status(400).json({ message: "batchId مطلوب" });
      const { rowCount } = await pool.query(
        `UPDATE exec_jobs
            SET status = 'pending', claimed_at = NULL, done_at = NULL, result = NULL,
                paused_at = NULL, attempts = 0
          WHERE batch_id = $1 AND status IN ('claimed', 'stale', 'pending')`,
        [batchId]);
      res.json({ ok: true, requeued: rowCount ?? 0 });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // إيقاف مؤقت لباتش معيّن (سوبر أدمن): بيعلّم مهامه pending كـ paused فيتخطّاها جهاز التنفيذ
  // (claim) ويكمّل مباشرة التالى فى الترتيب — عكس /cancel، ده قابل للاستئناف ومش بيلغى حاجة.
  app.post("/api/exec-queue/pause", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const batchId = String(req.body?.batchId || "").trim();
      if (!batchId) return res.status(400).json({ message: "لا يوجد باتش" });
      const { rowCount } = await pool.query(
        `UPDATE exec_jobs SET paused_at = now() WHERE batch_id = $1 AND status IN ('pending','claimed') AND paused_at IS NULL`,
        [batchId],
      );
      res.json({ ok: true, paused: rowCount ?? 0 });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // استئناف باتش موقَّف مؤقتاً (سوبر أدمن).
  app.post("/api/exec-queue/resume", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const batchId = String(req.body?.batchId || "").trim();
      if (!batchId) return res.status(400).json({ message: "لا يوجد باتش" });
      const { rowCount } = await pool.query(
        `UPDATE exec_jobs SET paused_at = NULL WHERE batch_id = $1 AND paused_at IS NOT NULL`,
        [batchId],
      );
      res.json({ ok: true, resumed: rowCount ?? 0 });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // إيقاف مؤقت لكل الطابور دفعة واحدة (سوبر أدمن) — كل المهام pending بتتوقّف عن الاستلام
  // لحد الاستئناف، من غير ما تتلغى ومن غير ما توقف الخط اللى شغّال دلوقتى.
  app.post("/api/exec-queue/pause-all", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const { rowCount } = await pool.query(
        `UPDATE exec_jobs SET paused_at = now() WHERE status IN ('pending','claimed') AND paused_at IS NULL`);
      res.json({ ok: true, paused: rowCount ?? 0 });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // استئناف كل الباتشات الموقَّفة مؤقتاً دفعة واحدة (سوبر أدمن).
  app.post("/api/exec-queue/resume-all", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const { rowCount } = await pool.query(
        `UPDATE exec_jobs SET paused_at = NULL WHERE paused_at IS NOT NULL`);
      res.json({ ok: true, resumed: rowCount ?? 0 });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // مسح الطابور يدوياً (سوبر أدمن): يعلّم كل المهام النشطة (pending/claimed) stale فوراً.
  app.post("/api/exec-queue/clear", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const { rowCount } = await pool.query(`UPDATE exec_jobs SET status = 'stale', done_at = now() WHERE status IN ('pending','claimed')`);
      res.json({ ok: true, cleared: rowCount ?? 0 });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // تنظيف المهام اليتيمة (اللى جهاز التنفيذ اتقفل عليها فى نصّها فبتفضل claimed/pending للأبد
  // وتضخّم الترتيب): نعلّمها stale لو (أ) جهاز التنفيذ مقفول (النبضة قديمة) والمهمة عدّى عليها >2 دقيقة،
  // أو (ب) مهمة claimed من أكثر من 5 ساعات (أطول من أقصى تشغيل باتش).
  // ── إعادة تنفيذ الخطوط اللى رجعت بإيرور ──────────────────────────────────────
  // الخط اللى قفل من غير نتيجة سليمة (التاب اتقفل / علّق / جهاز التنفيذ اتقفل) بيترجع
  // للطابور **مرة واحدة بس**، وبأولوية «محتاجة رفع سرعة» (1)، وبعد ما الباتش بتاعه
  // يخلص بالكامل (مفيش فيه مهمة منتظرة ولا شغّالة) — عشان مايزاحمش الباتش وهو شغّال.
  // لو رجع بإيرور تانى: خلاص، بيتسجّل بالنتيجة دى ومابيتعادش (retry_round = 1).
  //
  // ملحوظات مقصودة:
  //  - preempted مش فى قايمة الإيرور: دى مقاطعة مقصودة والسيرفر بيرجّع الباقى بنفسه.
  //  - نافذة 6 ساعات + سقف 200 لكل دورة: يمنع إن أول تشغيل بعد النشر يقلب آلاف
  //    الأخطاء القديمة للطابور دفعة واحدة.
  //  - retried_at ختم على المهمة الأصلية عشان مانضيفش نفس الإعادة كل دورة سحب.
  const RETRY_ERR = `('tab_closed','timeout','stopped')`;
  // ⏱️ بتتنادى من حلقة السحب (كل 4 ثوانى) — لكن بتتنفّذ فعلياً مرة كل دقيقة بس.
  // من غير الخنق ده الاستعلام التقيل ده كان بيشتغل 15 مرة فى الدقيقة على آلاف
  // المهام فيخنق قاعدة البيانات وتعلّق باقى الصفحات.
  let lastRequeueAt = 0;
  const REQUEUE_EVERY_MS = 60 * 1000;
  const requeueErroredJobs = async () => {
    if (Date.now() - lastRequeueAt < REQUEUE_EVERY_MS) return;
    lastRequeueAt = Date.now();
    try {
      const { rows } = await pool.query(`
        -- المهام النشطة بتتقرا **مرة واحدة** فى CTE بدل استعلام لكل صف (كان بيعمل
        -- ملايين المقارنات كل دورة). MATERIALIZED بتجبر الـ planner يحسبها مرة واحدة.
        WITH active AS MATERIALIZED (
          SELECT DISTINCT type, accounts, batch_id FROM exec_jobs WHERE status IN ('pending','claimed')
        ), picked AS (
          SELECT e.id, e.type, e.accounts, e.requested_by, e.note, e.batch_id, e.site, e.params, e.requested_from
            FROM exec_jobs e
           WHERE e.status = 'done'
             AND e.result IN ${RETRY_ERR}
             AND e.retry_round = 0
             AND e.retried_at IS NULL
             AND e.type IN ('measure','raise','stop')
             AND e.done_at > now() - interval '6 hours'
             -- الباتش خلص بالكامل
             AND NOT EXISTS (SELECT 1 FROM active b WHERE b.batch_id = e.batch_id)
             -- ومفيش نفس الرقم مستنى/شغّال دلوقتى (مانكرّرش)
             AND NOT EXISTS (SELECT 1 FROM active a WHERE a.type = e.type AND a.accounts = e.accounts)
           ORDER BY e.done_at
           LIMIT 200
        ), ins AS (
          INSERT INTO exec_jobs (type, accounts, requested_by, note, priority, batch_id, site, params, retry_round, requested_from)
          SELECT p.type, p.accounts, p.requested_by,
                 COALESCE(p.note, '') || ' (إعادة تنفيذ بعد إيرور)',
                 -- أولوية 3 (أعلى الترتيب): الباتش الأصلى خلص خلاص (شرط الاختيار فوق)،
                 -- والإعادة لازم تتنفّذ **مباشرة بعده** مش ورا كل اللى فى الطابور.
                 -- ومع كده مابتقاطعش أى مهمة شغّالة — شوف استثناء retry_round فى
                 -- فحص المقاطعة (/preempt-check): بتستنى اللى شغّال يخلص وبس.
                 3, COALESCE(p.batch_id, 'b') || '-r1', p.site, p.params, 1, p.requested_from
            FROM picked p
          RETURNING id
        )
        UPDATE exec_jobs SET retried_at = now()
         WHERE id IN (SELECT id FROM picked)
        RETURNING id`);
      if (rows.length) console.log(`[exec-queue] إعادة تنفيذ ${rows.length} خط رجعوا بإيرور (أولوية 3)`);
    } catch (e: any) {
      console.error("[exec-queue] فشل إعادة تنفيذ الأخطاء:", e.message);
    }
  };

  const expireOrphanedExecJobs = async () => {
    try {
      // المهمة بتعلق فى claimed لما التاب يتقفل أو التنفيذ يفشل من غير ما يبعت /done.
      // من غير علاج بتفضل claimed للأبد فتعمل تلات مشاكل:
      //   • claim بياخد pending بس → الباتش بتاعها مابيخلصش والجهاز بيروح لباتشات أقل أولوية
      //     (الباتش يبان فى «الأولوية العليا» لكن كأنه مش موجود).
      //   • pause/pause-all بتشتغل على pending/claimed → لكن مافيش حاجة بترجّعها للطابور.
      //   • كانت بتتلغى (stale) بعد 6 ساعات من غير أى محاولة تانية.
      // العلاج: إعادة محاولة تلقائية لحد 3 مرات، وبعدها بس تتلغى.
      const MAX_ATTEMPTS = 3;

      // (1) الجهاز عدّاها فعلاً (سحب مهمة أحدث منها **على نفس المسار**) → يتيمة أكيد،
      //     نرجّعها بسرعة (10 دقايق).
      //     ⚠️ لازم «على نفس المسار»: المواقع المختلفة بتشتغل بالتوازى، فمهمة قياس اتسحبت
      //     على DZS مش دليل إطلاقاً إن مهمة تحديث البورتات على بوابة التزويد اتساب.
      //     الشرط ده لما كان بيقارن كل المهام كان بيرجّع تحديث البورتات للطابور وهو لسه
      //     شغّال (مهلته 30 دقيقة) → يتسحب تانى → تاب جديد كل 10 دقايق → المتصفح يتخنق
      //     والقياسات تقف. (اتأكدنا منه بالتجربة قبل الإصلاح.)
      // (2) الجهاز مات عليها هى نفسها (مافيش مهمة أحدث على نفس المسار) → مافيش دليل مباشر،
      //     فبنستنى أطول وبعدين نرجّعها برضه.
      //     المهل بتحترم مهلة العملية نفسها: العمليات الطويلة (تحديث الملفات اليومية —
      //     لحد 30 دقيقة فى جهاز التنفيذ) بتاخد ضعف المهلة، عشان مانقطعهاش وهى شغّالة.
      const LONG_TYPES = Array.from(DAILY_TYPES);
      // ⚠️ سقف زمنى **لكل نوع** — لازم يكون هو المُنقِذ الأساسى، مش شرط «فيه مهمة
      // اتسحبت بعدها». السبب: المهمة العالقة قافلة مسارها بنفسها، فمهمة أحدث على
      // **نفس المسار** مستحيل تحصل — يبقى الشرط ده مايتحققش أبداً والمهمة تفضل
      // عالقة لحد السقف المطلق. ده بالظبط اللى كان بيوقّف القياسات: تاب DZS يتقفل
      // من غير ما يتعلّم done، فالمسار يفضل مقفول والصفحة اللى بعدها ماتفتحش.
      // المهل (متطابقة مع شارة «عالق» فى شاشة الطابور — stuckMinsFor):
      //   • القياس 5 دقايق — مهمة القياس خط واحد (بتتقسّم رقم-رقم) ومهلته فى جهاز
      //     التنفيذ 2.5 دقيقة، فـ5 ضعف المهلة وسقف آمن وسريع.
      //   • أى عملية تانية 20 دقيقة.
      //   • استثناءات لازمة — دول مهلتهم فى جهاز التنفيذ **أطول من 20**، ولو
      //     رجّعناهم وهم شغّالين هيتسحبوا تانى ويتفتح تاب جديد فوق القديم (ده
      //     بالظبط اللى كان بيخنق المتصفح ويوقّف القياسات):
      //       - تحديث الملفات (DAILY_TYPES): 30 دقيقة فعلية → 60.
      //       - c360 وwfmreport: 20 دقيقة لكل رقم جوّه نفس التاب → 45.
      const maxRunSql = `(CASE
        WHEN e.type = ANY($2::text[])          THEN interval '60 minutes'
        WHEN e.type IN ('c360','wfmreport')    THEN interval '45 minutes'
        WHEN e.type = 'measure'                THEN interval '5 minutes'
        ELSE interval '20 minutes' END)`;
      await pool.query(
        `UPDATE exec_jobs e
            SET status = 'pending', claimed_at = NULL, attempts = e.attempts + 1
          WHERE e.status = 'claimed'
            AND e.attempts < $1
            AND (
              -- (1) مسار سريع: الجهاز سحب مهمة أحدث على **نفس المسار** = عدّاها أكيد
              (e.claimed_at < now() - (CASE WHEN e.type = ANY($2::text[])
                                            THEN interval '45 minutes' ELSE interval '10 minutes' END)
               AND EXISTS (SELECT 1 FROM exec_jobs j2
                            WHERE j2.claimed_at > e.claimed_at
                              AND COALESCE(j2.site, '10.42.187.101') = COALESCE(e.site, '10.42.187.101')))
              -- (2) المُنقِذ الأساسى: عدّت مهلة نوعها القصوى → عالقة أكيد، رجّعها
              OR e.claimed_at < now() - ${maxRunSql}
            )`,
        [MAX_ATTEMPTS, LONG_TYPES],
      );

      // (3) استنفدت المحاولات ولسه عالقة → نعلّمها stale بنتيجة واضحة تظهر فى تقرير
      //     الباتشات (بدل ما تختفى من غير سبب).
      //     ⚠️ كانت بتستنى **ساعة كاملة** من آخر سحب. النتيجة: بين المحاولة الأخيرة
      //     والساعة دى الباتش بيقف على «0 من N» — لا إنقاذ تلقائى ولا علامة إلغاء
      //     ولا أى تفسير. دلوقتى بنستخدم نفس مهلة النوع، فالحالة تتحسم فوراً
      //     ويقدر المستخدم يضغط «إعادة تشغيل» على باتش باين إنه اتلغى.
      await pool.query(
        `UPDATE exec_jobs e SET status = 'stale', done_at = now(), result = 'stuck_max_attempts'
          WHERE e.status = 'claimed' AND e.attempts >= $1
            AND e.claimed_at < now() - ${maxRunSql}`,
        [MAX_ATTEMPTS, LONG_TYPES],
      );

      // (4) آخر حدّ مطلق: مهمة claimed عدّى عليها >6 ساعات مهما كانت محاولاتها.
      await pool.query(
        `UPDATE exec_jobs SET status = 'stale', done_at = now(), result = COALESCE(result, 'stuck_expired')
         WHERE status = 'claimed' AND claimed_at < now() - interval '6 hours'`,
      );
    } catch { /* تنظيف إضافى — لو فشل نكمّل عادى */ }
  };

  // كام رقم اتنفّذ فعلاً من مهمة (بعد بدء تنفيذها claimed_at):
  //  - القياس: عدد أرقام الأكونت اللى ليها قياس جديد فى case_138 بعد claimed_at.
  //  - رفع/إيقاف: line_po_events.last_raise_at / last_stop_at بعد claimed_at.
  const jobProgress = async (accountsRaw: any, type: string, claimedAt: any): Promise<{ done: number; total: number }> => {
    let accs: string[] = [];
    try { accs = (Array.isArray(accountsRaw) ? accountsRaw : JSON.parse(accountsRaw || "[]")).map((a: any) => String(a).trim()).filter(Boolean); } catch { accs = []; }
    const total = accs.length;
    if (!total || !claimedAt) return { done: 0, total };
    let q: string;
    if (type === "measure") {
      q = `SELECT COUNT(DISTINCT account_no)::int AS n FROM case_138 WHERE account_no = ANY($1::text[]) AND uploaded_at >= $2`;
    } else if (type === "c360") {
      q = `SELECT COUNT(DISTINCT full_phone)::int AS n FROM line_accounts
            WHERE ${sp("full_phone")} = ANY(SELECT ${sp("x")} FROM unnest($1::text[]) AS x) AND updated_at >= $2`;
    } else if (type === "portchange" || type === "portcheck") {
      q = `SELECT COUNT(DISTINCT phone_number)::int AS n FROM port_change_requests
            WHERE ${sp("phone_number")} = ANY(SELECT ${sp("x")} FROM unnest($1::text[]) AS x) AND recorded_at >= $2`;
    } else if (type === "wfmcancel") {
      q = `SELECT COUNT(DISTINCT phone_number)::int AS n FROM wfm_task_cancels
            WHERE ${sp("phone_number")} = ANY(SELECT ${sp("x")} FROM unnest($1::text[]) AS x) AND canceled_at >= $2`;
    } else if (type === "subinfo") {
      // المراجعة خلصت لما سكربت FCC يرفع اسم/عنوان الرقم (fetched_at بيتحدّث فى الـ ingest)
      q = `SELECT COUNT(DISTINCT phone_number)::int AS n FROM line_subscriber_info
            WHERE ${sp("phone_number")} = ANY(SELECT ${sp("x")} FROM unnest($1::text[]) AS x) AND fetched_at >= $2`;
    } else {
      const col = type === "stop" ? "last_stop_at" : "last_raise_at";
      q = `SELECT COUNT(DISTINCT account_no)::int AS n FROM line_po_events WHERE account_no = ANY($1::text[]) AND ${col} >= $2`;
    }
    try {
      const { rows } = await pool.query(q, [accs, claimedAt]);
      return { done: Math.min(rows[0]?.n ?? 0, total), total };
    } catch { return { done: 0, total }; }
  };

  // أرقام الأكونت اللى لسه ماتنفّذتش من مهمة (للاستئناف بعد المقاطعة): الأرقام اللى مالهاش نتيجة
  // جديدة بعد claimed_at. (measure→case_138, raise/stop→line_po_events).
  const jobRemainingAccounts = async (accountsRaw: any, type: string, claimedAt: any): Promise<string[]> => {
    let accs: string[] = [];
    try { accs = (Array.isArray(accountsRaw) ? accountsRaw : JSON.parse(accountsRaw || "[]")).map((a: any) => String(a).trim()).filter(Boolean); } catch { accs = []; }
    if (!accs.length || !claimedAt) return accs;
    let q: string;
    if (type === "measure") {
      q = `SELECT DISTINCT account_no FROM case_138 WHERE account_no = ANY($1::text[]) AND uploaded_at >= $2`;
    } else if (type === "raise" || type === "stop") {
      const col = type === "stop" ? "last_stop_at" : "last_raise_at";
      q = `SELECT DISTINCT account_no FROM line_po_events WHERE account_no = ANY($1::text[]) AND ${col} >= $2`;
    } else {
      // الأنواع اللى بتشتغل بأرقام تليفون (مراجعة/جلب أكونت/بورت/WFM): بنستخدم نفس مصادر
      // jobProgress. اللى مالوش أثر فى قاعدة البيانات (تحديث ملفات) بيرجع كله كأنه متبقّى.
      const src: Record<string, [string, string, string]> = {
        subinfo:   ["line_subscriber_info", "phone_number", "fetched_at"],
        c360:      ["line_accounts", "full_phone", "updated_at"],
        portchange:["port_change_requests", "phone_number", "recorded_at"],
        portcheck: ["phone_ports", "phone_number", "uploaded_at"],
        wfmcancel: ["wfm_task_cancels", "phone_number", "canceled_at"],
      };
      const s = src[type];
      if (!s) return accs;
      q = `SELECT DISTINCT ${sp(s[1])} AS k FROM ${s[0]}
            WHERE ${sp(s[1])} = ANY(SELECT ${sp("x")} FROM unnest($1::text[]) AS x) AND ${s[2]} >= $2`;
      try {
        const { rows } = await pool.query(q, [accs, claimedAt]);
        const done = new Set((rows as any[]).map((r) => String(r.k).trim()));
        return accs.filter((a) => !done.has(a.replace(/\D/g, "").replace(/^88/, "")) && !done.has(a));
      } catch { return accs; }
    }
    try {
      const { rows } = await pool.query(q, [accs, claimedAt]);
      const done = new Set((rows as any[]).map((r) => String(r.account_no).trim()));
      return accs.filter((a) => !done.has(a));
    } catch { return accs; }
  };

  // فحص حالة المهمة الجارية لجهاز التنفيذ: لسه شغّالة (claimed)؟ فيه طلب عاجل يقطعها؟ اتقاس كام رقم؟
  //  - active=false → المهمة اتلغت/اتمسحت من الطابور (يدوى) → جهاز التنفيذ يوقف فوراً.
  //  - measured → عشان جهاز التنفيذ يكتشف لو DZS وقف (مفيش تقدّم لمدة) فيوقف بدل ما يعلّق ساعات.
  app.get("/api/exec-queue/job-check", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const jobId = parseInt(String(req.query.jobId || ""));
      if (!jobId) return res.json({ active: false, preempt: false, measured: 0, total: 0 });
      const { rows } = await pool.query(`SELECT priority, status, accounts, type, claimed_at, site FROM exec_jobs WHERE id = $1`, [jobId]);
      const job = rows[0];
      if (!job) return res.json({ active: false, preempt: false, measured: 0, total: 0 });
      const active = job.status === "claimed";
      // المقاطعة **داخل نفس الدومين فقط**: المواقع المختلفة بتشتغل بالتوازى أصلاً فمفيش سبب
      // إن مهمة عاجلة على DZS توقف مهمة شغّالة على FCC. لكن تحديث ملفات FCC (أولوية 3) بيوقف
      // مراجعة البيان الفنى الجارية على FCC، وبعد ما يخلص المراجعة بتكمّل للمتبقى.
      const { rows: p } = await pool.query(
        `SELECT 1 FROM exec_jobs
          WHERE status = 'pending' AND paused_at IS NULL AND priority > $1
            -- باتشات «إعادة التنفيذ بعد إيرور» ليها أعلى أولوية فى **الترتيب** بس،
            -- ومابتقاطعش مهمة شغّالة: بتستنى اللى شغّال يخلص وتتنفّذ بعده على طول.
            -- (المقاطعة مقصودة لتحديث الملفات اليومية بس.)
            AND retry_round = 0
            AND COALESCE(site, '10.42.187.101') = COALESCE($2, '10.42.187.101') LIMIT 1`,
        [job.priority ?? 0, job.site]);
      const prog = await jobProgress(job.accounts, job.type, job.claimed_at);
      res.json({ active, preempt: p.length > 0, measured: prog.done, total: prog.total });
    } catch {
      res.json({ active: true, preempt: false, measured: 0, total: 0 }); // فشل الفحص → نكمّل (fail-safe)
    }
  });

  // مقاطعة مهمة جارية: نعلّمها done (result=preempted) ونرجّع الأرقام المتبقية كمهمة جديدة
  // أولويتها 0 (تكملة) — فتتكمّل بعد الطلبات العاجلة كلها.
  app.post("/api/exec-queue/:id/preempt", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { rows } = await pool.query(
        `SELECT type, accounts, claimed_at, note, requested_by, priority, site, batch_id, params, requested_from FROM exec_jobs WHERE id = $1`, [id]);
      const job = rows[0];
      if (!job) return res.json({ ok: false });
      const remaining = await jobRemainingAccounts(job.accounts, job.type, job.claimed_at);
      // حارس التكرار: لو الطلب اتكرر (إعادة محاولة شبكة مثلاً) المهمة مش claimed
      // خلاص — من غير الحارس كانت بتتضاف مهمة تكملة **تانية** بنفس الأرقام فتتقاس مرتين.
      const up = await pool.query(
        `UPDATE exec_jobs SET status = 'done', done_at = now(), result = 'preempted'
          WHERE id = $1 AND status = 'claimed'`, [id]);
      if (!up.rowCount) return res.json({ ok: true, remaining: 0, newId: null, duplicate: true });
      let newId: number | null = null;
      if (remaining.length) {
        const note = (job.note ? job.note + " " : "") + "(تكملة)";
        // الطلب الصغير/العاجل (أولوية ≥2) بيرجع بنفس أولويته فيكمّل فوراً بعد اللى قاطعه
        // (مثلاً مراجعة اتقطعت لتحديث ملفات FCC → بتكمّل أول ما التحديث يخلص).
        // الباتش الكبير بينزل لـ 0 زى ما هو عشان مايزاحمش الطلبات العاجلة.
        const newPriority = (job.priority ?? 0) >= 2 ? job.priority : 0;
        const { rows: ins } = await pool.query(
          `INSERT INTO exec_jobs (type, accounts, requested_by, note, priority, site, batch_id, params, requested_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [job.type, JSON.stringify(remaining), job.requested_by || null, note, newPriority,
           job.site || SITE_OF_TYPE[job.type] || "10.42.187.101", job.batch_id || null, job.params || null,
           job.requested_from || null]);
        newId = ins[0].id;
      }
      res.json({ ok: true, remaining: remaining.length, newId });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ترتيب مهمة معيّنة فى الطابور (للعرض للمستخدم اللى طلبها) — يتقدّم كل ما تتنفّذ مهمة قبلها.
  // position = عدد المهام النشطة قبلها + 1 (بنفس ترتيب السحب: created_at ثم id). 0/done = خلصت.
  // بيرجّع كمان تقدّم مهمة المستخدم (jobDone/jobTotal) وتقدّم المهمة الجارية دلوقتى (active) — عشان
  // لو المهمة (بتاعته أو اللى قبله) فيها أكثر من خط يعرف وصلت لرقم كام.
  app.get("/api/exec-queue/position", requireAuth, async (req, res) => {
    try {
      await expireOrphanedExecJobs();
      const id = parseInt(String(req.query.id || ""));
      if (!id) return res.json({ found: false });
      const { rows } = await pool.query(`SELECT status, created_at, claimed_at, accounts, type, result FROM exec_jobs WHERE id = $1`, [id]);
      const job = rows[0];
      if (!job) return res.json({ found: false });
      const jobProg = await jobProgress(job.accounts, job.type, job.claimed_at);
      // أى حالة غير نشطة = نهائية: done (اتنفّذت) أو stale/canceled (اتلغت لأن جهاز التنفيذ اتقفل)
      if (job.status !== "pending" && job.status !== "claimed") {
        const canceled = job.status !== "done";
        return res.json({ found: true, status: job.status, canceled, result: job.result || null, position: 0, total: 0, jobDone: jobProg.done, jobTotal: jobProg.total, active: null });
      }
      const { rows: a } = await pool.query(
        `SELECT COUNT(*)::int AS ahead FROM exec_jobs
         WHERE status IN ('pending','claimed') AND (created_at < $1 OR (created_at = $1 AND id < $2))`,
        [job.created_at, id]);
      const { rows: t } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM exec_jobs WHERE status IN ('pending','claimed')`);
      const ahead = a[0]?.ahead ?? 0;
      // المهمة الجاري تنفيذها الآن (أقدم مهمة claimed) — عشان المنتظرين يشوفوا وصلت لفين
      const { rows: cj } = await pool.query(
        `SELECT accounts, type, claimed_at FROM exec_jobs WHERE status = 'claimed' ORDER BY created_at, id LIMIT 1`);
      let active: { type: string; done: number; total: number } | null = null;
      if (cj[0]) {
        const ap = await jobProgress(cj[0].accounts, cj[0].type, cj[0].claimed_at);
        active = { type: cj[0].type, done: ap.done, total: ap.total };
      }
      res.json({
        found: true, status: job.status, position: ahead + 1, total: t[0]?.total ?? ahead + 1,
        jobDone: jobProg.done, jobTotal: jobProg.total, active,
      });
    } catch {
      res.json({ found: false });
    }
  });

  // ===== بوابة إدارة المستخدمين الموحّدة (سوبر أدمن فقط) =====
  // حساب واحد للموقعين: الدور الموحّد يحدّد دور الطلبات (users/scrypt) ودور الكوابل (cfm_users/bcrypt).
  // إنشاء/تعديل الدور/مسح/تصفير الباسورد يتعامل مع الجدولين معاً ويربطهم بـ cfm_user_id.
  const unifiedRoleOf = (sfRole: string | null, cfmRole: string | null): string => {
    // طابق الزوج (طلبات + كوابل) بالضبط الأول — يميّز مهندس الكوابل (external+cable_engineer) عن الشئون الخارجية (external+external_affairs)
    const exact = Object.entries(UNIFIED_ROLE_ACCESS).find(([, v]) => v.sf === (sfRole || null) && v.cfm === (cfmRole || null));
    if (exact) return exact[0];
    if (sfRole && (UNIFIED_ROLE_ACCESS as any)[sfRole]) return sfRole;
    const hit = Object.entries(UNIFIED_ROLE_ACCESS).find(([, v]) => v.sf === null && v.cfm === cfmRole);
    return hit ? hit[0] : (cfmRole || sfRole || "");
  };

  // قائمة الأدوار الموحّدة (للواجهة)
  app.get("/api/portal/roles", requireAuth, requireSuperAdmin, (_req, res) => {
    res.json(Object.entries(UNIFIED_ROLE_ACCESS).map(([key, v]) => ({ key, labelAr: v.labelAr, sf: v.sf, cfm: v.cfm, maint: v.maint })));
  });

  // القائمة الموحّدة: من جدول الطلبات + حسابات الكوابل اللى مالهاش حساب طلبات
  app.get("/api/portal/users", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT u.id AS "sfId", u.username, u.role AS "sfRole", u.worker_code AS "workerCode",
               u.password_plain AS "passwordPlain",
               COALESCE(u.suspended, false) AS suspended, cu.id AS "cfmId", cu.role AS "cfmRole", cu.name AS "cfmName"
        FROM users u
        LEFT JOIN LATERAL (
          SELECT c.* FROM cfm_users c WHERE c.id = u.cfm_user_id OR c.username = u.username
          ORDER BY (c.id = u.cfm_user_id) DESC LIMIT 1
        ) cu ON true
        UNION ALL
        SELECT NULL AS "sfId", cu.username, NULL AS "sfRole", NULL AS "workerCode",
               NULL AS "passwordPlain",
               COALESCE(cu.suspended, false) AS suspended, cu.id AS "cfmId", cu.role AS "cfmRole", cu.name AS "cfmName"
        FROM cfm_users cu
        WHERE NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.cfm_user_id = cu.id OR u2.username = cu.username)
        ORDER BY username`);
      res.json(rows.map((r: any) => ({ ...r, unifiedRole: unifiedRoleOf(r.sfRole, r.cfmRole) })));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // إنشاء مستخدم موحّد: ينشئ حساب الطلبات و/أو الكوابل حسب الدور، ويربطهم.
  app.post("/api/portal/users", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      const { username, password, role, workerCode, name } = req.body || {};
      const uname = String(username || "").trim();
      if (!uname || !password || !role) return res.status(400).json({ message: "الاسم وكلمة السر والدور مطلوبين" });
      const acc = (UNIFIED_ROLE_ACCESS as any)[role];
      if (!acc) return res.status(400).json({ message: "دور غير معروف" });
      const dupSf = (await pool.query(`SELECT 1 FROM users WHERE username = $1`, [uname])).rowCount;
      const dupCfm = (await pool.query(`SELECT 1 FROM cfm_users WHERE username = $1`, [uname])).rowCount;
      if (dupSf || dupCfm) return res.status(400).json({ message: "اسم المستخدم موجود بالفعل" });
      let cfmId: string | null = null;
      if (acc.cfm) {
        const ph = bcryptjs.hashSync(String(password), 10);
        const ins = await pool.query(
          `INSERT INTO cfm_users (id, username, password, name, role, is_initial_password, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, false, now()) RETURNING id`,
          [uname, ph, String(name || uname).trim(), acc.cfm]);
        cfmId = ins.rows[0].id;
      }
      let sfId: number | null = null;
      if (acc.sf) {
        const hp = await hashPassword(String(password));
        // نخزّن الدور الفعّال فى الطلبات (acc.sf) — لكل الأدوار = اسم الدور الموحّد نفسه، ما عدا
        // مهندس الكوابل: طلباته «external» فيتعامل معاه موقع الطلبات كشئون خارجية بدون أى تغيير.
        const ins = await pool.query(
          `INSERT INTO users (username, password, role, worker_code, full_name, password_plain, cfm_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [uname, hp, acc.sf, workerCode?.trim() || null, String(name || "").trim() || null, String(password), cfmId]);
        sfId = ins.rows[0].id;
      }
      res.status(201).json({ ok: true, username: uname, role, sfId, cfmId });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // تغيير دور مستخدم حالى (سوبر أدمن فقط) — يظبط الجدولين حسب الدور الجديد.
  app.patch("/api/portal/users/:username/role", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      const uname = String(req.params.username || "").trim();
      const { role, password } = req.body || {};
      const acc = (UNIFIED_ROLE_ACCESS as any)[role];
      if (!acc) return res.status(400).json({ message: "دور غير معروف" });
      const sf = (await pool.query(`SELECT * FROM users WHERE username = $1`, [uname])).rows[0];
      const cfm = (await pool.query(`SELECT * FROM cfm_users WHERE username = $1`, [uname])).rows[0];
      let sfId: number | null = sf?.id ?? null;
      // جهة الطلبات (نخزّن الدور الفعّال acc.sf — مهندس الكوابل = external فى الطلبات)
      if (acc.sf && sf) {
        await pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [acc.sf, sf.id]);
      } else if (acc.sf && !sf) {
        // الدور الجديد يحتاج حساب طلبات ومفيش (المستخدم كان كوابل فقط) → ننشئه بكلمة السر المُرسلة
        // ونربطه بحساب الكوابل الموجود. الكوابل بيفضل بباسورده القديم، والطلبات بالباسورد الجديد
        // (الدخول موحّد بعد كده: يدخل الطلبات فيتفتح الكوابل تلقائياً).
        if (!password || String(password).length < 3) return res.status(400).json({ message: "الدور الجديد يحتاج حساب طلبات — ابعت كلمة سر لإنشائه", needPassword: true });
        const hp = await hashPassword(String(password));
        const ins = await pool.query(
          `INSERT INTO users (username, password, role, cfm_user_id) VALUES ($1,$2,$3,$4) RETURNING id`,
          [uname, hp, acc.sf, cfm?.id ?? null]);
        sfId = ins.rows[0].id;
      } else if (!acc.sf && sf) {
        await pool.query(`DELETE FROM users WHERE id = $1`, [sf.id]); // الدور الجديد كوابل فقط
        sfId = null;
      }
      // جهة الكوابل
      if (acc.cfm) {
        if (cfm) await pool.query(`UPDATE cfm_users SET role = $1 WHERE id = $2`, [acc.cfm, cfm.id]);
        else {
          // مفيش حساب كوابل → أنشئ واحد مربوط (باسورد عشوائى؛ الدخول عبر SSO من الطلبات)
          const ph = bcryptjs.hashSync(randomBytes(24).toString("hex"), 10);
          const ins = await pool.query(
            `INSERT INTO cfm_users (id, username, password, name, role, is_initial_password, created_at)
             VALUES (gen_random_uuid()::text, $1, $2, $1, $3, false, now())
             ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
            [uname, ph, acc.cfm]);
          if (sfId && ins.rows[0]) await pool.query(`UPDATE users SET cfm_user_id = $1 WHERE id = $2`, [ins.rows[0].id, sfId]);
        }
      } else if (cfm) {
        await pool.query(`DELETE FROM cfm_users WHERE id = $1`, [cfm.id]);
        if (sf) await pool.query(`UPDATE users SET cfm_user_id = NULL WHERE id = $1`, [sf.id]);
      }
      res.json({ ok: true, username: uname, role });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // تغيير الاسم الظاهر — يُخزَّن فى حساب الطلبات (users.full_name، ويُستخدم أيضاً فى برنامج الصيانة
  // عبر SSO) وفى حساب الكوابل (cfm_users.name، اللى بيظهر لما المستخدم يضيف حاجة). أى واحد منهم يكفى.
  app.patch("/api/portal/users/:username/name", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      const uname = String(req.params.username || "").trim();
      const name = String(req.body?.name || "").trim();
      if (!name) return res.status(400).json({ message: "الاسم مطلوب" });
      // دايماً: حدّث الاسم فى حساب الطلبات (لو موجود) — ده اللى بيوصل لبرنامج الصيانة.
      const sfUpd = await pool.query(`UPDATE users SET full_name = $1 WHERE username = $2`, [name, uname]);
      // حدّث اسم الكوابل لو للمستخدم حساب كوابل.
      const r = await pool.query(`UPDATE cfm_users SET name = $1 WHERE username = $2`, [name, uname]);
      let created = false;
      if (!r.rowCount) {
        // مفيش حساب كوابل — لو دور المستخدم بيفتح الكوابل ننشئه دلوقتى بالاسم ده ونربطه (الحسابات القديمة).
        const sf = (await pool.query(`SELECT * FROM users WHERE username = $1`, [uname])).rows[0];
        const cfmRole = sf?.role ? cfmRoleOf(sf.role) : null;
        if (cfmRole) {
          const ph = bcryptjs.hashSync(randomBytes(24).toString("hex"), 10);
          const ins = await pool.query(
            `INSERT INTO cfm_users (id, username, password, name, role, is_initial_password, created_at)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, false, now())
             ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [uname, ph, name, cfmRole]);
          if (sf && ins.rows[0]) await pool.query(`UPDATE users SET cfm_user_id = $1 WHERE id = $2`, [ins.rows[0].id, sf.id]);
          created = true;
        }
      }
      if (!sfUpd.rowCount && !r.rowCount && !created) return res.status(404).json({ message: "المستخدم غير موجود" });
      res.json({ ok: true, created });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // تصفير كلمة السر لمستخدم — تتغيّر فى الموقعين (scrypt + bcrypt)
  app.post("/api/portal/users/:username/reset-password", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      const uname = String(req.params.username || "").trim();
      const newPassword = String(req.body?.newPassword || "");
      if (newPassword.length < 3) return res.status(400).json({ message: "كلمة السر قصيرة جداً" });
      await pool.query(`UPDATE users SET password = $1, password_plain = $2 WHERE username = $3`, [await hashPassword(newPassword), newPassword, uname]);
      await pool.query(`UPDATE cfm_users SET password = $1, is_initial_password = true WHERE username = $2`, [bcryptjs.hashSync(newPassword, 10), uname]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/auth/change-my-password — أى مستخدم مسجّل دخول يغيّر كلمة السر بتاعته
  // (يتحقق من الحالية). يحدّث الطلبات + الكوابل (لو له حساب) ويخزّن النسخة النصية للسوبر أدمن.
  app.post("/api/auth/change-my-password", requireAuth, async (req: any, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword || "");
      const newPassword = String(req.body?.newPassword || "");
      if (newPassword.length < 3) return res.status(400).json({ message: "كلمة السر الجديدة قصيرة جداً (3 أحرف على الأقل)" });
      const me = await storage.getUser(req.user.id);
      if (!me) return res.status(404).json({ message: "المستخدم غير موجود" });
      const ok = await comparePassword(currentPassword, me.password);
      if (!ok) return res.status(400).json({ message: "كلمة السر الحالية غير صحيحة" });
      await pool.query(`UPDATE users SET password = $1, password_plain = $2 WHERE id = $3`, [await hashPassword(newPassword), newPassword, me.id]);
      await pool.query(`UPDATE cfm_users SET password = $1 WHERE username = $2`, [bcryptjs.hashSync(newPassword, 10), me.username]).catch(() => {});
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // إيقاف/تنشيط حساب — يوقف الدخول فى الموقعين (الطلبات + الكوابل)
  app.post("/api/portal/users/:username/suspend", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      const uname = String(req.params.username || "").trim();
      if (uname === req.user.username) return res.status(400).json({ message: "لا يمكنك إيقاف حسابك" });
      const suspended = !!req.body?.suspended;
      await pool.query(`UPDATE users SET suspended = $1 WHERE username = $2`, [suspended, uname]);
      await pool.query(`UPDATE cfm_users SET suspended = $1 WHERE username = $2`, [suspended, uname]).catch(() => {});
      res.json({ ok: true, suspended });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // مسح مستخدم من الموقعين
  app.delete("/api/portal/users/:username", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      const uname = String(req.params.username || "").trim();
      if (uname === req.user.username) return res.status(400).json({ message: "لا يمكنك حذف حسابك" });
      await pool.query(`DELETE FROM cfm_users WHERE username = $1`, [uname]);
      await pool.query(`DELETE FROM users WHERE username = $1`, [uname]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // === User Management Routes ===
  app.get(api.users.list.path, requireAuth, requireUserManager, async (req, res) => {
    const userList = await storage.getUsers();
    let sanitized = userList.map(u => ({ id: u.id, username: u.username, role: u.role, workerCode: u.workerCode, suspended: u.suspended, createdAt: u.createdAt }));
    // أدمن المبيعات يرى مستخدمى المبيعات فقط
    if ((req.user as any).role === ROLES.SALES_ADMIN) {
      sanitized = sanitized.filter(u => u.role === ROLES.SALES);
    }
    res.json(sanitized);
  });

  app.post(api.users.create.path, requireAuth, requireUserManager, async (req, res) => {
    try {
      const { username, password, role, workerCode } = req.body;

      if (!username || !password || !role) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // أدمن المبيعات: مستخدمى مبيعات فقط.
      // الأدمن العادى: sales/sales_admin/tech/external/data_manager.
      // الأدمن الأعلى (super_admin): كمان أدمن عادى وأدمن أعلى.
      const requesterRole = (req.user as any).role;
      const validRoles = requesterRole === ROLES.SUPER_ADMIN
        ? [ROLES.SALES, ROLES.SALES_ADMIN, ROLES.TECH, ROLES.EXTERNAL, ROLES.DATA_MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN]
        : requesterRole === ROLES.SALES_ADMIN
          ? [ROLES.SALES]
          : [ROLES.SALES, ROLES.SALES_ADMIN, ROLES.TECH, ROLES.EXTERNAL, ROLES.DATA_MANAGER];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ message: "دور غير مسموح به لهذا المستخدم" });
      }

      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({ username, password: hashedPassword, role, workerCode: workerCode?.trim() || null });
      res.status(201).json({ id: user.id, username: user.username, role: user.role, workerCode: user.workerCode });
    } catch (e) {
      res.status(500).json({ message: "Error creating user" });
    }
  });

  app.put(api.users.changePassword.path, requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const dbUser = await storage.getUser(user.id);
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      const isValid = await comparePassword(currentPassword, dbUser.password);
      if (!isValid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      const hashedPassword = await hashPassword(newPassword);
      await storage.updateUserPassword(user.id, hashedPassword);
      res.json({ message: "Password updated successfully" });
    } catch (e) {
      res.status(500).json({ message: "Error updating password" });
    }
  });

  app.delete(api.users.delete.path, requireAuth, requireUserManager, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const currentUser = req.user as any;

      if (userId === currentUser.id) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      const userToDelete = await storage.getUser(userId);
      if (!userToDelete) {
        return res.status(404).json({ message: "User not found" });
      }
      if (!canManageTarget(currentUser.role, userToDelete.role)) {
        return res.status(403).json({ message: "لا يمكنك التحكم فى حساب مدير — للأدمن الأعلى فقط" });
      }

      await storage.deleteUser(userId);
      res.json({ message: "User deleted successfully" });
    } catch (e) {
      res.status(500).json({ message: "Error deleting user" });
    }
  });

  app.put(api.users.suspend.path, requireAuth, requireUserManager, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const currentUser = req.user as any;
      const { suspended } = req.body;

      if (userId === currentUser.id) {
        return res.status(400).json({ message: "Cannot suspend your own account" });
      }

      const userToSuspend = await storage.getUser(userId);
      if (!userToSuspend) {
        return res.status(404).json({ message: "User not found" });
      }
      if (!canManageTarget(currentUser.role, userToSuspend.role)) {
        return res.status(403).json({ message: "لا يمكنك التحكم فى حساب مدير — للأدمن الأعلى فقط" });
      }

      const updatedUser = await storage.suspendUser(userId, suspended);
      res.json({ id: updatedUser.id, username: updatedUser.username, role: updatedUser.role, suspended: updatedUser.suspended });
    } catch (e) {
      res.status(500).json({ message: "Error updating user suspension" });
    }
  });

  // 🆕 تعيين رقم العامل لمستخدم (للفنيين) — يربط الحساب ببياناته فى التقارير
  app.put(api.users.setWorkerCode.path, requireAuth, requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const currentUser = req.user as any;
      const { workerCode } = req.body;
      const userToEdit = await storage.getUser(userId);
      if (!userToEdit) {
        return res.status(404).json({ message: "User not found" });
      }
      if (!canManageTarget(currentUser.role, userToEdit.role)) {
        return res.status(403).json({ message: "لا يمكنك التحكم فى حساب مدير — للأدمن الأعلى فقط" });
      }
      const updatedUser = await storage.updateUserWorkerCode(userId, (workerCode || "").trim());
      res.json({ id: updatedUser.id, username: updatedUser.username, role: updatedUser.role, workerCode: updatedUser.workerCode, suspended: updatedUser.suspended });
    } catch (e) {
      res.status(500).json({ message: "Error updating worker code" });
    }
  });

  // === Order Routes ===

  app.get(api.orders.list.path, requireAuth, async (req, res) => {
    const user = req.user as any;

    if (user.role === ROLES.SALES) {
      const allOrders = await storage.getOrdersBySalesId(user.id);
      // Sales sees non-contracted orders only
      const filteredOrders = allOrders.filter(o => o.contractStatus === CONTRACT_STATUS.NOT_CONTRACTED);
      return res.json(filteredOrders);
    }

    if (user.role === ROLES.EXTERNAL) {
      // الشئون الخارجية (ومنها مهندس الكوابل) تقدر تشوف كل الطلبات؛
      // الفلترة لـ«الطلبات المطلوب الرد عليها» (needs_external) بتتم فى الواجهة (تبديل بزر).
      const orders = await storage.getOrders();
      return res.json(await attachCabinetTech(orders));
    }

    if (user.role === ROLES.TECH) {
      // الفنى يشوف (عدا needs_external):
      //  - الطلبات قيد الانتظار: المُسنَدة له (assign) أو غير المُسنَدة لأى حد (متاحة للكل).
      //  - الطلبات غير قيد الانتظار: اللى ردّ عليها هو، أو المُسنَدة له.
      const allOrders = await storage.getOrders();
      const techOrders = allOrders.filter((o: any) => {
        if (o.status === ORDER_STATUS.NEEDS_EXTERNAL) return false;
        if (o.status === ORDER_STATUS.PENDING) {
          return o.assignedTechId == null || o.assignedTechId === user.id;
        }
        return o.techId === user.id || o.assignedTechId === user.id;
      });
      return res.json(await attachCabinetTech(techOrders));
    }

    // Admin sees all orders
    const orders = await storage.getOrders();
    res.json(await attachCabinetTech(orders));
  });

  // PUT /api/orders/:id/assign — الأدمن بيعمل assign لطلب قيد الانتظار لفنى محدد (techId=null لإلغاء التعيين)
  app.put("/api/orders/:id/assign", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { techId } = req.body;
      const cur = await pool.query(`SELECT id, status FROM orders WHERE id = $1`, [id]);
      if (!cur.rows.length) return res.status(404).json({ message: "Order not found" });
      if (cur.rows[0].status !== ORDER_STATUS.PENDING) {
        return res.status(400).json({ message: "لا يمكن التعيين إلا لطلب قيد الانتظار" });
      }
      let aId: number | null = null, aName: string | null = null;
      if (techId != null && techId !== "") {
        const tech = await storage.getUser(Number(techId));
        if (!tech || tech.role !== ROLES.TECH) return res.status(400).json({ message: "فنى غير صالح" });
        aId = tech.id; aName = tech.username;
      }
      const upd = await pool.query(
        `UPDATE orders SET assigned_tech_id = $1, assigned_tech_name = $2 WHERE id = $3 RETURNING *`,
        [aId, aName, id],
      );
      res.json(upd.rows[0]);
    } catch (e: any) {
      res.status(500).json({ message: e.message || "Error assigning order" });
    }
  });

  // GET /api/techs — قائمة الفنيين (id + اسم) — متاحة لأى مستخدم مسجّل (المبيعات تحتاجها لاختيار فنى وقت الإنشاء)
  app.get("/api/techs", requireAuth, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, username FROM users WHERE role = $1 AND suspended IS NOT TRUE ORDER BY username`,
      [ROLES.TECH],
    );
    res.json(rows);
  });

  app.post(api.orders.create.path, requireAuth, async (req, res) => {
    const user = req.user as any;
    if (user.role !== ROLES.SALES && user.role !== ROLES.SALES_ADMIN && !hasAdminAccess(user.role)) {
      return res.status(403).json({ message: "Only Sales can create orders" });
    }

    try {
      const input = insertOrderSchema.parse(req.body);
      // إسناد اختيارى وقت الإنشاء: نقبل assignedTechId فقط ونشتق الاسم من السيرفر (نمنع التلاعب من العميل)
      let assignedTechId: number | null = null;
      let assignedTechName: string | null = null;
      const rawAssign = (req.body as any).assignedTechId;
      if (rawAssign != null && rawAssign !== "") {
        const tid = parseInt(String(rawAssign));
        if (!isNaN(tid)) {
          const { rows } = await pool.query(`SELECT id, username, role FROM users WHERE id = $1`, [tid]);
          const tech = rows[0];
          if (tech && tech.role === ROLES.TECH) { assignedTechId = tech.id; assignedTechName = tech.username; }
        }
      }
      // لو المبيعات ساب "الكل" (مفيش إسناد يدوى) → إسناد تلقائى حسب كلمات فى العنوان.
      // نطبّع الحروف العربية (ى/ي، ة/ه، الهمزات، التشكيل) عشان المطابقة تكون مضمونة.
      if (assignedTechId == null) {
        // تطبيع قوى: همزات + ى/ي + ة/ه + إزالة التشكيل والتطويل + إزالة "ال" التعريف + إزالة كل المسافات.
        // كده "دير الجنادله" = "دير الجنادلة" = "ديرالجنادله" = "الدير الجنادلة" كلهم بيتطابقوا.
        const normAr = (s: string) => (s || "")
          .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
          .replace(/[ًٌٍَُِّْـ]/g, "")
          .replace(/ال/g, "")
          .replace(/\s+/g, "")
          .trim();
        const AUTO_RULES: { tech: string; keys: string[] }[] = [
          { tech: "سامى",  keys: ["دير الجنادله", "دير الجنادلة"] },
          { tech: "محمود", keys: ["مشايعه", "مشايعة"] },
          { tech: "اسلام", keys: ["عزايزه", "عزايزة", "عامرى", "عامري", "اولاد محمد", "أولاد محمد"] },
        ];
        const addrN = normAr(String((input as any).customerAddress || ""));
        const rule = AUTO_RULES.find((r) => r.keys.some((k) => addrN.includes(normAr(k))));
        if (rule) {
          const { rows } = await pool.query(`SELECT id, username FROM users WHERE role = $1`, [ROLES.TECH]);
          const t = rows.find((u: any) => normAr(u.username).includes(normAr(rule.tech)));
          if (t) { assignedTechId = t.id; assignedTechName = t.username; }
        }
      }
      const order = await storage.createOrder({
        ...input,
        assignedTechId,
        assignedTechName,
        salesId: user.id,
        salesName: user.username,
      });
      
      broadcast({ type: WS_EVENTS.ORDER_CREATE, payload: order });
      res.status(201).json(order);
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        res.status(400).json(e.errors);
      } else {
        // كان بيرمى الخطأ تانى → unhandled rejection بيوقع السيرفر كله
        console.error("[orders/create]", e?.stack || e);
        res.status(500).json({ message: e?.message || "خطأ فى إنشاء الطلب" });
      }
    }
  });

  // ── مزامنة الرد بين الطلب والمتعذر المربوطين بتطابق مؤكَّد ──────────────
  // بعد ما السوبر أدمن يأكّد التطابق، الاتنين بقوا **نفس الحالة**. فأى رد يتسجّل
  // على أى ناحية فى أى وقت (رد فنى، تحويل للشئون الخارجية، رد خارجى، أو إلغاء
  // الرد) بينزل على الناحية التانية على طول — مش وقت التأكيد بس.
  // بيكتب بـ SQL مباشر (مش من خلال الـ endpoints) فمافيش استدعاء متبادل لا نهائى،
  // وبيتنادى بعد ما الرد الأصلى يتحفظ فأى فشل هنا مايضيّعش الرد نفسه.
  // (تكتات البكس مابتتفتحش من هنا — الحالة واحدة والتكت بتتفتح من الناحية
  //  اللى اترد عليها فعلاً، وبرنامج الكوابل أصلاً بيمنع تكرار التكت على نفس البكس.)
  async function syncMatchedResponse(src: { orderId?: number; serial?: string }) {
    try {
      const byOrder = src.orderId != null;
      const { rows: mm } = await pool.query(
        byOrder
          ? `SELECT order_id, om_serial FROM om_order_matches WHERE order_id = $1`
          : `SELECT order_id, om_serial FROM om_order_matches WHERE om_serial = $1`,
        [byOrder ? src.orderId : String(src.serial ?? "")]);
      if (!mm.length) return;              // مش مربوط بتطابق مؤكَّد → مافيش مزامنة
      const orderId = Number(mm[0].order_id);
      const serial = String(mm[0].om_serial);

      if (byOrder) {
        // طلبات → متعذرات
        const { rows } = await pool.query(
          `SELECT status, is_feasible, rejection_reason, central_name, cabin_number, box_number,
                  nearest_box_distance, additional_notes, tech_id, tech_name, tech_response_at,
                  external_id, external_name, is_feasible_external, external_rejection_reason,
                  external_response_at
             FROM orders WHERE id = $1`, [orderId]);
        if (!rows.length) return;
        const o = rows[0];
        await pool.query(
          `INSERT INTO om_responses (serial_number, status, is_feasible, rejection_reason, central_name,
              cabin_number, box_number, nearest_box_distance, additional_notes, tech_id, tech_name,
              responded_at, external_id, external_name, is_feasible_external, external_rejection_reason,
              external_response_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
           ON CONFLICT (serial_number) DO UPDATE SET
             status = EXCLUDED.status, is_feasible = EXCLUDED.is_feasible,
             rejection_reason = EXCLUDED.rejection_reason,
             central_name = COALESCE(EXCLUDED.central_name, om_responses.central_name),
             cabin_number = COALESCE(EXCLUDED.cabin_number, om_responses.cabin_number),
             box_number = COALESCE(EXCLUDED.box_number, om_responses.box_number),
             nearest_box_distance = COALESCE(EXCLUDED.nearest_box_distance, om_responses.nearest_box_distance),
             additional_notes = EXCLUDED.additional_notes,
             tech_id = EXCLUDED.tech_id, tech_name = EXCLUDED.tech_name,
             responded_at = EXCLUDED.responded_at,
             external_id = EXCLUDED.external_id, external_name = EXCLUDED.external_name,
             is_feasible_external = EXCLUDED.is_feasible_external,
             external_rejection_reason = EXCLUDED.external_rejection_reason,
             external_response_at = EXCLUDED.external_response_at, updated_at = now()`,
          [serial, o.status, o.is_feasible, o.rejection_reason, o.central_name, o.cabin_number,
           o.box_number, o.nearest_box_distance, o.additional_notes, o.tech_id, o.tech_name,
           o.tech_response_at, o.external_id, o.external_name, o.is_feasible_external,
           o.external_rejection_reason, o.external_response_at]);
      } else {
        // متعذرات → طلبات
        const { rows } = await pool.query(
          `SELECT status, is_feasible, rejection_reason, central_name, cabin_number, box_number,
                  nearest_box_distance, additional_notes, tech_id, tech_name, responded_at,
                  external_id, external_name, is_feasible_external, external_rejection_reason,
                  external_response_at
             FROM om_responses WHERE serial_number = $1`, [serial]);
        if (rows.length) {
          const m = rows[0];
          await pool.query(
            `UPDATE orders SET status = $2, is_feasible = $3, rejection_reason = $4,
                    central_name = COALESCE($5, central_name),
                    cabin_number = COALESCE($6, cabin_number),
                    box_number = COALESCE($7, box_number),
                    nearest_box_distance = COALESCE($8, nearest_box_distance),
                    additional_notes = $9, tech_id = $10, tech_name = $11, tech_response_at = $12,
                    external_id = $13, external_name = $14, is_feasible_external = $15,
                    external_rejection_reason = $16, external_response_at = $17
              WHERE id = $1`,
            [orderId, m.status, m.is_feasible, m.rejection_reason, m.central_name, m.cabin_number,
             m.box_number, m.nearest_box_distance, m.additional_notes, m.tech_id, m.tech_name,
             m.responded_at, m.external_id, m.external_name, m.is_feasible_external,
             m.external_rejection_reason, m.external_response_at]);
        } else {
          // الرد اتلغى خالص من ناحية المتعذرات → الطلب يرجع «قيد الانتظار»
          await pool.query(
            `UPDATE orders SET status = $2, is_feasible = NULL, rejection_reason = NULL,
                    tech_id = NULL, tech_name = NULL, tech_response_at = NULL,
                    external_id = NULL, external_name = NULL, is_feasible_external = NULL,
                    external_rejection_reason = NULL, external_response_at = NULL
              WHERE id = $1`, [orderId, ORDER_STATUS.PENDING]);
        }
      }
      // الواجهة عند الطرف التانى تتحدّث من غير ما المستخدم يعمل ريفرش
      try {
        const o = await storage.getOrder(orderId);
        if (o) broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: o });
      } catch {}
    } catch (e: any) { console.error("[match-sync]", e?.stack || e); }
  }

  app.put(api.orders.update.path, requireAuth, async (req, res) => {
    const user = req.user as any;
    // Only Tech (or Admin) can update status/feasibility
    if (user.role !== ROLES.TECH && !hasAdminAccess(user.role)) {
      return res.status(403).json({ message: "Only Tech can update order status" });
    }

    try {
      const id = parseInt(req.params.id);
      const input = updateOrderSchema.parse(req.body);
      
      // Determine status
      let status = "pending";
      if (input.isFeasible === true) status = "feasible";
      if (input.isFeasible === false) status = "not_feasible";

      const order = await storage.updateOrder(id, {
        ...input,
        status,
        // الطلب بقى «يمكن التنفيذ» → المتعذر خلاص اتحلّ، فبنمسح سببه.
        // ⚠️ من غير المسح ده كان السبب القديم («بوكس معطل») بيفضل مكتوب على الصف
        // للأبد (updateOrder بيتجاهل الحقول اللى مش فى input)، فالطلب يفضل محسوب
        // متعذر على البكس فى برنامج الكوابل رغم إنه اتنفّذ. نفس اللى بيحصل فى
        // متعذرات OM بالظبط (بتمسح rejection_reason لما is_feasible يبقى true).
        ...(status === "feasible" ? { rejectionReason: null, isFeasible: true } : {}),
        techId: user.id,
        techName: user.username,
        techResponseAt: new Date(),
      });

      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
      if (status === "feasible") {
        await notifyOrderFeasible(order, "tech");
      }
      // «بوكس معطل» → تكت تلقائى على برنامج الكوابل (لو البكس مش مغطّى بتكت مفتوحة).
      // بيتنفّذ بعد حفظ الرد وبيرجّع نتيجته فى الرد — فشل التكت مايمنعش تسجيل الرد.
      let boxTicket: any = null;
      // الطلب بقى «يمكن التنفيذ» → لو التكت اتفتحت تلقائياً بسبب المتعذر ده ومفيش
      // متعذر تانى على نفس البكس، تروح «انتظار التأكيد» (ومهندس الكوابل لسه يقدر
      // يضيف مهمات وأعمال). التكت المفتوحة يدوى مابتتلمسش.
      if (order && status === "feasible") {
        await settleBoxTicketIfCleared({
          central: (order as any).centralName, cabinet: (order as any).cabinNumber,
          box: (order as any).boxNumber,
        }).catch(() => {});
      }
      if (order && (order as any).rejectionReason === REJECTION_REASONS.BOX_BROKEN) {
        boxTicket = await openBoxFaultTicket({
          central: (order as any).centralName, cabinet: (order as any).cabinNumber,
          box: (order as any).boxNumber, techName: user.username, source: "طلبات",
          respondedAt: (order as any).techResponseAt, refKey: `طلب #${id}`,
          customerName: (order as any).customerName, nationalId: (order as any).nationalId,
        });
      }
      // لو الطلب مربوط بمتعذر مؤكَّد → الرد ينزل عليه على طول
      await syncMatchedResponse({ orderId: id });
      res.json(boxTicket ? { ...order, boxTicket } : order);
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        res.status(400).json(e.errors);
      } else {
        // ده مسار حفظ رد الفنى — إعادة الرمى كانت بتوقع السيرفر كله عند أى خطأ DB
        console.error("[orders/update]", e?.stack || e);
        res.status(500).json({ message: e?.message || "خطأ فى حفظ الرد" });
      }
    }
  });

  app.post(api.orders.resetTechResponse.path, requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      // الأدمن/الأدمن الأعلى + أدمن المبيعات يقدروا يرجّعوا المعاينة للفنى
      if (!hasAdminAccess(user.role) && user.role !== ROLES.SALES_ADMIN) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const id = parseInt(req.params.id);

      const existingOrder = await storage.getOrder(id);
      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      const order = await storage.resetTechResponse(id);
      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
      await syncMatchedResponse({ orderId: id });
      res.json(order);
    } catch (e) {
      res.status(500).json({ message: "Error resetting order" });
    }
  });

  app.put(api.orders.updateContractStatus.path, requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const id = parseInt(req.params.id);
      const { contractStatus } = req.body;

      if (contractStatus !== CONTRACT_STATUS.CONTRACTED && contractStatus !== CONTRACT_STATUS.NOT_CONTRACTED) {
        return res.status(400).json({ message: "Invalid contract status" });
      }

      const existingOrder = await storage.getOrder(id);
      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (user.role === ROLES.SALES) {
        if (existingOrder.salesId !== user.id) {
          return res.status(403).json({ message: "Cannot update orders of other sales" });
        }
        if (contractStatus !== CONTRACT_STATUS.CONTRACTED) {
          return res.status(403).json({ message: "Sales can only mark as contracted" });
        }
        if (existingOrder.status === "pending") {
          return res.status(400).json({ message: "Cannot mark as contracted before tech response" });
        }
      } else if (user.role === ROLES.SALES_ADMIN) {
        // أدمن المبيعات مشرف على المبيعات كلها، فيقدر يعلّم أى طلب «تم التعاقد» (مش طلباته بس).
        // زر «تم التعاقد» كان ظاهر له فى الواجهة أصلاً لكن السيرفر كان بيرفضه بـ 403.
        // الرجوع لـ«لم يتم التعاقد» يفضل للأدمن وحده (زى ما مكتوب فى نافذة التأكيد).
        if (contractStatus !== CONTRACT_STATUS.CONTRACTED) {
          return res.status(403).json({ message: "إرجاع حالة التعاقد للأدمن فقط" });
        }
        if (existingOrder.status === ORDER_STATUS.PENDING) {
          return res.status(400).json({ message: "لا يمكن التعاقد قبل رد الفنى" });
        }
      } else if (!hasAdminAccess(user.role)) {
        return res.status(403).json({ message: "Only Sales or Admin can update contract status" });
      }

      const order = await storage.updateContractStatus(id, contractStatus);
      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
      res.json(order);
    } catch (e) {
      res.status(500).json({ message: "Error updating contract status" });
    }
  });

  // === External Review Routes ===

  app.post(api.orders.requestExternalReview.path, requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const id = parseInt(req.params.id);

      if (user.role !== ROLES.SALES && user.role !== ROLES.SALES_ADMIN && !hasAdminAccess(user.role)) {
        return res.status(403).json({ message: "Only Sales or Admin can request external review" });
      }

      const existingOrder = await storage.getOrder(id);
      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (user.role === ROLES.SALES && existingOrder.salesId !== user.id) {
        return res.status(403).json({ message: "Cannot request external review for other sales orders" });
      }

      if (existingOrder.status !== ORDER_STATUS.NOT_FEASIBLE) {
        return res.status(400).json({ message: "External review can only be requested for not_feasible orders" });
      }

      const order = await storage.requestExternalReview(id);
      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
      await syncMatchedResponse({ orderId: id });
      res.json(order);
    } catch (e) {
      res.status(500).json({ message: "Error requesting external review" });
    }
  });

  app.put(api.orders.externalResponse.path, requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const id = parseInt(req.params.id);

      if (user.role !== ROLES.EXTERNAL && !hasAdminAccess(user.role)) {
        return res.status(403).json({ message: "Only External Affairs can respond to orders" });
      }

      const existingOrder = await storage.getOrder(id);
      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (existingOrder.status !== ORDER_STATUS.NEEDS_EXTERNAL) {
        return res.status(400).json({ message: "Order is not awaiting external review" });
      }

      const input = updateExternalResponseSchema.parse(req.body);
      const newStatus = input.isFeasibleExternal ? ORDER_STATUS.EXTERNAL_FEASIBLE : ORDER_STATUS.EXTERNAL_NOT_FEASIBLE;

      const order = await storage.updateExternalResponse(id, {
        ...input,
        externalId: user.id,
        externalName: user.username,
        externalResponseAt: new Date(),
        status: newStatus,
      });

      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
      if (newStatus === ORDER_STATUS.EXTERNAL_FEASIBLE) {
        await notifyOrderFeasible(order, "external");
      }
      await syncMatchedResponse({ orderId: id });
      res.json(order);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json(e.errors);
      } else {
        res.status(500).json({ message: "Error saving external response" });
      }
    }
  });

  // === Notifications ===
  app.get("/api/notifications", requireAuth, async (req, res) => {
    const user = req.user as any;
    const [items, unread] = await Promise.all([
      storage.getNotificationsByUser(user.id),
      storage.getUnreadCount(user.id),
    ]);
    res.json({ items, unread });
  });

  app.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
    const user = req.user as any;
    await storage.markNotificationRead(parseInt(req.params.id), user.id);
    res.json({ success: true });
  });

  app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
    const user = req.user as any;
    await storage.markAllNotificationsRead(user.id);
    res.json({ success: true });
  });

  // === Phone Lines Reports ===

  // GET /api/fcc-centrals — أسماء السنترالات المرجعية الصحيحة من FCC (phone_lines).
  // تُستخدم لتغذية دروب‌ليست السنترال فى معاينة الفنى/الشئون الخارجية بأسماء FCC مباشرةً.
  app.get("/api/fcc-centrals", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT central FROM phone_lines WHERE central IS NOT NULL AND btrim(central) <> '' ORDER BY central`,
      );
      res.json((rows as any[]).map((r) => r.central));
    } catch (e) {
      console.error("Get FCC centrals error:", e);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/phone-lines/filter-options — returns unique centrals, cabins per central, boxes per central+cabin
  app.get("/api/phone-lines/filter-options", requireAuth, async (req, res) => {
    const { rows } = await pool.query(`
      SELECT DISTINCT central, cabin_number, box_number
      FROM phone_lines
      WHERE central IS NOT NULL AND central <> ''
    `);

    const centralSet = new Set<string>();
    const cabinMap = new Map<string, Set<string>>();
    const boxMap = new Map<string, Set<string>>();

    for (const r of rows) {
      const central = r.central || "";
      const cabin = r.cabin_number || "";
      const box = r.box_number || "";
      if (central) centralSet.add(central);
      if (central && cabin) {
        if (!cabinMap.has(central)) cabinMap.set(central, new Set());
        cabinMap.get(central)!.add(cabin);
      }
      if (central && cabin && box) {
        const key = `${central}||${cabin}`;
        if (!boxMap.has(key)) boxMap.set(key, new Set());
        boxMap.get(key)!.add(box);
      }
    }

    const centrals = Array.from(centralSet).sort((a, b) => a.localeCompare(b, "ar"));
    const cabins: Record<string, string[]> = {};
    for (const [central, set] of cabinMap) {
      cabins[central] = Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
    }
    const boxes: Record<string, string[]> = {};
    for (const [key, set] of boxMap) {
      boxes[key] = Array.from(set).sort((a, b) => a.localeCompare(b, "ar", { numeric: false, sensitivity: "base" }));
    }

    res.json({ centrals, cabins, boxes });
  });

  // GET /api/phone-lines/dp-options — distinct dp_terminals for central+cabin+box
  app.get("/api/phone-lines/dp-options", requireAuth, async (req, res) => {
    const { central = "", cabin = "", box = "" } = req.query as Record<string, string>;
    if (!central || !cabin || !box) return res.json([]);
    const { rows } = await pool.query(
      `SELECT DISTINCT dp_terminal FROM phone_lines WHERE central = $1 AND cabin_number = $2 AND box_number = $3 AND dp_terminal IS NOT NULL ORDER BY dp_terminal`,
      [central, cabin, box]
    );
    res.json(rows.map((r: any) => r.dp_terminal));
  });

  // GET /api/phone-lines/field-options — cascading options for edit form (cabins → boxes → dpTerminals)
  app.get("/api/phone-lines/field-options", requireAuth, async (req, res) => {
    const { central = "", cabin = "", box = "" } = req.query as Record<string, string>;
    const result: { cabins: string[]; boxes: string[]; dpTerminals: string[]; cabinetIns: string[] } = { cabins: [], boxes: [], dpTerminals: [], cabinetIns: [] };
    if (!central) return res.json(result);
    const { rows: cabinRows } = await pool.query(
      `SELECT DISTINCT cabin_number FROM phone_lines WHERE central = $1 AND cabin_number IS NOT NULL ORDER BY cabin_number`,
      [central]
    );
    result.cabins = cabinRows.map((r: any) => r.cabin_number);
    if (cabin) {
      const { rows: boxRows } = await pool.query(
        `SELECT DISTINCT box_number FROM phone_lines WHERE central = $1 AND cabin_number = $2 AND box_number IS NOT NULL ORDER BY box_number`,
        [central, cabin]
      );
      result.boxes = boxRows.map((r: any) => r.box_number);
      const { rows: cabinInRows } = await pool.query(
        `SELECT DISTINCT cabinet_in FROM phone_lines WHERE central = $1 AND cabin_number = $2 AND cabinet_in IS NOT NULL ORDER BY cabinet_in`,
        [central, cabin]
      );
      result.cabinetIns = cabinInRows.map((r: any) => r.cabinet_in);
      if (box) {
        const { rows: dpRows } = await pool.query(
          `SELECT DISTINCT dp_terminal FROM phone_lines WHERE central = $1 AND cabin_number = $2 AND box_number = $3 AND dp_terminal IS NOT NULL ORDER BY dp_terminal`,
          [central, cabin, box]
        );
        result.dpTerminals = dpRows.map((r: any) => r.dp_terminal);
      }
    }
    res.json(result);
  });

  // GET /api/phone-lines — paginated, with optional central/cabin/box or text search filters
  app.get("/api/phone-lines", requireAuth, async (req, res) => {
    const { search = "", central = "", cabin = "", box = "", phoneFrom = "", phoneTo = "", page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(20000, Math.max(1, parseInt(limit) || 50));
    const q = search.trim().toLowerCase();
    // نطاق أرقام: نطابق على الرقم القصير (بدون بادئة 88) كقيمة رقمية. نشيل أى غير أرقام ونشيل 88 لو اتكتبت.
    const digitsOnly = (s: string) => String(s || "").replace(/\D/g, "").replace(/^88/, "");
    let pFrom = digitsOnly(phoneFrom), pTo = digitsOnly(phoneTo);
    // الترتيب ملوش أهمية: لو «من» أكبر من «إلى» نبدّلهم عشان المدى ميطلعش فاضى.
    if (pFrom && pTo && BigInt(pFrom) > BigInt(pTo)) { const t = pFrom; pFrom = pTo; pTo = t; }

    const conds: string[] = [];
    const params: any[] = [];
    if (central) { params.push(central); conds.push(`pl.central = $${params.length}`); }
    if (cabin) { params.push(cabin); conds.push(`pl.cabin_number = $${params.length}`); }
    if (box) { params.push(box); conds.push(`pl.box_number = $${params.length}`); }
    // فلتر النطاق «من رقم / إلى رقم» — على الرقم القصير (شيل غير الأرقام + الأصفار البادئة + 88).
    // نستخدم CASE عشان التحويل لـ bigint يتم فقط لو القيمة رقمية (WHERE مبيضمنش ترتيب التقييم فـ
    // كاست مباشر بيقع بـ error على أى بورت رقمه فاضى/غير رقمى → الجدول يطلع فاضى).
    if (pFrom || pTo) {
      const shortExpr = `regexp_replace(regexp_replace(k.full_phone,'[^0-9]','','g'),'^0*88','')`;
      const numExpr = `(CASE WHEN ${shortExpr} ~ '^[0-9]{1,18}$' THEN ${shortExpr}::bigint END)`;
      if (pFrom) { params.push(pFrom); conds.push(`${numExpr} >= $${params.length}::bigint`); }
      if (pTo) { params.push(pTo); conds.push(`${numExpr} <= $${params.length}::bigint`); }
    }
    if (q) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      // بحث نصّى فى كل الأعمدة الظاهرة: التليفون/الأكونت/الاسم/العنوان/السنترال/الكابينة/البكس
      // + كل الحقول الفنية (IDU/ODU/DP/البلوكات/الفايبر/البورت...). الأكونت عبر EXISTS (مش join
      // فى الـ count). كله ::text عشان أى عمود رقمى مايكسّرش LOWER.
      conds.push(`(
        ${n("k.full_phone")} LIKE ${p} OR ${n("pl.tel_no")} LIKE ${p} OR
        ${n("pl.central")} LIKE ${p} OR ${n("pl.cabin_number")} LIKE ${p} OR
        ${n("pl.box_number")} LIKE ${p} OR ${n("si2.sub_name")} LIKE ${p} OR
        ${n("si2.sub_add")} LIKE ${p} OR ${n("pl.dp_terminal")} LIKE ${p} OR
        ${n("pl.idu_no")} LIKE ${p} OR ${n("pl.odu_no")} LIKE ${p} OR
        ${n("pl.primary_block_no")} LIKE ${p} OR ${n("pl.cabinet_in")} LIKE ${p} OR
        ${n("pl.sec_block_no")} LIKE ${p} OR ${n("pl.cabinet_out")} LIKE ${p} OR
        ${n("pl.fiber_block")} LIKE ${p} OR ${n("pl.fiber_out")} LIKE ${p} OR
        ${n("pl.port")} LIKE ${p} OR ${n("pl.len")} LIKE ${p} OR
        ${n("pp.frame")} LIKE ${p} OR
        EXISTS (SELECT 1 FROM case_138 c WHERE c.full_phone = k.full_phone AND ${n("c.account_no")} LIKE ${p}) OR
        EXISTS (SELECT 1 FROM line_accounts la WHERE la.full_phone = k.full_phone AND ${n("la.account_no")} LIKE ${p}) OR
        EXISTS (SELECT 1 FROM cabinet_technicians ct JOIN technician_names tn ON tn.worker_code = ct.worker_code
                 WHERE ct.central_name = pl.central AND ct.cabin_number = pl.cabin_number
                   AND ${n("tn.tech_name")} LIKE ${p})
      )`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // المرساة = اتحاد أرقام البيانات الفنية (phone_lines) وأرقام المنافذ (phone_ports)،
    // عشان بيان التليفونات يشمل أى رقم ليه بورت حتى لو مالوش بيانات فنية.
    // نضيف line_subscriber_info لعرض اسم/عنوان العميل (phone_number مفتاح أساسى فمفيش تكرار صفوف)
    const joinClause = `FROM (SELECT full_phone FROM phone_lines
            UNION
            -- أرقام البورتات: بس اللى 88 + 7 خانات بالظبط (الأطول من كده مش تخصنا فتُستبعد)
            SELECT phone_number AS full_phone FROM phone_ports
             WHERE regexp_replace(phone_number,'[^0-9]','','g') ~ '^0*88[0-9]{7}$') k
      LEFT JOIN phone_lines pl ON pl.full_phone = k.full_phone
      LEFT JOIN phone_ports pp ON pp.phone_number = k.full_phone
      LEFT JOIN line_subscriber_info si2 ON si2.phone_number = k.full_phone
      -- رقم مالوش فريم دلوقتى بس كان ليه بورت قبل كده (موجود فى جدول الخطوط المرفوعة)
      -- = اتشال من ملف البورتات فعلياً، مش لسه ماتفحصش. الفرق ده بيبان فى عمود «الحالة».
      LEFT JOIN removed_phone_ports rpp ON rpp.phone_number = k.full_phone`;

    const totalRes = await pool.query(`SELECT COUNT(*)::int AS c ${joinClause} ${where}`, params);
    const total = totalRes.rows[0].c as number;

    const offset = (pageNum - 1) * pageSize;
    params.push(pageSize); params.push(offset);
    // ربط بشيت القياسات 138 (آخر قياس لكل رقم) — المطابقة بالتليفون الكامل:
    // case_138.full_phone = phone_lines.full_phone (الاتنين بصيغة 88+رقم).
    const c138Join = `LEFT JOIN LATERAL (
        SELECT c.account_no, c.current_speed, c.max_speed, c.score, c.complain_no, c.complain_time, c.uploaded_at
        FROM case_138 c WHERE c.full_phone = k.full_phone
        ORDER BY c.id DESC LIMIT 1
      ) c138p ON true
      LEFT JOIN line_po_events pe ON pe.account_no = c138p.account_no`;
    const dataRes = await pool.query(
      `SELECT pl.id, COALESCE(pl.tel_no, regexp_replace(k.full_phone, '^88', '')) AS "telNo", pl.central, pl.idu_no AS "iduNo", pl.odu_no AS "oduNo",
              pl.cabin_number AS "cabinNumber", pl.primary_block_no AS "primaryBlockNo",
              pl.cabinet_in AS "cabinetIn", pl.sec_block_no AS "secBlockNo", pl.cabinet_out AS "cabinetOut",
              pl.box_number AS "boxNumber", pl.dp_terminal AS "dpTerminal",
              COALESCE(pp.frame, pl.port) AS port, pl.len,
              pl.fiber_block AS "fiberBlock", pl.fiber_out AS "fiberOut",
              pp.msan_code AS "msanCode",
              pp.frame AS "frameNo",
              -- مالوش فريم دلوقتى: لو كان ليه بورت قبل كده وانمسح (removed_phone_ports) فده
              -- «تم رفعه نهائياً» فعلاً؛ غير كده لسه ماتفحصش/مالوش بورت من الأساس.
              (CASE
                 WHEN COALESCE(btrim(pp.frame::text), '') <> '' THEN NULL
                 WHEN rpp.phone_number IS NOT NULL THEN 'تم رفعه نهائياً'
                 ELSE 'لم يُفحص بعد'
               END) AS "frameStatus",
              (rpp.removed_at AT TIME ZONE 'Africa/Cairo') AS "removedAt",
              -- فنى المنطقة = صاحب الكابينة (cabinet_technicians) حسب السنترال + رقم الكابينة
              (SELECT tn.tech_name FROM cabinet_technicians ct
                 JOIN technician_names tn ON tn.worker_code = ct.worker_code
                WHERE ct.central_name = pl.central AND ct.cabin_number = pl.cabin_number
                LIMIT 1) AS "techName",
              pl.tel_num_txt AS "telNumTxt", k.full_phone AS "fullPhone",
              si2.sub_name AS "subName", si2.sub_add AS "subAdd",
              c138p.account_no AS "accountNo",
              c138p.current_speed AS "lineCurrentSpeed",
              c138p.max_speed AS "lineMaxSpeed",
              c138p.score AS "lastMeasScore",
              c138p.complain_no AS "lastMeasComplainNo",
              (c138p.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime",
              (pe.last_raise_at AT TIME ZONE 'Africa/Cairo') AS "lastPoRaiseAt",
              (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') AS "lastPoStopAt"
       ${joinClause} ${c138Join} ${where}
       ORDER BY pl.id NULLS LAST, k.full_phone
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({ data: dataRes.rows, total, page: pageNum, pageSize });
  });

  // GET /api/phone-lines/no-mobile — نفس تقرير بيان التليفونات، بس بس الأرقام اللى
  // مالهاش رقم موبايل من أى مصدر (يدوى/أوامر شغل/طلبات FTTH — نفس أولوية بحث برقم
  // التليفون بالظبط)، عشان تتجمّع أرقام الموبايل الناقصة وتتضاف من التقرير نفسه.
  //
  // GET /api/phone-lines/mobile-checked — «أرقام تم الفحص وتحتاج أرقام محمول»
  // نفس الـ handler بالظبط (نفس الأعمدة والفلاتر والتصدير) وبيعكس شرط الفحص بس:
  // بيعرض اللى اتعلّم إنه اتفحص بدل اللى لسه تحت الفحص. سوبر أدمن فقط حالياً.
  // بيقبل كمان onlyCurrentFault=1 → الأرقام اللى ليها شكوى مفتوحة فى الأعطال الحالية.
  // ⚠️ الشرطين الأساسيين (مالوش موبايل من أى مصدر) بيفضلوا شغّالين هنا كمان — فأى رقم
  // يتضاف له موبايل بعدين (من بحث برقم التليفون مثلاً) بيختفى من التقرير ده تلقائياً.
  app.get(["/api/phone-lines/no-mobile", "/api/phone-lines/mobile-checked"], requireAuth, async (req: any, res) => {
    const checkedMode = req.path.endsWith("/mobile-checked");
    if (checkedMode && req.user?.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ message: "غير مسموح" });
    }
    const { search = "", central = "", cabin = "", box = "", phoneFrom = "", phoneTo = "", page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(20000, Math.max(1, parseInt(limit) || 50));
    const q = search.trim().toLowerCase();
    const digitsOnly = (s: string) => String(s || "").replace(/\D/g, "").replace(/^88/, "");
    let pFrom = digitsOnly(phoneFrom), pTo = digitsOnly(phoneTo);
    if (pFrom && pTo && BigInt(pFrom) > BigInt(pTo)) { const t = pFrom; pFrom = pTo; pTo = t; }

    const conds: string[] = [
      `NOT EXISTS (SELECT 1 FROM ${HAS_MOBILE_SET} hm WHERE hm.ph = ${sp("k.full_phone")})`,
      // بنفحص كمان بـ tel_no لأن الفرع القديم كان بيطابق بيه لو موجود (لو اختلف عن
      // الرقم القصير المشتقّ من full_phone بسبب بيانات غير متسقة).
      `NOT EXISTS (SELECT 1 FROM ${HAS_MOBILE_SET} hm WHERE pl.tel_no IS NOT NULL AND hm.ph = ${sp("pl.tel_no")})`,
      // «تحت الفحص» = لسه ماتفحصش. اللى اتفحص بيروح لتقرير «تم الفحص وتحتاج أرقام محمول».
      checkedMode
        ? `EXISTS (SELECT 1 FROM line_mobile_checked mc WHERE mc.full_phone = k.full_phone)`
        : `NOT EXISTS (SELECT 1 FROM line_mobile_checked mc WHERE mc.full_phone = k.full_phone)`,
    ];
    const params: any[] = [];
    // فلتر «له شكوى فى الأعطال الحالية» — نفس تعريف تقرير الأعطال الحالية بالظبط
    // (تذكرة مفتوحة close_date IS NULL على سنترالات الغنايم بنفس أكواد الأعطال).
    if (checkedMode && (String(req.query.onlyCurrentFault ?? "") === "1" || String(req.query.onlyCurrentFault ?? "") === "true")) {
      conds.push(`EXISTS (
        SELECT 1 FROM ticket_dsl_current t
         WHERE t.close_date IS NULL
           AND (t.status_code ~ '^(160|173|122|73|72|60|81)' OR t.complain_type_name ~ '^(160|173|122|73|72|60|81)')
           AND (t.central_name = 'الغنايم' OR t.central_name = 'الغنايم-العزايزة'
                OR t.central_name = 'الغنايم-دير الجنادله' OR t.central_name = 'الغنايم-نجع العمدة')
           AND ${sp("t.phone_number")} = ${sp("k.full_phone")})`);
    }
    if (central) { params.push(central); conds.push(`pl.central = $${params.length}`); }
    if (cabin) { params.push(cabin); conds.push(`pl.cabin_number = $${params.length}`); }
    if (box) { params.push(box); conds.push(`pl.box_number = $${params.length}`); }
    if (pFrom || pTo) {
      const shortExpr = `regexp_replace(regexp_replace(k.full_phone,'[^0-9]','','g'),'^0*88','')`;
      const numExpr = `(CASE WHEN ${shortExpr} ~ '^[0-9]{1,18}$' THEN ${shortExpr}::bigint END)`;
      if (pFrom) { params.push(pFrom); conds.push(`${numExpr} >= $${params.length}::bigint`); }
      if (pTo) { params.push(pTo); conds.push(`${numExpr} <= $${params.length}::bigint`); }
    }
    if (q) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      conds.push(`(
        ${n("k.full_phone")} LIKE ${p} OR ${n("pl.tel_no")} LIKE ${p} OR
        ${n("pl.central")} LIKE ${p} OR ${n("pl.cabin_number")} LIKE ${p} OR
        ${n("pl.box_number")} LIKE ${p} OR ${n("si2.sub_name")} LIKE ${p} OR
        ${n("si2.sub_add")} LIKE ${p} OR ${n("pp.msan_code")} LIKE ${p} OR ${n("pp.frame")} LIKE ${p} OR
        EXISTS (SELECT 1 FROM cabinet_technicians ct JOIN technician_names tn ON tn.worker_code = ct.worker_code
                 WHERE ct.central_name = pl.central AND ct.cabin_number = pl.cabin_number
                   AND ${n("tn.tech_name")} LIKE ${p})
      )`);
    }
    const where = `WHERE ${conds.join(" AND ")}`;
    // نفس مرساة/أولوية الموبايل المستخدمة فى بحث برقم التليفون بالظبط: يدوى (line_mobiles) أولاً،
    // بعدين أوامر الشغل (wfm)، بعدين طلبات FTTH — أول قيمة حقيقية (مش مشفّرة) بتكسب.
    const joinClause = `FROM (SELECT full_phone FROM phone_lines
            UNION
            SELECT phone_number AS full_phone FROM phone_ports
             WHERE regexp_replace(phone_number,'[^0-9]','','g') ~ '^0*88[0-9]{7}$') k
      LEFT JOIN phone_lines pl ON pl.full_phone = k.full_phone
      LEFT JOIN phone_ports pp ON pp.phone_number = k.full_phone
      LEFT JOIN line_subscriber_info si2 ON si2.phone_number = k.full_phone
      LEFT JOIN removed_phone_ports rpp ON rpp.phone_number = k.full_phone`;

    const totalRes = await pool.query(`SELECT COUNT(*)::int AS c ${joinClause} ${where}`, params);
    const total = totalRes.rows[0].c as number;

    const offset = (pageNum - 1) * pageSize;
    params.push(pageSize); params.push(offset);
    const dataRes = await pool.query(
      `SELECT pl.id, COALESCE(pl.tel_no, regexp_replace(k.full_phone, '^88', '')) AS "telNo", pl.central,
              pl.cabin_number AS "cabinNumber", pl.box_number AS "boxNumber", pl.dp_terminal AS "dpTerminal",
              pp.msan_code AS "msanCode", pp.frame AS "frameNo",
              (CASE
                 WHEN COALESCE(btrim(pp.frame::text), '') <> '' THEN NULL
                 WHEN rpp.phone_number IS NOT NULL THEN 'تم رفعه نهائياً'
                 ELSE 'لم يُفحص بعد'
               END) AS "frameStatus",
              (SELECT tn.tech_name FROM cabinet_technicians ct
                 JOIN technician_names tn ON tn.worker_code = ct.worker_code
                WHERE ct.central_name = pl.central AND ct.cabin_number = pl.cabin_number
                LIMIT 1) AS "techName",
              k.full_phone AS "fullPhone",
              si2.sub_name AS "subName", si2.sub_add AS "subAdd"
       ${joinClause} ${where}
       ORDER BY pl.id NULLS LAST, k.full_phone
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({ data: dataRes.rows, total, page: pageNum, pageSize });
  });

  // POST /api/line-mobile-checked { fullPhone, note? } — علّم إن الرقم اتفحص وطلع فعلاً
  // مالوش رقم محمول. بيشيله من «تحت الفحص» وبيوديه لتقرير «تم الفحص وتحتاج أرقام محمول».
  app.post("/api/line-mobile-checked", requireAuth, async (req: any, res) => {
    try {
      const fullPhone = String(req.body?.fullPhone || "").trim();
      if (!fullPhone) return res.status(400).json({ message: "رقم التليفون مطلوب" });
      const note = String(req.body?.note || "").trim() || null;
      await pool.query(
        `INSERT INTO line_mobile_checked (full_phone, note, checked_by_id, checked_by_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (full_phone) DO UPDATE SET
           note = EXCLUDED.note, checked_by_id = EXCLUDED.checked_by_id,
           checked_by_name = EXCLUDED.checked_by_name, checked_at = now()`,
        [fullPhone, note, req.user?.id ?? null, String(req.user?.username || "")],
      );
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // DELETE /api/line-mobile-checked/:fullPhone — تراجُع: يرجّع الرقم لتقرير «تحت الفحص».
  app.delete("/api/line-mobile-checked/:fullPhone", requireAuth, async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM line_mobile_checked WHERE full_phone = $1`, [String(req.params.fullPhone || "").trim()]);
      res.json({ ok: true, removed: rowCount ?? 0 });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── تقرير ربط الطلبات بالمتعذرات الحالية (سوبر أدمن فقط) ────────────────────
  // بيجيب كل الطلبات وكل المتعذرات الحالية وبيطابق **بالاسم** بنسبة ≥ العتبة
  // (0.7 افتراضياً). الحساب فى الـ JS مش فى القاعدة — مافيش أى إضافة (pg_trgm)
  // مطلوبة، والأحجام هنا مئات الصفوف فالتكلفة مالهاش أثر.
  // بيرجّع لكل زوج: الاسم/العنوان/الموبايل والرد من الجهتين + نسبة التطابق.
  app.get("/api/reports/om-order-match", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const minScore = Math.max(0, Math.min(1, parseFloat(String(req.query.minScore ?? "")) || NAME_MATCH_THRESHOLD));
      const { rows: orderRows } = await pool.query(
        `SELECT o.id, o.customer_name AS name, o.customer_address AS address,
                o.customer_phone AS mobile, o.status, o.rejection_reason AS reason,
                o.additional_notes AS notes, o.central_name AS central,
                o.cabin_number AS cabin, o.box_number AS box, o.tech_name AS tech,
                (o.created_at AT TIME ZONE 'Africa/Cairo') AS "createdAt"
           FROM orders o
          WHERE COALESCE(btrim(o.customer_name), '') <> ''`);
      const { rows: omRows } = await pool.query(
        // الموبايل بنفس أولوية تقرير المتعذرات بالظبط: اليدوى ← موبايل المعاينة ←
        // اللى فى الملف. الانضمام مجمّع (مش lateral لكل صف) عشان مايتقلش.
        `SELECT fo.serial_number AS serial, fo.customer_name AS name,
                fo.install_address AS address,
                COALESCE(omm.mobile, wfm.mobile, fo.customer_mobile) AS mobile,
                fo.service_number AS phone, fo.msan_code AS msan,
                r.rejection_reason AS reason, r.additional_notes AS notes,
                r.status AS "respStatus", r.tech_name AS tech,
                r.central_name AS central, r.cabin_number AS cabin, r.box_number AS box
           FROM ftth_orders_current fo
           LEFT JOIN om_responses r ON r.serial_number = fo.serial_number
           LEFT JOIN om_manual_mobiles omm ON omm.serial_number = fo.serial_number
           LEFT JOIN (
             SELECT reference_no, MIN(mobile) AS mobile
               FROM maintenance_orders
              WHERE work_order_type ILIKE 'fvmanualsurvey'
                AND COALESCE(btrim(mobile), '') <> ''
              GROUP BY reference_no
           ) wfm ON wfm.reference_no = fo.service_order_id
          -- ⚠️ نفس فلتر تقرير «المتعذرات الحالية» بالحرف: ملف OM بيجى فيه طلبات
          -- سنترالات تانية وأنواع خدمة تانية. من غير الفلتر ده كان التقرير بيطابق
          -- على متعذرات **مش ظاهرة أصلاً** فى المتعذرات الحالية ولا فى تم فكها.
          WHERE COALESCE(btrim(fo.customer_name), '') <> ''
            AND fo.fcc_exchange IN ('GHNAT','AMZAT','DRGAT','NGOAT')
            AND fo.service_name = 'FV Survey'`);
      const { rows: confirmed } = await pool.query(
        `SELECT order_id AS "orderId", om_serial AS serial, score,
                confirmed_by_name AS "confirmedBy",
                (confirmed_at AT TIME ZONE 'Africa/Cairo') AS "confirmedAt"
           FROM om_order_matches`);
      const confByOrder = new Map<number, any>();
      for (const c of confirmed) confByOrder.set(Number(c.orderId), c);

      // لكل طلب: أحسن متعذر مطابق (أعلى نسبة) — الربط 1:1 فمابنعرضش نفس المتعذر
      // لأكتر من طلب إلا لو لسه مش مؤكَّد (السوبر أدمن هو اللى يحسم).
      // ⚠️ الأداء: المقارنة الكاملة (كل طلب × كل متعذر) كانت بتقفل الـ event loop
      // بتاع Node — والسيرفر ثريد واحد فالموقع **كله** كان بيقف مش التقرير بس.
      // بنحسب الكلمات مرة واحدة لكل صف، وبنفهرس المتعذرات بالاسم الأول: القاعدة
      // أصلاً بتحتّم إن الاسم الأول يتطابق، فمافيش داعى نقارن باللى اسمه الأول
      // مختلف خالص. النتيجة نفس النتيجة بالظبط لكن بجزء ضئيل من العمل.
      const omTok = new Map<any, string[]>();
      for (const m of omRows) omTok.set(m, nameTokens(m.name));
      const candidatesFor = buildFirstNameIndex(omRows, (m) => omTok.get(m) ?? []);

      // 🛡️ صمّام أمان: كل 50 طلب بنسيب الـ event loop يتنفّس. حتى لو البيانات
      // كبرت جداً، السيرفر بيفضل بيرد على باقى المستخدمين بدل ما يتجمّد.
      // (التقرير ده وقّع الموقع كله قبل كده لأن الحلقة كانت بتقفل الـ loop لدقايق.)
      const breathe = () => new Promise<void>((r) => setImmediate(r));

      // المسلسلات المربوطة خلاص بطلب معيّن — مابتترشّحش لأى طلب تانى (الربط 1:1).
      const omBySerial = new Map<string, any>();
      for (const m of omRows) omBySerial.set(String(m.serial), m);
      const takenSerial = new Set<string>();
      for (const c of confirmed) takenSerial.add(String(c.serial));

      const pairs: any[] = [];
      // كل الترشيحات فوق العتبة (أحسن ٥ لكل طلب) — بنسندها بعد كده إسناد أحادى
      const proposals: { o: any; m: any; score: number; matched: number }[] = [];
      let scanned = 0;
      for (const o of orderRows) {
        if (++scanned % 50 === 0) await breathe();
        const conf = confByOrder.get(Number(o.id));
        // الأزواج المؤكَّدة بتظهر دايماً حتى لو النسبة أقل من العتبة دلوقتى
        if (conf) {
          pairs.push({ order: o, om: omBySerial.get(String(conf.serial)) ?? null,
                       score: conf.score ?? 0, matched: 0, confirmed: conf });
          continue;
        }
        const ot = nameTokens(o.name);
        const cands: { m: any; score: number; matched: number }[] = [];
        for (const m of candidatesFor(ot[0] ?? "")) {
          if (takenSerial.has(String(m.serial))) continue;
          const r = nameMatchTokens(ot, omTok.get(m) ?? []);
          if (r.score >= minScore) cands.push({ m, score: r.score, matched: r.matched });
        }
        cands.sort((a, b) => b.score - a.score);
        for (const c of cands.slice(0, 5)) proposals.push({ o, m: c.m, score: c.score, matched: c.matched });
      }
      // ⚠️ إسناد أحادى: المتعذر الواحد مايتعرضش لأكتر من طلب. الطلب الأعلى نسبة
      // بياخده، والباقى بياخد أفضل متعذر **تانى متاح**. قبل كده كل طلب كان بياخد
      // أحسن متعذر ليه بشكل مستقل، فكان نفس المتعذر يتعرض لكذا طلب (شائع لما
      // نفس العميل يكون له أكتر من طلب) — أول تأكيد بس هو اللى ينفع والباقى
      // يقع على قيد UNIQUE ويظهر للمستخدم كـ «تعذّر تأكيد التطابق».
      proposals.sort((a, b) => b.score - a.score);
      const usedOrder = new Set<number>();
      const usedSerial = new Set<string>(takenSerial);
      for (const p of proposals) {
        const oid = Number(p.o.id), sn = String(p.m.serial);
        if (usedOrder.has(oid) || usedSerial.has(sn)) continue;
        usedOrder.add(oid); usedSerial.add(sn);
        pairs.push({ order: p.o, om: p.m, score: p.score, matched: p.matched, confirmed: null });
      }
      pairs.sort((a, b) => (b.confirmed ? 1 : 0) - (a.confirmed ? 1 : 0) || b.score - a.score);
      res.json({ data: pairs, minScore, orders: orderRows.length, omCases: omRows.length });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/reports/om-order-match/confirm { orderId, serialNumber }
  // بيأكّد التطابق وبيزامن سبب الرد بين النظامين:
  //   • فيه سبب فى المتعذرات الحالية → بينزل على قسم الطلبات (وبيحدّث أى سبب قديم)
  //   • مفيش سبب فى المتعذرات وفيه سبب فى الطلبات → بيروح للمتعذرات الحالية
  //   • الاتنين فاضيين → بنسجّل التطابق بس
  // ⚠️ كله جوه **ترانزاكشن واحدة**: لو أى خطوة وقعت بيترجع كل شىء زى ما كان.
  // من غيرها كان ممكن السبب/الموبايل يتنقل وبعدين سطر الربط يفشل → تعديل من غير
  // لقطة تراجع (ده اللى كان بيحصل فى «تعذّر تأكيد التطابق»).
  app.post("/api/reports/om-order-match/confirm", requireAuth, requireSuperAdmin, async (req: any, res) => {
    const orderId = parseInt(String(req.body?.orderId ?? ""));
    const serial = String(req.body?.serialNumber ?? "").trim();
    if (!orderId || !serial) return res.status(400).json({ message: "orderId و serialNumber مطلوبين" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // قفل استشارى على المسلسل — يمنع تأكيدين متوازيين لنفس المتعذر
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ["om-match:" + serial]);

      const { rows: oRows } = await client.query(
        `SELECT id, rejection_reason, additional_notes, central_name, cabin_number, box_number,
                customer_phone, status, is_feasible
           FROM orders WHERE id = $1`, [orderId]);
      if (!oRows.length) { await client.query("ROLLBACK"); return res.status(404).json({ message: "الطلب مش موجود" }); }
      const o = oRows[0];

      // ── فحص الارتباطات القائمة قبل ما نلمس أى حاجة ──────────────────────
      // الربط 1:1 (قيد UNIQUE على المسلسل وعلى الطلب). لو المسلسل مربوط بطلب
      // تانى، أو الطلب مربوط بمتعذر تانى، بنرجّع رسالة واضحة بدل ما الـ INSERT
      // يقع بخطأ قاعدة بيانات ويوصل للمستخدم كـ «تعذّر تأكيد التطابق» من غير سبب.
      const { rows: clash } = await client.query(
        `SELECT m.order_id, m.om_serial, o2.customer_name
           FROM om_order_matches m
           LEFT JOIN orders o2 ON o2.id = m.order_id
          WHERE (m.om_serial = $1 AND m.order_id <> $2) OR (m.order_id = $2 AND m.om_serial <> $1)`,
        [serial, orderId]);
      if (clash.length) {
        await client.query("ROLLBACK");
        const c = clash[0];
        const msg = String(c.om_serial) === serial
          ? `المتعذر ده مربوط قبل كده بطلب تانى (${c.customer_name || "طلب #" + c.order_id}). اعمل «تراجع» على الربط القديم الأول.`
          : `الطلب ده مربوط قبل كده بمتعذر تانى (مسلسل ${c.om_serial}). اعمل «تراجع» الأول.`;
        return res.status(409).json({ message: msg });
      }
      // لو نفس الربط موجود بالظبط → مافيش حاجة تتعمل (تجنّب دبل-كليك)
      const { rows: same } = await client.query(
        `SELECT 1 FROM om_order_matches WHERE order_id = $1 AND om_serial = $2`, [orderId, serial]);
      if (same.length) {
        await client.query("ROLLBACK");
        return res.json({ ok: true, direction: "none", mobileDirection: "none", already: true });
      }

      const { rows: mRows } = await client.query(
        `SELECT serial_number, rejection_reason, additional_notes, central_name, cabin_number,
                box_number, status, is_feasible
           FROM om_responses WHERE serial_number = $1`, [serial]);
      const m = mRows[0] || null;
      // لقطة «قبل التأكيد» — بتتخزّن مع الربط عشان زر التراجع يرجّع كل حاجة زى ما كانت
      const undoData: any = {};

      const omReason = String(m?.rejection_reason ?? "").trim();
      const orderReason = String(o.rejection_reason ?? "").trim();
      let direction = "none";

      // ⚠️ النقل بيحصل **بس لو جهة ناقصة**. لو الاتنين فيهم رد خلاص مابنلمسش
      // أى حاجة — الرد اللى اتسجّل فى كل نظام هو رد صاحبه ومش من حقنا نطمسه.
      // اللى بيحصل فى الحالة دى هو الربط بس (يتحسبوا متعذر واحد على البكس).
      if (omReason && !orderReason) {
        undoData.order = {
          rejection_reason: o.rejection_reason, is_feasible: o.is_feasible, status: o.status,
          additional_notes: o.additional_notes, central_name: o.central_name,
          cabin_number: o.cabin_number, box_number: o.box_number,
        };
        // سبب المتعذرات هو المرجع — بينزل على الطلب اللى مالوش رد
        await client.query(
          `UPDATE orders SET rejection_reason = $2, is_feasible = false,
                             status = CASE WHEN status IN ('feasible','external_feasible') THEN status ELSE 'not_feasible' END,
                             additional_notes = COALESCE(NULLIF(btrim($3), ''), additional_notes),
                             central_name = COALESCE(central_name, $4),
                             cabin_number = COALESCE(cabin_number, $5),
                             box_number   = COALESCE(box_number, $6)
            WHERE id = $1`,
          [orderId, omReason, String(m?.additional_notes ?? ""), m?.central_name ?? null,
           m?.cabin_number ?? null, m?.box_number ?? null]);
        direction = "om→order";
      } else if (orderReason && !omReason) {
        undoData.omResponse = m
          ? { existed: true, rejection_reason: m.rejection_reason, is_feasible: m.is_feasible,
              status: m.status, additional_notes: m.additional_notes, central_name: m.central_name,
              cabin_number: m.cabin_number, box_number: m.box_number }
          : { existed: false };
        // مفيش سبب فى المتعذرات → ناخد سبب الطلب ونوديه هناك
        await client.query(
          `INSERT INTO om_responses (serial_number, status, is_feasible, rejection_reason,
                                     additional_notes, central_name, cabin_number, box_number, updated_at)
           VALUES ($1, 'not_feasible', false, $2, $3, $4, $5, $6, now())
           ON CONFLICT (serial_number) DO UPDATE SET
             rejection_reason = EXCLUDED.rejection_reason,
             is_feasible = false,
             status = CASE WHEN om_responses.status IN ('feasible','external_feasible')
                           THEN om_responses.status ELSE 'not_feasible' END,
             additional_notes = COALESCE(NULLIF(btrim(EXCLUDED.additional_notes), ''), om_responses.additional_notes),
             central_name = COALESCE(om_responses.central_name, EXCLUDED.central_name),
             cabin_number = COALESCE(om_responses.cabin_number, EXCLUDED.cabin_number),
             box_number   = COALESCE(om_responses.box_number, EXCLUDED.box_number),
             updated_at = now()`,
          [serial, orderReason, String(o.additional_notes ?? ""), o.central_name, o.cabin_number, o.box_number]);
        direction = "order→om";
      }

      // ── مزامنة رقم المحمول ──────────────────────────────────────────────
      // «رقم حقيقى» = 10 أرقام فأكتر بعد شيل أى رموز، ومفيهوش نجوم. الأرقام
      // المخفية فى ملف المتعذرات بتتكتب زى «*****011» — بعد شيل النجوم بتبقى
      // 3 أرقام، فبتترفض تلقائياً بشرط الطول، والنجمة بترفضها صراحةً كمان.
      const realMobile = (v: unknown): string | null => {
        const raw = String(v ?? "").trim();
        if (!raw || raw.includes("*")) return null;
        const d = raw.replace(/\D/g, "");
        return d.length >= 10 ? raw : null;
      };
      const { rows: omMob } = await client.query(
        `SELECT COALESCE(omm.mobile, wfm.mobile, fo.customer_mobile) AS mobile
           FROM ftth_orders_current fo
           LEFT JOIN om_manual_mobiles omm ON omm.serial_number = fo.serial_number
           LEFT JOIN LATERAL (
             SELECT mobile FROM maintenance_orders
              WHERE reference_no = fo.service_order_id
                AND work_order_type ILIKE 'fvmanualsurvey'
                AND COALESCE(btrim(mobile), '') <> '' LIMIT 1
           ) wfm ON true
          WHERE fo.serial_number = $1 LIMIT 1`, [serial]);
      const omMobile = realMobile(omMob[0]?.mobile);
      const orderMobile = realMobile(o.customer_phone);
      let mobileDirection = "none";
      if (omMobile && !orderMobile) {
        undoData.orderPhone = o.customer_phone;
        await client.query(`UPDATE orders SET customer_phone = $2 WHERE id = $1`, [orderId, omMobile]);
        mobileDirection = "om→order";
      } else if (orderMobile && !omMobile) {
        const { rows: prevMm } = await client.query(
          `SELECT mobile FROM om_manual_mobiles WHERE serial_number = $1`, [serial]);
        undoData.omManualMobile = prevMm.length ? { existed: true, mobile: prevMm[0].mobile } : { existed: false };
        await client.query(
          `INSERT INTO om_manual_mobiles (serial_number, mobile, updated_by, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (serial_number) DO UPDATE SET
             mobile = EXCLUDED.mobile, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [serial, orderMobile, String(req.user?.username || "")]);
        mobileDirection = "order→om";
      }

      const score = parseFloat(String(req.body?.score ?? "")) || null;
      await client.query(
        `INSERT INTO om_order_matches (order_id, om_serial, score, confirmed_by_id, confirmed_by_name, undo_data)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [orderId, serial, score, req.user?.id ?? null, String(req.user?.username || ""),
         Object.keys(undoData).length ? JSON.stringify(undoData) : null]);

      await client.query("COMMIT");
      res.json({ ok: true, direction, mobileDirection });
    } catch (e: any) {
      try { await client.query("ROLLBACK"); } catch {}
      // 23505 = تصادم على قيد UNIQUE (سباق بين تأكيدين فى نفس اللحظة)
      if (e?.code === "23505")
        return res.status(409).json({ message: "المتعذر ده أو الطلب ده اتربط للتو من مكان تانى. اعمل تحديث للتقرير." });
      res.status(500).json({ message: e.message });
    } finally { client.release(); }
  });

  // DELETE /api/reports/om-order-match/:orderId — تراجع كامل عن التطابق.
  // مش بيفكّ الربط وبس: بيرجّع الحقول اللى التأكيد غيّرها (سبب الرد + الموبايل
  // على الجهتين) لقيمتها الأصلية من اللقطة المخزّنة وقت التأكيد.
  app.delete("/api/reports/om-order-match/:orderId", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const { rows: mm } = await pool.query(
        `SELECT om_serial, undo_data FROM om_order_matches WHERE order_id = $1`, [orderId]);
      const u = mm[0]?.undo_data || {};
      const serial = mm[0]?.om_serial;

      if (u.order) {
        // بنرجّع **بس** الحقول الموجودة فى اللقطة. اللقطات القديمة (اتكتبت قبل ما
        // نضيف status/is_feasible للـ SELECT) مافيهاش الحقلين دول — لو كتبناهم
        // على طول كانوا هيتكتبوا NULL فوق القيمة الصح ويبوّظوا حالة الطلب.
        const sets: string[] = [];
        const vals: any[] = [orderId];
        for (const col of ["rejection_reason", "is_feasible", "status", "additional_notes",
                           "central_name", "cabin_number", "box_number"]) {
          if (u.order[col] === undefined) continue;
          vals.push(u.order[col]);
          sets.push(`${col} = $${vals.length}`);
        }
        if (sets.length)
          await pool.query(`UPDATE orders SET ${sets.join(", ")} WHERE id = $1`, vals);
      }
      if (u.omResponse && serial) {
        if (u.omResponse.existed) {
          await pool.query(
            `UPDATE om_responses SET rejection_reason = $2, is_feasible = $3, status = $4,
                                     additional_notes = $5, central_name = $6, cabin_number = $7,
                                     box_number = $8, updated_at = now()
              WHERE serial_number = $1`,
            [serial, u.omResponse.rejection_reason, u.omResponse.is_feasible, u.omResponse.status,
             u.omResponse.additional_notes, u.omResponse.central_name, u.omResponse.cabin_number,
             u.omResponse.box_number]);
        } else {
          // الصف ده احنا اللى أنشأناه وقت التأكيد → بيتشال بالكامل
          await pool.query(`DELETE FROM om_responses WHERE serial_number = $1`, [serial]);
        }
      }
      if (u.orderPhone !== undefined) {
        await pool.query(`UPDATE orders SET customer_phone = $2 WHERE id = $1`, [orderId, u.orderPhone]);
      }
      if (u.omManualMobile && serial) {
        if (u.omManualMobile.existed) {
          await pool.query(
            `UPDATE om_manual_mobiles SET mobile = $2, updated_at = now() WHERE serial_number = $1`,
            [serial, u.omManualMobile.mobile]);
        } else {
          await pool.query(`DELETE FROM om_manual_mobiles WHERE serial_number = $1`, [serial]);
        }
      }

      const { rowCount } = await pool.query(
        `DELETE FROM om_order_matches WHERE order_id = $1`, [orderId]);
      res.json({ ok: true, removed: rowCount ?? 0, restored: Object.keys(u) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/phone-lines/box-summary — count of lines per box
  app.get("/api/phone-lines/box-summary", requireAuth, async (req, res) => {
    const { search = "" } = req.query as Record<string, string>;
    const q = search.trim().toLowerCase();

    const { rows } = await pool.query(`
      SELECT central,
             COALESCE(cabin_number, '') AS "cabinNumber",
             COALESCE(box_number, '') AS "boxNumber",
             COUNT(*)::int AS count
      FROM phone_lines
      GROUP BY central, cabin_number, box_number
    `);

    let summary = rows.sort((a: any, b: any) => {
      const cc = a.central.localeCompare(b.central, "ar");
      if (cc !== 0) return cc;
      const cab = a.cabinNumber.localeCompare(b.cabinNumber, "ar");
      if (cab !== 0) return cab;
      return parseInt(a.boxNumber) - parseInt(b.boxNumber) || a.boxNumber.localeCompare(b.boxNumber);
    });

    if (q) {
      summary = summary.filter((r: any) =>
        r.central.toLowerCase().includes(q) ||
        r.cabinNumber.toLowerCase().includes(q) ||
        r.boxNumber.toLowerCase().includes(q),
      );
    }

    res.json(summary);
  });

  // GET /api/phone-lines/with-account — lines that have an entry in line_accounts (paginated, same filters)
  app.get("/api/phone-lines/with-account", requireAuth, async (req, res) => {
    const { search = "", central = "", cabin = "", box = "", boxFrom = "", boxTo = "",
            page = "1", limit = "50", accountQ = "", staleDays = "", hasComplaint = "",
            scoreGt = "", scoreLt = "", speedGt = "", speedLt = "", neverMeasured = "" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(20000, Math.max(1, parseInt(limit) || 50));
    const q = search.trim().toLowerCase();

    // التقرير مبنى على line_accounts (الأرقام اللى لها أكونت) وليس phone_lines — علشان
    // يظهر أى رقم له أكونت حتى لو مالوش بيانات فنية (مش موجود فى phone_lines).
    const conds: string[] = ["la.account_no IS NOT NULL", "la.account_no <> ''"];
    // أى رقم مالوش فريم (مش متركّب على المسان) مايدخلش تقارير القياسات — حتى لو ليه أكونت
    conds.push(hasFrameSql("la.full_phone"));
    const params: any[] = [];
    // فلتر "لم يتم قياسها من قبل": لا يوجد أى سجل لهذا الخط فى شيت 138 (case_138)
    if (neverMeasured === "1" || neverMeasured === "true") {
      conds.push(`NOT EXISTS (SELECT 1 FROM case_138 c WHERE c.full_phone = la.full_phone)`);
    }
    // فلتر "لها شكوى": الرقم له أى شكوى — على شاشة الـ OSS (ticket_dsl_current المفتوحة) أو
    // خارجها فى 430D (complaint_details المغلقة + remaining_complaints)، أو عطل «خارج الشاشة»
    // مسجَّل يدوياً من صفحة بحث رقم التليفون (manual_faults) وممكن ملوش أى أثر فى 430D خالص.
    // نفس المصادر الأربعة بالظبط المستخدَمة فى /api/phone-lines/needs-speed (requireComplaintAny).
    if (hasComplaint === "1" || hasComplaint === "true") {
      conds.push(`(
        EXISTS (SELECT 1 FROM complaint_details cd WHERE ${sp("cd.phone_number")} = ${sp("la.full_phone")})
        OR EXISTS (SELECT 1 FROM remaining_complaints rc WHERE ${sp("rc.phone_number")} = ${sp("la.full_phone")})
        OR EXISTS (SELECT 1 FROM ticket_dsl_current td WHERE td.close_date IS NULL AND ${sp("td.phone_number")} = ${sp("la.full_phone")})
        OR EXISTS (SELECT 1 FROM manual_faults mf WHERE ${sp("mf.phone_short")} = ${sp("la.full_phone")} OR ${sp("mf.full_phone")} = ${sp("la.full_phone")})
      )`);
    }
    if (central) { params.push(central); conds.push(`pl.central = $${params.length}`); }
    if (cabin) { params.push(cabin); conds.push(`pl.cabin_number = $${params.length}`); }
    if (box) {
      params.push(box); conds.push(`pl.box_number = $${params.length}`);
    } else {
      // مدى البكسيات: من boxFrom إلى boxTo (مقارنة رقمية).
      // الإدخال غير الرقمى كان بيبعت NaN لـ Postgres والاستعلام يقع، وأى بكس مخزّن
      // بحروف كان بيكسّر الـ ::int — فالتحصين من الجهتين (نفس نمط box-summary).
      const safeBoxInt = `(CASE WHEN pl.box_number ~ '^[0-9]{1,9}$' THEN pl.box_number::int END)`;
      if (/^\d+$/.test(boxFrom.trim())) { params.push(parseInt(boxFrom)); conds.push(`${safeBoxInt} >= $${params.length}`); }
      if (/^\d+$/.test(boxTo.trim()))   { params.push(parseInt(boxTo));   conds.push(`${safeBoxInt} <= $${params.length}`); }
    }
    if (q) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      conds.push(`(${n("la.full_phone")} LIKE ${p} OR ${n("COALESCE(pl.tel_no, regexp_replace(la.full_phone,'^88',''))")} LIKE ${p} OR ${n("pl.central")} LIKE ${p} OR ${n("pl.cabin_number")} LIKE ${p} OR ${n("pl.box_number")} LIKE ${p} OR ${n("la.account_no")} LIKE ${p})`);
    }
    // بحث مخصّص برقم الأكونت فقط
    if (accountQ.trim()) {
      params.push(arQ(accountQ));
      conds.push(`${n("la.account_no")} LIKE $${params.length}`);
    }
    // الفنى: يرى خطوطه فقط (كباينه من cabinet_technicians حسب رقم العامل)
    if (req.user?.role === ROLES.TECH) {
      params.push(String((req.user as any).workerCode || "").trim());
      conds.push(`EXISTS (SELECT 1 FROM cabinet_technicians ctx WHERE ctx.central_name = pl.central AND ctx.cabin_number = pl.cabin_number AND ctx.worker_code = $${params.length})`);
    }
    const where = `WHERE ${conds.join(" AND ")}`;
    const joinClause = `FROM line_accounts la LEFT JOIN phone_lines pl ON pl.full_phone = la.full_phone LEFT JOIN phone_ports pp ON pp.phone_number = la.full_phone LEFT JOIN line_po_events pe ON pe.account_no = la.account_no`;
    const c138Join = `LEFT JOIN LATERAL (SELECT c.current_speed, c.max_speed, c.score, c.complain_no, c.complain_time, c.uploaded_at FROM case_138 c WHERE c.full_phone = la.full_phone ORDER BY c.id DESC LIMIT 1) c138p ON true`;
    // فلاتر اختيارية على الاسكور والسرعة — تحتاج c138Join دائماً (موجود فى الـ query)
    // ملاحظة: current_speed مخزّنة كنص → لازم نحوّلها لرقم قبل المقارنة (وإلا تتعمل مقارنة نصية غلط)
    const numCurSpeed = `NULLIF(regexp_replace(COALESCE(c138p.current_speed, ''), '[^0-9]', '', 'g'), '')::numeric`;
    const c138Parts: string[] = [];
    if (scoreGt !== "" && !isNaN(parseFloat(scoreGt))) { params.push(parseFloat(scoreGt)); c138Parts.push(`c138p.score > $${params.length}`); }
    if (scoreLt !== "" && !isNaN(parseFloat(scoreLt))) { params.push(parseFloat(scoreLt)); c138Parts.push(`c138p.score < $${params.length}`); }
    if (speedGt !== "" && !isNaN(parseFloat(speedGt))) { params.push(parseFloat(speedGt)); c138Parts.push(`${numCurSpeed} > $${params.length}`); }
    if (speedLt !== "" && !isNaN(parseFloat(speedLt))) { params.push(parseFloat(speedLt)); c138Parts.push(`${numCurSpeed} < $${params.length}`); }
    const c138Where = c138Parts.length > 0 ? " AND " + c138Parts.join(" AND ") : "";

    // فلتر "أقدم من N يوم": يُظهر فقط الخطوط التى مرّ على آخر قياس لها أكثر من N يوم،
    // أو التى لم تُقَس من قبل (لا يوجد سجل فى شيت 138 → uploaded_at = NULL). يشيل الخطوط التى قِيست خلال آخر N يوم.
    // يُطبَّق كشرط منفصل (بارامتره آخر واحد قبل الـ limit/offset) عشان نقدر نحسب الإجمالى بدونه كمان.
    const staleN = parseInt(staleDays);
    let staleClause = "";
    if (staleDays !== "" && !isNaN(staleN) && staleN > 0) {
      params.push(staleN);
      staleClause = ` AND (c138p.uploaded_at IS NULL OR c138p.uploaded_at < now() - make_interval(days => $${params.length}))`;
    }
    // baseParams = كل البارامترات ما عدا بارامتر «أقدم من» (لحساب الإجمالى بدون الفلتر)
    const baseParams = staleClause ? params.slice(0, -1) : params.slice();

    // مع فلتر «أقدم من N يوم»: نستبعد الأرقام **اللى فى طابور القياس دلوقتى** (منتظرة أو
    // شغّالة) — دى هتتقاس خلاص، فلو فضلت ظاهرة هنا هتتبعت للطابور تانى ويتقاس نفس الرقم
    // مرتين. الاستبعاد مربوط بفلتر «أقدم من» بس لأنه ده تدفّق القياس بالجملة.
    // (subquery غير مرتبطة عشان تتحسب مرة واحدة بدل مرة لكل صف.)
    // بزر من الواجهة (excludeQueued) — مش تلقائى. الاستثناء الوحيد: تقرير «لها أكونت
    // ولم تُقَس» الواجهة بتبعت الزر مفعّل فيه افتراضياً.
    const queuedClause = excludeQueuedOn(req) ? ` AND ${notQueuedSql("la.account_no")}` : "";

    // الإجمالى بدون فلتر «أقدم من» (مع باقى الفلاتر) — للعرض والتشخيص
    const grandRes = await pool.query(`SELECT COUNT(*)::int AS c ${joinClause} ${c138Join} ${where}${c138Where}`, baseParams);
    const grandTotal = grandRes.rows[0].c as number;
    // الإجمالى بعد فلتر «أقدم من» **قبل** استبعاد اللى فى الطابور — الفرق بينه وبين
    // الإجمالى النهائى = عدد الأرقام اللى اتشالت لأنها فى الطابور (بنعرضه للمستخدم).
    const beforeExclRes = queuedClause
      ? await pool.query(`SELECT COUNT(*)::int AS c ${joinClause} ${c138Join} ${where}${c138Where}${staleClause}`, params)
      : null;
    const totalRes = await pool.query(`SELECT COUNT(*)::int AS c ${joinClause} ${c138Join} ${where}${c138Where}${staleClause}${queuedClause}`, params);
    const total = totalRes.rows[0].c as number;
    const queuedExcluded = beforeExclRes ? Math.max(0, (beforeExclRes.rows[0].c as number) - total) : 0;
    const offset = (pageNum - 1) * pageSize;
    params.push(pageSize); params.push(offset);
    const dataRes = await pool.query(
      `SELECT pl.id, COALESCE(pl.tel_no, regexp_replace(la.full_phone,'^88','')) AS "telNo",
              pl.central, pl.idu_no AS "iduNo", pl.odu_no AS "oduNo",
              pl.cabin_number AS "cabinNumber", pl.primary_block_no AS "primaryBlockNo",
              pl.cabinet_in AS "cabinetIn", pl.sec_block_no AS "secBlockNo", pl.cabinet_out AS "cabinetOut",
              pl.box_number AS "boxNumber", pl.dp_terminal AS "dpTerminal",
              COALESCE(pp.frame, pl.port) AS port, pl.len,
              pl.fiber_block AS "fiberBlock", pl.fiber_out AS "fiberOut",
              pl.tel_num_txt AS "telNumTxt", la.full_phone AS "fullPhone",
              la.account_no AS "accountNo", la.source AS "accountSource",
              c138p.current_speed AS "lineCurrentSpeed", c138p.max_speed AS "lineMaxSpeed",
              c138p.score AS "lastMeasScore", c138p.complain_no AS "lastMeasComplainNo",
              (c138p.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime",
              (pe.last_raise_at AT TIME ZONE 'Africa/Cairo') AS "lastPoRaiseAt",
              (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') AS "lastPoStopAt"
       ${joinClause} ${c138Join} ${where}${c138Where}${staleClause}${queuedClause}
       ORDER BY pl.central NULLS LAST, LPAD(COALESCE(pl.cabin_number,''), 8, '0'), LPAD(COALESCE(pl.box_number,''), 8, '0'), la.full_phone
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ data: dataRes.rows, total, grandTotal, queuedExcluded, page: pageNum, pageSize });
  });

  // GET /api/phone-lines/without-account — lines with no entry in line_accounts (paginated, same filters)
  app.get("/api/phone-lines/without-account", requireAuth, async (req, res) => {
    const { search = "", central = "", cabin = "", box = "", page = "1", limit = "50", complaintThisMonth = "" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(20000, Math.max(1, parseInt(limit) || 50));
    const q = search.trim().toLowerCase();

    const conds: string[] = ["la.full_phone IS NULL"];
    // استبعاد الخطوط المعلَّمة يدوياً بأنها "بدون رقم أكونت"
    conds.push("NOT EXISTS (SELECT 1 FROM lines_no_account na WHERE na.full_phone = k.full_phone)");
    // أى رقم مالوش فريم (مش متركّب على المسان) مايدخلش تقارير القياسات
    conds.push(hasFrameSql("k.full_phone"));
    const params: any[] = [];
    if (central) { params.push(central); conds.push(`pl.central = $${params.length}`); }
    if (cabin) { params.push(cabin); conds.push(`pl.cabin_number = $${params.length}`); }
    if (box) { params.push(box); conds.push(`pl.box_number = $${params.length}`); }
    if (q) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      conds.push(`(${n("k.full_phone")} LIKE ${p} OR ${n("pl.tel_no")} LIKE ${p} OR ${n("pl.central")} LIKE ${p} OR ${n("pl.cabin_number")} LIKE ${p} OR ${n("pl.box_number")} LIKE ${p})`);
    }
    // فلتر: الأرقام التى نزلت لها شكوى خلال الشهر الحالى (شيت التفاصيل أو المتبقى) — المطابقة برقم التليفون
    if (complaintThisMonth === "1" || complaintThisMonth === "true") {
      conds.push(`(
        EXISTS (
          SELECT 1 FROM complaint_details cd
          WHERE ${sp("cd.phone_number")} = ${sp("k.full_phone")}
            AND date_trunc('month', cd.complain_time AT TIME ZONE 'Africa/Cairo')
                = date_trunc('month', now() AT TIME ZONE 'Africa/Cairo')
        )
        OR EXISTS (
          SELECT 1 FROM remaining_complaints rc
          WHERE ${sp("rc.phone_number")} = ${sp("k.full_phone")}
            AND date_trunc('month', rc.complain_time AT TIME ZONE 'Africa/Cairo')
                = date_trunc('month', now() AT TIME ZONE 'Africa/Cairo')
        )
      )`);
    }
    const where = `WHERE ${conds.join(" AND ")}`;
    // المرساة = اتحاد أرقام البيانات الفنية (phone_lines) وأرقام المنافذ (phone_ports)،
    // عشان التقرير يجيب أى رقم ملوش أكونت سواء ليه بيانات فنية أو ليه بورت.
    const joinClause = `FROM (SELECT full_phone FROM phone_lines
            UNION
            -- أرقام البورتات: بس اللى 88 + 7 خانات بالظبط (الأطول من كده مش تخصنا فتُستبعد)
            SELECT phone_number AS full_phone FROM phone_ports
             WHERE regexp_replace(phone_number,'[^0-9]','','g') ~ '^0*88[0-9]{7}$') k
      LEFT JOIN phone_lines pl ON pl.full_phone = k.full_phone
      LEFT JOIN phone_ports pp ON pp.phone_number = k.full_phone
      LEFT JOIN line_accounts la ON la.full_phone = k.full_phone`;
    const c138Join = `LEFT JOIN LATERAL (SELECT c.current_speed, c.max_speed, c.score, c.complain_no, c.complain_time, c.uploaded_at FROM case_138 c WHERE c.full_phone = k.full_phone ORDER BY c.id DESC LIMIT 1) c138p ON true`;

    const totalRes = await pool.query(`SELECT COUNT(*)::int AS c ${joinClause} ${where}`, params);
    const total = totalRes.rows[0].c as number;
    const offset = (pageNum - 1) * pageSize;
    params.push(pageSize); params.push(offset);
    const dataRes = await pool.query(
      `SELECT pl.id, COALESCE(pl.tel_no, regexp_replace(k.full_phone, '^88', '')) AS "telNo", pl.central, pl.idu_no AS "iduNo", pl.odu_no AS "oduNo",
              pl.cabin_number AS "cabinNumber", pl.primary_block_no AS "primaryBlockNo",
              pl.cabinet_in AS "cabinetIn", pl.sec_block_no AS "secBlockNo", pl.cabinet_out AS "cabinetOut",
              pl.box_number AS "boxNumber", pl.dp_terminal AS "dpTerminal",
              COALESCE(pp.frame, pl.port) AS port, pl.len,
              pl.fiber_block AS "fiberBlock", pl.fiber_out AS "fiberOut",
              pl.tel_num_txt AS "telNumTxt", k.full_phone AS "fullPhone",
              c138p.current_speed AS "lineCurrentSpeed", c138p.max_speed AS "lineMaxSpeed",
              c138p.score AS "lastMeasScore", c138p.complain_no AS "lastMeasComplainNo",
              (c138p.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime"
       ${joinClause} ${c138Join} ${where}
       ORDER BY pl.central NULLS LAST, LPAD(COALESCE(pl.cabin_number,''), 8, '0'), LPAD(COALESCE(pl.box_number,''), 8, '0'), k.full_phone
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ data: dataRes.rows, total, page: pageNum, pageSize });
  });

  // PUT /api/line-accounts/:fullPhone — set/update account number (all roles except sales)
  app.put("/api/line-accounts/:fullPhone", requireAuth, async (req: any, res) => {
    if (req.user.role === ROLES.SALES) {
      return res.status(403).json({ message: "غير مصرح" });
    }
    const { fullPhone } = req.params;
    const { accountNo } = req.body as { accountNo: string };
    if (!accountNo || !accountNo.trim()) {
      return res.status(400).json({ message: "رقم الأكونت مطلوب" });
    }
    const newNo = accountNo.trim();
    // منع التكرار: رقم الأكونت ده مستخدم بالفعل على خط تانى؟ (حتى لو البيان الفنى مختلف تماماً)
    const { rows: dup } = await pool.query(
      `SELECT full_phone FROM line_accounts WHERE account_no = $1 AND full_phone <> $2 LIMIT 1`,
      [newNo, fullPhone],
    );
    if (dup.length) {
      return res.status(409).json({ message: `رقم الأكونت ${newNo} مستخدم بالفعل على الخط ${dup[0].full_phone}` });
    }
    // fetch old value before upsert (for audit log)
    const { rows: existing } = await pool.query(
      `SELECT account_no FROM line_accounts WHERE full_phone = $1`,
      [fullPhone],
    );
    const oldNo: string | null = existing[0]?.account_no ?? null;
    await pool.query(
      `INSERT INTO line_accounts (full_phone, account_no, source, updated_by_id, updated_by_name, updated_at)
       VALUES ($1, $2, 'manual', $3, $4, now())
       ON CONFLICT (full_phone) DO UPDATE
         SET account_no = EXCLUDED.account_no,
             source = 'manual',
             updated_by_id = EXCLUDED.updated_by_id,
             updated_by_name = EXCLUDED.updated_by_name,
             updated_at = now()`,
      [fullPhone, newNo, req.user.id, req.user.username],
    );
    // write audit log entry
    await pool.query(
      `INSERT INTO line_account_edits (full_phone, old_account_no, new_account_no, edited_by_id, edited_by_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [fullPhone, oldNo, newNo, req.user.id, req.user.username],
    );
    // الخط بقى له رقم أكونت → علامة «بدون أكونت» مابقاش ليها معنى، فبتتشال تلقائياً
    // (نفس أثر زر «استرجاع» فى تقرير «معلَّمة بدون أكونت» بالظبط). من غير ده كان
    // الخط يفضل فى تقرير المعلَّمة رغم إن أكونته اتسجّل.
    const un = await pool.query(`DELETE FROM lines_no_account WHERE full_phone = $1`, [fullPhone]);
    res.json({ ok: true, restored: (un.rowCount ?? 0) > 0 });
  });

  // GET /api/reports/lines-without-port — أرقام لها بيان فنى (131) لكن مالهاش بورت/فريم
  // على المسان. دى الأرقام اللى بتتستبعد من كل تقارير القياسات وبيان التليفونات، فمحتاجة
  // متابعة: يا إما تتركّب على المسان يا إما بيانها الفنى قديم ومحتاج تنظيف.
  app.get("/api/reports/lines-without-port", requireAuth, async (req, res) => {
    try {
      const { central = "", cabin = "", box = "", search = "" } = req.query as Record<string, string>;
      const params: any[] = [];
      const conds: string[] = [`NOT ${hasFrameSql("pl.full_phone")}`];
      if (central) { params.push(central); conds.push(`pl.central = $${params.length}`); }
      if (cabin)   { params.push(cabin);   conds.push(`pl.cabin_number = $${params.length}`); }
      if (box)     { params.push(box);     conds.push(`pl.box_number = $${params.length}`); }
      const q = search.trim().toLowerCase();
      if (q) {
        params.push(arQ(q));
        const p = `$${params.length}`;
        conds.push(`(${n("pl.tel_no")} LIKE ${p} OR ${n("pl.full_phone")} LIKE ${p}
          OR ${n("pl.central")} LIKE ${p} OR ${n("pl.cabin_number")} LIKE ${p}
          OR ${n("pl.box_number")} LIKE ${p} OR ${n("si.sub_name")} LIKE ${p})`);
      }
      const { rows } = await pool.query(
        `SELECT pl.full_phone                              AS "fullPhone",
                COALESCE(pl.tel_no, regexp_replace(pl.full_phone,'^88','')) AS "telNo",
                pl.central, pl.cabin_number                AS "cabinNumber",
                pl.box_number                              AS "boxNumber",
                pl.dp_terminal                             AS "dpTerminal",
                pl.idu_no AS "iduNo", pl.odu_no AS "oduNo",
                pl.primary_block_no AS "primaryBlockNo", pl.cabinet_in AS "cabinetIn",
                pl.sec_block_no AS "secBlockNo", pl.cabinet_out AS "cabinetOut",
                pl.port AS "port131", pl.len,
                la.account_no                              AS "accountNo",
                si.sub_name AS "subName", si.sub_add AS "subAdd",
                (SELECT MAX(c.uploaded_at) AT TIME ZONE 'Africa/Cairo'
                   FROM case_138 c WHERE c.full_phone = pl.full_phone) AS "lastMeasTime"
           FROM phone_lines pl
           LEFT JOIN line_accounts la ON la.full_phone = pl.full_phone
           LEFT JOIN line_subscriber_info si ON si.phone_number = pl.full_phone
          WHERE ${conds.join(" AND ")}
          ORDER BY pl.central NULLS LAST,
                   LPAD(COALESCE(pl.cabin_number,''), 8, '0'),
                   LPAD(COALESCE(pl.box_number,''), 8, '0'),
                   pl.full_phone
          LIMIT 20000`, params);
      res.json({ data: rows, total: rows.length });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/reports/duplicate-accounts — خطوط تليفون مختلفة لكن لها نفس رقم الأكونت
  app.get("/api/reports/duplicate-accounts", requireAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        // أى رقم مالوش فريم (مش متركّب على المسان) مايدخلش تقارير القياسات —
        // نفس القاعدة المطبّقة فى باقى تقارير التاب.
        `WITH dup AS (
           SELECT account_no FROM line_accounts la0
           WHERE account_no IS NOT NULL AND account_no <> ''
             AND ${hasFrameSql("la0.full_phone")}
           GROUP BY account_no
           HAVING COUNT(DISTINCT full_phone) > 1
         )
         SELECT la.account_no                                                     AS "accountNo",
                la.full_phone                                                     AS "fullPhone",
                COALESCE(pl.tel_no, regexp_replace(la.full_phone,'^88',''))        AS "telNo",
                pl.central, pl.cabin_number                                       AS "cabinNumber",
                pl.box_number                                                     AS "boxNumber",
                la.source,
                CASE la.source WHEN 'manual' THEN 'يدوى' WHEN 'customer360' THEN 'Customer360' ELSE 'شيت 138' END AS "sourceLabel",
                la.updated_by_name                                                AS "updatedByName",
                (la.updated_at AT TIME ZONE 'Africa/Cairo')                        AS "updatedAt"
         FROM line_accounts la
         JOIN dup ON dup.account_no = la.account_no
         LEFT JOIN phone_lines pl ON pl.full_phone = la.full_phone
         WHERE ${hasFrameSql("la.full_phone")}
         ORDER BY la.account_no, la.full_phone`);
      const groups = new Set(rows.map((r) => r.accountNo)).size;
      res.json({ data: rows, groups, lines: rows.length });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // DELETE /api/line-accounts/:fullPhone — حذف رقم الأكونت (يرجع الخط لتقرير بدون أكونت)
  app.delete("/api/line-accounts/:fullPhone", requireAuth, async (req: any, res) => {
    if (req.user.role === ROLES.SALES) return res.status(403).json({ message: "غير مصرح" });
    const { fullPhone } = req.params;
    await pool.query(`DELETE FROM line_accounts WHERE full_phone = $1`, [fullPhone]);
    res.json({ ok: true });
  });

  // POST /api/line-accounts/bulk — حفظ عدة أرقام أكونت دفعة واحدة (كل الأدوار عدا المبيعات)
  app.post("/api/line-accounts/bulk", requireAuth, async (req: any, res) => {
    if (req.user.role === ROLES.SALES) {
      return res.status(403).json({ message: "غير مصرح" });
    }
    const { entries } = req.body as { entries: { fullPhone: string; accountNo: string }[] };
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ message: "لا توجد بيانات للحفظ" });
    }
    // تنقية المدخلات الصالحة فقط
    const clean = entries
      .map((e) => ({ fullPhone: String(e.fullPhone || "").trim(), accountNo: String(e.accountNo || "").trim() }))
      .filter((e) => e.fullPhone && e.accountNo);
    if (clean.length === 0) {
      return res.status(400).json({ message: "لا توجد أرقام أكونت صالحة" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let saved = 0;
      // منع التكرار: نرفض أى صف رقم الأكونت بتاعه مستخدم بالفعل على خط تانى — سواء موجود
      // فى القاعدة أو اتحجز لخط مختلف داخل نفس الدفعة دى، حتى لو البيان الفنى مختلف تماماً.
      const duplicates: { fullPhone: string; accountNo: string; conflictsWith: string }[] = [];
      const claimedInBatch = new Map<string, string>();
      for (const e of clean) {
        const { rows: existingAcc } = await client.query(
          `SELECT full_phone FROM line_accounts WHERE account_no = $1 AND full_phone <> $2 LIMIT 1`,
          [e.accountNo, e.fullPhone],
        );
        const conflictPhone = existingAcc[0]?.full_phone || claimedInBatch.get(e.accountNo);
        if (conflictPhone && conflictPhone !== e.fullPhone) {
          duplicates.push({ fullPhone: e.fullPhone, accountNo: e.accountNo, conflictsWith: conflictPhone });
          continue;
        }
        claimedInBatch.set(e.accountNo, e.fullPhone);
        const { rows: existing } = await client.query(
          `SELECT account_no FROM line_accounts WHERE full_phone = $1`,
          [e.fullPhone],
        );
        const oldNo: string | null = existing[0]?.account_no ?? null;
        await client.query(
          `INSERT INTO line_accounts (full_phone, account_no, source, updated_by_id, updated_by_name, updated_at)
           VALUES ($1, $2, 'manual', $3, $4, now())
           ON CONFLICT (full_phone) DO UPDATE
             SET account_no = EXCLUDED.account_no,
                 source = 'manual',
                 updated_by_id = EXCLUDED.updated_by_id,
                 updated_by_name = EXCLUDED.updated_by_name,
                 updated_at = now()`,
          [e.fullPhone, e.accountNo, req.user.id, req.user.username],
        );
        await client.query(
          `INSERT INTO line_account_edits (full_phone, old_account_no, new_account_no, edited_by_id, edited_by_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [e.fullPhone, oldNo, e.accountNo, req.user.id, req.user.username],
        );
        saved++;
      }
      await client.query("COMMIT");
      res.json({ ok: true, saved, duplicates });
    } catch (err: any) {
      await client.query("ROLLBACK");
      res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  // POST /api/lines-no-account/:fullPhone — تعليم خط بأنه "بدون رقم أكونت" (يختفى من التقرير، الأكونت يفضل فاضى)
  app.post("/api/lines-no-account/:fullPhone", requireAuth, async (req: any, res) => {
    if (req.user.role === ROLES.SALES) return res.status(403).json({ message: "غير مصرح" });
    const { fullPhone } = req.params;
    await pool.query(
      `INSERT INTO lines_no_account (full_phone, marked_by_id, marked_by_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (full_phone) DO NOTHING`,
      [fullPhone, req.user.id, req.user.username],
    );
    res.json({ ok: true });
  });

  // DELETE /api/lines-no-account/:fullPhone — إلغاء تعليم "بدون رقم أكونت" (يرجع للتقرير)
  app.delete("/api/lines-no-account/:fullPhone", requireAuth, async (req: any, res) => {
    if (req.user.role === ROLES.SALES) return res.status(403).json({ message: "غير مصرح" });
    const { fullPhone } = req.params;
    await pool.query(`DELETE FROM lines_no_account WHERE full_phone = $1`, [fullPhone]);
    res.json({ ok: true });
  });

  // GET /api/reports/marked-no-account — الأرقام المعلَّمة "بدون رقم أكونت" (اتشالت من تقرير الخطوط
  // بدون أكونت بالحذف اليدوى، أو Customer360 رجّع "this subscriber does not exist"). المصدر = lines_no_account.
  app.get("/api/reports/marked-no-account", requireAuth, async (req, res) => {
    const { central = "", q = "" } = req.query as Record<string, string>;
    const params: any[] = [];
    const conds: string[] = [];
    if (central) { params.push(central); conds.push(`pl.central = $${params.length}`); }
    if (q.trim()) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      conds.push(`(${n("na.full_phone")} LIKE ${p} OR ${n("pl.tel_no")} LIKE ${p} OR ${n("pl.central")} LIKE ${p} OR ${n("na.marked_by_name")} LIKE ${p})`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT na.full_phone AS "fullPhone",
              COALESCE(pl.tel_no, regexp_replace(na.full_phone, '^88', '')) AS "telNo",
              pl.central, pl.cabin_number AS "cabinNumber", pl.box_number AS "boxNumber",
              pp.frame AS frame, pl.dp_terminal AS "dpTerminal",
              na.marked_by_name AS "markedByName",
              (na.marked_at AT TIME ZONE 'Africa/Cairo') AS "markedAt"
       FROM lines_no_account na
       LEFT JOIN phone_lines pl ON pl.full_phone = na.full_phone
       LEFT JOIN phone_ports pp ON pp.phone_number = na.full_phone
       ${where}
       ORDER BY na.marked_at DESC
       LIMIT 20000`,
      params,
    );
    res.json(rows);
  });

  // GET /api/phone-lines/needs-speed — أرقام محتاجة رفع سرعة (تقريرا 2 و 4)
  // المعيار: نستبعد الخطوط غير المتزامنة (السرعة الحالية وأقصى سرعة < 200 معاً)، ثم نعتبر الخط
  //   محتاجاً رفع سرعة إذا: (نسبة الحالى/الأقصى < 60% و 15 < الاسكور < 101) أو (الاسكور < 16 و السرعة الحالية < 10000).
  // requireComplaint=1: فقط الأرقام التى لها رقم شكوى خلال آخر شهر (تقرير 2)؛ بدونها = الكل (تقرير 4).
  //
  // GET /api/phone-lines/needs-speed-lowscore — «اسكور منخفض وسرعة عالية» (تقرير منفصل)
  // نفس الـ handler بالظبط (نفس الأعمدة والفلاتر والتصدير وزر الطابور) وبيغيّر معيار
  // التأهيل بس. المعيار فوق فيه **فجوة**: الخط اللى اسكوره 15 أو أقل وسرعته الحالية
  // 10000 أو أكتر بيسقط من الاتنين — شرط النسبة عايز اسكور > 15، وشرط الاسكور المنخفض
  // عايز سرعة < 10000. مثال حقيقى: 2823645 (اسكور 15، حالى 10238، أقصى 53080 → 19% بس
  // من سرعته الممكنة) كان مش ظاهر فى أى تقرير. التقرير ده بيمسك الفجوة دى بالظبط:
  //   الاسكور < 16  و  السرعة الحالية >= 10000  و  النسبة < 60%.
  // القيود التلاتة مع بعض بتضمن إن الخط **مستحيل** يكون فى تقرير «محتاجة رفع سرعة»
  // (شرط (أ) بيقع على الاسكور، وشرط (ب) بيقع على السرعة) — فمافيش تكرار بين التقريرين.
  app.get(["/api/phone-lines/needs-speed", "/api/phone-lines/needs-speed-lowscore"], requireAuth, async (req, res) => {
    const lowScoreMode = req.path.endsWith("/needs-speed-lowscore");
    const { central = "", cabin = "", box = "", page = "1", limit = "50", requireComplaint = "", requireComplaintAny = "", poStoppedBefore = "", search = "", includeExcluded = "" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(20000, Math.max(1, parseInt(limit) || 50));
    const needComplaint = requireComplaint === "1" || requireComplaint === "true";
    // needComplaintAny: لها أى شكوى — داخل الشاشة (ticket_dsl_current المفتوحة) أو خارجها
    //   (complaint_details المغلقة + remaining_complaints)، أو عطل «خارج الشاشة» مسجَّل يدوياً
    //   من صفحة بحث رقم التليفون (manual_faults) وممكن ملوش أى أثر فى 430D خالص — بدون قيد آخر شهر.
    const needComplaintAny = requireComplaintAny === "1" || requireComplaintAny === "true";
    const params: any[] = [];
    // أى رقم مالوش فريم (مش متركّب على المسان) مايدخلش تقارير القياسات
    const conds: string[] = [hasFrameSql("m.full_phone")];

    // مصدر التقرير = أحدث قياس لكل رقم فى case_138 (مش phone_lines) — علشان تظهر كل الأرقام
    // المحتاجة رفع سرعة سواء لها بيانات فنية (موجودة فى phone_lines) أو لأ، وسواء لها شكوى أو لأ.
    // السنترال/الكابينة بتيجى من phone_lines، ولو الرقم مش موجود فيها بتيجى من سجل الشكوى.
    // ⚡ الأداء: نفلتر معيار رفع السرعة جوّه الـ subquery (m) قبل أى join/lateral — فالـ join
    // مع الشكاوى بيتعمل فقط للأرقام المؤهّلة (قليلة) بدل كل الأرقام المتقاسة (آلاف).
    const joinClause = `FROM (
        SELECT * FROM (
          SELECT DISTINCT ON (c.full_phone)
                 c.full_phone, c.current_speed, c.max_speed, c.score, c.complain_no, c.uploaded_at,
                 -- توحيد وحدة السرعة إلى Kbps: القيم اللى فيها كسر عشري (زى 0.5 / 2.5) مخزّنة بالميجابت → × 1024.
                 -- بدون ده كان الشرط (< 200) بيعتبر خط VDSL بالميجابت (0.5/2.5) خطاً ميتاً ويستبعده بالغلط.
                 CASE WHEN c.current_speed LIKE '%.%' THEN NULLIF(regexp_replace(COALESCE(c.current_speed,''),'[^0-9.]','','g'),'')::numeric * 1024
                      ELSE NULLIF(regexp_replace(COALESCE(c.current_speed,''),'[^0-9]','','g'),'')::numeric END AS cur_n,
                 CASE WHEN c.max_speed LIKE '%.%' THEN NULLIF(regexp_replace(COALESCE(c.max_speed,''),'[^0-9.]','','g'),'')::numeric * 1024
                      ELSE NULLIF(regexp_replace(COALESCE(c.max_speed,''),'[^0-9]','','g'),'')::numeric END AS mx_n
          FROM case_138 c
          WHERE c.full_phone IS NOT NULL AND c.full_phone <> ''
          ORDER BY c.full_phone, c.id DESC
        ) latest
        WHERE latest.score IS NOT NULL
          AND NOT (COALESCE(latest.cur_n, 0) < 200 AND COALESCE(latest.mx_n, 0) < 200)
          AND ${lowScoreMode ? `(
            latest.score < 16
            AND latest.cur_n >= 10000
            AND latest.mx_n > 0 AND latest.cur_n / latest.mx_n < 0.6
          )` : `(
            (latest.mx_n > 0 AND latest.cur_n / latest.mx_n < 0.6 AND latest.score > 15 AND latest.score < 101)
            OR (latest.score < 16 AND latest.cur_n < 10000)
          )`}
      ) m
      LEFT JOIN phone_lines pl ON pl.full_phone = m.full_phone
      LEFT JOIN phone_ports pp ON pp.phone_number = m.full_phone
      LEFT JOIN line_accounts la ON la.full_phone = m.full_phone
      LEFT JOIN line_po_events pe ON pe.account_no = la.account_no
      LEFT JOIN LATERAL (
        SELECT u.complain_no, u.complain_time, u.central_name, u.cabinet_no FROM (
          SELECT complain_no, complain_time, COALESCE(NULLIF(central_name,''), exchange_name) AS central_name, cabinet_no
            FROM complaint_details
            WHERE ${sp("phone_number")} = ${sp("m.full_phone")}
          UNION ALL
          SELECT complain_no, complain_time, exchange_name AS central_name, cabinet_no
            FROM remaining_complaints
            WHERE ${sp("phone_number")} = ${sp("m.full_phone")}${needComplaintAny ? `
          UNION ALL
          SELECT ticket_id AS complain_no, complaint_time AS complain_time, central_name, cabinet_no
            FROM ticket_dsl_current
            WHERE close_date IS NULL AND ${sp("phone_number")} = ${sp("m.full_phone")}
          UNION ALL
          SELECT ('يدوى-' || mf.id) AS complain_no, mf.flagged_at AS complain_time, mf.central AS central_name, mf.cabin_number AS cabinet_no
            FROM manual_faults mf
            WHERE ${sp("mf.phone_short")} = ${sp("m.full_phone")} OR ${sp("mf.full_phone")} = ${sp("m.full_phone")}` : ""}
        ) u ORDER BY u.complain_time DESC NULLS LAST LIMIT 1
      ) cpl ON true`;

    if (needComplaint) {
      conds.push(`cpl.complain_time >= now() - interval '1 month'`);
    } else if (needComplaintAny) {
      conds.push(`cpl.complain_no IS NOT NULL`);
    }
    if (central) { params.push(central); conds.push(`COALESCE(pl.central, cpl.central_name) = $${params.length}`); }
    if (cabin) { params.push(cabin); conds.push(`COALESCE(pl.cabin_number, cpl.cabinet_no) = $${params.length}`); }
    if (box) { params.push(box); conds.push(`pl.box_number = $${params.length}`); }
    // كباين مستثناة من التقرير افتراضياً (بقرار تشغيلى) — خطوطها مابتظهرش إلا لو المستخدم
    // ضغط زر «إظهار الكباين المستثناة» (includeExcluded=1). الاستثناء بيتم بكود الـ MSAN،
    // سواء الكود جاى من بيان البورتات للخط نفسه أو من جدول فنيى الكباين (سنترال + كابينة).
    const SPEED_EXCLUDED_MSAN = [
      "11-2-26-12", "11-2-26-13", "11-2-26-15", "11-2-26-16",
      "11-2-26-19", "11-2-26-20", "11-2-26-21", "11-2-26-24",
    ];
    // إظهار الكباين المستثناة للسوبر أدمن فقط — الزر مخفى عن غيره فى الواجهة، وبنتحقق
    // هنا كمان عشان مايتعملش تحايل بالباراميتر مباشرةً.
    // الزر بيبدّل بين وضعين (مش بيضيف): الوضع العادى = كل الخطوط **ما عدا** الكباين
    // المستثناة، ووضع الإظهار = خطوط الكباين المستثناة **فقط**.
    const onlyExcluded = req.user?.role === ROLES.SUPER_ADMIN
      && (includeExcluded === "1" || includeExcluded === "true");
    params.push(SPEED_EXCLUDED_MSAN);
    const ex = `$${params.length}::text[]`;
    const inExcludedCabin = `(EXISTS (SELECT 1 FROM phone_ports pxe
                                       WHERE pxe.phone_number = m.full_phone
                                         AND btrim(pxe.msan_code) = ANY(${ex}))
                              OR EXISTS (SELECT 1 FROM cabinet_technicians ctx
                                          WHERE ctx.central_name = COALESCE(pl.central, cpl.central_name)
                                            AND ctx.cabin_number = COALESCE(pl.cabin_number, cpl.cabinet_no)
                                            AND btrim(ctx.cabin_code) = ANY(${ex})))`;
    conds.push(onlyExcluded ? inExcludedCabin : `NOT ${inExcludedCabin}`);
    // بحث نصّى: رقم التليفون (كامل أو قصير) أو رقم الأكونت أو رقم الشكوى — على مستوى السيرفر
    // علشان يبحث فى كل السجلات مش فى الصفحة المعروضة بس.
    if (search.trim()) {
      params.push(arQ(search));
      const p = params.length;
      conds.push(`(${n("m.full_phone")} LIKE $${p}
                OR ${n("COALESCE(pl.tel_no, regexp_replace(m.full_phone, '^88', ''))")} LIKE $${p}
                OR ${n("la.account_no")} LIKE $${p}
                OR ${n("cpl.complain_no")} LIKE $${p})`);
    }
    // فلتر: يستبعد اللى تم إيقاف الـ PO بتاعها بعد هذا التاريخ/الوقت، ويُبقى الباقى بما فيهم اللى مالوش تاريخ إيقاف
    if (poStoppedBefore) { params.push(poStoppedBefore); conds.push(`(pe.last_stop_at IS NULL OR (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') <= $${params.length}::timestamp)`); }
    const whereNoQ = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // بزر من الواجهة (excludeQueued) — مش تلقائى
    if (excludeQueuedOn(req)) conds.push(notQueuedSql("la.account_no"));
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const totalRes = await pool.query(`SELECT COUNT(*)::int AS c ${joinClause} ${where}`, params);
    const total = totalRes.rows[0].c as number;
    const queuedExcluded = excludeQueuedOn(req)
      ? Math.max(0, ((await pool.query(`SELECT COUNT(*)::int AS c ${joinClause} ${whereNoQ}`, params)).rows[0].c as number) - total)
      : 0;
    const offset = (pageNum - 1) * pageSize;
    params.push(pageSize); params.push(offset);
    const dataRes = await pool.query(
      `SELECT pl.id, COALESCE(pl.tel_no, regexp_replace(m.full_phone, '^88', '')) AS "telNo",
              COALESCE(pl.central, cpl.central_name) AS central, pl.idu_no AS "iduNo", pl.odu_no AS "oduNo",
              COALESCE(pl.cabin_number, cpl.cabinet_no) AS "cabinNumber", pl.box_number AS "boxNumber",
              pl.dp_terminal AS "dpTerminal", COALESCE(pp.frame, pl.port) AS port, pl.len, m.full_phone AS "fullPhone",
              la.account_no AS "accountNo", la.source AS "accountSource",
              m.current_speed AS "lineCurrentSpeed", m.max_speed AS "lineMaxSpeed",
              m.score AS "lastMeasScore", m.complain_no AS "lastMeasComplainNo",
              (m.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime",
              cpl.complain_no AS "complaintNo",
              (cpl.complain_time AT TIME ZONE 'Africa/Cairo') AS "complaintTime",
              (pe.last_raise_at AT TIME ZONE 'Africa/Cairo') AS "lastPoRaiseAt",
              (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') AS "lastPoStopAt"
       ${joinClause} ${where}
       ORDER BY COALESCE(pl.central, cpl.central_name), LPAD(COALESCE(pl.cabin_number, cpl.cabinet_no, ''), 8, '0'),
                LPAD(COALESCE(pl.box_number, ''), 8, '0'), m.score DESC NULLS LAST, m.full_phone
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ data: dataRes.rows, total, queuedExcluded, page: pageNum, pageSize });
  });

  // GET /api/phone-lines/needs-po-stop — خطوط تحتاج إيقاف PO
  // المعيار: لها رقم أكونت + آخر قياس مرّ عليه أقل من 3 أيام + لا تحتاج رفع سرعة (عكس معيار
  //   محتاجة رفع سرعة). دى غالباً خطوط اتعملها Profile Optimization ومحتاجة إيقاف الـ nightly PO.
  app.get("/api/phone-lines/needs-po-stop", requireAuth, async (req, res) => {
    const { central = "", cabin = "", box = "", poStoppedBefore = "", page = "1", limit = "50", search = "" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(20000, Math.max(1, parseInt(limit) || 50));
    const params: any[] = [];
    // أى رقم مالوش فريم (مش متركّب على المسان) مايدخلش تقارير القياسات
    const conds: string[] = [hasFrameSql("m.full_phone")];

    const joinClause = `FROM (
        SELECT * FROM (
          SELECT DISTINCT ON (c.full_phone)
                 c.full_phone, c.current_speed, c.max_speed, c.score, c.complain_no, c.uploaded_at,
                 -- توحيد وحدة السرعة إلى Kbps: القيم اللى فيها كسر عشري (زى 0.5 / 2.5) مخزّنة بالميجابت → × 1024.
                 -- بدون ده كان الشرط (< 200) بيعتبر خط VDSL بالميجابت (0.5/2.5) خطاً ميتاً ويستبعده بالغلط.
                 CASE WHEN c.current_speed LIKE '%.%' THEN NULLIF(regexp_replace(COALESCE(c.current_speed,''),'[^0-9.]','','g'),'')::numeric * 1024
                      ELSE NULLIF(regexp_replace(COALESCE(c.current_speed,''),'[^0-9]','','g'),'')::numeric END AS cur_n,
                 CASE WHEN c.max_speed LIKE '%.%' THEN NULLIF(regexp_replace(COALESCE(c.max_speed,''),'[^0-9.]','','g'),'')::numeric * 1024
                      ELSE NULLIF(regexp_replace(COALESCE(c.max_speed,''),'[^0-9]','','g'),'')::numeric END AS mx_n
          FROM case_138 c
          WHERE c.full_phone IS NOT NULL AND c.full_phone <> ''
          ORDER BY c.full_phone, c.id DESC
        ) latest
        WHERE latest.score IS NOT NULL
          AND latest.score <= 100                               -- استبعاد الأرقام اللى الاسكور فيها أكبر من 100
          AND latest.uploaded_at >= now() - interval '3 days'   -- آخر قياس مرّ عليه أقل من 3 أيام
          -- COALESCE(…, false): لو السرعة القصوى غير قابلة للقراءة (N/A) التعبير
          -- الداخلى بيطلع NULL وNOT NULL = NULL فالخط كان بيختفى من التقريرين
          -- الاتنين (مش محتاج رفع فى الأول، ومش ظاهر هنا) — بقى بيظهر هنا.
          AND NOT COALESCE((                                     -- لا تحتاج رفع سرعة (عكس معيار needs-speed)
            NOT (COALESCE(latest.cur_n, 0) < 200 AND COALESCE(latest.mx_n, 0) < 200)
            AND (
              (latest.mx_n > 0 AND latest.cur_n / latest.mx_n < 0.6 AND latest.score > 15 AND latest.score < 101)
              OR (latest.score < 16 AND latest.cur_n < 10000)
            )
          ), false)
      ) m
      JOIN line_accounts la ON la.full_phone = m.full_phone AND la.account_no IS NOT NULL AND la.account_no <> ''
      LEFT JOIN phone_lines pl ON pl.full_phone = m.full_phone
      LEFT JOIN phone_ports pp ON pp.phone_number = m.full_phone
      LEFT JOIN line_po_events pe ON pe.account_no = la.account_no
      LEFT JOIN LATERAL (
        SELECT u.central_name, u.cabinet_no FROM (
          SELECT complain_time, COALESCE(NULLIF(central_name,''), exchange_name) AS central_name, cabinet_no
            FROM complaint_details
            WHERE ${sp("phone_number")} = ${sp("m.full_phone")}
          UNION ALL
          SELECT complain_time, exchange_name AS central_name, cabinet_no
            FROM remaining_complaints
            WHERE ${sp("phone_number")} = ${sp("m.full_phone")}
        ) u ORDER BY u.complain_time DESC NULLS LAST LIMIT 1
      ) cpl ON true`;

    if (central) { params.push(central); conds.push(`COALESCE(pl.central, cpl.central_name) = $${params.length}`); }
    if (cabin) { params.push(cabin); conds.push(`COALESCE(pl.cabin_number, cpl.cabinet_no) = $${params.length}`); }
    if (box) { params.push(box); conds.push(`pl.box_number = $${params.length}`); }
    // بحث نصّى: رقم التليفون (كامل أو قصير) أو رقم الأكونت — على مستوى السيرفر
    if (search.trim()) {
      params.push(arQ(search));
      const p = params.length;
      conds.push(`(${n("m.full_phone")} LIKE $${p}
                OR ${n("COALESCE(pl.tel_no, regexp_replace(m.full_phone, '^88', ''))")} LIKE $${p}
                OR ${n("la.account_no")} LIKE $${p})`);
    }
    // فلتر: يستبعد الخطوط اللى تم إيقاف الـ PO بتاعها بعد هذا التاريخ/الوقت (بتوقيت القاهرة)،
    //        ويُبقى الباقى بما فيهم اللى مالوش تاريخ إيقاف (last_stop_at IS NULL).
    if (poStoppedBefore) { params.push(poStoppedBefore); conds.push(`(pe.last_stop_at IS NULL OR (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') <= $${params.length}::timestamp)`); }
    const whereNoQ = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // بزر من الواجهة (excludeQueued) — مش تلقائى
    if (excludeQueuedOn(req)) conds.push(notQueuedSql("la.account_no"));
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const totalRes = await pool.query(`SELECT COUNT(*)::int AS c ${joinClause} ${where}`, params);
    const total = totalRes.rows[0].c as number;
    const queuedExcluded = excludeQueuedOn(req)
      ? Math.max(0, ((await pool.query(`SELECT COUNT(*)::int AS c ${joinClause} ${whereNoQ}`, params)).rows[0].c as number) - total)
      : 0;
    const offset = (pageNum - 1) * pageSize;
    params.push(pageSize); params.push(offset);
    const dataRes = await pool.query(
      `SELECT pl.id, COALESCE(pl.tel_no, regexp_replace(m.full_phone, '^88', '')) AS "telNo",
              COALESCE(pl.central, cpl.central_name) AS central, pl.idu_no AS "iduNo", pl.odu_no AS "oduNo",
              COALESCE(pl.cabin_number, cpl.cabinet_no) AS "cabinNumber", pl.box_number AS "boxNumber",
              pl.dp_terminal AS "dpTerminal", COALESCE(pp.frame, pl.port) AS port, pl.len, m.full_phone AS "fullPhone",
              la.account_no AS "accountNo", la.source AS "accountSource",
              m.current_speed AS "lineCurrentSpeed", m.max_speed AS "lineMaxSpeed",
              m.score AS "lastMeasScore", m.complain_no AS "lastMeasComplainNo",
              (m.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime",
              NULL AS "complaintNo", NULL AS "complaintTime",
              (pe.last_raise_at AT TIME ZONE 'Africa/Cairo') AS "lastPoRaiseAt",
              (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') AS "lastPoStopAt"
       ${joinClause} ${where}
       ORDER BY COALESCE(pl.central, cpl.central_name), LPAD(COALESCE(pl.cabin_number, cpl.cabinet_no, ''), 8, '0'),
                LPAD(COALESCE(pl.box_number, ''), 8, '0'), m.uploaded_at DESC, m.full_phone
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ data: dataRes.rows, total, queuedExcluded, page: pageNum, pageSize });
  });

  // GET /api/phone-lines/lookup?phone=<رقم> — بحث برقم التليفون → بياناته الفنية + آخر قياس
  // متاح لكل المستخدمين ما عدا المبيعات. يقبل الرقم الكامل (88..) أو رقم التليفون القصير.
  app.get("/api/phone-lines/lookup", requireAuth, async (req, res) => {
    if (req.user?.role === ROLES.SALES) return res.status(403).json({ message: "غير مسموح" });
    const phone = String((req.query as Record<string, string>).phone || "").trim();
    if (!phone) return res.status(400).json({ message: "أدخل رقم التليفون" });
    // مطابقة الرقم الكامل أو القصير (مع/بدون بادئة 88)
    const short = phone.replace(/^88/, "");
    const full = phone.startsWith("88") ? phone : "88" + phone;
    const codes = await coverageCodes(req.user);   // {own, covered} لحساب ownedByMe
    // نبحث فى phone_lines (بيانات فنية) وإلا نرجّع البيانات من line_accounts / case_138 /
    // الشكاوى — علشان يظهر أى رقم له أكونت أو قياس أو شكوى حتى لو مالوش بيانات فنية.
    const { rows } = await pool.query(
      `WITH t AS (SELECT $1::text AS raw, $2::text AS short, $3::text AS full)
       SELECT COALESCE(pl.tel_no, t.short) AS "telNo",
              COALESCE(pl.central, cpl.central_name, si.central, wfmo.central_name) AS central,
              COALESCE(pl.cabin_number, cpl.cabinet_no, si.cabin_number,
                       NULLIF(btrim(wfmo.exch_cabinet), '')) AS "cabinNumber",
              COALESCE(pl.box_number, si.box_number) AS "boxNumber", COALESCE(pp.frame, pl.port) AS frame,
              ctc.cabin_code AS "msanCode",
              COALESCE(mto.tech_name, ctc.ct_tech, '') AS "techName",
              COALESCE(pl.idu_no, si.idu_no) AS "iduNo", COALESCE(pl.odu_no, si.odu_no) AS "oduNo",
              COALESCE(pl.primary_block_no, si.primary_block) AS "primaryBlockNo", COALESCE(pl.cabinet_in, si.cabinet_in) AS "cabinetIn",
              COALESCE(pl.sec_block_no, si.sec_block) AS "secBlockNo", COALESCE(pl.cabinet_out, si.cabinet_out) AS "cabinetOut",
              COALESCE(pl.dp_terminal, si.dp_terminal) AS "dpTerminal", COALESCE(pp.port_number, pl.port, si.port_no) AS "port", pl.len AS "len",
              COALESCE(pl.fiber_block, si.fiber_block) AS "fiberBlock", COALESCE(pl.fiber_out, si.fiber_out) AS "fiberOut",
              pp.port_type AS "portType", pp.row_no AS "rowNo", pp.column_no AS "columnNo",
              pp.voice_status AS "voiceStatus", pp.data_status AS "dataStatus",
              pp.operator AS "operator", pp.shelf AS "shelf", pp.slot AS "slot",
              mob.m AS "mobile", mob.manual AS "mobileManual",
              COALESCE(si.sub_name, wfmo.customer_name) AS "subName",
              COALESCE(si.sub_add, wfmo.address) AS "subAdd",
              -- أمر الشغل الأحدث للرقم — بيوضّح إن الرقم جديد وتحت التركيب/النقل
              wfmo.work_order_type AS "wfmType", wfmo.stage AS "wfmStage",
              wfmo.status AS "wfmStatus",
              (wfmo.creation_date AT TIME ZONE 'Africa/Cairo') AS "wfmCreatedAt",
              si.work_ord_date AS "workOrdDate", si.work_ord_no AS "workOrdNo",
              COALESCE(pl.full_phone, la.full_phone, c.full_phone, t.full) AS "fullPhone",
              la.account_no AS "accountNo",
              -- الخط اتفحص واتعلّم «بدون أكونت» (مسئول البيانات شاله من التقرير):
              -- ده معناه إنه **صوت بس مش داتا** — نفرّق بيه بين اللى لسه ماتفحصش
              -- (مفيش أكونت ومفيش علامة) واللى اتفحص وثبت إنه مالوش خدمة داتا.
              (na.full_phone IS NOT NULL)                       AS "markedNoAccount",
              na.marked_by_name                                  AS "noAccountBy",
              (na.marked_at AT TIME ZONE 'Africa/Cairo')         AS "noAccountAt",
              c.current_speed AS "currentSpeed", c.max_speed AS "maxSpeed",
              c.score AS "score", (c.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime",
              c.measured_by AS "measuredBy",
              (pe.last_raise_at AT TIME ZONE 'Africa/Cairo') AS "lastPoRaiseAt", pe.last_raise_by AS "raisedBy",
              (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') AS "lastPoStopAt", pe.last_stop_by AS "stoppedBy",
              (cpl.complain_time AT TIME ZONE 'Africa/Cairo') AS "lastComplaintAt",
              -- ownedByMe: خطوطى أنا ($4 = كودى) → أى خط فى كباينى.
              -- خطوط زميل مشمول بالتغطية ($5 = أكواد الزملاء) → **فقط** لو عليها عطل حالى
              -- (ticket_dsl_current مفتوح) أو عطل خارج الشاشة مفتوح (manual_faults status='open').
              (ctc.cabin_code IS NOT NULL AND btrim(ctc.cabin_code) <> '' AND (
                 (array_length($4::text[], 1) > 0 AND EXISTS (
                    SELECT 1 FROM cabinet_technicians ctx
                    WHERE btrim(ctx.cabin_code) = btrim(ctc.cabin_code) AND btrim(ctx.worker_code) = ANY($4::text[])))
                 OR
                 (array_length($5::text[], 1) > 0
                  AND EXISTS (SELECT 1 FROM cabinet_technicians ctx
                              WHERE btrim(ctx.cabin_code) = btrim(ctc.cabin_code) AND btrim(ctx.worker_code) = ANY($5::text[]))
                  AND (
                    EXISTS (SELECT 1 FROM ticket_dsl_current tc
                            WHERE tc.phone_number = t.short AND tc.close_date IS NULL
                              AND (tc.status_code ~ '^(160|173|122|73|72|60|81)' OR tc.complain_type_name ~ '^(160|173|122|73|72|60|81)'))
                    OR EXISTS (SELECT 1 FROM manual_faults mf
                               WHERE mf.status = 'open' AND (mf.phone_short = t.short OR mf.full_phone = t.full))
                    -- أو عطل **اتنظّم النهاردة** (تقرير «الأعطال المنتظمة اليوم»):
                    -- الفنى القائم بالعمل بيحتاج يقيس بعد الإزالة عشان يتأكد إن الخط
                    -- رجع تمام، فالصلاحية مابتقفلش فى نفس اللحظة اللى العطل بيتقفل فيها.
                    -- نفس تعريف التقرير بالحرف — مصدرين: مغلق النهاردة فى الحالى، أو
                    -- اختفى من الحالى وكان فى لقطة بداية اليوم (ما عدا 135/138 الوسيطة).
                    OR EXISTS (SELECT 1 FROM ticket_dsl_current tr
                               WHERE tr.phone_number = t.short AND tr.close_date IS NOT NULL
                                 AND (tr.close_date AT TIME ZONE 'Africa/Cairo')::date
                                     = (now() AT TIME ZONE 'Africa/Cairo')::date
                                 AND (tr.status_code ~ '^(160|173|122|73|72|60)' OR tr.complain_type_name ~ '^(160|173|122|73|72|60)'))
                    OR EXISTS (SELECT 1 FROM ticket_dsl_sod ts
                               WHERE ts.phone_number = t.short
                                 AND NOT EXISTS (SELECT 1 FROM ticket_dsl_current c WHERE c.ticket_id = ts.ticket_id)
                                 AND NOT (ts.status_code ~ '^(135|138)')
                                 AND (ts.status_code ~ '^(160|173|122|73|72|60)' OR ts.complain_type_name ~ '^(160|173|122|73|72|60)'))
                  ))
              ))
              -- أو: الرقم موجود فى تقرير «الأعطال المنتظمة اليوم» وتذكرته على كابينة
              -- بتاعتى أو بتاعة زميل أنا مغطّيه → **كل** أرقام التقرير مفتوحة للفنى
              -- القائم بالعمل وللفنى المغطَّى له.
              -- ⚠️ ليه فرع منفصل مش شرط جوّه الفرع اللى فوق؟ الفرع اللى فوق بيحدّد
              -- الكابينة من phone_lines، لكن التقرير نفسه بيحدّدها من **التذكرة**
              -- (central_name/cabinet_no بتوعها). فالرقم اللى بيان الخط بتاعه ناقص أو
              -- كابينته فيه مختلفة عن اللى فى التذكرة كان بيسقط رغم إنه ظاهر فى التقرير.
              -- والمطابقة بـ sp() الطرفين لأن جداول التذاكر بتخزّن الرقم بصيغ مختلفة.
              OR EXISTS (
                SELECT 1 FROM (
                  SELECT tc.phone_number, tc.central_name, tc.cabinet_no, tc.status_code, tc.complain_type_name
                    FROM ticket_dsl_current tc
                   WHERE tc.close_date IS NOT NULL
                     AND (tc.close_date AT TIME ZONE 'Africa/Cairo')::date
                         = (now() AT TIME ZONE 'Africa/Cairo')::date
                  UNION ALL
                  SELECT ts.phone_number, ts.central_name, ts.cabinet_no, ts.status_code, ts.complain_type_name
                    FROM ticket_dsl_sod ts
                   WHERE NOT EXISTS (SELECT 1 FROM ticket_dsl_current c2 WHERE c2.ticket_id = ts.ticket_id)
                     AND NOT (ts.status_code ~ '^(135|138)')
                ) rt
                JOIN cabinet_technicians rct
                  ON rct.central_name = rt.central_name AND rct.cabin_number = rt.cabinet_no
                WHERE ${sp("rt.phone_number")} = ${sp("t.short")}
                  AND (rt.status_code ~ '^(160|173|122|73|72|60)' OR rt.complain_type_name ~ '^(160|173|122|73|72|60)')
                  AND btrim(rct.worker_code) = ANY($4::text[] || $5::text[])
              ) AS "ownedByMe",
              (pl.full_phone IS NOT NULL OR la.account_no IS NOT NULL OR c.uploaded_at IS NOT NULL OR cpl.complain_no IS NOT NULL OR pp.phone_number IS NOT NULL OR si.phone_number IS NOT NULL OR wfmo.phone_number IS NOT NULL) AS "hasData"
       FROM t
       LEFT JOIN phone_lines pl ON pl.full_phone = t.raw OR pl.tel_no = t.short OR pl.full_phone = t.full
       LEFT JOIN line_accounts la ON la.full_phone = COALESCE(pl.full_phone, t.full)
       LEFT JOIN lines_no_account na ON na.full_phone = COALESCE(pl.full_phone, t.full)
       LEFT JOIN line_po_events pe ON pe.account_no = la.account_no
       LEFT JOIN phone_ports pp ON pp.phone_number IN (COALESCE(pl.full_phone, t.full), t.short, t.raw)
       LEFT JOIN line_subscriber_info si ON si.phone_number IN (COALESCE(pl.full_phone, t.full), t.short, t.raw)
       LEFT JOIN LATERAL (
         SELECT ct.cabin_code, tn.tech_name AS ct_tech
         FROM cabinet_technicians ct
         LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
         WHERE ct.central_name = pl.central AND ct.cabin_number = pl.cabin_number
         ORDER BY (ct.cabin_code IS NOT NULL AND ct.cabin_code <> '') DESC, tn.tech_name NULLS LAST
         LIMIT 1
       ) ctc ON true
       LEFT JOIN msan_tech_overrides mto ON mto.cabin_code = ctc.cabin_code
       LEFT JOIN LATERAL (
         SELECT c2.full_phone, c2.current_speed, c2.max_speed, c2.score, c2.uploaded_at, c2.measured_by
         FROM case_138 c2 WHERE c2.full_phone = COALESCE(pl.full_phone, t.full) ORDER BY c2.id DESC LIMIT 1
       ) c ON true
       LEFT JOIN LATERAL (
         SELECT u.complain_no, u.central_name, u.cabinet_no, u.complain_time FROM (
           SELECT complain_no, complain_time, COALESCE(NULLIF(central_name,''), exchange_name) AS central_name, cabinet_no
             FROM complaint_details WHERE ${sp("phone_number")} = ${sp("t.short")}
           UNION ALL
           SELECT complain_no, complain_time, exchange_name AS central_name, cabinet_no
             FROM remaining_complaints WHERE ${sp("phone_number")} = ${sp("t.short")}
         ) u ORDER BY u.complain_time DESC NULLS LAST LIMIT 1
       ) cpl ON true
       LEFT JOIN LATERAL (
         -- أوامر الشغل (تركيب/نقل): الرقم الجديد لسه ماحصلش عليه بيان خطوط ولا شكاوى،
         -- فكان «لا يوجد خط بالرقم» رغم إنه ظاهر فى تقرير «التركيبات والنقل الحالى».
         -- الحالى (wfm_current) الأول، وبعده التاريخى (maintenance_orders).
         SELECT w.phone_number, w.customer_name, w.address, w.central_name, w.exch_cabinet,
                w.work_order_type, w.stage, w.status, w.creation_date
         FROM (
           SELECT phone_number, customer_name, address, central_name, exch_cabinet,
                  work_order_type, stage, status, creation_date, 0 AS pr
             FROM wfm_current WHERE ${sp("phone_number")} = ${sp("t.short")}
           UNION ALL
           SELECT phone_number, customer_name, address, central_name, exch_cabinet,
                  work_order_type, stage, status, creation_date, 1 AS pr
             FROM maintenance_orders WHERE ${sp("phone_number")} = ${sp("t.short")}
         ) w ORDER BY w.pr, w.creation_date DESC NULLS LAST LIMIT 1
       ) wfmo ON true
       LEFT JOIN LATERAL (
         -- رقم الموبايل: الأولوية للمُدخَل يدوياً، ثم من أوامر الشغل (wfm)، ثم من طلبات FTTH
         SELECT m, manual FROM (
           SELECT lm.mobile AS m, true AS manual, 0 AS pr FROM line_mobiles lm
             WHERE lm.full_phone = COALESCE(pl.full_phone, la.full_phone, t.full)
           UNION ALL
           SELECT mo.mobile AS m, false AS manual, 1 AS pr FROM maintenance_orders mo
             WHERE mo.phone_number IN (COALESCE(pl.tel_no, t.short), t.full, t.raw)
               AND mo.mobile !~ '[A-Za-z=/]' AND mo.mobile ~ '[0-9]{5,}'   -- رقم حقيقى فقط (استبعاد المشفّر)
           UNION ALL
           -- أوامر الشغل الحالية (تركيب/نقل) — الرقم الجديد موبايله هنا قبل ما يدخل التاريخى
           SELECT wc.mobile AS m, false AS manual, 1 AS pr FROM wfm_current wc
             WHERE ${sp("wc.phone_number")} = ${sp("t.short")}
               AND wc.mobile !~ '[A-Za-z=/]' AND wc.mobile ~ '[0-9]{5,}'
           UNION ALL
           SELECT fo.customer_mobile AS m, false AS manual, 2 AS pr FROM ftth_orders_current fo
             WHERE fo.service_number IN (COALESCE(pl.tel_no, t.short), t.full, t.raw)
               AND fo.customer_mobile !~ '[A-Za-z=/]' AND fo.customer_mobile ~ '[0-9]{5,}'
         ) x WHERE NULLIF(btrim(x.m),'') IS NOT NULL ORDER BY pr LIMIT 1
       ) mob ON true
       LIMIT 1`,
      [phone, short, full, codes.own, codes.covered],
    );
    const line = rows[0];
    if (!line || !line.hasData) return res.json({ found: false });
    delete line.hasData;
    res.json({ found: true, line });
  });

  // POST /api/line-mobiles — حفظ/تحديث رقم موبايل يدوى لخط (بحث برقم التليفون)
  app.post("/api/line-mobiles", requireAuth, async (req: any, res) => {
    if (req.user?.role === ROLES.SALES) return res.status(403).json({ message: "غير مسموح" });
    const rawPhone = String(req.body?.fullPhone ?? "").replace(/\D/g, "");
    const mobile = String(req.body?.mobile ?? "").trim();
    if (!rawPhone) return res.status(400).json({ message: "رقم التليفون مطلوب" });
    const full = rawPhone.length >= 9 ? rawPhone : ("88" + rawPhone);
    if (!mobile) {
      await pool.query(`DELETE FROM line_mobiles WHERE full_phone = $1`, [full]);
      return res.json({ ok: true, mobile: "" });
    }
    await pool.query(
      `INSERT INTO line_mobiles (full_phone, mobile, updated_by_id, updated_by_name, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (full_phone) DO UPDATE SET mobile = EXCLUDED.mobile,
         updated_by_id = EXCLUDED.updated_by_id, updated_by_name = EXCLUDED.updated_by_name, updated_at = now()`,
      [full, mobile, req.user?.id ?? null, req.user?.username ?? req.user?.name ?? ""],
    );
    res.json({ ok: true, mobile });
  });

  // GET /api/reports/regularized-no-account — الأعطال المنتظمة خلال فترة التى ليس لها رقم أكونت (تقرير 1)
  // المصدر: نفس مصدر تقرير الأعطال المنتظمة لفترة (التفاصيل المغلقة + المتبقى 138/135، سنترالات غنايم)،
  //   مطابقة برقم التليفون مع phone_lines، ثم استبعاد الأرقام التى لها رقم أكونت.
  app.get("/api/reports/regularized-no-account", requireAuth, async (req, res) => {
    const { dateFrom = "", dateTo = "", central = "", cabin = "", box = "", page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(20000, Math.max(1, parseInt(limit) || 50));
    // افتراضى: من أول الشهر الحالى إلى اليوم
    const today = new Date();
    const from = dateFrom || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    const to = dateTo || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const params: any[] = [from, to];
    // بدون أكونت = مفيش سجل فى line_accounts، مع استبعاد المُعلَّم يدوياً "بدون رقم أكونت" (lines_no_account)
    const plConds: string[] = [
      "la.full_phone IS NULL",
      "NOT EXISTS (SELECT 1 FROM lines_no_account na WHERE na.full_phone = COALESCE(pl.full_phone, '88' || reg1.short))",
    ];
    if (central) { params.push(central); plConds.push(`pl.central = $${params.length}`); }
    if (cabin) { params.push(cabin); plConds.push(`pl.cabin_number = $${params.length}`); }
    if (box) { params.push(box); plConds.push(`pl.box_number = $${params.length}`); }

    const regCte = `WITH reg AS (
       SELECT ${sp("cd.phone_number")} AS short, cd.exchange_name AS ex FROM complaint_details cd
         WHERE cd.close_time IS NOT NULL AND cd.exchange_name ILIKE '%غنايم%'
           AND (cd.close_time AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date
       UNION
       SELECT ${sp("rc.phone_number")}, rc.exchange_name FROM remaining_complaints rc
         WHERE rc.status_code IN ('138', '135') AND rc.exchange_name ILIKE '%غنايم%'
           AND COALESCE(rc.close_time, rc.complain_time)::date BETWEEN $1::date AND $2::date
    ), reg1 AS (
       SELECT DISTINCT ON (short) short, ex FROM reg WHERE COALESCE(short,'') <> '' ORDER BY short
    )`;
    // نبدأ من الأعطال المنتظمة (reg) و LEFT JOIN مع الخطوط: تظهر اللى ليها بيانات فنية واللى ملهاش
    // (أعمدة فنية فاضية). بدون أكونت = مفيش سجل فى line_accounts (بالرقم الكامل من الخط أو 88+القصير).
    const joinClause = `FROM reg1
       LEFT JOIN phone_lines pl ON pl.tel_no = reg1.short
       LEFT JOIN line_accounts la ON la.full_phone = COALESCE(pl.full_phone, '88' || reg1.short)
       LEFT JOIN phone_ports pp ON pp.phone_number = pl.full_phone`;
    const where = `WHERE ${plConds.join(" AND ")}`;

    const totalRes = await pool.query(`${regCte} SELECT COUNT(DISTINCT reg1.short)::int AS c ${joinClause} ${where}`, params);
    const total = totalRes.rows[0].c as number;
    const offset = (pageNum - 1) * pageSize;
    params.push(pageSize); params.push(offset);
    const dataRes = await pool.query(
      `${regCte}
       SELECT DISTINCT ON (reg1.short)
              pl.id, reg1.short AS "telNo", COALESCE(pl.central, reg1.ex) AS central,
              pl.idu_no AS "iduNo", pl.odu_no AS "oduNo",
              pl.cabin_number AS "cabinNumber", pl.primary_block_no AS "primaryBlockNo",
              pl.cabinet_in AS "cabinetIn", pl.sec_block_no AS "secBlockNo", pl.cabinet_out AS "cabinetOut",
              pl.box_number AS "boxNumber", pl.dp_terminal AS "dpTerminal",
              COALESCE(pp.frame, pl.port) AS port, pl.len,
              COALESCE(pl.full_phone, '88' || reg1.short) AS "fullPhone"
       ${joinClause} ${where}
       ORDER BY reg1.short, pl.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ data: dataRes.rows, total, page: pageNum, pageSize, dateFrom: from, dateTo: to });
  });

  // GET /api/reports/complaint-no-measure — أرقام لها شكوى منتظمة خلال فترة، لها رقم أكونت، وليس لها قياس بعد تاريخ الشكوى (تقرير 5)
  app.get("/api/reports/complaint-no-measure", requireAuth, async (req, res) => {
    const { dateFrom = "", dateTo = "", central = "", cabin = "", box = "", page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(20000, Math.max(1, parseInt(limit) || 50));
    const today = new Date();
    const from = dateFrom || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    const to = dateTo || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const params: any[] = [from, to];
    const plConds: string[] = [];
    if (central) { params.push(central); plConds.push(`pl.central = $${params.length}`); }
    if (cabin) { params.push(cabin); plConds.push(`pl.cabin_number = $${params.length}`); }
    if (box) { params.push(box); plConds.push(`pl.box_number = $${params.length}`); }
    // لا قياس بعد تاريخ الشكوى المرجعى لكل رقم
    plConds.push(`NOT EXISTS (
       SELECT 1 FROM case_138 c WHERE c.full_phone = la.full_phone AND c.uploaded_at > regm.ref_time
    )`);
    // أى رقم مالوش فريم (مش متركّب على المسان) مايدخلش تقارير القياسات
    plConds.push(hasFrameSql("la.full_phone"));

    const regCte = `WITH reg AS (
       SELECT ${sp("cd.phone_number")} AS short, MAX(cd.close_time) AS ref_time FROM complaint_details cd
         WHERE cd.close_time IS NOT NULL AND cd.exchange_name ILIKE '%غنايم%'
           AND (cd.close_time AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date
         GROUP BY ${sp("cd.phone_number")}
       UNION ALL
       SELECT ${sp("rc.phone_number")}, MAX(COALESCE(rc.close_time, rc.complain_time)) FROM remaining_complaints rc
         WHERE rc.status_code IN ('138', '135') AND rc.exchange_name ILIKE '%غنايم%'
           AND COALESCE(rc.close_time, rc.complain_time)::date BETWEEN $1::date AND $2::date
         GROUP BY ${sp("rc.phone_number")}
    ), regm AS (
       SELECT short, MAX(ref_time) AS ref_time FROM reg GROUP BY short
    )`;
    // نبنى من الشكاوى (regm) + line_accounts علشان يظهر أى رقم له شكوى وله أكونت حتى لو
    // مالوش بيانات فنية (مش موجود فى phone_lines). phone_lines اختيارى (LEFT JOIN).
    const joinClause = `FROM regm
       JOIN line_accounts la ON la.full_phone = '88' || regm.short
       LEFT JOIN line_po_events pe ON pe.account_no = la.account_no
       LEFT JOIN phone_lines pl ON pl.full_phone = la.full_phone
       LEFT JOIN phone_ports pp ON pp.phone_number = la.full_phone
       LEFT JOIN LATERAL (
         SELECT c.current_speed, c.max_speed, c.score, c.uploaded_at
         FROM case_138 c WHERE c.full_phone = la.full_phone ORDER BY c.id DESC LIMIT 1
       ) c138p ON true`;
    const whereNoQ = plConds.length ? `WHERE ${plConds.join(" AND ")}` : "";
    // بزر من الواجهة (excludeQueued) — يشيل اللى فى طابور التنفيذ عشان مايتبعتش تانى
    if (excludeQueuedOn(req)) plConds.push(notQueuedSql("la.account_no"));
    const where = plConds.length ? `WHERE ${plConds.join(" AND ")}` : "";

    const totalRes = await pool.query(`${regCte} SELECT COUNT(DISTINCT la.full_phone)::int AS c ${joinClause} ${where}`, params);
    const total = totalRes.rows[0].c as number;
    const queuedExcluded = excludeQueuedOn(req)
      ? Math.max(0, ((await pool.query(`${regCte} SELECT COUNT(DISTINCT la.full_phone)::int AS c ${joinClause} ${whereNoQ}`, params)).rows[0].c as number) - total)
      : 0;
    const offset = (pageNum - 1) * pageSize;
    params.push(pageSize); params.push(offset);
    const dataRes = await pool.query(
      `${regCte}
       SELECT DISTINCT ON (la.full_phone)
              pl.id, COALESCE(pl.tel_no, regm.short) AS "telNo", pl.central, pl.idu_no AS "iduNo", pl.odu_no AS "oduNo",
              pl.cabin_number AS "cabinNumber", pl.box_number AS "boxNumber", pl.dp_terminal AS "dpTerminal",
              COALESCE(pp.frame, pl.port) AS port, pl.len, la.full_phone AS "fullPhone",
              la.account_no AS "accountNo", la.source AS "accountSource",
              (regm.ref_time AT TIME ZONE 'Africa/Cairo') AS "complaintTime",
              c138p.current_speed AS "lineCurrentSpeed", c138p.max_speed AS "lineMaxSpeed",
              c138p.score AS "lastMeasScore",
              (c138p.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime",
              (pe.last_raise_at AT TIME ZONE 'Africa/Cairo') AS "lastPoRaiseAt",
              (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') AS "lastPoStopAt"
       ${joinClause} ${where}
       ORDER BY la.full_phone, pl.central NULLS LAST, LPAD(COALESCE(pl.cabin_number,''), 8, '0'), LPAD(COALESCE(pl.box_number,''), 8, '0'), pl.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ data: dataRes.rows, total, queuedExcluded, page: pageNum, pageSize, dateFrom: from, dateTo: to });
  });

  // GET /api/reports/account-edits — سجل تعديلات أرقام الأكونت
  app.get("/api/reports/account-edits", requireAuth, async (req: any, res) => {
    const { phone, editor } = req.query as Record<string, string>;
    const params: any[] = [];
    const conds: string[] = [];
    if (phone?.trim()) { params.push(arQ(phone)); conds.push(`${n("e.full_phone")} LIKE $${params.length}`); }
    if (editor?.trim()) { params.push(arQ(editor)); conds.push(`${n("e.edited_by_name")} LIKE $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT
         e.id,
         e.full_phone AS "fullPhone",
         e.old_account_no AS "oldAccountNo",
         e.new_account_no AS "newAccountNo",
         e.edited_by_name AS "editedByName",
         (e.edited_at AT TIME ZONE 'Africa/Cairo') AS "editedAt"
       FROM line_account_edits e
       ${where}
       ORDER BY e.edited_at DESC
       LIMIT 2000`,
      params,
    );
    res.json(rows);
  });

  // GET /api/reports/cabinet-score-avg/options — فلاتر التقرير: السنترالات + الكباين النحاسية + كباين MSAN
  app.get("/api/reports/cabinet-score-avg/options", requireAuth, async (_req, res) => {
    // السنترالات + الكباين النحاسية من بيان التليفونات
    const { rows: plRows } = await pool.query(`
      SELECT DISTINCT central, cabin_number
      FROM phone_lines
      WHERE central IS NOT NULL AND central <> ''
    `);
    // كباين MSAN (cabin_code) لكل سنترال من جدول الفنيين
    const { rows: msanRows } = await pool.query(`
      SELECT DISTINCT central_name AS central, cabin_code
      FROM cabinet_technicians
      WHERE central_name IS NOT NULL AND central_name <> ''
        AND cabin_code IS NOT NULL AND cabin_code <> ''
    `);
    const centralSet = new Set<string>();
    const copperMap = new Map<string, Set<string>>();
    const msanMap = new Map<string, Set<string>>();
    for (const r of plRows) {
      const c = r.central || ""; const cab = r.cabin_number || "";
      if (c) centralSet.add(c);
      if (c && cab) { if (!copperMap.has(c)) copperMap.set(c, new Set()); copperMap.get(c)!.add(cab); }
    }
    for (const r of msanRows) {
      const c = r.central || ""; const code = r.cabin_code || "";
      if (c) centralSet.add(c);
      if (c && code) { if (!msanMap.has(c)) msanMap.set(c, new Set()); msanMap.get(c)!.add(code); }
    }
    const arSort = (a: string, b: string) => a.localeCompare(b, "ar", { numeric: true });
    const centrals = Array.from(centralSet).sort(arSort);
    const copperCabins: Record<string, string[]> = {};
    for (const [c, set] of copperMap) copperCabins[c] = Array.from(set).sort(arSort);
    const msanCabins: Record<string, string[]> = {};
    for (const [c, set] of msanMap) msanCabins[c] = Array.from(set).sort(arSort);
    res.json({ centrals, copperCabins, msanCabins });
  });

  // GET /api/reports/cabinet-score-avg — متوسط القياسات لكل كابينة (خطوط لها أكونت فقط)
  // current_speed/max_speed مخزّنة كـ text → نُنظّفها لأرقام قبل المتوسط.
  app.get("/api/reports/cabinet-score-avg", requireAuth, async (req: any, res) => {
    const { central, cabin, msan } = req.query as Record<string, string>;
    const params: any[] = [];
    // أى رقم مالوش فريم مايدخلش فى متوسط القياسات
    const conds: string[] = [hasFrameSql("la.full_phone")];
    if (central) { params.push(central); conds.push(`pl.central = $${params.length}`); }
    if (cabin)   { params.push(cabin);   conds.push(`pl.cabin_number = $${params.length}`); }
    if (msan)    { params.push(msan);    conds.push(`ctm.cabin_code = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // تعبير آمن لتحويل عمود السرعة النصى لرقم (تجاهل أى رمز غير رقمى)
    const numSpeed = (col: string) =>
      `NULLIF(regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g'), '')::numeric`;
    const { rows } = await pool.query(
      `SELECT
         COALESCE(pl.central, '—')      AS "centralName",
         COALESCE(pl.cabin_number, '—') AS "cabinNumber",
         ctm.cabin_code                 AS "msanCode",
         COUNT(DISTINCT pl.full_phone)::int AS "lineCount",
         COUNT(DISTINCT CASE WHEN c138p.score IS NOT NULL THEN pl.full_phone END)::int AS "measuredCount",
         ROUND(AVG(CASE WHEN c138p.score <= 100 THEN c138p.score END)::numeric, 1) AS "avgScore",
         -- متوسط السرعات: نستبعد N/A (numSpeed→NULL) ونستبعد الخطوط اللى اسكورها > 100
         ROUND(AVG(CASE WHEN COALESCE(c138p.score, 0) <= 100 THEN ${numSpeed("c138p.current_speed")} END), 0) AS "avgCurrentSpeed",
         ROUND(AVG(CASE WHEN COALESCE(c138p.score, 0) <= 100 THEN ${numSpeed("c138p.max_speed")} END), 0)     AS "avgMaxSpeed",
         MIN(c138dates.oldest_at) AS "oldestMeasTime",
         MAX(c138dates.newest_at) AS "newestMeasTime"
       FROM line_accounts la
       JOIN phone_lines pl ON pl.full_phone = la.full_phone
       LEFT JOIN LATERAL (
         SELECT ct.cabin_code FROM cabinet_technicians ct
         WHERE ct.central_name = pl.central AND ct.cabin_number = pl.cabin_number
         ORDER BY (ct.cabin_code IS NOT NULL AND btrim(ct.cabin_code) <> '') DESC
         LIMIT 1
       ) ctm ON true
       LEFT JOIN LATERAL (
         SELECT c.score, c.current_speed, c.max_speed
         FROM case_138 c WHERE c.full_phone = la.full_phone
         ORDER BY c.id DESC LIMIT 1
       ) c138p ON true
       LEFT JOIN LATERAL (
         SELECT MIN(c.uploaded_at AT TIME ZONE 'Africa/Cairo') AS oldest_at,
                MAX(c.uploaded_at AT TIME ZONE 'Africa/Cairo') AS newest_at
         FROM case_138 c WHERE c.full_phone = la.full_phone
       ) c138dates ON true
       ${where}
       GROUP BY pl.central, pl.cabin_number, ctm.cabin_code
       ORDER BY pl.central, LPAD(COALESCE(pl.cabin_number,''), 8, '0')`,
      params,
    );
    res.json({ data: rows });
  });

  // GET /api/reports/box-score-avg — متوسط القياسات لكل بكس (خطوط لها أكونت فقط)
  app.get("/api/reports/box-score-avg", requireAuth, async (req: any, res) => {
    try {
      const { central, cabin, box } = req.query as Record<string, string>;
      const params: any[] = [];
      // أى رقم مالوش فريم مايدخلش فى متوسط القياسات (المرساة هنا phone_lines مش line_accounts)
      const conds: string[] = [hasFrameSql("pl.full_phone")];
      if (central) { params.push(central); conds.push(`pl.central = $${params.length}`); }
      if (cabin)   { params.push(cabin);   conds.push(`pl.cabin_number = $${params.length}`); }
      if (box)     { params.push(box);     conds.push(`pl.box_number = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const numSpeed = (col: string) =>
        `NULLIF(regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g'), '')::numeric`;
      // نبدأ من كل خطوط البكس (مش بس اللى لها أكونت) عشان نحسب كل الأعداد المطلوبة.
      const { rows } = await pool.query(
        `SELECT
           COALESCE(pl.central, '—')      AS "centralName",
           COALESCE(pl.cabin_number, '—') AS "cabinNumber",
           COALESCE(pl.box_number, '—')   AS "boxNumber",
           COUNT(DISTINCT pl.full_phone)::int AS "lineCount",
           COUNT(DISTINCT pl.full_phone) FILTER (WHERE la.full_phone IS NOT NULL)::int AS "withAccountCount",
           COUNT(DISTINCT pl.full_phone) FILTER (WHERE c138p.score IS NOT NULL)::int   AS "measuredCount",
           COUNT(DISTINCT pl.full_phone) FILTER (WHERE na.full_phone IS NOT NULL)::int AS "noAccountCount",
           COUNT(DISTINCT pl.full_phone) FILTER (WHERE la.full_phone IS NULL AND na.full_phone IS NULL)::int AS "undeterminedCount",
           ROUND(AVG(CASE WHEN c138p.score <= 100 THEN c138p.score END)::numeric, 1) AS "avgScore",
           -- متوسط السرعات: نستبعد N/A (numSpeed→NULL) ونستبعد الخطوط اللى اسكورها > 100
           ROUND(AVG(CASE WHEN COALESCE(c138p.score, 0) <= 100 THEN ${numSpeed("c138p.current_speed")} END), 0) AS "avgCurrentSpeed",
           ROUND(AVG(CASE WHEN COALESCE(c138p.score, 0) <= 100 THEN ${numSpeed("c138p.max_speed")} END), 0)     AS "avgMaxSpeed",
           MIN(c138dates.oldest_at) AS "oldestMeasTime",
           MAX(c138dates.newest_at) AS "newestMeasTime"
         FROM phone_lines pl
         LEFT JOIN line_accounts la   ON la.full_phone = pl.full_phone
         LEFT JOIN lines_no_account na ON na.full_phone = pl.full_phone
         LEFT JOIN LATERAL (
           SELECT c.score, c.current_speed, c.max_speed
           FROM case_138 c WHERE c.full_phone = pl.full_phone
           ORDER BY c.id DESC LIMIT 1
         ) c138p ON true
         LEFT JOIN LATERAL (
           SELECT MIN(c.uploaded_at AT TIME ZONE 'Africa/Cairo') AS oldest_at,
                  MAX(c.uploaded_at AT TIME ZONE 'Africa/Cairo') AS newest_at
           FROM case_138 c WHERE c.full_phone = pl.full_phone
         ) c138dates ON true
         ${where}
         GROUP BY pl.central, pl.cabin_number, pl.box_number
         ORDER BY pl.central, LPAD(COALESCE(pl.cabin_number,''), 8, '0'), LPAD(COALESCE(pl.box_number,''), 8, '0')`,
        params,
      );
      res.json({ data: rows });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // === Work Orders (تركيبات) ===
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

  // POST /api/work-orders/import — admin uploads تركيبات xlsx / csv
  // requireAdminOrToken: يقبل كمان رفع تلقائى من سكربت التامبر منكى بـ X-Upload-Token
  app.options("/api/work-orders/import", (_req, res) => { setUploadCors(res); res.sendStatus(204); });
  app.post("/api/work-orders/import", requireAdminOrToken, upload.single("file"), async (req: any, res) => {
    if (!req.file) return res.status(400).json({ message: "لم يتم إرسال ملف" });
    try {
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = sheetRows(ws);
      if (rows.length < 2) return res.status(400).json({ message: "الملف فارغ" });

      // Detect column indices from header row by partial (case-insensitive)
      // match — supports the WFM "Voice Installation Raw Data" English layout
      // as well as the older Arabic تركيبات layout.
      // تصدير WFM بيحط سطر عنوان ("Voice Installation Raw Data Report") فوق سطر
      // العناوين الحقيقى، فبندوّر على أول سطر فيه عمود معروف بدل ما نفترض rows[0].
      const HEADER_ANCHORS = ["work order id", "امر الشغل", "رقم الامر", "service no", "التليفون"];
      let hdrIdx = 0;
      for (let i = 0; i < Math.min(15, rows.length); i++) {
        const cells = (rows[i] || []).map((c: any) => String(c ?? "").trim().toLowerCase());
        if (HEADER_ANCHORS.some((a) => cells.some((c) => c.includes(a)))) { hdrIdx = i; break; }
      }
      const header = rows[hdrIdx].map((h: any) => String(h ?? "").trim().toLowerCase());
      const findCol = (...keywords: string[]) =>
        header.findIndex((h) => h !== "" && keywords.some((k) => h.includes(k.toLowerCase())));

      const iCentral   = findCol("سنترال", "central");
      const iOrg       = findCol("organization", "كود السنترال", "المنظمه");
      const iCloseCat  = findCol("close category", "success", "حاله الاغلاق", "نتيجه الاغلاق");
      const iWorkOrder = findCol("work order id", "امر الشغل", "رقم الامر", "تذكرة");
      const iPhone     = findCol("service no", "التليفون", "تليفون", "هاتف", "phone");
      const iService   = findCol("work order type", "نوع الخدمه", "نوع الخدمة", "service type");
      const iDate      = findCol("close date", "تاريخ الاغلاق", "تاريخ الإغلاق", "الاغلاق");
      const iCreation  = findCol("creation date", "تاريخ الانشاء", "تاريخ الإنشاء", "initiate date");
      const iItem      = findCol("اسم الصنف", "الصنف", "item name");
      const iCable     = findCol("consumed cables", "كميه السلك", "كمية السلك", "السلك", "cable");
      const iCloseReason = findCol("close reason", "سبب الاغلاق", "سبب الإغلاق");
      const iTech      = findCol("tech name", "اسم الفنى", "اسم الفني", "الفنى");
      const iMsan      = findCol("msan code", "msan", "الكابينة", "الكابينه");
      // العناوين الأصلية (بدون تصغير) لحفظ raw_data بكل خانات الشيت — القاعدة #10
      const origHeader = rows[hdrIdx].map((h: any) => String(h ?? "").trim());

      // central header is blank in the WFM export → fall back to first column
      const g = (row: any[], detected: number, fallback: number) =>
        row[detected >= 0 ? detected : fallback] ?? "";
      // optional fields: blank when the column is absent (no positional guess)
      const opt = (row: any[], detected: number) =>
        detected >= 0 ? (row[detected] ?? "") : "";

      const dataRows = rows.slice(hdrIdx + 1).filter((r) => {
        const id = g(r, iWorkOrder, 1);
        return id !== "" && id !== null && id !== undefined;
      });

      let inserted = 0;
      let skipped = 0;
      let deactivated = 0;   // أوامر رفع نهائى اتحوّلت لجدولها

      const toDate = (v: any): Date | null => {
        if (v instanceof Date) return v;
        if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400 * 1000));
        if (v === "" || v == null) return null;
        const d = new Date(v); return isNaN(d.getTime()) ? null : d;
      };

      // ⚡ الإدخال بالدفعات: قبل كده كان بيتعمل استعلام لكل صف — ملف من 1500 صف
      // يعنى ~370 رحلة لقاعدة البيانات. القاعدة على Replit بعيدة (كل رحلة عشرات
      // الملّى ثانية)، فالرفع كان بياخد عشرات الثوانى وبيقرّب من حد المهلة —
      // ودى كانت أشهر سبب لرسالة «Failed to fetch» عند الرفع.
      // دلوقتى كل 500 صف فى بيان واحد → الملف كله بيبقى 3-4 رحلات.
      const WO_COLS = 14;
      const BATCH = 500;
      const pending: any[][] = [];
      let pendingTotal = 0;
      const flushWorkOrders = async (): Promise<number> => {
        if (!pending.length) return 0;
        const rows = pending.splice(0, pending.length);
        pendingTotal += rows.length;
        const params: any[] = [];
        // الصف الأول بأنواع صريحة: Postgres مابيقدرش يستنتج نوع البارامتر جوّه
        // VALUES، فمن غير الكاست بيعتبرهم كلهم نص ويرفض (bigint/timestamptz/jsonb).
        const CAST = ["text", "bigint", "text", "text", "timestamptz", "text", "text",
                      "text", "text", "timestamptz", "text", "text", "jsonb", "int"];
        const values = rows.map((r, i) => {
          params.push(...r);
          const base = i * WO_COLS;
          return "(" + Array.from({ length: WO_COLS },
            (_, k) => `$${base + k + 1}` + (i === 0 ? `::${CAST[k]}` : "")).join(",") + ")";
        }).join(",");
        // ⚠️ لازم نستبعد التكرار **جوّه نفس الدفعة**: Postgres بيرفض
        // «ON CONFLICT DO UPDATE» لو نفس المفتاح اتكرّر مرتين فى نفس البيان.
        const res = await pool.query(
          `INSERT INTO work_orders (central_name, work_order_id, phone_number, service_type, close_date, item_name, cable_quantity, tech_name, close_category, creation_date, msan_code, work_order_type_raw, raw_data, uploaded_by_id)
           SELECT DISTINCT ON (central_name, work_order_id) *
             FROM (VALUES ${values}) AS v(central_name, work_order_id, phone_number, service_type, close_date, item_name, cable_quantity, tech_name, close_category, creation_date, msan_code, work_order_type_raw, raw_data, uploaded_by_id)
           ON CONFLICT (central_name, work_order_id) DO UPDATE SET
             close_category = EXCLUDED.close_category,
             creation_date = COALESCE(EXCLUDED.creation_date, work_orders.creation_date),
             msan_code = COALESCE(EXCLUDED.msan_code, work_orders.msan_code),
             work_order_type_raw = COALESCE(EXCLUDED.work_order_type_raw, work_orders.work_order_type_raw),
             raw_data = COALESCE(EXCLUDED.raw_data, work_orders.raw_data),
             -- نجدّد وقت الرفع حتى لو الصف موجود بالفعل، عشان MAX(uploaded_at) اللى بيغذّى
             -- «آخر تحديث» يفضل صحيح لو الملف الجديد كل صفوفه موجودة أصلاً.
             uploaded_at = now()`,
          params);
        return res.rowCount ?? 0;
      };

      for (const r of dataRows) {
        // نقبل Success و Fail (كل واحد يظهر فى تقريره الخاص)؛ نتخطّى بس لو التصنيف غير واضح.
        const closeCatLower = String(g(r, iCloseCat, 10)).trim().toLowerCase();
        if (closeCatLower !== "success" && !closeCatLower.startsWith("fail")) { skipped++; continue; }
        const closeCategory = closeCatLower === "success" ? "Success" : "Fail";
        // اسم السنترال يُستخرج من كود Organization ويُقارن بأكواد الملف المرفق.
        // أي كود غير موجود ضمن السنترالات المسموحة (الغنايم وفروعها) يُتخطّى.
        const orgCode = String(g(r, iOrg, 4)).trim().toUpperCase();
        const centralName = CENTRAL_CODE_TO_NAME[orgCode];
        if (!centralName) { skipped++; continue; }
        const workOrderId  = parseInt(String(g(r, iWorkOrder, 1)));
        const phoneNumber  = String(g(r, iPhone, 7)).replace(/^'/, "").trim();
        // IIf([Work Order Type]="Fixed Voice Installation MSAN";"تركيب جديد";"نقل")
        const rawServiceType = String(g(r, iService, 5)).trim();
        const serviceType  = rawServiceType === "Fixed Voice Installation MSAN" ? "تركيب جديد" : "نقل";
        // ⚠️ السطر اللى فوق بيحطّ **أى** نوع مش «Installation MSAN» على إنه «نقل» —
        // بما فيهم أوامر رفع/إلغاء الخط نهائياً. ودى مش تركيب ولا نقل ومابيتصرفلهاش
        // سلك، فكانت بتظهر فى تقارير النقل وفى «أوامر شغل بدون كمية سلك» غلط.
        // بنحوّلها لجدول «الرفع النهائى» ومابتدخلش work_orders خالص.
        const closeReason = iCloseReason >= 0 ? String(r[iCloseReason] ?? "").trim() : "";
        if (isDeactivationWO(rawServiceType, closeReason)) {
          const rawObjD: Record<string, any> = {};
          for (let ci = 0; ci < origHeader.length; ci++) {
            const k = origHeader[ci] || ("col" + ci);
            const v = r[ci];
            rawObjD[k] = (v === "" || v === undefined) ? null : (v instanceof Date ? v.toISOString() : v);
          }
          const dDate = toDate(g(r, iDate, 12)), dCreate = toDate(opt(r, iCreation));
          await pool.query(
            `INSERT INTO line_deactivations
               (central_name, work_order_id, phone_number, work_order_type, close_reason,
                close_category, close_date, creation_date, tech_name, msan_code, raw_data, uploaded_by_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (central_name, work_order_id) DO UPDATE SET
               close_reason = EXCLUDED.close_reason, close_category = EXCLUDED.close_category,
               close_date = COALESCE(EXCLUDED.close_date, line_deactivations.close_date),
               creation_date = COALESCE(EXCLUDED.creation_date, line_deactivations.creation_date),
               tech_name = EXCLUDED.tech_name, msan_code = COALESCE(EXCLUDED.msan_code, line_deactivations.msan_code),
               raw_data = COALESCE(EXCLUDED.raw_data, line_deactivations.raw_data), uploaded_at = now()`,
            [centralName, workOrderId, phoneNumber, rawServiceType || null, closeReason || null,
             closeCategory, dDate, dCreate, String(g(r, iTech, 15)).trim() || null,
             iMsan >= 0 ? (String(r[iMsan] ?? "").trim() || null) : null,
             JSON.stringify(rawObjD), (req.user as any)?.id ?? null]);
          // ولو الأمر ده كان اتسجّل قبل كده فى أوامر الشغل (من رفعة قديمة) نشيله من هناك
          await pool.query(`DELETE FROM work_orders WHERE central_name = $1 AND work_order_id = $2`,
                           [centralName, workOrderId]);
          deactivated++;
          continue;
        }
        const rawDate      = g(r, iDate, 12);
        const rawCreation  = opt(r, iCreation);
        const itemName     = "سلك واحد جوز"; // اسم الصنف ثابت دائماً
        const cableQuantity = ""; // كميه السلك تُترك فارغة عمداً (لا تؤخذ من الملف)
        const techName     = String(g(r, iTech, 15)).trim();

        if (!workOrderId || isNaN(workOrderId)) { skipped++; continue; }

        const closeDate = toDate(rawDate);
        if (!closeDate || isNaN(closeDate.getTime())) { skipped++; continue; }
        const creationDate = toDate(rawCreation); // اختيارى — لحساب زمن الإغلاق
        // كود الكابينة (MSAN Code) من الشيت مباشرةً + النوع الخام + صف الشيت كامل (raw_data)
        const msanCode = iMsan >= 0 ? (String(r[iMsan] ?? "").trim() || null) : null;
        const rawObj: Record<string, any> = {};
        for (let ci = 0; ci < origHeader.length; ci++) {
          const k = origHeader[ci] || ("col" + ci);
          const v = r[ci];
          rawObj[k] = (v === "" || v === undefined) ? null : (v instanceof Date ? v.toISOString() : v);
        }

        // بنجمّع الصفوف وبندخّلها **دفعات** بعد الحلقة (شوف flushWorkOrders تحت)
        pending.push([centralName, workOrderId, phoneNumber, serviceType, closeDate,
                      itemName || null, cableQuantity || null, techName, closeCategory,
                      creationDate, msanCode, rawServiceType || null, JSON.stringify(rawObj),
                      (req.user as any)?.id ?? null]);
        if (pending.length >= BATCH) inserted += await flushWorkOrders();
      }
      inserted += await flushWorkOrders();
      skipped += Math.max(0, pendingTotal - inserted);

      // Purge any previously-stored work orders for non-allowed centrals,
      // so the report stays restricted to الغنايم وفروعها even after older uploads.
      const { rows: existingCentrals } = await pool.query(
        "SELECT DISTINCT central_name FROM work_orders",
      );
      const centralsToDrop = existingCentrals
        .map((c: any) => c.central_name)
        .filter((c: string) => !isAllowedCentral(c));
      let purged = 0;
      if (centralsToDrop.length > 0) {
        const del = await pool.query(
          "DELETE FROM work_orders WHERE central_name = ANY($1)",
          [centralsToDrop],
        );
        purged = del.rowCount ?? 0;
      }

      // وقت آخر رفع لأوامر الشغل — بيتسجّل مهما كانت النتيجة، حتى لو كل الخطوط
      // موجودة بالفعل ومفيش صف جديد اتضاف. (uploaded_at بيتحط على INSERT بس، والـ
      // ON CONFLICT DO UPDATE مابيلمسهوش، فكان «آخر تحديث» بيفضل قديم لو مفيش جديد.)
      // ملحوظة: الخطأ هنا كان بيتبلع بصمت (catch فاضى) فلو الختم فشل مكانش حد ياخد باله.
      // دلوقتى بنسجّله فى اللوج وبنرجّع stampedAt فى الرد عشان يبان إن الرفع اتختم فعلاً.
      let stampedAt: string | null = null;
      try {
        const st = await pool.query(
          `INSERT INTO app_state (key, value, updated_at) VALUES ('work_orders_import_at', now()::text, now())
           ON CONFLICT (key) DO UPDATE SET value = now()::text, updated_at = now()
           RETURNING updated_at`);
        stampedAt = st.rows[0]?.updated_at?.toISOString?.() ?? String(st.rows[0]?.updated_at ?? "");
      } catch (e: any) {
        console.error("work-orders import: فشل ختم work_orders_import_at:", e?.message || e);
      }

      console.log(`work-orders import: purged=${purged}, headers=${JSON.stringify(header)}, cols={central:${iCentral},order:${iWorkOrder},phone:${iPhone},svc:${iService},date:${iDate},item:${iItem},cable:${iCable},tech:${iTech}}, rows=${dataRows.length}, inserted=${inserted}, skipped=${skipped}, stampedAt=${stampedAt}`);
      res.json({ ok: true, inserted, skipped, purged, deactivated, total: dataRows.length, stampedAt });
    } catch (e: any) {
      console.error("work-orders import error:", e);
      res.status(500).json({ message: "خطأ أثناء معالجة الملف", detail: e.message });
    }
  });

  // GET /api/work-orders — list with date range filter
  app.get("/api/work-orders", requireAuth, async (req, res) => {
    const { dateFrom, dateTo, category = "success", over24 = "" } = req.query as Record<string, string>;
    const params: any[] = [];
    const conds: string[] = [];

    if (dateFrom) { params.push(dateFrom); conds.push(`w.close_date >= $${params.length}::date`); }
    if (dateTo) { params.push(dateTo); conds.push(`w.close_date < ($${params.length}::date + interval '1 day')`); }
    // التصنيف: success (الافتراضى — يشمل القديمة NULL) | fail | all
    if (category === "fail") conds.push(`w.close_category = 'Fail'`);
    else if (category !== "all") conds.push(`(w.close_category IS NULL OR w.close_category = 'Success')`);
    // تركيبات متخطية زمن الإغلاق 24 ساعة (close_date − creation_date > 24 ساعة)
    if (over24 === "1" || over24 === "true") {
      conds.push(`w.creation_date IS NOT NULL AND EXTRACT(EPOCH FROM (w.close_date - w.creation_date)) / 3600 > 24`);
    }
    // خانة التليفون: أرقام التركيبات فقط بصيغة 88+7 خانات (زى 88-2650505). أى صف اتحفظ
    // فيه مسلسل طويل (معاينات … إلخ) يتشال خالص من التقرير — الفلترة على مستوى التقرير.
    conds.push(`regexp_replace(coalesce(w.phone_number,''), '\\D', '', 'g') ~ '^88[0-9]{7}$'`);

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // كمية السلك: تؤخذ من work_orders لو موجودة، وإلا من cable_entries (إدخال الفنى يدوياً)
    // المطابقة: رقم تليفون محلى (إزالة 88- البادئة) + نوع امر الشغل (نقل / تركيب).
    const { rows } = await pool.query(
      `SELECT w.id, w.central_name AS "centralName", w.work_order_id AS "workOrderId",
              w.phone_number AS "phoneNumber", w.service_type AS "serviceType",
              w.close_date AS "closeDate", w.item_name AS "itemName",
              COALESCE(NULLIF(w.cable_quantity, ''), ce.cable_quantity) AS "cableQuantity",
              w.tech_name AS "techName"
       FROM work_orders w
       LEFT JOIN cable_entries ce
         ON ce.phone_local = CASE
              WHEN regexp_replace(w.phone_number, '\\D', '', 'g') LIKE '88%'
                   AND length(regexp_replace(w.phone_number, '\\D', '', 'g')) > 7
              THEN substring(regexp_replace(w.phone_number, '\\D', '', 'g') FROM 3)
              ELSE regexp_replace(w.phone_number, '\\D', '', 'g')
            END
        AND ce.work_order_type = CASE WHEN trim(w.service_type) = 'نقل' THEN 'نقل' ELSE 'تركيب' END
       ${where}
       ORDER BY w.close_date ASC`,
      params,
    );
    res.json(rows);
  });

  // GET /api/reports/work-orders-no-cable — أوامر الشغل اللى لسه مالهاش كمية سلك.
  // كمية السلك مابتيجيش من ملف أوامر الشغل خالص — الفنى بيدخّلها من «استكمال بيانات»
  // فتتخزّن فى cable_entries. فالتقرير ده = أوامر الشغل اللى مالهاش صف مقابل هناك.
  // المطابقة بنفس منطق تقرير أوامر الشغل بالظبط: رقم محلى (بدون 88) + نوع الأمر (نقل/تركيب).
  app.get("/api/reports/work-orders-no-cable", requireAuth, async (req, res) => {
    try {
      const { dateFrom = "", dateTo = "", q = "" } = req.query as Record<string, string>;
      const params: any[] = [];
      const conds: string[] = [
        // التركيبات فقط: أرقام بصيغة 88+7 خانات (المعاينات بمسلسل طويل مش تخصنا)
        `regexp_replace(coalesce(w.phone_number,''), '\\D', '', 'g') ~ '^88[0-9]{7}$'`,
        // الناجحة فقط (زى الافتراضى فى تقرير أوامر الشغل)
        `(w.close_category IS NULL OR w.close_category = 'Success')`,
        // مالهاش كمية سلك: لا فى work_orders ولا فى cable_entries
        `COALESCE(NULLIF(w.cable_quantity, ''), ce.cable_quantity) IS NULL`,
      ];
      if (dateFrom) { params.push(dateFrom); conds.push(`w.close_date >= $${params.length}::date`); }
      if (dateTo) { params.push(dateTo); conds.push(`w.close_date < ($${params.length}::date + interval '1 day')`); }
      if (q.trim()) {
        params.push(arQ(q));
        const p = `$${params.length}`;
        conds.push(`(${n("w.phone_number")} LIKE ${p} OR ${n("w.work_order_id")} LIKE ${p}
                  OR ${n("w.tech_name")} LIKE ${p} OR ${n("w.central_name")} LIKE ${p})`);
      }
      const { rows } = await pool.query(
        `SELECT w.id, w.central_name AS "centralName", w.work_order_id AS "workOrderId",
                w.phone_number AS "phoneNumber", w.service_type AS "serviceType",
                w.close_date AS "closeDate", w.item_name AS "itemName", w.tech_name AS "techName"
           FROM work_orders w
           LEFT JOIN cable_entries ce
             ON ${sp("ce.phone_local")} = ${sp("w.phone_number")}
            AND ce.work_order_type = CASE WHEN trim(w.service_type) = 'نقل' THEN 'نقل' ELSE 'تركيب' END
          WHERE ${conds.join(" AND ")}
          ORDER BY w.close_date DESC
          LIMIT 20000`,
        params,
      );
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/reports/installations-by-tech — نسبة إنجاز التركيبات خلال 24 ساعة لكل فنى (Success فقط).
  // الرؤية: السوبر أدمن/الأدمن/الشئون الخارجية = كل الفنيين؛ الفنى = أرقامه فقط؛ الباقى ممنوع.
  // lines=1 → يرجّع خطوط التركيبات المتجاوزة 24 ساعة (بنفس فلترة الدور) لزر «تجاوزات 24 ساعة».
  app.get("/api/reports/installations-by-tech", requireAuth, async (req: any, res) => {
    const role = req.user.role;
    const seeAll = [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.EXTERNAL].includes(role);
    if (!seeAll && role !== ROLES.TECH) return res.status(403).json({ message: "غير مسموح" });
    const { dateFrom = "", dateTo = "", lines = "" } = req.query as Record<string, string>;
    const params: any[] = [];
    // شروط داخلية (Success + التاريخ) على work_orders
    const inner: string[] = ["(w.close_category IS NULL OR w.close_category = 'Success')"];
    // التركيبات فقط: الأرقام بصيغة 88+7 خانات (زى 88-2650505). أى رقم تانى (معاينات
    // بمسلسل طويل … إلخ) يتشال خالص من نسبة التركيبات (العدّ + قائمة التجاوزات) مهما كان القافل.
    inner.push(`regexp_replace(coalesce(w.phone_number,''),'\\D','','g') ~ '^88[0-9]{7}$'`);
    if (dateFrom) { params.push(dateFrom); inner.push(`w.close_date >= $${params.length}::date`); }
    if (dateTo) { params.push(dateTo); inner.push(`w.close_date < ($${params.length}::date + interval '1 day')`); }
    const innerWhere = `WHERE ${inner.join(" AND ")}`;

    // فنيونا الخمسة (بالاسم). القفل بواسطة أى منهم يُحسب له؛ وأى قفل بواسطة حد تانى
    // يتنسب لفنى المنطقة = صاحب كابينة الخط (اللى لازم يكون واحد من الخمسة برضه).
    const OUR_TECHS = [
      "اسلام عبدالعال هريدى حسن",
      "حسن عبدالفتاح حموده يعقوب",
      "محمد عبدالمجيد محمد رشدى",
      "محمود احمد يعقوب",
      "محمد عبدالعزيز طه احمد",
    ];
    params.push(OUR_TECHS); const iTechs = params.length;

    // رقم محلى (بدون 88-) من رقم التليفون المخزّن
    const phDigits = `regexp_replace(coalesce(w.phone_number,''),'\\D','','g')`;
    const phLocal = `CASE WHEN ${phDigits} LIKE '88%' AND length(${phDigits})>7 THEN substring(${phDigits} FROM 3) ELSE ${phDigits} END`;
    // تطبيع اسم عربى للمطابقة: صغّر + شيل المسافات + وحّد ى→ي و ة→ه و أإآ→ا
    // (لأن إملاء الاسم فى ملف الأوامر يختلف عن البيان الفنى → كان بيخفى فنيين).
    const norm = (col: string) => `translate(regexp_replace(lower(btrim(coalesce(${col},''))),'\\s','','g'),'ىأإآة','ياااه')`;
    // الفنى الفعلى: (1) فنى الإغلاق لو اسمه ضمن الخمسة (مطابقة مُطبَّعة)،
    // (2) وإلا فنى منطقة الخط = صاحب كابينة الخط من البيان الفنى (phone_lines).
    const effTech = `COALESCE(
        (SELECT o.name FROM our o WHERE o.nn = ${norm("w.tech_name")} LIMIT 1),
        (SELECT o.name FROM cabinet_technicians ct3
           JOIN technician_names tn3 ON tn3.worker_code = ct3.worker_code
           JOIN our o ON o.nn = ${norm("tn3.tech_name")}
          WHERE btrim(coalesce(w.msan_code,'')) <> '' AND btrim(ct3.cabin_code) = btrim(w.msan_code) LIMIT 1),
        (SELECT o.name FROM phone_lines pl
           JOIN cabinet_technicians ct2 ON ct2.central_name = pl.central AND ct2.cabin_number = pl.cabin_number
           JOIN technician_names tn2 ON tn2.worker_code = ct2.worker_code
           JOIN our o ON o.nn = ${norm("tn2.tech_name")}
          WHERE regexp_replace(coalesce(pl.tel_no,''),'\\D','','g') = ${phLocal} LIMIT 1)
      )`;

    // فلترة الدور تتم على الفنى الفعلى (مش القافل) — والفنى يشوف المنسوب له فقط.
    const outer: string[] = ["eff_tech IS NOT NULL"];
    if (!seeAll) {
      let myName = String(req.user.techName || req.user.fullName || "").trim();
      if (req.user.workerCode) {
        const r = await pool.query(`SELECT tech_name FROM technician_names WHERE worker_code = $1 ORDER BY id DESC LIMIT 1`, [String(req.user.workerCode).trim()]);
        if (r.rows[0]?.tech_name) myName = String(r.rows[0].tech_name).trim();
      }
      params.push(myName || "___none___"); outer.push(`${norm("eff_tech")} = ${norm(`$${params.length}`)}`);
    }
    const outerWhere = `WHERE ${outer.join(" AND ")}`;
    const over24 = `(creation_date IS NOT NULL AND EXTRACT(EPOCH FROM (close_date - creation_date)) / 3600 > 24)`;
    const cte = `WITH our AS (SELECT name, ${norm("name")} AS nn FROM unnest($${iTechs}::text[]) AS name),
      att AS (SELECT w.*, ${effTech} AS eff_tech FROM work_orders w ${innerWhere})`;

    if (lines === "1") {
      const { rows } = await pool.query(
        `${cte}
         SELECT eff_tech AS "techName", central_name AS "centralName", work_order_id AS "workOrderId",
                phone_number AS "phoneNumber", service_type AS "serviceType",
                (creation_date AT TIME ZONE 'Africa/Cairo') AS "creationDate",
                (close_date AT TIME ZONE 'Africa/Cairo') AS "closeDate",
                ROUND((EXTRACT(EPOCH FROM (close_date - creation_date)) / 3600)::numeric, 1) AS "hours"
         FROM att ${outerWhere} AND ${over24}
         ORDER BY EXTRACT(EPOCH FROM (close_date - creation_date)) DESC`, params);
      return res.json({ lines: rows });
    }
    const { rows } = await pool.query(
      `${cte}
       SELECT eff_tech AS "techName", COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE creation_date IS NOT NULL AND EXTRACT(EPOCH FROM (close_date - creation_date)) / 3600 <= 24)::int AS "within24",
              COUNT(*) FILTER (WHERE ${over24})::int AS "over24"
       FROM att ${outerWhere}
       GROUP BY eff_tech ORDER BY COUNT(*) DESC`, params);
    res.json({ data: rows, scope: seeAll ? "all" : "own" });
  });

  // === استكمال بيانات: كمية السلك (cable_entries) ===

  // يحوّل رقم التليفون الذى يدخله الفنى إلى صيغة محلية موحّدة (أرقام فقط، بدون 88-)
  // ثم يعيد بناء الصيغة الكاملة 88-<local>. يقبل: 2657290 | 88-2657290 | 882657290.
  const normalizePhone = (raw: string) => {
    let digits = String(raw || "").replace(/\D/g, "");
    if (digits.startsWith("88") && digits.length > 7) digits = digits.slice(2);
    return { local: digits, full: digits ? `88-${digits}` : "" };
  };

  // GET /api/cable-entries — قائمة الإدخالات (فنى + أدمن)
  app.get("/api/cable-entries", requireTechOrAdmin, async (req: any, res) => {
    const { q } = req.query as Record<string, string>;
    const params: any[] = [];
    const conds: string[] = [];
    if (q && q.trim()) {
      // البحث برقم التليفون بيقارن **بالأرقام بس** — الرقم مخزّن «2657363» و«88-2657363»،
      // فالبحث بـ «882657363» أو «88 2657363» أو «88-2657363» كلهم كانوا بيفشلوا قبل كده
      // لأن المقارنة كانت نصية على الصيغة المخزّنة بالحرف.
      let digits = q.replace(/\D/g, "");
      if (digits.startsWith("88") && digits.length > 7) digits = digits.slice(2);  // نفس منطق normalizePhone
      if (digits) {
        params.push(`%${digits}%`);
        const p = `$${params.length}`;
        conds.push(`(regexp_replace(phone_local, '[^0-9]', '', 'g') LIKE ${p}
                  OR regexp_replace(phone_full,  '[^0-9]', '', 'g') LIKE ${p})`);
      } else {
        params.push(arQ(q));
        conds.push(`(${n("phone_local")} LIKE $${params.length} OR ${n("phone_full")} LIKE $${params.length})`);
      }
    }
    // 🆕 الفني يشوف إدخالاته فقط (اللى هو دخلها)؛ الأدمن يشوف الكل
    if (req.user?.role === ROLES.TECH) {
      params.push(req.user.id);
      conds.push(`created_by_id = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT id, phone_local AS "phoneLocal", phone_full AS "phoneFull",
              work_order_type AS "workOrderType", cable_quantity AS "cableQuantity",
              created_by_id AS "createdById", created_by_name AS "createdByName",
              created_at AS "createdAt", updated_at AS "updatedAt",
              printed_at AS "printedAt", edit_unlocked_at AS "editUnlockedAt",
              -- مقفل = طُبع ولم يُمنح صلاحية تعديل
              (printed_at IS NOT NULL AND edit_unlocked_at IS NULL) AS "locked",
              -- يمكن للأدمن منح الصلاحية = مقفل ولم تمر 3 أيام على الطباعة
              (printed_at IS NOT NULL AND edit_unlocked_at IS NULL
                 AND printed_at > now() - interval '3 days') AS "canUnlock"
       FROM cable_entries ${where}
       ORDER BY updated_at DESC`,
      params,
    );
    res.json(rows);
  });

  // POST /api/cable-entries — إضافة كمية السلك لرقم + نوع امر شغل (فنى + أدمن)
  // التكرار (نفس الرقم + نفس النوع) مرفوض برسالة خطأ — لتعديل القيمة يُحذف الإدخال أولاً.
  app.post("/api/cable-entries", requireTechOrAdmin, async (req: any, res) => {
    const { phone, workOrderType, cableQuantity, mobile } = req.body as Record<string, string>;
    const { local, full } = normalizePhone(phone);
    if (!local || local.length < 5) return res.status(400).json({ message: "رقم تليفون غير صالح" });
    const type = ["نقل", "صيانة", "تركيب"].includes(workOrderType) ? workOrderType : "تركيب";
    const qty = String(cableQuantity ?? "").trim();
    if (!/^\d+(\.\d+)?$/.test(qty)) return res.status(400).json({ message: "كمية السلك يجب أن تكون رقماً (يقبل العشرى)" });
    // رقم المحمول (يظهر فى الواجهة عند اختيار «صيانة» فقط) — يُسجَّل فى مخزن أرقام المحمول للخطوط
    // (line_mobiles) فيظهر عند البحث برقم التليفون. ON CONFLICT بيحدّث الرقم القديم تلقائياً بأحدث رقم.
    const mobileVal = String(mobile ?? "").trim();
    const userId = req.user.id;
    const userName = req.user.username;
    // رفض التكرار صراحةً: لو الرقم + النوع موجود من قبل
    const dup = await pool.query(
      `SELECT created_by_name FROM cable_entries WHERE phone_local = $1 AND work_order_type = $2 LIMIT 1`,
      [local, type],
    );
    if (dup.rowCount && dup.rowCount > 0) {
      return res.status(409).json({
        message: `سبق إدخال كمية السلك للرقم ${full} (${type}) من قبل بواسطة ${dup.rows[0].created_by_name}. احذف الإدخال السابق أولاً لتعديله.`,
      });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO cable_entries (phone_local, phone_full, work_order_type, cable_quantity, created_by_id, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [local, full, type, qty, userId, userName],
      );
      // لو الفنى اختار «صيانة» وكتب رقم محمول → سجّله/حدّثه فى line_mobiles (نفس صيغة full_phone
      // المستخدمة فى البحث برقم التليفون = 88 + الأرقام بدون شرطة). الأولوية له فى الـ lookup فيظهر
      // كأحدث رقم مسجّل. لو الخط له رقم قديم يتحدّث (ON CONFLICT).
      if (type === "صيانة" && mobileVal) {
        const mobileFull = "88" + local; // بدون شرطة — مطابق لتخزين line_mobiles
        await pool.query(
          `INSERT INTO line_mobiles (full_phone, mobile, updated_by_id, updated_by_name, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (full_phone) DO UPDATE SET mobile = EXCLUDED.mobile,
             updated_by_id = EXCLUDED.updated_by_id, updated_by_name = EXCLUDED.updated_by_name, updated_at = now()`,
          [mobileFull, mobileVal, userId, userName],
        );
      }
      res.json({ ok: true, id: rows[0]?.id });
    } catch (e: any) {
      // حماية إضافية ضد سباق التزامن على قيد التفرّد
      if (e.code === "23505") {
        return res.status(409).json({ message: `سبق إدخال كمية السلك للرقم ${full} (${type}) من قبل.` });
      }
      throw e;
    }
  });

  // DELETE /api/cable-entries/:id — حذف إدخال (أدمن أو صاحب الإدخال فقط)
  // مقفل بعد طباعة التقرير (printed_at) ما لم يُمنح صلاحية التعديل (edit_unlocked_at).
  app.delete("/api/cable-entries/:id", requireTechOrAdmin, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ message: "معرّف غير صالح" });
    const { rows } = await pool.query(
      `SELECT printed_at, edit_unlocked_at, created_by_id FROM cable_entries WHERE id = $1`, [id],
    );
    if (!rows.length) return res.json({ ok: true });
    const userId: number = req.user.id;
    const isAdmin: boolean = hasAdminAccess(req.user.role);
    if (!isAdmin && rows[0].created_by_id !== userId) {
      return res.status(403).json({ message: "لا يمكنك حذف إدخال أدخله فنى آخر." });
    }
    if (rows[0].printed_at && !rows[0].edit_unlocked_at) {
      return res.status(403).json({ message: "تم طباعة التقرير — التعديل مقفل. اطلب من الأدمن منح صلاحية التعديل." });
    }
    await pool.query(`DELETE FROM cable_entries WHERE id = $1`, [id]);
    res.json({ ok: true });
  });

  // POST /api/cable-entries/mark-printed — يُستدعى عند طباعة تقرير أوامر الشغل.
  // يقفل كل الإدخالات غير المطبوعة (printed_at = now). (فنى + أدمن)
  app.post("/api/cable-entries/mark-printed", requireTechOrAdmin, async (req: any, res) => {
    // الفنى بيطبع تقريره هو — قفل إدخالاته هو بس. كان بيختم إدخالات كل الفنيين،
    // فطباعة فنى «أ» كانت بتقفل إدخالات فنى «ب» الجديدة وتبدأ مهلة الـ3 أيام بتاعته.
    if (req.user?.role === ROLES.TECH) {
      const r = await pool.query(
        `UPDATE cable_entries SET printed_at = now() WHERE printed_at IS NULL AND created_by_id = $1`,
        [req.user.id]);
      return res.json({ ok: true, locked: r.rowCount ?? 0 });
    }
    const r = await pool.query(`UPDATE cable_entries SET printed_at = now() WHERE printed_at IS NULL`);
    res.json({ ok: true, locked: r.rowCount ?? 0 });
  });

  // POST /api/cable-entries/:id/unlock — الأدمن يمنح صلاحية تعديل لإدخال مطبوع.
  // مسموح فقط خلال 3 أيام من الطباعة.
  app.post("/api/cable-entries/:id/unlock", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ message: "معرّف غير صالح" });
    const { rows } = await pool.query(
      `SELECT printed_at, printed_at > now() - interval '3 days' AS within3 FROM cable_entries WHERE id = $1`, [id],
    );
    if (!rows.length) return res.status(404).json({ message: "الإدخال غير موجود" });
    if (!rows[0].printed_at) return res.status(400).json({ message: "الإدخال غير مطبوع — التعديل متاح بالفعل" });
    if (!rows[0].within3) return res.status(403).json({ message: "مرّت 3 أيام على الطباعة — لا يمكن منح صلاحية التعديل" });
    await pool.query(`UPDATE cable_entries SET edit_unlocked_at = now() WHERE id = $1`, [id]);
    res.json({ ok: true });
  });

  // === فنى الإغلاق اليدوى (manual_close_by) — أدمن فقط ===

  // POST /api/manual-close-by — تعيين/تحديث فنى إغلاق يدوى لشكوى (مرجعية أولى)
  app.post("/api/manual-close-by", requireAdmin, async (req: any, res) => {
    const { complainNo, techName } = req.body as Record<string, string>;
    const no = String(complainNo ?? "").trim();
    const tech = String(techName ?? "").trim();
    if (!no) return res.status(400).json({ message: "رقم الشكوى مطلوب" });
    if (!tech) return res.status(400).json({ message: "اسم الفنى مطلوب" });
    await pool.query(
      `INSERT INTO manual_close_by (complain_no, tech_name, assigned_by_id, assigned_by_name)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (complain_no)
       DO UPDATE SET tech_name = EXCLUDED.tech_name,
                     assigned_by_id = EXCLUDED.assigned_by_id,
                     assigned_by_name = EXCLUDED.assigned_by_name,
                     updated_at = now()`,
      [no, tech, req.user.id, req.user.username],
    );
    res.json({ ok: true });
  });

  // DELETE /api/manual-close-by/:complainNo — إلغاء التعيين اليدوى
  app.delete("/api/manual-close-by/:complainNo", requireAdmin, async (req, res) => {
    const no = String(req.params.complainNo ?? "").trim();
    if (!no) return res.status(400).json({ message: "رقم الشكوى مطلوب" });
    await pool.query(`DELETE FROM manual_close_by WHERE complain_no = $1`, [no]);
    res.json({ ok: true });
  });

  // === إسناد فنى يدوى لكود كابينة MSAN (msan_tech_overrides) — أدمن فقط ===

  // POST /api/msan-tech — تعيين/تحديث فنى كود كابينة غير معروف
  app.post("/api/msan-tech", requireAdmin, async (req: any, res) => {
    const { msanCode, techName } = req.body as Record<string, string>;
    const code = String(msanCode ?? "").trim();
    const tech = String(techName ?? "").trim();
    if (!code) return res.status(400).json({ message: "كود الكابينة مطلوب" });
    if (!tech) return res.status(400).json({ message: "اسم الفنى مطلوب" });
    await pool.query(
      `INSERT INTO msan_tech_overrides (cabin_code, tech_name, assigned_by_id, assigned_by_name)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (cabin_code)
       DO UPDATE SET tech_name = EXCLUDED.tech_name,
                     assigned_by_id = EXCLUDED.assigned_by_id,
                     assigned_by_name = EXCLUDED.assigned_by_name,
                     updated_at = now()`,
      [code, tech, req.user.id, req.user.username],
    );
    res.json({ ok: true });
  });

  // DELETE /api/msan-tech/:code — إلغاء الإسناد اليدوى
  app.delete("/api/msan-tech/:code", requireAdmin, async (req, res) => {
    const code = String(req.params.code ?? "").trim();
    if (!code) return res.status(400).json({ message: "كود الكابينة مطلوب" });
    await pool.query(`DELETE FROM msan_tech_overrides WHERE cabin_code = $1`, [code]);
    res.json({ ok: true });
  });

  // === Multi-file upload section ===

  // POST /api/maintenance-orders/import — Work_Orders / wfm (3 destinations)
  app.options("/api/maintenance-orders/import", (_req, res) => { setUploadCors(res); res.sendStatus(204); });
  app.post("/api/maintenance-orders/import", requireAdminOrToken, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = sheetRows(ws);
      if (rows.length < 2) return res.json({ inserted: 0 });

      // smart header detection (tolerant of column reorder / leading title rows)
      const { find, header, dataRows } = smartSheet(rows, ["رقم أمر الشغل", "رقم امر الشغل", "work order"]);
      const iDate     = find("تاريخ الانشاء", "تاريخ الإنشاء", "creation", "initiate date", "initiate");
      const iWorkOrder = find("رقم أمر الشغل", "رقم امر الشغل", "work order id", "work order no");
      const iOrg      = find("المؤسسة", "المنظمه", "organization");
      const iPhone    = find("رقم الخدمة", "رقم الخدمه", "service no", "home service", "التليفون", "tel no");
      const iType     = find("نوع أمر الشغل", "نوع امر الشغل", "work order type", "request type");
      const iStage    = find("المرحلة", "stage");
      const iStatus   = find("الحالة", "status");
      const iPriority = find("الأهمية", "الاهميه", "priority", "customer segment");
      const iWorkspec = find("currentworkspec", "workspec");
      const iNotes    = find("notes", "ملاحظات");
      const iDesc     = find("الوصف", "description");
      const iMobile   = find("رقم المحمول", "المحمول", "محمول", "رقم الموبايل", "موبايل", "mobile");
      const iCustomer = find("اسم العميل", "customer name", "customer");
      const iAddress  = find("العنوان", "address");
      const iRef      = find("رقم المرجع", "reference no", "reference");
      // "اسم السنترال" = كود السنترال/رقم الكابينة (مثال GHNAT/7-3) — نستخرج
      // منه رقم الكابينة لربط أمر الشغل بفنى الكابينة فى تقارير التركيبات.
      const iExchName = find("اسم السنترال", "exchange name");
      // تشخيص: يطبع رؤوس الأعمدة المكتشفة وموضع عمود الموبايل فى سجل Replit
      console.log(`maintenance-orders import: headers=${JSON.stringify(header)} | iMobile=${iMobile} | iPhone=${iPhone}`);
      const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

      // build value rows (store ALL centrals; name falls back to the code)
      const wfmRows: any[][] = [];
      const seen = new Set<string>();
      for (const r of dataRows) {
        const workOrderId = parseInt(String(g(r, iWorkOrder)));
        if (!workOrderId || isNaN(workOrderId)) continue;
        const orgCode = String(g(r, iOrg)).trim().toUpperCase();
        const centralName = CENTRAL_CODE_TO_NAME[orgCode] || orgCode || "—";
        const key = centralName + "|" + workOrderId;
        if (seen.has(key)) continue;
        seen.add(key);
        wfmRows.push([
          centralName, workOrderId,
          String(g(r, iPhone)).replace(/^88[-‐]?/, "").trim(),
          String(g(r, iType))     || null,
          String(g(r, iStage))    || null,
          String(g(r, iStatus))   || null,
          String(g(r, iPriority)) || null,
          String(g(r, iWorkspec)) || null,
          String(g(r, iNotes))    || null,
          String(g(r, iDesc))     || null,
          toDate(g(r, iDate)),
          String(g(r, iMobile))   || null,
          String(g(r, iCustomer)) || null,
          String(g(r, iAddress))  || null,
          String(g(r, iRef))      || null,
          (String(g(r, iExchName)).split("/")[1] || "").trim() || null,
        ]);
      }

      const userId = req.user
        ? (req.user as any).id
        : ((await pool.query("SELECT id FROM users WHERE role = $1 LIMIT 1", [ROLES.ADMIN])).rows[0]?.id ?? 1);
      const r = await writeThreeDestinations({
        histTable: "maintenance_orders", sodTable: "wfm_sod", curTable: "wfm_current",
        cols: WFM_COLS, conflict: "central_name, work_order_id", rows: wfmRows, userId,
      });
      res.json({ inserted: r.hist, ...r });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // POST /api/ticket-queue/import — DSL/copper TicketQueue (3 destinations)
  app.options("/api/ticket-queue/import", (_req, res) => { setUploadCors(res); res.sendStatus(204); });
  app.post("/api/ticket-queue/import", requireAdminOrToken, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const rows = parseTicketFile(req.file.buffer);
      const userId = req.user
        ? (req.user as any).id
        : ((await pool.query("SELECT id FROM users WHERE role = $1 LIMIT 1", [ROLES.ADMIN])).rows[0]?.id ?? 1);
      const r = await writeThreeDestinations({
        histTable: "ticket_queue", sodTable: "ticket_dsl_sod", curTable: "ticket_dsl_current",
        cols: TICKET_COLS, conflict: "ticket_id, status_code", rows, userId,
      });
      res.json({ inserted: r.hist, ...r });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // POST /api/ticket-queue-ftth/import — FTTH TicketQueue (3 destinations)
  app.post("/api/ticket-queue-ftth/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const rows = parseTicketFile(req.file.buffer);
      const r = await writeThreeDestinations({
        histTable: "ticket_ftth", sodTable: "ticket_ftth_sod", curTable: "ticket_ftth_current",
        cols: TICKET_COLS, conflict: "ticket_id, status_code", rows, userId: (req.user as any).id,
      });
      res.json({ inserted: r.hist, ...r });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // GET /api/maintenance-orders — list. ?bucket=historical|sod|current
  app.get("/api/maintenance-orders", requireAuth, async (req, res) => {
    const { dateFrom, dateTo, bucket, all } = req.query as Record<string, string>;
    const table = bucket === "sod" ? "wfm_sod" : bucket === "current" ? "wfm_current" : "maintenance_orders";
    const params: any[] = [];
    const conds: string[] = [];
    if (all !== "true") {
      conds.push(`(central_name = 'الغنايم' OR central_name = 'الغنايم-العزايزة' OR central_name = 'الغنايم-دير الجنادله' OR central_name = 'الغنايم-نجع العمدة')`);
    }
    if (dateFrom) { params.push(dateFrom); conds.push(`creation_date >= $${params.length}`); }
    if (dateTo)   { params.push(dateTo + " 23:59:59"); conds.push(`creation_date <= $${params.length}`); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const { rows } = await pool.query(
      `SELECT id, central_name AS "centralName", work_order_id AS "workOrderId",
              phone_number AS "phoneNumber", work_order_type AS "workOrderType",
              stage, status, priority, current_workspec AS "currentWorkspec",
              notes, description, creation_date AS "creationDate"
       FROM ${table} ${where}
       ORDER BY creation_date DESC NULLS LAST`,
      params,
    );
    res.json(rows);
  });

  // GET /api/tickets — ?type=dsl|ftth & ?bucket=historical|sod|current
  app.get("/api/tickets", requireAuth, async (req, res) => {
    const { dateFrom, dateTo, q, all, type, bucket } = req.query as Record<string, string>;
    const TICKET_TABLES: Record<string, Record<string, string>> = {
      dsl:  { historical: "ticket_queue",  sod: "ticket_dsl_sod",  current: "ticket_dsl_current" },
      ftth: { historical: "ticket_ftth",   sod: "ticket_ftth_sod", current: "ticket_ftth_current" },
    };
    const t = TICKET_TABLES[type === "ftth" ? "ftth" : "dsl"];
    const table = t[bucket === "sod" ? "sod" : bucket === "current" ? "current" : "historical"];
    const params: any[] = [];
    const conds: string[] = [];
    if (all !== "true") {
      conds.push(`central_code IN ('GHNAT','AMZAT','DRGAT','NGOAT')`);
    }
    if (dateFrom) { params.push(dateFrom); conds.push(`complaint_time >= $${params.length}`); }
    if (dateTo)   { params.push(dateTo + " 23:59:59"); conds.push(`complaint_time <= $${params.length}`); }
    if (q?.trim()) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      conds.push(`(${n("ticket_id")} LIKE ${p} OR ${n("phone_number")} LIKE ${p} OR ${n("central_name")} LIKE ${p} OR ${n("cabinet_no")} LIKE ${p})`);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    // A ticket can hold several status_code rows. Show only the LAST status per
    // ticket: DISTINCT ON (ticket_id) keeping the highest id (latest inserted),
    // then sort the result by complaint time.
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (ticket_id)
                id, ticket_id AS "ticketId", central_code AS "centralCode",
                central_name AS "centralName", phone_number AS "phoneNumber",
                complaint_time AS "complaintTime", tech_code AS "techCode",
                line_type_code AS "lineTypeCode", cabinet_no AS "cabinetNo",
                priority_code AS "priorityCode", close_date AS "closeDate",
                operation_type AS "operationType", complain_type_name AS "complainTypeName",
                status_code AS "statusCode"
         FROM ${table} ${where}
         ORDER BY ticket_id, id DESC
       ) t
       ORDER BY "complaintTime" DESC NULLS LAST
       LIMIT 5000`,
      params,
    );
    res.json(rows);
  });

  // POST /api/complaint-details/import — smart import of 430D file
  //  • شيت "التفاصيل"    → hist: complaint_details | sod: complaint_details_sod | cur: complaint_details_current
  //  • شيت "تفاصيل متبقى" → hist: remaining_complaints | sod: remaining_complaints_sod | cur: remaining_complaints_current
  app.options("/api/complaint-details/import", (_req, res) => { setUploadCors(res); res.sendStatus(204); });
  app.post("/api/complaint-details/import", requireAdminOrToken, upload.any(), async (req: any, res) => {
    try {
      const files: any[] = (req.files && req.files.length) ? req.files : (req.file ? [req.file] : []);
      if (!files.length) return res.status(400).json({ message: "لا يوجد ملف" });
      // مسار X-Upload-Token (الرفع التلقائى من السكربت) مافيهوش req.user — القراءة
      // المباشرة كانت بترمى TypeError قبل قراءة الشيت، فالرفع التلقائى لـ430D كان
      // بيفشل بـ500 دايماً بينما اليدوى شغّال. نفس نمط بقية المستوردات.
      const userId: number = (req as any).user?.id
        ?? ((await pool.query("SELECT id FROM users WHERE role = $1 LIMIT 1", [ROLES.ADMIN])).rows[0]?.id ?? 1);

      let detailsInserted = 0, detailsTotal = 0;
      let remainingInserted = 0, remainingTotal = 0;
      const allSheetNames: string[] = [];
      const detailsSheets: string[] = [];

      // ندعم رفع أكثر من ملف مرة واحدة (كل ملف يُكتشف نوعه تلقائياً: تفاصيل/متبقى)،
      // أو ملف واحد فيه شيت واحد لأى نوع، أو ملف واحد يحوى الشيتين معاً.
      for (const file of files) {
        const wb = XLSX.read(file.buffer, { type: "buffer", cellDates: false });
        allSheetNames.push(...wb.SheetNames);

      // ── Sheet: التفاصيل / تفاصيل الأعطال (accumulating, dedup by complain_no) ──
      let ws1 = wb.Sheets["التفاصيل"] || wb.Sheets["تفاصيل الأعطال"];
      let detailsSheetName = wb.Sheets["التفاصيل"] ? "التفاصيل" : (wb.Sheets["تفاصيل الأعطال"] ? "تفاصيل الأعطال" : null);
      // Fallback: لو اتغيّر اسم شيت التفاصيل فى ملف 430D، ندوّر عليه بالمحتوى:
      // أى شيت (غير شيت المتبقى) فيه عمود "complain no" / "رقم الشكوى" ومافيهوش
      // أعمدة المتبقى المميزة (status code / dispatch) — دى علامة شيت التفاصيل.
      if (!ws1) {
        for (const name of wb.SheetNames) {
          if (name === "تفاصيل متبقى" || name.includes("متبقى")) continue;
          const cand = wb.Sheets[name];
          if (!cand) continue;
          const rowsC = sheetRows(cand);
          const { header, dataRows } = smartSheet(rowsC, ["complain no", "رقم الشكوى"]);
          const hasComplainNo = header.some((h) => h.includes("complain no") || h.includes("رقم الشكوى"));
          const looksRemaining = header.some((h) => h.includes("status code") || h.includes("dispatch"));
          if (hasComplainNo && !looksRemaining && dataRows.length > 0) {
            ws1 = cand; detailsSheetName = name; break;
          }
        }
      }
      if (ws1) {
        const rows1: any[][] = sheetRows(ws1);
        const { find, header, dataRows } = smartSheet(rows1, ["complain no", "رقم الشكوى"]);
        const iNo       = find("complain no", "رقم الشكوى");
        const iSector   = find("sector", "القطاع");
        const iRegion   = find("region", "المنطقة");
        const iExchange = find("exchange name", "exchange", "السنترال");
        const iPhone    = find("التليفون", "tel no", "رقم التليفون");
        const iMsan     = find("msan id", "msan");
        const iCabinet  = find("cabinet no", "الكابينة");
        const iCloseCode    = find("close code", "كود الاغلاق", "كود الإغلاق");
        const iStatusCode   = find("status code", "حالة الشكوى", "حالة الشكوي");
        const iComplainTime = find("compalin time", "complain time", "وقت الشكوى");
        const iCloseTime    = find("close time", "وقت الإغلاق");
        const iSide     = find("complain side name", "side name");
        const iType     = find("complain type name", "complain type", "نوع العطل");
        const iCloseBy  = find("close by", "أغلق بواسطة");
        // Arabic header: "فترة الاستمرار...استبعاد الحالة 135" | English: "time till now(except 135)"
        const iTimeTillNow1 = find("except 135", "استبعاد الحالة 135");
        // العمود الكلى "Time untill now" (بدون استبعاد 135/138) — نتجنّب مطابقة عمود except135
        const iTimeTillNowFull1 = header.findIndex((h) =>
          (h.includes("till now") || h.includes("untill now") || h.includes("until now") || h.includes("الاستمرار") || h.includes("حتى ال"))
          && !h.includes("except") && !h.includes("استبعاد") && !h.includes("135"));
        const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

        const inserts: any[][] = [];
        const seen = new Set<string>();
        for (const r of dataRows) {
          const no = String(g(r, iNo)).trim();
          if (!no || no === "0" || seen.has(no)) continue;
          seen.add(no);
          const timeTillNow1 = toHours(iTimeTillNow1 >= 0 ? r[iTimeTillNow1] : null);
          const timeTillNowFull1 = toHours(iTimeTillNowFull1 >= 0 ? r[iTimeTillNowFull1] : null);
          inserts.push([
            no,
            String(g(r, iSector)) || null,
            String(g(r, iRegion)) || null,
            String(g(r, iExchange)) || null,
            String(g(r, iPhone)) || null,
            String(g(r, iMsan)) || null,
            String(g(r, iCabinet)) || null,
            toDate(g(r, iComplainTime)),
            toDate(g(r, iCloseTime)),
            String(g(r, iCloseCode)) || null,
            String(g(r, iStatusCode)) || null,
            String(g(r, iSide)) || null,
            String(g(r, iType)) || null,
            String(g(r, iCloseBy)) || null,
            timeTillNow1,
            timeTillNowFull1,
          ]);
        }
        detailsTotal += inserts.length;
        // cols that may have been null in older uploads — backfill them on re-upload
        const detailsUpdateCols = ["close_by", "time_till_now", "time_till_now_full", "complain_side_name", "complain_type_name", "cabinet_no", "msan_id", "status_code"];
        // All 3 destinations accumulate — no full replace — so uploading multiple
        // parts of the national 430D file combines them instead of overwriting.
        const r1hist = await accumulateTable("complaint_details", COMPLAINT_DETAILS_COLS, "complain_no", inserts, userId, detailsUpdateCols);
        await accumulateTable("complaint_details_current", COMPLAINT_DETAILS_COLS, "complain_no", inserts, userId, detailsUpdateCols);
        const firstToday1 = await isFirstUploadToday("complaint_details_sod");
        if (firstToday1) await pool.query("DELETE FROM complaint_details_sod");
        await accumulateTable("complaint_details_sod", COMPLAINT_DETAILS_COLS, "complain_no", inserts, userId, detailsUpdateCols);
        detailsInserted += r1hist;
      }

      // ── Sheet: تفاصيل متبقى (full replace) ──
      // بالاسم، وإلا بالمحتوى: أى شيت (غير شيت التفاصيل) فيه "status code" + "complain no"
      // — عشان الملف لو اترفع منفصل بشيت اسمه "Sheet1" يتعرّف عليه من الأعمدة.
      let ws2 = wb.Sheets["تفاصيل متبقى"] || (wb.SheetNames.map((name) => {
        if (name === detailsSheetName) return null;
        const cand = wb.Sheets[name];
        if (!cand) return null;
        const { header, dataRows } = smartSheet(sheetRows(cand), ["complain no", "رقم الشكوى"]);
        const hasStatus = header.some((h) => h.includes("status code") || h.includes("حالة"));
        const hasNo = header.some((h) => h.includes("complain no") || h.includes("رقم الشكوى"));
        return (hasStatus && hasNo && dataRows.length > 0) ? cand : null;
      }).find(Boolean) || null);
      if (ws2) {
        const rows2: any[][] = sheetRows(ws2);
        const { find, header, dataRows } = smartSheet(rows2, ["complain no"]);
        const iNo = find("complain no", "رقم الشكوى");
        const iSector = find("sector", "القطاع");
        const iRegion = find("region", "المنطقة");
        const iExchange = find("exchange name", "exchange", "السنترال");
        const iPhone = find("tel no", "التليفون", "رقم التليفون");
        const iComplainTime = find("complain time", "وقت الشكوى");
        const iDispatchTime = find("dispatch time");
        const iDispatchUser = find("dispatch user");
        const iMsan = find("msan id", "msan");
        const iCloseTime = find("close time", "وقت الإغلاق");
        const iCloseCode = find("close code", "كود الاغلاق", "كود الإغلاق");
        const iCloseBy = find("close by");
        const iStatus = find("status code", "حالة الشكوى", "حالة الشكوي");
        const iCabinet = find("cabinet no", "الكابينة", "الكابينه");
        // "Complain Type" (not "Complain Type Code")
        const iType = (() => {
          const exact = find("complain type");
          // prefer the column whose header is exactly "complain type"
          return exact;
        })();
        const iTimeTillNow2 = find("except 135");
        // العمود الكلى "Time untill now" (بدون استبعاد 135/138)
        const iTimeTillNowFull2 = header.findIndex((h) =>
          (h.includes("till now") || h.includes("untill now") || h.includes("until now") || h.includes("الاستمرار") || h.includes("حتى ال"))
          && !h.includes("except") && !h.includes("استبعاد") && !h.includes("135"));
        const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

        const inserts: any[][] = [];
        const seen = new Set<string>();
        for (const r of dataRows) {
          const no = String(g(r, iNo)).trim();
          if (!no || no === "0" || seen.has(no)) continue;
          seen.add(no);
          const timeTillNow2 = toHours(iTimeTillNow2 >= 0 ? r[iTimeTillNow2] : null);
          const timeTillNowFull2 = toHours(iTimeTillNowFull2 >= 0 ? r[iTimeTillNowFull2] : null);
          inserts.push([
            no,
            String(g(r, iSector)) || null,
            String(g(r, iRegion)) || null,
            String(g(r, iExchange)) || null,
            String(g(r, iPhone)) || null,
            toDate(g(r, iComplainTime)),
            toDate(g(r, iDispatchTime)),
            String(g(r, iDispatchUser)) || null,
            String(g(r, iMsan)) || null,
            toDate(g(r, iCloseTime)),
            String(g(r, iCloseCode)) || null,
            String(g(r, iCloseBy)) || null,
            String(g(r, iStatus)) || null,
            String(g(r, iCabinet)) || null,
            String(g(r, iType)) || null,
            timeTillNow2,
            timeTillNowFull2,
          ]);
        }
        remainingTotal += inserts.length;
        // المتبقى snapshot: current is fully replaced each upload (fresh open-faults
        // snapshot), while the historical table keeps accumulating. The historical
        // table OVERWRITES the volatile state fields (status_code/close_time/...) with
        // the latest snapshot, so a fault that progresses 135→138 is recorded with its
        // final removed-status + close_time and never goes stale — this lets combined
        // stats read removed (138) faults from the permanent historical table so they
        // don't vanish when a newer 430D file replaces remaining_complaints_current.
        const r2 = await writeThreeDestinations({
          histTable: "remaining_complaints",
          sodTable: "remaining_complaints_sod",
          curTable: "remaining_complaints_current",
          cols: REMAINING_COMPLAINTS_COLS,
          conflict: "complain_no",
          rows: inserts,
          userId,
          overwriteCols: ["exchange_name", "status_code", "close_time", "close_code",
                          "close_by", "time_till_now", "time_till_now_full", "cabinet_no", "dispatch_time",
                          "dispatch_user", "complain_type", "msan_id"],
        });
        remainingInserted += r2.hist;
      }

        if (detailsSheetName) detailsSheets.push(detailsSheetName);
      } // ← نهاية الحلقة على كل ملف مرفوع

      res.json({
        inserted: detailsInserted + remainingInserted,
        details: { inserted: detailsInserted, total: detailsTotal },
        remaining: { inserted: remainingInserted, total: remainingTotal },
        filesProcessed: files.length,
        // تشخيص: أسماء الشيتات فى كل الملفات + الشيتات اللى اتقرأ منها التفاصيل
        sheetNames: allSheetNames,
        detailsSheet: detailsSheets.join(", ") || null,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // GET /api/complaint-details/counts — diagnostic: row counts of all 6 tables
  app.get("/api/complaint-details/counts", requireAuth, async (_req, res) => {
    const tables = [
      "complaint_details", "complaint_details_sod", "complaint_details_current",
      "remaining_complaints", "remaining_complaints_sod", "remaining_complaints_current",
      "ftth_subscribers",
    ];
    const out: Record<string, number> = {};
    for (const t of tables) {
      try {
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM ${t}`);
        out[t] = rows[0]?.c ?? 0;
      } catch (e: any) {
        out[t] = -1; // table missing / error
      }
    }
    res.json(out);
  });

  // GET /api/complaint-details — list with date filter + search (Ghanaim centrals only by default)
  // ?bucket=historical (default) | sod | current
  app.get("/api/complaint-details", requireAuth, async (req, res) => {
    const { dateFrom, dateTo, q, all, bucket, limit: limitParam } = req.query as Record<string, string>;
    const rowLimit = parseInt(limitParam || "0") || 10000;
    const tbl = bucket === "current" ? "complaint_details_current"
              : bucket === "sod"     ? "complaint_details_sod"
              :                        "complaint_details";
    const params: any[] = [];
    const conds: string[] = [];
    // Show only الغنايم branches unless all=true
    if (all !== "true") {
      conds.push(`(exchange_name = 'الغنايم' OR exchange_name = 'الغنايم-العزايزة' OR exchange_name = 'الغنايم-دير الجنادله' OR exchange_name = 'الغنايم-نجع العمدة')`);
    }
    if (dateFrom) { params.push(dateFrom); conds.push(`complain_time >= $${params.length}`); }
    if (dateTo)   { params.push(dateTo + " 23:59:59"); conds.push(`complain_time <= $${params.length}`); }
    if (q?.trim()) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      conds.push(`(${n("complain_no")} LIKE ${p} OR ${n("phone_number")} LIKE ${p} OR ${n("exchange_name")} LIKE ${p} OR ${n("cabinet_no")} LIKE ${p})`);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const { rows } = await pool.query(
      `SELECT id, complain_no AS "complainNo", sector, region,
              exchange_name AS "exchangeName", phone_number AS "phoneNumber",
              msan_id AS "msanId", cabinet_no AS "cabinetNo",
              complain_time AS "complainTime", close_time AS "closeTime",
              close_code AS "closeCode", complain_side_name AS "complainSideName",
              complain_type_name AS "complainTypeName", close_by AS "closeBy"
       FROM ${tbl} ${where}
       ORDER BY complain_time DESC NULLS LAST
       LIMIT $${params.length + 1}`,
      [...params, rowLimit],
    );
    res.json(rows);
  });

  // GET /api/remaining-complaints — list with date filter + search (Ghanaim only by default)
  // ?bucket=current (default) | sod | historical
  app.get("/api/remaining-complaints", requireAuth, async (req, res) => {
    const { dateFrom, dateTo, q, all, bucket } = req.query as Record<string, string>;
    const tbl = bucket === "historical" ? "remaining_complaints"
              : bucket === "sod"        ? "remaining_complaints_sod"
              :                           "remaining_complaints_current";
    const params: any[] = [];
    const conds: string[] = [];
    if (all !== "true") {
      conds.push(`(exchange_name = 'الغنايم' OR exchange_name = 'الغنايم-العزايزة' OR exchange_name = 'الغنايم-دير الجنادله' OR exchange_name = 'الغنايم-نجع العمدة')`);
    }
    if (dateFrom) { params.push(dateFrom); conds.push(`complain_time >= $${params.length}`); }
    if (dateTo)   { params.push(dateTo + " 23:59:59"); conds.push(`complain_time <= $${params.length}`); }
    if (q?.trim()) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      conds.push(`(${n("complain_no")} LIKE ${p} OR ${n("phone_number")} LIKE ${p} OR ${n("exchange_name")} LIKE ${p} OR ${n("cabinet_no")} LIKE ${p})`);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const { rows } = await pool.query(
      `SELECT id, complain_no AS "complainNo", sector, region,
              exchange_name AS "exchangeName", phone_number AS "phoneNumber",
              complain_time AS "complainTime", dispatch_time AS "dispatchTime",
              dispatch_user AS "dispatchUser", msan_id AS "msanId",
              close_time AS "closeTime", close_code AS "closeCode",
              close_by AS "closeBy", status_code AS "statusCode",
              cabinet_no AS "cabinetNo", complain_type AS "complainType"
       FROM ${tbl} ${where}
       ORDER BY complain_time DESC NULLS LAST`,
      params,
    );
    res.json(rows);
  });

  // POST /api/ftth-subscribers/import — full replace from FTTH-Subscibers sheet
  app.post("/api/ftth-subscribers/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets["FTTH-Subscibers"] || wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = sheetRows(ws);
      const { find, dataRows } = smartSheet(rows, ["fcc code", "msan/gpon", "msan"]);
      const iSector = find("sector");
      const iRegion = find("regoin", "region");
      const iMainEx = find("main ex");
      const iSubEx  = find("sub ex");
      const iFcc    = find("fcc code", "fcc");
      const iType   = find("type");
      const iMsan   = find("msan/gpon", "msan", "gpon code");
      const iFbb    = find("fbb subs", "fbb");
      const iFv     = find("fv subs", "fv");
      const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");
      const toInt = (v: any) => { const n = parseInt(String(v)); return isNaN(n) ? null : n; };

      const inserts: any[][] = [];
      for (const r of dataRows) {
        const fcc = String(g(r, iFcc)).trim();
        const msan = String(g(r, iMsan)).trim();
        if (!fcc && !msan) continue;
        inserts.push([
          String(g(r, iSector)) || null,
          String(g(r, iRegion)) || null,
          String(g(r, iMainEx)) || null,
          String(g(r, iSubEx)) || null,
          fcc || null,
          String(g(r, iType)) || null,
          msan || null,
          toInt(g(r, iFbb)),
          toInt(g(r, iFv)),
        ]);
      }

      const inserted = await withTx(async (tx) => {
        await tx.query("DELETE FROM ftth_subscribers");
        let n = 0;
        const BATCH = 300;
        for (let s = 0; s < inserts.length; s += BATCH) {
          const chunk = inserts.slice(s, s + BATCH);
          const ph = chunk.map((_, ci) => {
            const o = ci * 9;
            return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9})`;
          }).join(",");
          const r = await tx.query(
            `INSERT INTO ftth_subscribers
               (sector, region, main_ex, sub_ex, fcc_code, type, msan_gpon_code, fbb_subs, fv_subs)
             VALUES ${ph}`,
            chunk.flat(),
          );
          n += r.rowCount ?? 0;
        }
        return n;
      });
      res.json({ inserted, total: inserts.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // POST /api/ftth-subscribers/import-rows — staged import: client parses Excel
  // in the browser and sends normalized rows in JSON batches. First batch uses
  // mode="replace" (wipes old data), the rest use mode="append".
  app.post("/api/ftth-subscribers/import-rows", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const { rows, mode } = req.body as { rows: any[][]; mode: "replace" | "append" };
      if (!Array.isArray(rows)) return res.status(400).json({ message: "لا توجد بيانات" });
      const toInt = (v: any) => { const n = parseInt(String(v)); return isNaN(n) ? null : n; };
      // المسح + أول دفعة فى transaction واحدة: فشل الطلب الأول كان بيسيب الجدول
      // فاضى خالص. (الدفعات التالية طلبات مستقلة — لو النت وقع فى نصها الجدول
      // بيبقى ناقص وبيتقال للمستخدم فى الرد إن العدد أقل من المتوقع.)
      let inserted = 0;
      const BATCH = 300;
      await withTx(async (tx) => {
      if (mode === "replace") await tx.query("DELETE FROM ftth_subscribers");
      for (let s = 0; s < rows.length; s += BATCH) {
        const chunk = rows.slice(s, s + BATCH).map((r) => [
          String(r[0] ?? "") || null,
          String(r[1] ?? "") || null,
          String(r[2] ?? "") || null,
          String(r[3] ?? "") || null,
          String(r[4] ?? "") || null,
          String(r[5] ?? "") || null,
          String(r[6] ?? "") || null,
          toInt(r[7]),
          toInt(r[8]),
        ]);
        const ph = chunk.map((_, ci) => {
          const o = ci * 9;
          return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9})`;
        }).join(",");
        const r2 = await tx.query(
          `INSERT INTO ftth_subscribers
             (sector, region, main_ex, sub_ex, fcc_code, type, msan_gpon_code, fbb_subs, fv_subs)
           VALUES ${ph}`,
          chunk.flat(),
        );
        inserted += r2.rowCount ?? 0;
      }
      });
      res.json({ inserted });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // GET /api/ftth-subscribers — list with search (summary report, all centrals)
  app.get("/api/ftth-subscribers", requireAuth, async (req, res) => {
    const { q } = req.query as Record<string, string>;
    const params: any[] = [];
    let where = "";
    if (q?.trim()) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      where = `WHERE (${n("fcc_code")} LIKE ${p} OR ${n("main_ex")} LIKE ${p} OR ${n("sub_ex")} LIKE ${p} OR ${n("msan_gpon_code")} LIKE ${p} OR ${n("type")} LIKE ${p})`;
    }
    const { rows } = await pool.query(
      `SELECT id, sector, region, main_ex AS "mainEx", sub_ex AS "subEx",
              fcc_code AS "fccCode", type, msan_gpon_code AS "msanGponCode",
              fbb_subs AS "fbbSubs", fv_subs AS "fvSubs"
       FROM ftth_subscribers ${where}
       ORDER BY fcc_code, msan_gpon_code
       LIMIT 5000`,
      params,
    );
    res.json(rows);
  });

  // POST /api/case-138/import — merge from حاله 138 sheet
  // (دمج: يحدّث فقط الشكاوى الموجودة فى الملف ويحافظ على باقى الصفوف — زى قياسات DZS التلقائية)
  app.post("/api/case-138/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets["حاله 138"] || wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = sheetRows(ws);
      const { find, dataRows } = smartSheet(rows, ["رقم الشكوي", "رقم الشكوى", "complain"]);
      const iCentral = find("field1");
      const iPhoneShort = find("رقم التلفون");
      const iComplainNo = find("رقم الشكوي", "رقم الشكوى");
      const iScore = find("score");
      const iCurSpeed = find("السرعه الحاليه", "السرعة الحالية");
      const iMaxSpeed = find("اقصى سرعه", "أقصى سرعة");
      const iFullPhone = find("رقم التليفون كاملا", "كاملا");
      const iAccount = find("رقم الاكونت", "اكونت", "account");
      const iStatus = find("status code");
      const iCabinet = find("cabinet no");
      const iBox = find("رقم البكس", "البكس");
      const iType = find("complaintypename", "complain type");
      const iComplainTime = find("وقت الشكوي", "وقت الشكوى");
      const iCustomer = find("field5");
      const iDispatch = find("وقت التسليم");
      const iTech = find("كود الفنى", "كود الفني");
      const iCloseDate = find("تاريخ الإغلاق", "تاريخ الاغلاق");
      const iOnu = find("onu");
      const iFault = find("نوع العطل");
      const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");
      const toInt = (v: any) => { const n = parseInt(String(v)); return isNaN(n) ? null : n; };

      // مفتاح الدمج: رقم الشكوى لو موجود، وإلا التليفون الكامل (88+الرقم)، وإلا مفتاح فريد.
      // Map.set يحتفظ بآخر صف لكل مفتاح (يتغلب على المكرر داخل نفس الملف).
      const byKey = new Map<string, any[]>();
      let noKeySeq = 0;
      for (const r of dataRows) {
        const complainNo = String(g(r, iComplainNo)).trim();
        const central = String(g(r, iCentral)).trim();
        if (!complainNo && !central) continue;
        const phoneShort = String(g(r, iPhoneShort)).trim();
        let fullPhone = String(g(r, iFullPhone)).trim();
        if (!fullPhone && phoneShort) fullPhone = "88" + phoneShort;
        const key = complainNo
          ? "c:" + complainNo
          : (fullPhone ? "p:" + fullPhone : `__no_key_${noKeySeq++}`);
        byKey.set(key, [
          central || null,
          phoneShort || null,
          complainNo || null,
          toInt(g(r, iScore)),
          String(g(r, iCurSpeed)) || null,
          String(g(r, iMaxSpeed)) || null,
          fullPhone || null,
          String(g(r, iAccount)) || null,
          String(g(r, iStatus)) || null,
          String(g(r, iCabinet)) || null,
          String(g(r, iBox)) || null,
          String(g(r, iType)) || null,
          toDate(g(r, iComplainTime)),
          String(g(r, iCustomer)) || null,
          toDate(g(r, iDispatch)),
          String(g(r, iTech)) || null,
          toDate(g(r, iCloseDate)),
          String(g(r, iOnu)) || null,
          String(g(r, iFault)) || null,
        ]);
      }
      const inserts = Array.from(byKey.values());

      // دمج بدل المسح الكامل (complain_no عمود 2، full_phone عمود 6).
      // كله جوه transaction واحدة: فشل فى نص الرفع كان بيمسح قياسات قديمة من غير
      // ما يدخّل الجديدة — تاريخ القياسات كان بيضيع بصمت.
      const { inserted } = await withTx(async (tx) => {
      const DEL_BATCH = 1000;
      // (1) امسح الشكاوى الموجودة فى الملف (لتُستبدل بأحدث بياناتها).
      const complainNos = Array.from(
        new Set(inserts.map((r) => r[2]).filter((c) => c != null && String(c).trim() !== "")),
      );
      for (let s = 0; s < complainNos.length; s += DEL_BATCH) {
        const chunk = complainNos.slice(s, s + DEL_BATCH);
        const ph = chunk.map((_, i) => `$${i + 1}`).join(",");
        await tx.query(`DELETE FROM case_138 WHERE complain_no IN (${ph})`, chunk);
      }
      // (2) للصفوف بدون رقم شكوى: امسح صفوف نفس التليفون الكامل التى لا شكوى لها فقط
      //     (حتى لا نمس صفوف الشكاوى لنفس الرقم) — وندخّل القراية الجديدة بدلها.
      const noComplainPhones = Array.from(
        new Set(inserts.filter((r) => !r[2]).map((r) => r[6]).filter((p) => p != null && String(p).trim() !== "")),
      );
      for (let s = 0; s < noComplainPhones.length; s += DEL_BATCH) {
        const chunk = noComplainPhones.slice(s, s + DEL_BATCH);
        const ph = chunk.map((_, i) => `$${i + 1}`).join(",");
        await tx.query(
          `DELETE FROM case_138 WHERE full_phone IN (${ph}) AND (complain_no IS NULL OR complain_no = '')`,
          chunk,
        );
      }
      let inserted = 0;  // جوه الـ transaction
      const BATCH = 200;
      for (let s = 0; s < inserts.length; s += BATCH) {
        const chunk = inserts.slice(s, s + BATCH);
        const ph = chunk.map((_, ci) => {
          const o = ci * 19;
          return "(" + Array.from({ length: 19 }, (_, k) => `$${o+k+1}`).join(",") + ")";
        }).join(",");
        const r = await tx.query(
          `INSERT INTO case_138
             (central_name, phone_short, complain_no, score, current_speed, max_speed,
              full_phone, account_no, status_code, cabinet_no, box_no, complain_type_name,
              complain_time, customer_name, dispatch_time, tech_code, close_date, onu, fault_type)
           VALUES ${ph}`,
          chunk.flat(),
        );
        inserted += r.rowCount ?? 0;
      }
      // مزامنة أرقام الأكونت مع line_accounts — للخطوط الغير موجودة فيه فقط (لا تُعيد الكتابة على الإدخال اليدوى)
      const withAccount = inserts.filter(r => r[6] && r[7] && String(r[6]).trim() && String(r[7]).trim());
      for (let s = 0; s < withAccount.length; s += BATCH) {
        const chunk = withAccount.slice(s, s + BATCH);
        const ph = chunk.map((_, ci) => `($${ci*2+1}, $${ci*2+2}, 'case_138')`).join(",");
        await tx.query(
          `INSERT INTO line_accounts (full_phone, account_no, source)
           VALUES ${ph}
           ON CONFLICT (full_phone) DO NOTHING`,
          chunk.flatMap(r => [String(r[6]).trim(), String(r[7]).trim()])
        );
      }
      return { inserted };
      });
      res.json({ inserted, total: inserts.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // GET /api/case-138 — list with date filter + search (all centrals)
  app.get("/api/case-138", requireAuth, async (req, res) => {
    const { dateFrom, dateTo, q } = req.query as Record<string, string>;
    const params: any[] = [];
    const conds: string[] = [];
    if (dateFrom) { params.push(dateFrom); conds.push(`complain_time >= $${params.length}`); }
    if (dateTo)   { params.push(dateTo + " 23:59:59"); conds.push(`complain_time <= $${params.length}`); }
    if (q?.trim()) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      conds.push(`(${n("complain_no")} LIKE ${p} OR ${n("full_phone")} LIKE ${p} OR ${n("phone_short")} LIKE ${p} OR ${n("central_name")} LIKE ${p} OR ${n("cabinet_no")} LIKE ${p})`);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const { rows } = await pool.query(
      `SELECT id, central_name AS "centralName", phone_short AS "phoneShort",
              complain_no AS "complainNo", score, current_speed AS "currentSpeed",
              max_speed AS "maxSpeed", full_phone AS "fullPhone", account_no AS "accountNo",
              status_code AS "statusCode", cabinet_no AS "cabinetNo", box_no AS "boxNo",
              complain_type_name AS "complainTypeName", complain_time AS "complainTime",
              customer_name AS "customerName", dispatch_time AS "dispatchTime",
              tech_code AS "techCode", close_date AS "closeDate", onu, fault_type AS "faultType"
       FROM case_138 ${where}
       ORDER BY complain_time DESC NULLS LAST`,
      params,
    );
    res.json(rows);
  });

  // === DZS Tampermonkey → تحديث شيت القياسات 138 تلقائياً ===
  // يُستدعى cross-origin من صفحة DZS (10.42.x.x) فلازم CORS + توكن مشترك.
  // التوكن: env DZS_INGEST_TOKEN (وله قيمة افتراضية) — لازم يطابق التوكن فى سكربت التامبر منكى.
  const DZS_INGEST_TOKEN = process.env.DZS_INGEST_TOKEN || "sf-dzs-138-ingest-2026";
  const setDzsCors = (res: any) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-DZS-Token");
  };
  app.options("/api/case-138/measurements", (_req, res) => { setDzsCors(res); res.sendStatus(204); });
  app.post("/api/case-138/measurements", async (req: any, res) => {
    setDzsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) {
      return res.status(401).json({ message: "invalid token" });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.json({ inserted: 0 });
    const toInt = (v: any) =>
      v != null && /^\d+$/.test(String(v).trim()) ? parseInt(String(v).trim(), 10) : null;
    let inserted = 0;
    for (const it of items) {
      const phoneShort = (it.phoneShort ?? "").toString().trim() || null;
      const complainNo = (it.complainNo ?? "").toString().trim() || null;
      const accountNo = (it.accountNo ?? "").toString().trim() || null;
      let fullPhone = (it.fullPhone ?? "").toString().trim() || null;
      if (!fullPhone && phoneShort) fullPhone = "88" + phoneShort;
      // لو السكربت بعت رقم الأكونت فقط (URL قصير بدون sf_meta) — نحوّله للتليفون
      // الكامل من line_accounts حتى تربط التقارير القياس بالخط (join على full_phone).
      if (!fullPhone && accountNo) {
        const { rows: la } = await pool.query(
          `SELECT full_phone FROM line_accounts WHERE account_no = $1 LIMIT 1`,
          [accountNo],
        );
        if (la[0]?.full_phone) fullPhone = String(la[0].full_phone).trim();
      }
      // لا بد من مفتاح ربط واحد على الأقل
      if (!phoneShort && !complainNo && !accountNo) continue;
      // مين طلب القياس ده؟ من op_intents (اتسجّلت وقت الضغط على زر القياس)
      let measuredBy: string | null = null;
      if (accountNo) {
        const { rows: oi } = await pool.query(`SELECT username FROM op_intents WHERE account = $1 AND op_type = 'measure'`, [accountNo]);
        measuredBy = oi[0]?.username || null;
      }
      await pool.query(
        `INSERT INTO case_138
           (phone_short, complain_no, score, current_speed, max_speed, full_phone, account_no, measured_by, complain_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
        [phoneShort, complainNo, toInt(it.score), (it.currentSpeed ?? "").toString().trim() || null,
         (it.maxSpeed ?? "").toString().trim() || null, fullPhone, accountNo, measuredBy],
      );
      inserted++;
    }
    res.json({ inserted });
  });

  // ===== استقبال أحداث رفع السرعة / إيقاف PO من سكربت رفع السرعة (token-based, CORS) =====
  // body: { items: [{ accountNo, event: "raise" | "stop" }] } — يسجّل آخر وقت رفع/إيقاف لكل أكونت.
  app.options("/api/po-events/ingest", (_req, res) => { setDzsCors(res); res.sendStatus(204); });
  app.post("/api/po-events/ingest", async (req: any, res) => {
    setDzsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) {
      return res.status(401).json({ message: "invalid token" });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    let saved = 0;
    for (const it of items) {
      const acc = (it?.accountNo ?? "").toString().trim();
      const ev = (it?.event ?? "").toString().trim().toLowerCase();
      if (!acc || (ev !== "raise" && ev !== "stop")) continue;
      const col = ev === "raise" ? "last_raise_at" : "last_stop_at";
      const byCol = ev === "raise" ? "last_raise_by" : "last_stop_by";
      // مين طلب الرفع/الإيقاف ده؟ من op_intents
      const { rows: oi } = await pool.query(`SELECT username FROM op_intents WHERE account = $1 AND op_type = $2`, [acc, ev]);
      const by = oi[0]?.username || null;
      await pool.query(
        `INSERT INTO line_po_events (account_no, ${col}, ${byCol}, updated_at)
         VALUES ($1, now(), $2, now())
         ON CONFLICT (account_no) DO UPDATE SET ${col} = now(), ${byCol} = $2, updated_at = now()`,
        [acc, by],
      );
      saved++;
    }
    res.json({ saved });
  });

  // تسجيل «نيّة» العملية: مين المستخدم اللى ضغط قياس/رفع سرعة/إيقاف لأى أرقام — يُختم بعدها فى
  // case_138.measured_by / line_po_events.last_raise_by / last_stop_by لما النتيجة ترجع.
  app.post("/api/op-intent", requireAuth, async (req: any, res) => {
    try {
      const type = String(req.body?.type || "").trim().toLowerCase();
      if (!ALL_JOB_TYPES.includes(type)) {
        return res.status(400).json({ message: "نوع غير صحيح" });
      }
      const list = Array.isArray(req.body?.accounts) ? req.body.accounts : (req.body?.account ? [req.body.account] : []);
      const accs = [...new Set(list.map((a: any) => String(a ?? "").trim()).filter(Boolean))];
      if (!accs.length) return res.json({ ok: true, count: 0 });
      const username = String(req.user?.username || "");
      for (const acc of accs) {
        await pool.query(
          `INSERT INTO op_intents (account, op_type, username, created_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (account, op_type) DO UPDATE SET username = EXCLUDED.username, created_at = now()`,
          [acc, type, username],
        );
      }
      res.json({ ok: true, count: accs.length });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // === Provisioning Portal Tampermonkey → تحديث ملف البورتات (phone_ports) تلقائياً ===
  // يُستدعى cross-origin من provisioningportal.te.eg فلازم CORS + توكن (نفس DZS token).
  const setPortsCors = (res: any) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-DZS-Token");
  };
  // قائمة أكواد الامسان المخزّنة فى الموقع (msan_code المميّزة فى phone_ports)
  app.options("/api/phone-ports/cabins", (_req, res) => { setPortsCors(res); res.sendStatus(204); });
  app.get("/api/phone-ports/cabins", async (req: any, res) => {
    setPortsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) {
      return res.status(401).json({ message: "invalid token" });
    }
    const { rows } = await pool.query(
      `SELECT DISTINCT btrim(msan_code) AS "msanCode" FROM phone_ports
        WHERE msan_code IS NOT NULL AND btrim(msan_code) <> ''
        ORDER BY 1`,
    );
    res.json({ cabins: rows.map((r: any) => r.msanCode) });
  });
  // استقبال صفوف البورتات من Get MSAN Data → upsert على phone_number (يستبدل الموجود ويضيف الجديد)
  // ===== متابعة طلبات تغيير البورت (Provisioning Portal) =====
  const pcNormFull = (p: any) => { const d = String(p || "").replace(/\D/g, ""); return d ? (d.startsWith("88") ? d : ("88" + d)) : ""; };

  // GET /api/port-change/seen?phone=... — Request IDs المسجّلة قبل كده لهذا الرقم (للـ dedup فى السكربت)
  app.options("/api/port-change/seen", (_req, res) => { setPortsCors(res); res.sendStatus(204); });
  app.get("/api/port-change/seen", async (req: any, res) => {
    setPortsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) return res.status(401).json({ message: "invalid token" });
    const phone = pcNormFull((req.query as any).phone);
    const { rows } = await pool.query(`SELECT request_id FROM port_change_requests WHERE phone_number = $1`, [phone]);
    res.json({ requestIds: rows.map((r: any) => r.request_id) });
  });

  // POST /api/port-change/ingest — يسجّل نتيجة طلب تغيير بورت (مرة واحدة لكل Request ID)؛
  // ولو COMPLETED يحدّث بيان البورت (frame/msan/port_type) للرقم.
  app.options("/api/port-change/ingest", (_req, res) => { setPortsCors(res); res.sendStatus(204); });
  app.post("/api/port-change/ingest", async (req: any, res) => {
    setPortsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) return res.status(401).json({ message: "invalid token" });
    const b = req.body || {};
    const requestId = String(b.requestId || "").trim();
    if (!requestId) return res.status(400).json({ message: "requestId مطلوب" });
    const phone = pcNormFull(b.phone);
    const status = String(b.status || "").trim().toUpperCase();
    const completed = status === "COMPLETED";
    // تنظيف دفاعى: أحياناً بيوصل اسم الحقل ملزوق بالقيمة («New Frame 131») حسب شكل
    // صفحة البوابة. بنشيل البادئة دى هنا كمان — عشان القيمة المخزّنة تفضل نضيفة حتى لو
    // السكربت قديم على جهاز المستخدم.
    const stripLbl = (v: any, labels: string[]) => {
      let out = String(v || "").trim();
      for (const l of labels) {
        const esc = l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
        out = out.replace(new RegExp("^\\s*" + esc + "\\s*[:\u061B-]?\\s*", "i"), "").trim();
      }
      return out;
    };
    const newFrame = stripLbl(b.newFrame, ["New Frame No", "New Frame Number", "New Frame", "NewFrame", "New Port", "Frame"]);
    const newMsan = stripLbl(b.newMsan, ["New Msan Code", "New MsanCode", "New MSAN", "New Msan", "Msan Code", "Msan"]);
    const oldMsan = String(b.oldMsan || "").trim();
    const portType = String(b.portType || "").trim();
    const reservationCode = String(b.reservationCode || "").trim();
    const requestDate = String(b.requestDate || "").trim();

    // مين طلب العملية دى؟ من op_intents (اتسجّلت وقت الضغط على «غيّر البورت»/«تحديث البورت»)
    // — نفس أسلوب القياس ورفع السرعة، لأن السكربت مابيعرفش مين ضغط الزر.
    let reqBy: string | null = null;
    if (phone) {
      try {
        const { rows: oi } = await pool.query(
          `SELECT username FROM op_intents WHERE account = $1 AND op_type IN ('portchange','portcheck')
            ORDER BY created_at DESC LIMIT 1`,
          [String(phone).replace(/^88/, "")]);
        reqBy = oi[0]?.username || null;
      } catch { /* التسجيل إضافى — لو فشل نكمّل عادى */ }
    }
    // كان DO NOTHING — فلو رفعة قديمة خزّنت قيمة غلط مكانش فيه أى طريقة لتصحيحها.
    // دلوقتى بنحدّث القيم عند إعادة الرفع. (xmax = 0 معناها الصف اتضاف دلوقتى مش اتحدّث.)
    const ins = await pool.query(
      `INSERT INTO port_change_requests (request_id, phone_number, old_msan, new_msan, new_frame, port_type, status, reservation_code, request_date, completed, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (request_id) DO UPDATE SET
         requested_by = COALESCE(EXCLUDED.requested_by, port_change_requests.requested_by),
         phone_number = EXCLUDED.phone_number,
         old_msan = COALESCE(NULLIF(EXCLUDED.old_msan,''), port_change_requests.old_msan),
         new_msan = COALESCE(NULLIF(EXCLUDED.new_msan,''), port_change_requests.new_msan),
         new_frame = COALESCE(NULLIF(EXCLUDED.new_frame,''), port_change_requests.new_frame),
         port_type = COALESCE(NULLIF(EXCLUDED.port_type,''), port_change_requests.port_type),
         status = EXCLUDED.status,
         completed = EXCLUDED.completed,
         -- ⚠️ لازم يتحدّث: جهاز التنفيذ بيعرف إن «غيّر البورت» خلص لما
         -- MAX(recorded_at) للرقم يبقى أحدث من وقت سحب المهمة (op-check).
         -- من غير السطر ده، إعادة رفع **نفس** الـ request_id (وده اللى بيحصل
         -- لما البورتال يكون مسجّل الطلب من قبل) كانت بتسيب recorded_at على
         -- وقت أول تسجيل — فالعملية تخلص فعلاً على البورتال والمهمة تفضل
         -- «جارٍ التنفيذ» لحد ما تعلّق وتتلغى بالمهلة.
         recorded_at = now()
       RETURNING (xmax = 0) AS inserted`,
      // ⚠️ reqBy ($11) كانت ناقصة: الاستعلام بيطلب 11 قيمة والكود كان بيبعت 10، فـ pg
      // بيرمى «bind message supplies 10 parameters, but prepared statement requires 11».
      // الرمية دى كانت بتطلع **برّه** أى try/catch (unhandledRejection) فالـ handler
      // مابيردّش على الطلب **أبداً** — الرفع بيعلّق للأبد. ده سبب «اتقرا البورت الجديد
      // بس الرفع علّق»: البورت اتقرا صح (Frame=518) والطلب مات هنا بالظبط.
      [requestId, phone, oldMsan, newMsan, newFrame, portType, status, reservationCode, requestDate, completed, reqBy]);
    const wasNew = ins.rows[0]?.inserted === true;

    let updatedPort = false;
    if (completed && phone) {
      // حدّث بيان البورت للرقم من نتيجة الطلب (frame + msan + port_type). لو مش موجود يُضاف.
      await pool.query(
        `INSERT INTO phone_ports (phone_number, frame, msan_code, port_type, uploaded_at)
         VALUES ($1, NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), now())
         ON CONFLICT (phone_number) DO UPDATE SET
           frame = COALESCE(NULLIF(EXCLUDED.frame,''), phone_ports.frame),
           msan_code = COALESCE(NULLIF(EXCLUDED.msan_code,''), phone_ports.msan_code),
           port_type = COALESCE(NULLIF(EXCLUDED.port_type,''), phone_ports.port_type),
           uploaded_at = now()`,
        [phone, newFrame, newMsan, portType]);
      updatedPort = true;
    }
    // نرجّع اللى اتخزّن فعلاً فى phone_ports — السكربت بيعرضه للمستخدم، فأى اختلاف بين
    // اللى اتبعت واللى اتخزّن يبان فوراً بدل ما نفترض إن التحديث تم.
    let savedFrame = "", savedMsan = "";
    if (phone) {
      const { rows } = await pool.query(
        `SELECT COALESCE(frame,'') AS frame, COALESCE(msan_code,'') AS msan FROM phone_ports WHERE phone_number = $1`, [phone]);
      savedFrame = rows[0]?.frame ?? ""; savedMsan = rows[0]?.msan ?? "";
    }
    res.json({ ok: true, recorded: wasNew, alreadyExisted: !wasNew, completed, updatedPort, savedFrame, savedMsan });
  });

  // GET /api/port-change/list — تقرير متابعة طلبات تغيير البورت (كل المستخدمين المصرّح لهم)
  app.get("/api/port-change/list", requireAuth, async (_req, res) => {
    const { rows } = await pool.query(
      // «مين نفّذ»: requested_by = اللى ضغط الزر (من op_intents)، وexecuted_by = الجهاز
      // اللى سحب المهمة من الطابور ونفّذها فعلاً (اسم المستخدم · المتصفح/النظام · معرّف الجهاز).
      `SELECT p.request_id AS "requestId", p.phone_number AS "phoneNumber", p.old_msan AS "oldMsan",
              p.new_msan AS "newMsan", p.new_frame AS "newFrame", p.port_type AS "portType", p.status,
              p.reservation_code AS "reservationCode", p.request_date AS "requestDate", p.completed,
              p.requested_by AS "requestedBy",
              ej.requested_from AS "requestedFrom",
              ej.executed_by AS "executedBy",
              (ej.done_at AT TIME ZONE 'Africa/Cairo') AS "executedAt",
              (p.recorded_at AT TIME ZONE 'Africa/Cairo') AS "recordedAt"
       FROM port_change_requests p
       LEFT JOIN LATERAL (
         SELECT e.executed_by, e.requested_from, e.done_at
           FROM exec_jobs e
          WHERE e.type IN ('portchange','portcheck')
            AND jsonb_exists(e.accounts, regexp_replace(p.phone_number, '^88', ''))
          ORDER BY e.done_at DESC NULLS LAST, e.id DESC LIMIT 1
       ) ej ON true
       ORDER BY p.recorded_at DESC LIMIT 5000`);
    res.json(rows);
  });

  // ===== إعدادات عامة مشتركة (app_settings) — تثبت على السيرفر لكل المستخدمين لحد ما تتغيّر =====
  // GET قيمة إعداد بمفتاحه (أى مستخدم مسجّل)
  app.get("/api/settings/:key", requireAuth, async (req, res) => {
    const key = String(req.params.key || "").trim();
    if (!key) return res.status(400).json({ message: "key مطلوب" });
    const { rows } = await pool.query(`SELECT value, (updated_at AT TIME ZONE 'Africa/Cairo') AS "updatedAt", updated_by AS "updatedBy" FROM app_settings WHERE key = $1`, [key]);
    res.json(rows[0] || { value: null });
  });
  // PUT حفظ/تحديث قيمة إعداد (غير مسموح لموظفى المبيعات)
  app.put("/api/settings/:key", requireAuth, async (req: any, res) => {
    if (req.user?.role === ROLES.SALES) return res.status(403).json({ message: "غير مسموح" });
    const key = String(req.params.key || "").trim();
    if (!key) return res.status(400).json({ message: "key مطلوب" });
    const value = req.body?.value == null ? "" : String(req.body.value);
    const by = (req.user?.fullName || req.user?.username || "").toString();
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, value, by]);
    res.json({ ok: true });
  });

  app.options("/api/phone-ports/ingest", (_req, res) => { setPortsCors(res); res.sendStatus(204); });
  app.post("/api/phone-ports/ingest", async (req: any, res) => {
    setPortsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) {
      return res.status(401).json({ message: "invalid token" });
    }
    // قراءة مفتاح مرن (case-insensitive، عدة أسماء محتملة)
    const pick = (o: any, ...keys: string[]) => {
      if (!o || typeof o !== "object") return "";
      const lower: Record<string, any> = {};
      for (const k of Object.keys(o)) lower[k.toLowerCase().replace(/[\s_]+/g, "")] = o[k];
      for (const k of keys) { const v = lower[k.toLowerCase().replace(/[\s_]+/g, "")]; if (v != null && String(v).trim() !== "") return String(v).trim(); }
      return "";
    };
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const byPhone = new Map<string, any[]>();
    for (const it of items) {
      const rawPhone = pick(it, "phonenumber", "phone", "phoneno", "msisdn", "رقمالتليفون").replace(/\D/g, "");
      if (!rawPhone) continue;
      const area = pick(it, "areacode", "area", "كودالمنطقة").replace(/\D/g, "").replace(/^0+/, "");
      // نخزّن الرقم الكامل (كود المنطقة بدون صفر + الرقم القصير) ليطابق joins الموقع (pl.full_phone = 88…)
      // Portal بيدّى الرقم القصير + Area Code منفصل، فلو الرقم أقصر من 9 خانات نبنى الكامل.
      const phone = rawPhone.length >= 9 ? rawPhone : ((area || "88") + rawPhone);
      byPhone.set(phone, [
        phone,
        pick(it, "areacode", "area", "كودالمنطقة") || null,
        pick(it, "msancode", "msan", "msancodee") || null,
        pick(it, "frame") || null,
        pick(it, "rowno", "row") || null,
        pick(it, "columnno", "column", "col") || null,
        pick(it, "shelf") || null,
        pick(it, "slot") || null,
        pick(it, "portnumber", "port", "portno") || null,
        pick(it, "porttype") || null,
        pick(it, "voicestatus", "voice") || null,
        pick(it, "datastatus", "data") || null,
        pick(it, "operator", "op") || null,
        pick(it, "onu", "onuname", "onusn", "onuserial", "sn") || null,
      ]);
    }
    const all = Array.from(byPhone.values());
    let affected = 0;
    const COLS = 14;
    const BATCH = 300;
    for (let s = 0; s < all.length; s += BATCH) {
      const chunk = all.slice(s, s + BATCH);
      const ph = chunk.map((_, ci) => {
        const o = ci * COLS;
        return "(" + Array.from({ length: COLS }, (_, k) => `$${o + k + 1}`).join(",") + ")";
      }).join(",");
      const r = await pool.query(
        `INSERT INTO phone_ports
           (phone_number, area_code, msan_code, frame, row_no, column_no, shelf, slot, port_number,
            port_type, voice_status, data_status, operator, onu)
         VALUES ${ph}
         -- ⚠️ القيمة الفاضية ماتمسحش قيمة موجودة: سكربت البورتال مابيرجّعش عمود
         -- Shelf (فاضى فى كل صفوفه)، فكان بيمسح رقم الشيلف اللى جاى من ملف
         -- MSANData_export كل نص ساعة. الجديد بيكسب **بس** لو فيه قيمة فعلاً.
         ON CONFLICT (phone_number) DO UPDATE SET
           area_code = COALESCE(NULLIF(btrim(EXCLUDED.area_code), ''), phone_ports.area_code),
           msan_code = COALESCE(NULLIF(btrim(EXCLUDED.msan_code), ''), phone_ports.msan_code),
           frame = COALESCE(NULLIF(btrim(EXCLUDED.frame), ''), phone_ports.frame),
           row_no = COALESCE(NULLIF(btrim(EXCLUDED.row_no), ''), phone_ports.row_no),
           column_no = COALESCE(NULLIF(btrim(EXCLUDED.column_no), ''), phone_ports.column_no),
           shelf = COALESCE(NULLIF(btrim(EXCLUDED.shelf), ''), phone_ports.shelf),
           slot = COALESCE(NULLIF(btrim(EXCLUDED.slot), ''), phone_ports.slot),
           port_number = COALESCE(NULLIF(btrim(EXCLUDED.port_number), ''), phone_ports.port_number),
           port_type = COALESCE(NULLIF(btrim(EXCLUDED.port_type), ''), phone_ports.port_type),
           voice_status = COALESCE(NULLIF(btrim(EXCLUDED.voice_status), ''), phone_ports.voice_status),
           data_status = COALESCE(NULLIF(btrim(EXCLUDED.data_status), ''), phone_ports.data_status),
           operator = COALESCE(NULLIF(btrim(EXCLUDED.operator), ''), phone_ports.operator),
           onu = COALESCE(NULLIF(btrim(EXCLUDED.onu), ''), phone_ports.onu), uploaded_at = now()`,
        chunk.flat(),
      );
      affected += r.rowCount ?? 0;
    }
    // رجع فى الشيت تانى؟ يبقى مابقاش «مرفوع» — نشيله من جدول الخطوط المرفوعة
    if (all.length) {
      await pool.query(`DELETE FROM removed_phone_ports WHERE phone_number = ANY($1::text[])`,
        [all.map((a) => String(a[0]))]).catch(() => {});
    }
    // «الشيت هو الحقيقة»: أى رقم كان متسجّل على **نفس أكواد المسان** دى ومش موجود فى
    // الدفعة الجديدة يبقى بورته اتشال فعلاً → نمسحه. الحذف محصور فى أكواد المسان اللى
    // فى الدفعة بس، لأن السكربت بيرفع كابينة كابينة — حذف شامل هنا كان هيمسح باقى الكباين.
    let removed = 0;
    const msans = [...new Set(all.map((a) => String(a[2] ?? "").trim()).filter(Boolean))];
    const phones = all.map((a) => String(a[0]));
    if (msans.length && phones.length) {
      // حارس ضد الدفعة الناقصة: لو الدفعة أقل من نص الموجود فى نفس الكباين، فده
      // غالباً تحميل متقطّع (سيشن وقعت/صفحة ماكملتش) مش حقيقة جديدة — الأرشفة
      // ساعتها كانت هتشيل نص المسان. بنأرشف بس لما الدفعة تبان كاملة.
      const { rows: exCnt } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM phone_ports WHERE btrim(COALESCE(msan_code,'')) = ANY($1::text[])`,
        [msans]);
      const existing = exCnt[0]?.c ?? 0;
      if (existing > 20 && phones.length < existing / 2) {
        console.warn(`[ports] الدفعة ${phones.length} من ${existing} فى ${msans.join(", ")} — أقل من النص، تخطّى الأرشفة (تحميل ناقص؟)`);
      } else {
        removed = await archiveRemovedPorts(
          `btrim(COALESCE(msan_code,'')) = ANY($1::text[]) AND phone_number <> ALL($2::text[])`,
          [msans, phones], "portal");
        if (removed) console.log(`[ports] اتأرشف ${removed} رقم مابقاش له بورت فى كباين: ${msans.join(", ")}`);
      }
    }
    res.json({ inserted: affected, total: all.length, removed });
  });

  // إشارة "اكتمال تشغيل تحديث البورتات": السكربت بيرفع من كذا كابينة، فـ uploaded_at بيتغيّر
  // مع كل كابينة — مش كافى لمعرفة إن كل التشغيل خلص. السكربت بيبعت هنا فقط لما يخلص كل الكباين
  // (دخل آخر كابينة والكود خلص)، فنسجّل الوقت ونستخدمه كعلامة "اتحدّثت البورتات النهارده".
  app.options("/api/phone-ports/run-complete", (_req, res) => { setPortsCors(res); res.sendStatus(204); });
  app.post("/api/phone-ports/run-complete", async (req: any, res) => {
    setPortsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) {
      return res.status(401).json({ message: "invalid token" });
    }
    const cabins = Number(req.body?.cabins) || 0;
    const updated = Number(req.body?.updated) || 0;
    await pool.query(
      `INSERT INTO app_state (key, value, updated_at) VALUES ('ports_run_completed_at', now()::text, now())
       ON CONFLICT (key) DO UPDATE SET value = now()::text, updated_at = now()`,
    );
    res.json({ ok: true, cabins, updated });
  });

  // ===== تشغيل تلقائى لتحديث البورتات عبر علامة على السيرفر =====
  // زر «حدّث الملفات اليومية» بيفتح 4 تابات مرة واحدة، فإشارة التشغيل التلقائى (window.name/?sf_ports=1)
  // بتضيع للبورتال (Angular SPA بيمسح الـ param وسط الزحمة). الحل: الزر «يسلّح» علامة هنا، وسكربت
  // البورتال يفحصها أول ما يفتح ويشتغل تلقائياً — مستقلة تماماً عن الـ URL/window.name.
  app.post("/api/ports-auto/arm", requireAuth, async (_req: any, res) => {
    await pool.query(
      `INSERT INTO app_state (key, value, updated_at) VALUES ('ports_auto_armed_at', 'armed', now())
       ON CONFLICT (key) DO UPDATE SET value = 'armed', updated_at = now()`,
    );
    res.json({ ok: true });
  });
  app.options("/api/ports-auto/check", (_req, res) => { setPortsCors(res); res.sendStatus(204); });
  app.get("/api/ports-auto/check", async (req: any, res) => {
    setPortsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) return res.status(401).json({ message: "invalid token" });
    const { rows } = await pool.query(`SELECT value, updated_at FROM app_state WHERE key = 'ports_auto_armed_at'`);
    const armedAt = rows[0]?.updated_at ? new Date(rows[0].updated_at).getTime() : 0;
    const pending = rows[0]?.value === "armed" && armedAt > 0 && (Date.now() - armedAt) < 10 * 60 * 1000;
    // نستهلك العلامة عشان تشتغل مرة واحدة بس (مايفضلش يعيد التشغيل كل ما البورتال يتفتح)
    if (pending) await pool.query(`UPDATE app_state SET value = '' WHERE key = 'ports_auto_armed_at'`);
    res.json({ pending });
  });

  // ===== أولوية تصدير شيت FCC عبر علامة على السيرفر =====
  // زر/مؤقت «حدّث الملفات اليومية» بيسلّح العلامة دى. لو تاب FCC اليومى كان وسط مراجعة بيانات فنية
  // (sf_si_batch مضبوط)، بيشوف العلامة فيصدّر الشيت الأول (أولوية) ثم يكمّل المراجعة بعده.
  app.post("/api/fcc-export/arm", requireAuth, async (_req: any, res) => {
    await pool.query(
      `INSERT INTO app_state (key, value, updated_at) VALUES ('fcc_export_force', 'armed', now())
       ON CONFLICT (key) DO UPDATE SET value = 'armed', updated_at = now()`,
    );
    res.json({ ok: true });
  });
  app.options("/api/fcc-export/check", (_req, res) => { setPortsCors(res); res.sendStatus(204); });
  app.get("/api/fcc-export/check", async (req: any, res) => {
    setPortsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) return res.status(401).json({ message: "invalid token" });
    const { rows } = await pool.query(`SELECT value, updated_at FROM app_state WHERE key = 'fcc_export_force'`);
    const armedAt = rows[0]?.updated_at ? new Date(rows[0].updated_at).getTime() : 0;
    const force = rows[0]?.value === "armed" && armedAt > 0 && (Date.now() - armedAt) < 8 * 60 * 1000;
    if (force) await pool.query(`UPDATE app_state SET value = '' WHERE key = 'fcc_export_force'`);
    res.json({ force });
  });

  // ===== تكامل: تقرير «مسافات التخاطي والتعارض — لم يتم الإصلاح بعد» من نظام صيانة البوكسات =====
  // وسيط server-to-server: بيجيب الـ JSON من المشروع التاني (maintenance-we) ويضيف توكن التكامل
  // (مخبّى فى env؛ القيمة الافتراضية هى المتفق عليها). كده التوكن مايظهرش للمتصفح ومفيش مشكلة CORS.
  // موقع الصيانة المدمج (نفس السيرفر تحت /maintenance) بدل الـ Repl القديم المقفول.
  const BOX_OVERLAP_URL = process.env.BOX_MAINT_URL
    || `http://127.0.0.1:${process.env.PORT || 5000}/maintenance/api/integration/overlap-distance-pending`;
  const BOX_OVERLAP_TOKEN = process.env.BOX_MAINT_TOKEN || "sf-integration-2026-GHNAT-overlap-Qz7m";
  app.get("/api/reports/box-overlap", requireAuth, async (req: any, res) => {
    try {
      const qs = new URLSearchParams();
      for (const k of ["from", "to", "box", "cabin", "central"]) {
        const v = (req.query as any)[k];
        if (v != null && String(v).trim() !== "") qs.append(k, String(v).trim());
      }
      const url = BOX_OVERLAP_URL + (qs.toString() ? "?" + qs.toString() : "");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      let r: any;
      try {
        r = await fetch(url, { headers: { "X-Integration-Token": BOX_OVERLAP_TOKEN }, signal: ctrl.signal });
      } finally { clearTimeout(timer); }
      if (!r.ok) {
        let detail = ""; try { detail = (await r.text()).slice(0, 200); } catch {}
        return res.status(502).json({ message: "تعذّر جلب التقرير من نظام صيانة البوكسات", status: r.status, detail });
      }
      const data = await r.json();

      // إثراء كل صف بعدد الأعطال فى الألف ونسبة التكرار للبكس خلال الفترة (من بيانات Service-Flow)
      // الفترة: from/to (الافتراضى من أول السنة لليوم — يُضبط من الواجهة).
      const nowY = new Date().getFullYear();
      const from = String((req.query as any).from || "").trim() || `${nowY}-01-01`;
      const to = String((req.query as any).to || "").trim() || new Date().toISOString().slice(0, 10);
      try {
        const { rows: mrows } = await pool.query(
          `WITH fu AS (
             SELECT phone_number, complain_no FROM complaint_details
               WHERE (complain_time AT TIME ZONE 'Africa/Cairo')::date >= $1::date
                 AND (complain_time AT TIME ZONE 'Africa/Cairo')::date <= $2::date
             UNION
             SELECT phone_number, complain_no FROM remaining_complaints
               WHERE (complain_time AT TIME ZONE 'Africa/Cairo')::date >= $1::date
                 AND (complain_time AT TIME ZONE 'Africa/Cairo')::date <= $2::date
           ),
           perline AS (
             SELECT pl.central, pl.cabin_number, pl.box_number, pl.tel_no,
                    COUNT(DISTINCT fu.complain_no) AS cnt
             FROM phone_lines pl
             LEFT JOIN fu ON ${sp("fu.phone_number")} = pl.tel_no
             WHERE COALESCE(pl.box_number, '') <> ''
             GROUP BY pl.central, pl.cabin_number, pl.box_number, pl.tel_no
           )
           SELECT central, cabin_number AS "cabin", box_number AS "box",
                  COUNT(*)::int AS "lines",
                  SUM(cnt)::int AS "faults",
                  COUNT(*) FILTER (WHERE cnt >= 1)::int AS "faultLines",
                  COUNT(*) FILTER (WHERE cnt >= 2)::int AS "repeatLines"
           FROM perline
           GROUP BY central, cabin_number, box_number`,
          [from, to],
        );
        const key = (c: any, cab: any, b: any) => normCentral(c) + "|" + String(cab ?? "").trim() + "|" + String(b ?? "").trim();
        const metrics = new Map<string, any>();
        for (const m of mrows) metrics.set(key(m.central, m.cabin, m.box), m);
        for (const row of (data.rows || [])) {
          const m = metrics.get(key(row.central, row.cabin, row.box));
          const lines = m?.lines || 0, faults = m?.faults || 0, faultLines = m?.faultLines || 0, repeatLines = m?.repeatLines || 0;
          row.faultsPerThousand = lines > 0 ? Math.round((faults / lines) * 1000 * 10) / 10 : null;
          row.repetitionRate = faultLines > 0 ? Math.round((repeatLines / faultLines) * 100 * 10) / 10 : null;
        }
      } catch (mErr) { /* لو فشل الإثراء نرجّع الصفوف بدون المقاييس */ }

      res.json(data);
    } catch (e: any) {
      res.status(502).json({ message: "تعذّر الاتصال بنظام صيانة البوكسات", error: e?.message || String(e) });
    }
  });

  // ===== إثراء أرقام البورتات باسم/عنوان العميل من FCC Complains (سكربت تامبر منكى، token + CORS) =====
  // قائمة الأرقام المطلوب جلبها: أرقام البورتات اللى ملهاش صف فى line_subscriber_info (ملهاش اسم/عنوان بعد).
  app.options("/api/line-subscriber-info/pending", (_req, res) => { setPortsCors(res); res.sendStatus(204); });
  app.get("/api/line-subscriber-info/pending", async (req: any, res) => {
    setPortsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) return res.status(401).json({ message: "invalid token" });
    const q = req.query as any;
    const limit = Math.min(Number(q.limit) || 5000, 20000);
    // فلتر اختيارى (سنترال/كابينة/بكس) — كل تاب مراجعة يبعت فلتره فيجيب أرقامه بس (مراجعات متوازية).
    const params: any[] = [limit];
    const conds: string[] = [
      "si.phone_number IS NULL",
      "regexp_replace(pp.phone_number, '[^0-9]', '', 'g') ~ '^0*88[0-9]{7}$'",
    ];
    let plJoin = "";
    if (q.central || q.cabin || q.box) {
      plJoin = "LEFT JOIN phone_lines pl ON pl.full_phone = pp.phone_number";
      if (q.central) { params.push(String(q.central)); conds.push(`pl.central = $${params.length}`); }
      if (q.cabin) { params.push(String(q.cabin)); conds.push(`pl.cabin_number = $${params.length}`); }
      if (q.box) { params.push(String(q.box)); conds.push(`pl.box_number = $${params.length}`); }
    }
    // نطاق «من رقم / إلى رقم» — على الرقم القصير الرقمى (CASE عشان الكاست ميقعش بـ error).
    const digitsOnly = (s: any) => String(s || "").replace(/\D/g, "").replace(/^88/, "");
    let pFrom = digitsOnly(q.phoneFrom), pTo = digitsOnly(q.phoneTo);
    if (pFrom && pTo && BigInt(pFrom) > BigInt(pTo)) { const t = pFrom; pFrom = pTo; pTo = t; }
    if (pFrom || pTo) {
      const shortExpr = `regexp_replace(regexp_replace(pp.phone_number,'[^0-9]','','g'),'^0*88','')`;
      const numExpr = `(CASE WHEN ${shortExpr} ~ '^[0-9]{1,18}$' THEN ${shortExpr}::bigint END)`;
      if (pFrom) { params.push(pFrom); conds.push(`${numExpr} >= $${params.length}::bigint`); }
      if (pTo) { params.push(pTo); conds.push(`${numExpr} <= $${params.length}::bigint`); }
    }
    // المصدر = اتحاد أرقام البورتات + أرقام البيان الفنى (phone_lines). قبل كده كان أرقام
    // البورتات بس، فالأرقام اللى ليها بيان فنى 131 ومالهاش بورت/فريم (تقرير «بيان فنى بدون
    // بورت») ماكانتش بتدخل قائمة الجلب أبداً → اسم/عنوان فاضى دايماً. دلوقتى بتتجلب زى غيرها.
    const { rows } = await pool.query(
      `SELECT pp.phone_number FROM (
         ${PORTS_LOCAL_PHONES_SQL}
         UNION
         SELECT full_phone AS phone_number FROM phone_lines
       ) pp
       LEFT JOIN line_subscriber_info si ON si.phone_number = pp.phone_number
       ${plJoin}
       WHERE ${conds.join(" AND ")}
       ORDER BY pp.phone_number
       LIMIT $1`,
      params,
    );
    res.json({ phones: rows.map((r: any) => r.phone_number) });
  });

  // استقبال بيانات الاسم/العنوان المجلوبة (upsert). نسجّل الصف حتى لو الاسم/العنوان فاضى (عشان مانعيدش جلبه).
  app.options("/api/line-subscriber-info/ingest", (_req, res) => { setPortsCors(res); res.sendStatus(204); });
  app.post("/api/line-subscriber-info/ingest", async (req: any, res) => {
    setPortsCors(res);
    if (req.headers["x-dzs-token"] !== DZS_INGEST_TOKEN) return res.status(401).json({ message: "invalid token" });
    const b = req.body || {};
    const phone = String(b.phoneNumber ?? "").trim();
    if (!phone) return res.status(400).json({ message: "phoneNumber مطلوب" });
    const clean = (v: any) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
    // اسم/عنوان + بيانات فنية (من FCC Complains) — الأعمدة والقيم بالترتيب
    const map: [string, any][] = [
      ["sub_name", b.subName], ["sub_add", b.subAdd], ["work_ord_date", b.workOrdDate], ["work_ord_no", b.workOrdNo],
      ["central", b.central], ["cabin_number", b.cabinNumber], ["box_number", b.boxNumber], ["dp_terminal", b.dpTerminal],
      ["port_no", b.portNo], ["idu_no", b.iduNo], ["odu_no", b.oduNo], ["primary_block", b.primaryBlock],
      ["sec_block", b.secBlock], ["cabinet_in", b.cabinetIn], ["cabinet_out", b.cabinetOut], ["fiber_block", b.fiberBlock],
      ["fiber_out", b.fiberOut], ["line_type", b.lineType],
    ];
    const cols = map.map((m) => m[0]);
    const params = [phone, ...map.map((m) => clean(m[1]))];
    const placeholders = params.map((_, i) => `$${i + 1}`).join(",");
    const updateSet = cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
    await pool.query(
      `INSERT INTO line_subscriber_info (phone_number, ${cols.join(", ")}, fetched_at)
       VALUES (${placeholders}, now())
       ON CONFLICT (phone_number) DO UPDATE SET ${updateSet}, fetched_at = now()`,
      params,
    );

    // بيان التليفونات: يستبدل الرقم كامل لو موجود، ويُضاف لو مش موجود — لو عنده بيانات فنية (سنترال).
    const short = phone.replace(/\D/g, "").replace(/^0*88/, "");
    const full = short ? ("88" + short) : phone;
    const central = clean(b.central);
    if (central && short) {
      await pool.query(
        // ملاحظة: مابنخزّنش Port بتاع FCC فى phone_lines — لأن عمود "Port" فى بيان التليفونات
        // بيعرض الفريم من البورتات (COALESCE(pp.frame, pl.port))، فمش عايزين نلوّثه. (Port موجود فى line_subscriber_info)
        `INSERT INTO phone_lines (tel_no, full_phone, central, cabin_number, box_number, dp_terminal,
            idu_no, odu_no, primary_block_no, cabinet_in, sec_block_no, cabinet_out, fiber_block, fiber_out)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (full_phone) DO UPDATE SET
            -- COALESCE فى كل الأعمدة: صفحة FCC ناقصة (فورم مختلف/تحميل جزئى) كانت
            -- بتكتب NULL فوق البيان الفنى المستورد من شيت 131 — فالخط يقع من فلاتر
            -- الكابينة/البكس ومتوسطات البكس. القيمة الجديدة بتكسب بس لو موجودة فعلاً.
            central = COALESCE(EXCLUDED.central, phone_lines.central),
            cabin_number = COALESCE(EXCLUDED.cabin_number, phone_lines.cabin_number),
            box_number = COALESCE(EXCLUDED.box_number, phone_lines.box_number),
            dp_terminal = COALESCE(EXCLUDED.dp_terminal, phone_lines.dp_terminal),
            idu_no = COALESCE(EXCLUDED.idu_no, phone_lines.idu_no),
            odu_no = COALESCE(EXCLUDED.odu_no, phone_lines.odu_no),
            primary_block_no = COALESCE(EXCLUDED.primary_block_no, phone_lines.primary_block_no),
            cabinet_in = COALESCE(EXCLUDED.cabinet_in, phone_lines.cabinet_in),
            sec_block_no = COALESCE(EXCLUDED.sec_block_no, phone_lines.sec_block_no),
            cabinet_out = COALESCE(EXCLUDED.cabinet_out, phone_lines.cabinet_out),
            fiber_block = COALESCE(EXCLUDED.fiber_block, phone_lines.fiber_block),
            fiber_out = COALESCE(EXCLUDED.fiber_out, phone_lines.fiber_out)`,
        [short, full, central, clean(b.cabinNumber), clean(b.boxNumber), clean(b.dpTerminal),
         clean(b.iduNo), clean(b.oduNo), clean(b.primaryBlock), clean(b.cabinetIn), clean(b.secBlock),
         clean(b.cabinetOut), clean(b.fiberBlock), clean(b.fiberOut)],
      );
    }
    res.json({ ok: true });
  });

  // تقرير: بيانات الاسم/العنوان + بيانات البورتات لكل رقم (للعرض فى تاب الخطوط والبكسيات)
  app.get("/api/line-subscriber-info", requireAuth, async (req, res) => {
    const q = String((req.query as Record<string, string>).q || "").trim().toLowerCase();
    const params: any[] = [];
    let where = "";
    if (q) { params.push(arQ(q)); where = `WHERE ${n("si.phone_number || ' ' || COALESCE(si.sub_name,'') || ' ' || COALESCE(si.sub_add,'') || ' ' || COALESCE(pp.msan_code,'') || ' ' || COALESCE(pp.frame,'')")} LIKE $1`; }
    const { rows } = await pool.query(
      `SELECT si.phone_number AS "phoneNumber", si.sub_name AS "subName", si.sub_add AS "subAdd",
              substring(si.work_ord_date from '[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}') AS "workOrdDate",
              si.work_ord_no AS "workOrdNo",
              COALESCE(si.central, pl.central) AS "central",
              (si.fetched_at AT TIME ZONE 'Africa/Cairo') AS "fetchedAt",
              pp.area_code AS "areaCode", pp.msan_code AS "msanCode", pp.frame AS "frame",
              pp.port_number AS "portNumber", pp.port_type AS "portType",
              pp.voice_status AS "voiceStatus", pp.data_status AS "dataStatus", pp.operator AS "operator"
       FROM line_subscriber_info si
       LEFT JOIN phone_ports pp ON pp.phone_number = si.phone_number
       LEFT JOIN phone_lines pl ON pl.full_phone = si.phone_number
       ${where}
       ORDER BY si.fetched_at DESC
       LIMIT 20000`,
      params,
    );
    res.json(rows);
  });

  // تقرير: الأرقام اللى ليها بورتات وحالتها الصوت=ALL_SUSPEND والداتا=FREE (بغضّ النظر عن وجود الاسم/العنوان)
  // مع فلتر باسم السنترال. السنترال بييجى من line_subscriber_info (لو اتراجع) أو من phone_lines.
  app.get("/api/reports/ports-suspend-free", requireAuth, async (req, res) => {
    const central = String((req.query as Record<string, string>).central || "").trim();
    const q = String((req.query as Record<string, string>).q || "").trim().toLowerCase();
    const params: any[] = [];
    const conds: string[] = [`pp.voice_status = 'ALL_SUSPEND'`, `pp.data_status = 'FREE'`];
    if (central) { params.push(arQ(central)); conds.push(`${n("COALESCE(si.central, pl.central)")} LIKE $${params.length}`); }
    if (q) { params.push(arQ(q)); conds.push(`${n("pp.phone_number || ' ' || COALESCE(si.sub_name,'') || ' ' || COALESCE(si.sub_add,'') || ' ' || COALESCE(pp.msan_code,'') || ' ' || COALESCE(pp.frame,'')")} LIKE $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT pp.phone_number AS "phoneNumber", si.sub_name AS "subName", si.sub_add AS "subAdd",
              substring(si.work_ord_date from '[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}') AS "workOrdDate",
              si.work_ord_no AS "workOrdNo",
              COALESCE(si.central, pl.central) AS "central",
              pp.area_code AS "areaCode", pp.msan_code AS "msanCode", pp.frame AS "frame",
              pp.port_number AS "portNumber", pp.port_type AS "portType",
              pp.voice_status AS "voiceStatus", pp.data_status AS "dataStatus", pp.operator AS "operator"
       FROM phone_ports pp
       LEFT JOIN line_subscriber_info si ON si.phone_number = pp.phone_number
       LEFT JOIN phone_lines pl ON pl.full_phone = pp.phone_number
       WHERE ${conds.join(" AND ")}
       ORDER BY COALESCE(si.central, pl.central) NULLS LAST, pp.phone_number
       LIMIT 20000`,
      params,
    );
    res.json(rows);
  });

  // "مراجعة الاسم والعنوان": إعادة جلب — نمسح الصفوف عشان الأرقام ترجع للقائمة المطلوبة.
  //   scope=empty → الأرقام بدون اسم (يعاد جلبها فقط). scope=all → كل الأرقام (يعاد جلب الكل).
  app.post("/api/line-subscriber-info/requeue", requireAuth, requireAdmin, async (req: any, res) => {
    const scope = String(req.body?.scope || "empty");
    // فلتر اختيارى بالسنترال/الكابينة/البكس (من بيان التليفونات) — يقصر المراجعة على الأرقام المفلترة فقط.
    const b = req.body || {};
    const params: any[] = [];
    const fconds: string[] = [];
    if (b.central) { params.push(String(b.central)); fconds.push(`pl.central = $${params.length}`); }
    if (b.cabin) { params.push(String(b.cabin)); fconds.push(`pl.cabin_number = $${params.length}`); }
    if (b.box) { params.push(String(b.box)); fconds.push(`pl.box_number = $${params.length}`); }
    const filterClause = fconds.length
      ? `phone_number IN (SELECT full_phone FROM phone_lines pl WHERE ${fconds.join(" AND ")})`
      : "TRUE";
    const scopeClause = scope === "all" ? "TRUE" : "(sub_name IS NULL OR TRIM(sub_name) = '')";
    // نطاق «من رقم / إلى رقم» — على الرقم القصير (بدون أصفار بادئة و88). الترتيب ملوش أهمية.
    const digitsOnly = (s: any) => String(s || "").replace(/\D/g, "").replace(/^88/, "");
    let pFrom = digitsOnly(b.phoneFrom), pTo = digitsOnly(b.phoneTo);
    if (pFrom && pTo && BigInt(pFrom) > BigInt(pTo)) { const t = pFrom; pFrom = pTo; pTo = t; }
    const shortExpr = `regexp_replace(regexp_replace(phone_number,'[^0-9]','','g'),'^0*88','')`;
    const numExpr = `(CASE WHEN ${shortExpr} ~ '^[0-9]{1,18}$' THEN ${shortExpr}::bigint END)`;
    let rangeClause = "TRUE";
    if (pFrom || pTo) {
      const rc: string[] = [];
      if (pFrom) { params.push(pFrom); rc.push(`${numExpr} >= $${params.length}::bigint`); }
      if (pTo) { params.push(pTo); rc.push(`${numExpr} <= $${params.length}::bigint`); }
      rangeClause = rc.join(" AND ");
    }
    // قائمة الأرقام اللى محتاجة مراجعة فعلياً — نفس مصدر /pending (بورتات + بيان فنى) عشان
    // الزر يقدر يبعتها لطابور التنفيذ (subinfo لكل رقم) بدل ما يفتح FCC على متصفح المستخدم
    // الحالى مباشرة (اللى كان بيقفل لو المتصفح ده مش جهاز التنفيذ ومالوش وصول لـ FCC).
    const uParams: any[] = [];
    const uConds: string[] = [scope === "all" ? "TRUE" : "(si.phone_number IS NULL OR TRIM(si.sub_name) = '')"];
    if (b.central) { uParams.push(String(b.central)); uConds.push(`pl.central = $${uParams.length}`); }
    if (b.cabin) { uParams.push(String(b.cabin)); uConds.push(`pl.cabin_number = $${uParams.length}`); }
    if (b.box) { uParams.push(String(b.box)); uConds.push(`pl.box_number = $${uParams.length}`); }
    if (pFrom || pTo) {
      const uShort = `regexp_replace(regexp_replace(pp.phone_number,'[^0-9]','','g'),'^0*88','')`;
      const uNum = `(CASE WHEN ${uShort} ~ '^[0-9]{1,18}$' THEN ${uShort}::bigint END)`;
      if (pFrom) { uParams.push(pFrom); uConds.push(`${uNum} >= $${uParams.length}::bigint`); }
      if (pTo) { uParams.push(pTo); uConds.push(`${uNum} <= $${uParams.length}::bigint`); }
    }
    const { rows: phoneRows } = await pool.query(
      `SELECT pp.phone_number FROM (
         ${PORTS_LOCAL_PHONES_SQL}
         UNION
         SELECT full_phone AS phone_number FROM phone_lines
       ) pp
       LEFT JOIN line_subscriber_info si ON si.phone_number = pp.phone_number
       LEFT JOIN phone_lines pl ON pl.full_phone = pp.phone_number
       WHERE ${uConds.join(" AND ")}
       ORDER BY pp.phone_number
       LIMIT 20000`,
      uParams);
    // بنمسح بيانات الأرقام المفلترة (حسب النطاق) فتبقى «ناقصة» — لازم برضه لمسار «auto» الاحتياطى
    // (لما مفيش جهاز تنفيذ، سوبر أدمن بيفتح FCC محلياً وسكربته بيعتمد على /pending اللى بتشترط
    // مافيش صف خالص لا وجود ناقص).
    const r = await pool.query(`DELETE FROM line_subscriber_info WHERE ${filterClause} AND ${scopeClause} AND ${rangeClause}`, params);
    res.json({
      ok: true, requeued: r.rowCount ?? 0, scope, filtered: fconds.length > 0,
      phones: phoneRows.map((x: any) => x.phone_number),
    });
  });

  // ===== استقبال أرقام الأكونت من سكربت Customer360 (token-based, CORS) =====
  // التوكن: env C360_INGEST_TOKEN (وله قيمة افتراضية) — لازم يطابق التوكن فى سكربت التامبر منكى.
  const C360_INGEST_TOKEN = process.env.C360_INGEST_TOKEN || "sf-c360-account-ingest-2026";
  const setC360Cors = (res: any) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-C360-Token");
  };
  app.options("/api/line-accounts/ingest", (_req, res) => { setC360Cors(res); res.sendStatus(204); });
  // body: { items: [{ fullPhone, accountNo }] } — يحفظ الأكونت ويسجّل تعديل بمصدر customer360
  app.post("/api/line-accounts/ingest", async (req: any, res) => {
    setC360Cors(res);
    if (req.headers["x-c360-token"] !== C360_INGEST_TOKEN) {
      return res.status(401).json({ message: "invalid token" });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    // العناصر اللى رجّع لها Customer360 "غير موجود" (notExist) → نعلّمها "بدون رقم أكونت"
    // (نفس منطق الدايرة الحمراء فى تقرير خطوط بدون رقم أكونت — تختفى من التقرير)
    const noAccount = items
      .filter((e: any) => e?.notExist === true || String(e?.status || "").includes("غير موجود"))
      .map((e: any) => String(e?.fullPhone || "").trim())
      .filter(Boolean);
    const clean = items
      .map((e: any) => ({ fullPhone: String(e?.fullPhone || "").trim(), accountNo: String(e?.accountNo || "").trim() }))
      .filter((e: any) => e.fullPhone && e.accountNo);
    if (!clean.length && !noAccount.length) return res.json({ saved: 0, markedNoAccount: 0 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let markedNoAccount = 0;
      let clearedAccounts = 0;
      for (const fullPhone of [...new Set(noAccount)]) {
        const r = await client.query(
          `INSERT INTO lines_no_account (full_phone, marked_by_name)
           VALUES ($1, 'customer360')
           ON CONFLICT (full_phone) DO NOTHING`,
          [fullPhone],
        );
        markedNoAccount += r.rowCount ?? 0;

        // Customer360 قال «Subscriber information is not exist» ⇒ الخط ملوش أكونت
        // حالياً، فأى رقم أكونت متسجّل عليه بقى قديم/غلط ولازم يتشال — ده اللى بيحلّ
        // الأكونتات المكررة (رقم أكونت واحد متسجّل على خطين والخط ده مابقاش صاحبه).
        const { rows: had } = await client.query(
          `SELECT account_no FROM line_accounts WHERE full_phone = $1`, [fullPhone]);
        if (had.length) {
          await client.query(`DELETE FROM line_accounts WHERE full_phone = $1`, [fullPhone]);
          clearedAccounts++;
          // سجل التعديل عشان يظهر فى تقرير «تعديلات الأكونت» (الجديد = فاضى يعنى اتشال)
          await client.query(
            `INSERT INTO line_account_edits (full_phone, old_account_no, new_account_no, edited_by_name)
             VALUES ($1, $2, '', 'customer360 (غير موجود)')`,
            [fullPhone, had[0].account_no ?? null]);
        }
      }
      let saved = 0;
      for (const e of clean) {
        const { rows: existing } = await client.query(
          `SELECT account_no FROM line_accounts WHERE full_phone = $1`,
          [e.fullPhone],
        );
        const oldNo: string | null = existing[0]?.account_no ?? null;
        if (oldNo === e.accountNo) continue; // لا تغيير — تجاهل
        await client.query(
          `INSERT INTO line_accounts (full_phone, account_no, source, updated_by_name, updated_at)
           VALUES ($1, $2, 'customer360', 'customer360', now())
           ON CONFLICT (full_phone) DO UPDATE
             SET account_no = EXCLUDED.account_no,
                 source = 'customer360',
                 updated_by_name = 'customer360',
                 updated_at = now()`,
          [e.fullPhone, e.accountNo],
        );
        // مين طلب الجلب ده؟ من op_intents (اتسجّلت وقت الضغط على زر «جلب الأكونت») — بيظهر
        // فى تقرير «تعديلات الأكونت» زى «مين قاس/مين رفع السرعة».
        let by = "customer360";
        try {
          const { rows: oi } = await client.query(
            `SELECT username FROM op_intents WHERE account = $1 AND op_type = 'c360'
              ORDER BY created_at DESC LIMIT 1`, [e.fullPhone]);
          if (oi[0]?.username) by = `customer360 — ${oi[0].username}`;
        } catch { /* التسجيل إضافى — لو فشل نكمّل عادى */ }
        await client.query(
          `INSERT INTO line_account_edits (full_phone, old_account_no, new_account_no, edited_by_name)
           VALUES ($1, $2, $3, $4)`,
          [e.fullPhone, oldNo, e.accountNo, by],
        );
        saved++;
      }
      await client.query("COMMIT");
      res.json({ saved, markedNoAccount, clearedAccounts });
    } catch (err: any) {
      await client.query("ROLLBACK");
      res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  // POST /api/phone-lines/import — ملف 131 (شيتات نحاسي + فيبر) → upsert على phone_lines
  // بالـ full_phone (88+الرقم القصير). يخزّن الصف كامل فى raw_data (القاعدة #10). يقبل توكن الرفع.
  app.options("/api/phone-lines/import", (_req, res) => { setUploadCors(res); res.sendStatus(204); });
  app.post("/api/phone-lines/import", requireAdminOrToken, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      let upserted = 0, total = 0;
      const sheetsSeen: string[] = [];
      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name]; if (!ws) continue;
        const rows: any[][] = sheetRows(ws);
        const { find, headerRowIdx, dataRows } = smartSheet(rows, ["tel no", "رقم التليفون", "السنترال"]);
        const iTel = find("tel no", "رقم التليفون", "رقم التلفون", "telno");
        const iCentral = find("السنترال", "central");
        if (iTel < 0 || iCentral < 0) continue;   // مش شيت خطوط (زى «دوائر المعلومات» بلا Tel No)
        sheetsSeen.push(name);
        const iCabin  = find("cabinet no", "رقم الكابينة", "رقم الكابينه");
        const iBox    = find("dp no", "box number");
        const iDpT    = find("dp terminal");
        const iPrim   = find("primary block");
        const iCabIn  = find("cabinet in");
        const iSec    = find("sec block");
        const iCabOut = find("cabinet out");
        const iIdu    = find("idu no");
        const iOdu    = find("odu no");
        const iPort   = find("port");
        const iLen    = find("len");
        const iFibBlk = find("fiber block");
        const iFibOut = find("fiber out");
        const origHeader = (rows[headerRowIdx] || []).map((h: any) => String(h ?? "").trim());
        const g = (r: any[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
        for (const r of dataRows) {
          const short = g(r, iTel).replace(/\D/g, "").replace(/^0*88/, "");
          if (!short) continue;
          const full = "88" + short;
          const rawObj: Record<string, any> = {};
          for (let ci = 0; ci < origHeader.length; ci++) {
            const k = origHeader[ci] || ("col" + ci);
            rawObj[k] = (r[ci] === "" || r[ci] === undefined) ? null : r[ci];
          }
          const nn = (i: number) => g(r, i) || null;
          await pool.query(
            `INSERT INTO phone_lines (tel_no, full_phone, central, cabin_number, box_number, dp_terminal,
                idu_no, odu_no, primary_block_no, cabinet_in, sec_block_no, cabinet_out, port, len, fiber_block, fiber_out, raw_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             ON CONFLICT (full_phone) DO UPDATE SET
                tel_no = EXCLUDED.tel_no, central = COALESCE(EXCLUDED.central, phone_lines.central),
                cabin_number = EXCLUDED.cabin_number, box_number = EXCLUDED.box_number, dp_terminal = EXCLUDED.dp_terminal,
                idu_no = EXCLUDED.idu_no, odu_no = EXCLUDED.odu_no, primary_block_no = EXCLUDED.primary_block_no,
                cabinet_in = EXCLUDED.cabinet_in, sec_block_no = EXCLUDED.sec_block_no, cabinet_out = EXCLUDED.cabinet_out,
                port = COALESCE(EXCLUDED.port, phone_lines.port), len = EXCLUDED.len,
                fiber_block = EXCLUDED.fiber_block, fiber_out = EXCLUDED.fiber_out, raw_data = EXCLUDED.raw_data`,
            [short, full, nn(iCentral), nn(iCabin), nn(iBox), nn(iDpT), nn(iIdu), nn(iOdu), nn(iPrim),
             nn(iCabIn), nn(iSec), nn(iCabOut), nn(iPort), nn(iLen), nn(iFibBlk), nn(iFibOut), JSON.stringify(rawObj)],
          );
          upserted++;
        }
        total += dataRows.length;
      }
      // نسجّل وقت آخر رفع لـ 131 فى app_state (phone_lines مافيهوش uploaded_at) — للعرض بجانب البطاقة
      try {
        await pool.query(
          `INSERT INTO app_state (key, value, updated_at) VALUES ('phone_lines_import_at', now()::text, now())
           ON CONFLICT (key) DO UPDATE SET value = now()::text, updated_at = now()`);
      } catch (e) {}
      res.json({ inserted: upserted, upserted, total, sheets: sheetsSeen });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في استيراد 131" });
    }
  });

  // GET /api/phone-lines/copper-cabinets — أرقام كباين النحاس الحقيقية لسكربت 131
  // المصدر الأساسى: phone_lines نفسها (بيان 131 الموجود) = المصدر الموثوق لأرقام الكباين (زى 1-1، 2-8)،
  // بالإضافة لأى كابينة بصيغة صحيحة من cabinet_technicians. نفلتر على صيغة «رقم-رقم» عشان نستبعد أكواد
  // MSAN الأبجدية (زى "shlter") اللى كانت بتترفع بالغلط فى خانة رقم الكابينة وبتخلى تبويب النحاسى يرجع فاضى.
  app.options("/api/phone-lines/copper-cabinets", (_req, res) => { setUploadCors(res); res.sendStatus(204); });
  app.get("/api/phone-lines/copper-cabinets", requireAdminOrToken, async (_req, res) => {
    setUploadCors(res);
    try {
      // ⚠️ كانت SELECT DISTINCT central, cabin ... ORDER BY (split_part(cabin,'-',1))::int
      // — Postgres بيرفضها بـ 500: "for SELECT DISTINCT, ORDER BY expressions must appear
      // in select list" لأن تعبيرى الترتيب مش فى قائمة SELECT. الرفض ده كان بيفشّل الـ
      // endpoint كله، فسكربت 131 كان بياخد فشل الجلب ويرجع لكابينة "1-1" الافتراضية
      // القديمة (قبل ما نشيلها) — وده أصل مشكلة «كابينة واحدة بس». الحل: DISTINCT فى
      // subquery داخلى من غير ORDER BY، والترتيب فى الطبقة الخارجية اللى مالهاش قيد DISTINCT.
      const { rows } = await pool.query(
        `SELECT central, cabin FROM (
           SELECT DISTINCT central, cabin FROM (
             SELECT central AS central, btrim(cabin_number) AS cabin
               FROM phone_lines
              WHERE btrim(coalesce(cabin_number,'')) ~ '^[0-9]+ *- *[0-9]+$'
             UNION
             SELECT central_name AS central, btrim(cabin_number) AS cabin
               FROM cabinet_technicians
              WHERE btrim(coalesce(cabin_number,'')) ~ '^[0-9]+ *- *[0-9]+$'
           ) u
         ) d
         ORDER BY central,
                  (split_part(cabin,'-',1))::int,
                  (split_part(cabin,'-',2))::int`);
      res.json({ cabinets: rows });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/cabinet-technicians/import — الفنيين بأرقام الكباين (full replace each upload)
  app.post("/api/cabinet-technicians/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = sheetRows(ws);
      const { find, dataRows } = smartSheet(rows, ["رقم الكابينة", "رقم الكابينه", "كود العامل"]);
      const iCentral  = find("اسم السنترال");
      const iCabin    = find("رقم الكابينة", "رقم الكابينه");
      const iWorker   = find("كود العامل", "كود الفنى", "كود الفني");
      const iHaya     = find("حياة كريمة", "حياه كريمه");
      const iRegion   = find("اسم المنطقة", "اسم المنطقه");
      const iActive   = find("الشغال");
      const iFinish   = find("finish");
      const iVillage  = find("كود القريه", "كود القرية");
      const iCabCode  = find("كود الكابينه", "كود الكابينة");
      const iIdu      = find("idu");
      const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

      const inserts: any[][] = [];
      for (const r of dataRows) {
        const central = String(g(r, iCentral)).trim();
        const cabin = String(g(r, iCabin)).trim();
        if (!central && !cabin) continue;
        inserts.push([
          central || null,
          cabin || null,
          String(g(r, iWorker)) || null,
          String(g(r, iHaya)) || null,
          String(g(r, iRegion)) || null,
          String(g(r, iActive)) || null,
          String(g(r, iFinish)) || null,
          String(g(r, iVillage)) || null,
          String(g(r, iCabCode)) || null,
          String(g(r, iIdu)) || null,
        ]);
      }

      // transaction: فشل فى النص كان بيسيب فنيى الكباين ناقصين — وده بيكسر
      // «متعذراتى» وownedByMe وكل نسب الفنيين لحد ما الشيت يترفع تانى.
      const inserted = await withTx(async (tx) => {
      await tx.query("DELETE FROM cabinet_technicians");
      let inserted = 0;
      const BATCH = 200;
      for (let s = 0; s < inserts.length; s += BATCH) {
        const chunk = inserts.slice(s, s + BATCH);
        const ph = chunk.map((_, ci) => {
          const o = ci * 10;
          return "(" + Array.from({ length: 10 }, (_, k) => `$${o+k+1}`).join(",") + ")";
        }).join(",");
        const r = await tx.query(
          `INSERT INTO cabinet_technicians
             (central_name, cabin_number, worker_code, haya_karima, region_name,
              active, central_finish, village_code, cabin_code, idu)
           VALUES ${ph}`,
          chunk.flat(),
        );
        inserted += r.rowCount ?? 0;
      }
      return inserted;
      });
      res.json({ inserted, total: inserts.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // POST /api/cabinet-capacity/import — رفع سعة الكباين من FCC Network Inventory (Copper → Cabinet).
  // أعمدة الملف: ExchCode, ExchName, Cabinet No, Cabinet Type, Primary Capacity, Secondary Capacity.
  // ExchCode يُحوَّل لاسم السنترال عشان يربط بـ cabinet_technicians. full replace كل رفعة.
  const EXCH_TO_CENTRAL: Record<string, string> = {
    GHNAT: "الغنايم",
    DRGAT: "الغنايم-دير الجنادله",
    AMZAT: "الغنايم-العزايزة",
    NGOAT: "الغنايم-نجع العمدة",
  };
  app.post("/api/cabinet-capacity/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = sheetRows(ws);
      const { find, dataRows } = smartSheet(rows, ["Cabinet No", "Secondary Capacity", "ExchCode"]);
      const iExchCode = find("ExchCode", "Exch Code", "كود السنترال");
      const iExchName = find("ExchName", "Exch Name", "اسم السنترال");
      const iCabin    = find("Cabinet No", "Cabinet Number", "رقم الكابينة", "رقم الكابينه");
      const iType     = find("Cabinet Type", "نوع الكابينة", "نوع الكابينه");
      const iPrimary  = find("Primary Capacity", "السعة الرئيسية");
      const iSecond   = find("Secondary Capacity", "السعة الثانوية", "سعة الثانوى");
      const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");
      const num = (v: any) => { const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10); return isNaN(n) ? null : n; };

      const inserts: any[][] = [];
      for (const r of dataRows) {
        const exch = String(g(r, iExchCode)).trim().toUpperCase();
        const cabin = String(g(r, iCabin)).trim();
        if (!exch && !cabin) continue;
        const centralName = EXCH_TO_CENTRAL[exch] || String(g(r, iExchName)).trim() || null;
        inserts.push([
          centralName,
          exch || null,
          String(g(r, iExchName)).trim() || null,
          cabin || null,
          String(g(r, iType)).trim() || null,
          num(g(r, iPrimary)),
          num(g(r, iSecond)),
        ]);
      }

      const inserted = await withTx(async (tx) => {
      await tx.query("DELETE FROM cabinet_capacity");
      let inserted = 0;
      const BATCH = 200;
      for (let s = 0; s < inserts.length; s += BATCH) {
        const chunk = inserts.slice(s, s + BATCH);
        const ph = chunk.map((_, ci) => {
          const o = ci * 7;
          return "(" + Array.from({ length: 7 }, (_, k) => `$${o+k+1}`).join(",") + ")";
        }).join(",");
        const r = await tx.query(
          `INSERT INTO cabinet_capacity
             (central_name, exch_code, exch_name, cabin_number, cabinet_type, primary_capacity, secondary_capacity)
           VALUES ${ph}`,
          chunk.flat(),
        );
        inserted += r.rowCount ?? 0;
      }
      return inserted;
      });
      res.json({ inserted, total: inserts.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // إدخال سعة الكباين من صور FCC مباشرةً (بدل الرفع) — لمرة واحدة، محمى بتوكن. GET/POST.
  const capSeedHandler = async (req: any, res: any) => {
    if ((req.query.token || req.headers["x-import-token"]) !== "cap-seed-2026") {
      return res.status(401).json({ error: "invalid token" });
    }
    try {
      const { seedCabinetCapacity } = await import("./seed-cabinet-capacity");
      const inserted = await seedCabinetCapacity();
      res.json({ ok: true, inserted });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  };
  app.get("/api/cabinet-capacity/_seed", capSeedHandler);
  app.post("/api/cabinet-capacity/_seed", capSeedHandler);

  // GET /api/cabinet-capacity — list with search
  app.get("/api/cabinet-capacity", requireAuth, async (req, res) => {
    const { q } = req.query as Record<string, string>;
    const params: any[] = [];
    let where = "";
    if (q?.trim()) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      where = `WHERE (${n("central_name")} LIKE ${p} OR ${n("exch_code")} LIKE ${p} OR ${n("cabin_number")} LIKE ${p} OR ${n("cabinet_type")} LIKE ${p})`;
    }
    const { rows } = await pool.query(
      `SELECT id, central_name AS "centralName", exch_code AS "exchCode", exch_name AS "exchName",
              cabin_number AS "cabinNumber", cabinet_type AS "cabinetType",
              primary_capacity AS "primaryCapacity", secondary_capacity AS "secondaryCapacity"
       FROM cabinet_capacity ${where}
       ORDER BY central_name, cabin_number
       LIMIT 5000`,
      params,
    );
    res.json(rows);
  });

  // GET /api/cabinet-technicians — list with search
  // GET /api/upload-times — آخر وقت رفع لكل جدول (للعرض بجانب كل بطاقة رفع)
  app.get("/api/upload-times", requireAuth, async (_req, res) => {
    const tables: { key: string; table: string }[] = [
      { key: "/api/maintenance-orders/import",  table: "wfm_current" },
      { key: "/api/ticket-queue/import",        table: "ticket_dsl_current" },
      { key: "/api/ticket-queue-ftth/import",   table: "ticket_ftth_current" },
      { key: "/api/complaint-details/import",   table: "complaint_details" },
      { key: "/api/ftth-orders/import",         table: "ftth_orders" },
      { key: "/api/ftth-orders/import-soy",     table: "ftth_orders_soy" },
      { key: "/api/ftth-subscribers/import",    table: "ftth_subscribers" },
      { key: "/api/case-138/import",            table: "case_138" },
      { key: "/api/phone-ports/import",         table: "phone_ports" },
      { key: "/api/cabinet-technicians/import", table: "cabinet_technicians" },
      { key: "/api/cabinet-capacity/import",    table: "cabinet_capacity" },
      { key: "/api/technician-names/import",    table: "technician_names" },
      { key: "/api/work-orders/import",         table: "work_orders" },
    ];
    const result: Record<string, string | null> = {};
    for (const { key, table } of tables) {
      try {
        const { rows } = await pool.query(`SELECT MAX(uploaded_at) AS t FROM ${table}`);
        result[key] = rows[0]?.t ? (rows[0].t instanceof Date ? rows[0].t.toISOString() : String(rows[0].t)) : null;
      } catch { result[key] = null; }
    }
    // وقت اكتمال آخر تشغيل كامل لتحديث البورتات (من السكربت لما يخلص كل الكباين) — علامة "اتحدّثت النهارده"
    try {
      const { rows } = await pool.query(`SELECT updated_at AS t FROM app_state WHERE key = 'ports_run_completed_at'`);
      result["ports_run_complete"] = rows[0]?.t ? (rows[0].t instanceof Date ? rows[0].t.toISOString() : String(rows[0].t)) : null;
    } catch { result["ports_run_complete"] = null; }
    // آخر رفع لملف 131 (phone_lines) — من app_state
    try {
      const { rows } = await pool.query(`SELECT updated_at AS t FROM app_state WHERE key = 'phone_lines_import_at'`);
      result["/api/phone-lines/import"] = rows[0]?.t ? (rows[0].t instanceof Date ? rows[0].t.toISOString() : String(rows[0].t)) : null;
    } catch { result["/api/phone-lines/import"] = null; }
    // آخر رفع لأوامر الشغل — من app_state (بيتسجّل حتى لو مفيش صفوف جديدة اتضافت).
    // لو أحدث من MAX(uploaded_at) بناخده، وإلا نسيب اللى اتحسب من الجدول (رفعات قديمة).
    try {
      const { rows } = await pool.query(`SELECT updated_at AS t FROM app_state WHERE key = 'work_orders_import_at'`);
      const stamp = rows[0]?.t ? (rows[0].t instanceof Date ? rows[0].t.toISOString() : String(rows[0].t)) : null;
      const prev = result["/api/work-orders/import"];
      if (stamp && (!prev || new Date(stamp) > new Date(prev))) result["/api/work-orders/import"] = stamp;
    } catch {}
    res.json(result);
  });

  app.get("/api/cabinet-technicians", requireAuth, async (req, res) => {
    const { q } = req.query as Record<string, string>;
    const params: any[] = [];
    let where = "";
    if (q?.trim()) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      where = `WHERE (${n("central_name")} LIKE ${p} OR ${n("cabin_number")} LIKE ${p} OR ${n("worker_code")} LIKE ${p} OR ${n("region_name")} LIKE ${p} OR ${n("cabin_code")} LIKE ${p} OR ${n("idu")} LIKE ${p})`;
    }
    const { rows } = await pool.query(
      `SELECT id, central_name AS "centralName", cabin_number AS "cabinNumber",
              worker_code AS "workerCode", haya_karima AS "hayaKarima",
              region_name AS "regionName", active, central_finish AS "centralFinish",
              village_code AS "villageCode", cabin_code AS "cabinCode", idu
       FROM cabinet_technicians ${where}
       ORDER BY central_name, cabin_number
       LIMIT 5000`,
      params,
    );
    res.json(rows);
  });

  // POST /api/technician-names/import — أسماء الفنيين (full replace each upload)
  app.post("/api/technician-names/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = sheetRows(ws);
      const { find, dataRows } = smartSheet(rows, ["Field1", "Field2"]);
      const iName = find("Field1");
      const iCode = find("Field2");
      const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

      const inserts: [string, string][] = [];
      for (const r of dataRows) {
        const workerCode = String(g(r, iCode)).trim();
        const techName   = String(g(r, iName)).trim();
        if (!workerCode || !techName) continue;
        inserts.push([workerCode, techName]);
      }

      const inserted = await withTx(async (tx) => {
      await tx.query("DELETE FROM technician_names");
      let inserted = 0;
      const BATCH = 200;
      for (let s = 0; s < inserts.length; s += BATCH) {
        const chunk = inserts.slice(s, s + BATCH);
        const uidPos = chunk.length * 2 + 1;
        const ph = chunk.map((_, ci) => `($${ci * 2 + 1},$${ci * 2 + 2},$${uidPos})`).join(",");
        const vals: any[] = chunk.flatMap(([code, name]) => [code, name]);
        vals.push(req.user.id);
        const r = await tx.query(
          `INSERT INTO technician_names (worker_code, tech_name, uploaded_by_id) VALUES ${ph}`,
          vals,
        );
        inserted += r.rowCount ?? 0;
      }
      return inserted;
      });
      res.json({ inserted, skipped: inserts.length - inserted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/technician-names — list with search
  app.get("/api/technician-names", requireAuth, async (req, res) => {
    const { q } = req.query as Record<string, string>;
    const params: any[] = [];
    let where = "";
    if (q?.trim()) {
      params.push(arQ(q));
      where = `WHERE (${n("worker_code")} LIKE $1 OR ${n("tech_name")} LIKE $1)`;
    }
    const { rows } = await pool.query(
      `SELECT id, worker_code AS "workerCode", tech_name AS "techName"
       FROM technician_names ${where}
       ORDER BY worker_code
       LIMIT 5000`,
      params,
    );
    res.json(rows);
  });

  // POST /api/phone-ports/import — upsert by phone_number (update existing, insert new)
  app.post("/api/phone-ports/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = sheetRows(ws);
      const { find, dataRows } = smartSheet(rows, ["phone number", "رقم التليفون", "رقم التلفون"]);
      const iPhone = find("phone number", "رقم التليفون", "رقم التلفون");
      const iArea  = find("area code", "كود المنطقة");
      const iMsan  = find("msan code", "msan");
      const iFrame = find("frame");
      const iShelf = find("shelf");
      const iSlot  = find("slot");
      const iPort  = find("port number", "port no");
      const iPortType = find("port type");
      const iVoice = find("voice status");
      const iData  = find("data status");
      const iOper  = find("operator");
      const iOnu   = find("onu", "onu name", "onu sn", "onu serial", "sn");
      const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

      // dedup within file by phone (last occurrence wins)
      // ⚠️ توحيد الرقم بنفس منطق الرفع التلقائى (ingest): الشيت ساعات بيطلع الرقم
      // القصير + كود المنطقة عمود منفصل. لو خزّناه قصير زى ما هو: (1) مايتطابقش مع
      // أى join فى التقارير (pl.full_phone = 88…)، و(2) الأرقام القديمة بصيغة 88
      // «مش موجودة فى الشيت» فتتأرشف كلها — يعنى رفعة شيت واحدة كانت تفضّى البورتات.
      const byPhone = new Map<string, any[]>();
      for (const r of dataRows) {
        const rawPhone = String(g(r, iPhone)).replace(/\D/g, "");
        if (!rawPhone) continue;
        const areaDigits = String(g(r, iArea)).replace(/\D/g, "").replace(/^0+/, "");
        const phone = rawPhone.length >= 9 ? rawPhone : ((areaDigits || "88") + rawPhone);
        byPhone.set(phone, [
          phone,
          String(g(r, iArea)) || null,
          String(g(r, iMsan)) || null,
          String(g(r, iFrame)) || null,
          String(g(r, iShelf)) || null,
          String(g(r, iSlot)) || null,
          String(g(r, iPort)) || null,
          String(g(r, iPortType)) || null,
          String(g(r, iVoice)) || null,
          String(g(r, iData)) || null,
          String(g(r, iOper)) || null,
          String(g(r, iOnu)) || null,
        ]);
      }
      const all = Array.from(byPhone.values());

      let affected = 0;
      const BATCH = 300;
      for (let s = 0; s < all.length; s += BATCH) {
        const chunk = all.slice(s, s + BATCH);
        const ph = chunk.map((_, ci) => {
          const o = ci * 12;
          return "(" + Array.from({ length: 12 }, (_, k) => `$${o+k+1}`).join(",") + ")";
        }).join(",");
        const r = await pool.query(
          `INSERT INTO phone_ports
             (phone_number, area_code, msan_code, frame, shelf, slot, port_number,
              port_type, voice_status, data_status, operator, onu)
           VALUES ${ph}
           -- نفس القاعدة: شيت ناقص عمود مايمسحش القيمة المخزّنة (الشيلف مثلاً)
           ON CONFLICT (phone_number) DO UPDATE SET
             area_code = COALESCE(NULLIF(btrim(EXCLUDED.area_code), ''), phone_ports.area_code),
             msan_code = COALESCE(NULLIF(btrim(EXCLUDED.msan_code), ''), phone_ports.msan_code),
             frame = COALESCE(NULLIF(btrim(EXCLUDED.frame), ''), phone_ports.frame),
             shelf = COALESCE(NULLIF(btrim(EXCLUDED.shelf), ''), phone_ports.shelf),
             slot = COALESCE(NULLIF(btrim(EXCLUDED.slot), ''), phone_ports.slot),
             port_number = COALESCE(NULLIF(btrim(EXCLUDED.port_number), ''), phone_ports.port_number),
             port_type = COALESCE(NULLIF(btrim(EXCLUDED.port_type), ''), phone_ports.port_type),
             voice_status = COALESCE(NULLIF(btrim(EXCLUDED.voice_status), ''), phone_ports.voice_status),
             data_status = COALESCE(NULLIF(btrim(EXCLUDED.data_status), ''), phone_ports.data_status),
             operator = COALESCE(NULLIF(btrim(EXCLUDED.operator), ''), phone_ports.operator),
             onu = COALESCE(NULLIF(btrim(EXCLUDED.onu), ''), phone_ports.onu), uploaded_at = now()`,
          chunk.flat(),
        );
        affected += r.rowCount ?? 0;
      }
      // رجع فى الشيت تانى؟ يبقى مابقاش «مرفوع» — نشيله من جدول الخطوط المرفوعة
      if (all.length) {
        await pool.query(`DELETE FROM removed_phone_ports WHERE phone_number = ANY($1::text[])`,
          [all.map((a) => String(a[0]))]).catch(() => {});
      }
      // «الشيت هو الحقيقة»: أى رقم متسجّل عندنا ومش فى الشيت الجديد يبقى بورته اتشال
      // → نمسحه، وإلا يفضل ظاهر «شغّال» بالغلط فى كل تقارير القياسات.
      // 🛡️ حارس: لو الشيت المرفوع أقل من نص اللى عندنا يبقى غالباً شيت ناقص/جزئى —
      // مانمسحش حاجة ونقول للمستخدم، بدل ما نمسح آلاف الأرقام بالغلط.
      let removed = 0, removeSkipped = false;
      const beforeRes = await pool.query(`SELECT COUNT(*)::int AS c FROM phone_ports`);
      const before = beforeRes.rows[0].c as number;
      const phones = all.map((a) => String(a[0]));
      if (phones.length && before > 0 && phones.length * 2 < before) {
        removeSkipped = true;
        console.warn(`[ports] الشيت فيه ${phones.length} رقم والموجود ${before} — اتخطّيت الحذف (شيت ناقص؟)`);
      } else if (phones.length) {
        removed = await archiveRemovedPorts(`phone_number <> ALL($1::text[])`, [phones], "sheet");
      }
      res.json({
        inserted: affected, total: all.length, removed, removeSkipped,
        message: removeSkipped
          ? `تم تحديث ${all.length} رقم. ⚠️ الشيت فيه ${phones.length} رقم بس والموجود ${before} — ماتأرشفش أى رقم قديم (شيت ناقص؟). ارفع الشيت الكامل لو عايز الأرقام اللى اتشالت تتمسح.`
          : `تم تحديث ${all.length} رقم${removed ? ` واتأرشف ${removed} رقم مابقاش له بورت (جدول الخطوط المرفوعة)` : ""}.`,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // ── تكتات «بوكس معطل»: التشغيل بأثر رجعى على القديم ──────────────────────────
  // بيجمع كل الطلبات والمتعذرات اللى الفنى سجّل فيها «بوكس معطل» وبيحسب لكل واحد:
  // اتفتحله تكت خلاص؟ ولا مغطّى بتكت مفتوحة؟ ولا محتاج تكت جديدة؟
  // الفحص **مايفتحش حاجة** — الفتح بيتم من /run بعد ما تشوف القايمة وتوافق.
  const collectBoxBrokenCandidates = async () => {
    const out: any[] = [];
    const { rows: ord } = await pool.query(
      `SELECT id::text AS "refKey", central_name AS central, cabin_number AS cabinet,
              box_number AS box, tech_name AS "techName",
              (tech_response_at AT TIME ZONE 'Africa/Cairo') AS "respondedAt",
              customer_name AS "customerName", national_id AS "nationalId"
         FROM orders
        WHERE rejection_reason = $1 AND COALESCE(btrim(box_number),'') <> ''
        ORDER BY tech_response_at DESC NULLS LAST`, [REJECTION_REASONS.BOX_BROKEN]);
    for (const r of ord) out.push({ ...r, source: "طلبات", refKey: `طلب #${r.refKey}` });
    const { rows: om } = await pool.query(
      `SELECT serial_number AS "refKey", serial_number AS "serialNumber",
              central_name AS central, cabin_number AS cabinet,
              box_number AS box, tech_name AS "techName",
              (responded_at AT TIME ZONE 'Africa/Cairo') AS "respondedAt"
         FROM om_responses
        WHERE rejection_reason = $1 AND COALESCE(btrim(box_number),'') <> ''
        ORDER BY responded_at DESC NULLS LAST`, [REJECTION_REASONS.BOX_BROKEN]);
    for (const r of om) out.push({ ...r, source: "OM", refKey: `متعذر ${r.refKey}` });
    return out;
  };

  app.get("/api/box-tickets/backfill-preview", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const cands = await collectBoxBrokenCandidates();
      const { rows: done } = await pool.query(`SELECT source, ref_key, ticket_number FROM box_fault_tickets`);
      const doneMap = new Map(done.map((d: any) => [`${d.source}|${d.ref_key}`, d.ticket_number]));
      const data: any[] = [];
      for (const c of cands) {
        const already = doneMap.get(`${c.source}|${c.refKey}`);
        if (already) { data.push({ ...c, action: "done", ticketNumber: already }); continue; }
        const cov = await findCoveringOpenTicket(c.central, c.cabinet, c.box);
        if (cov) { data.push({ ...c, action: "covered", ticketNumber: cov.ticketNumber, coveringBox: cov.box }); continue; }
        // بنتأكد من دلوقتى إن الكابينة موجودة فى برنامج الكوابل — عشان السبب
        // يبان فى المعاينة مش يفضل التكت مش بيتفتح من غير ما حد يعرف ليه.
        const cab = await resolveCable(c.central, c.cabinet);
        data.push(cab
          ? { ...c, action: "will_open" }
          : { ...c, action: "blocked", why: `الكابينة «${c.cabinet}» فى «${c.central}» مش موجودة فى برنامج الكوابل` });
      }
      res.json({
        data,
        counts: {
          total: data.length,
          willOpen: data.filter((d) => d.action === "will_open").length,
          covered: data.filter((d) => d.action === "covered").length,
          done: data.filter((d) => d.action === "done").length,
          blocked: data.filter((d) => d.action === "blocked").length,
        },
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // التنفيذ الفعلى — سوبر أدمن بس، وبيفتح اللى حالته will_open وقت التنفيذ (بيعيد
  // الفحص لكل واحد لحظتها عشان مايفتحش تكت بقت مغطّاة بين المعاينة والتنفيذ).
  app.post("/api/box-tickets/backfill-run", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const cands = await collectBoxBrokenCandidates();
      const { rows: done } = await pool.query(`SELECT source, ref_key FROM box_fault_tickets`);
      const doneSet = new Set(done.map((d: any) => `${d.source}|${d.ref_key}`));
      const opened: any[] = [], skipped: any[] = [], failed: any[] = [];
      for (const c of cands) {
        if (doneSet.has(`${c.source}|${c.refKey}`)) { skipped.push({ ...c, why: "اتفتحت قبل كده" }); continue; }
        const r = await openBoxFaultTicket({
          central: c.central, cabinet: c.cabinet, box: c.box, techName: c.techName || "غير معروف",
          source: c.source === "OM" ? "OM" : "طلبات", respondedAt: c.respondedAt, refKey: c.refKey,
          serialNumber: c.serialNumber, customerName: c.customerName, nationalId: c.nationalId,
        });
        if (r.ok && (r as any).created) opened.push({ ...c, ticketNumber: (r as any).ticketNumber });
        else if (r.ok) skipped.push({ ...c, why: `مغطّى بتكت ${(r as any).ticketNumber}` });
        else failed.push({ ...c, why: (r as any).reason });
      }
      res.json({ opened: opened.length, skipped: skipped.length, failed: failed.length, details: { opened, skipped, failed } });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/box-tickets/repair-confirm — رد الفنى بعد إغلاق التكت:
  //   confirmed = الإصلاح تم فعلاً | rejected = لسه معطّل (بيظهر للشئون الخارجية
  //   والأدمن والسوبر أدمن ومهندس الكوابل ومدير السنترال).
  app.post("/api/box-tickets/repair-confirm", requireAuth, async (req: any, res) => {
    try {
      // نفس أدوار الرد فى الواجهة — كان مفتوح لأى مستخدم مسجّل (حتى المبيعات)،
      // ورفض الإصلاح هو اللى بيشغّل مسار إعادة فتح التكت فلازم يتقيّد.
      const roleRC = req.user?.role;
      if (!([ROLES.TECH, ROLES.EXTERNAL, ROLES.ADMIN, ROLES.SUPER_ADMIN] as string[]).includes(roleRC)) {
        return res.status(403).json({ message: "غير مسموح" });
      }
      const { source, refKey, confirm, note } = req.body || {};
      if (!source || !refKey) return res.status(400).json({ message: "المصدر والمرجع مطلوبين" });
      if (confirm !== "confirmed" && confirm !== "rejected") {
        return res.status(400).json({ message: "الرد لازم يكون confirmed أو rejected" });
      }
      const { rows } = await pool.query(
        `UPDATE box_fault_tickets
            SET repair_confirm = $3, repair_confirm_by = $4,
                repair_confirm_at = now(), repair_confirm_note = $5
          WHERE source = $1 AND ref_key = $2
          RETURNING *`,
        [source, refKey, confirm, String(req.user?.username || ""), String(note ?? "").trim() || null]);
      if (!rows.length) return res.status(404).json({ message: "المتعذر مش موجود" });
      res.json({ ok: true, row: rows[0] });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/box-tickets/reopen — إعادة فتح تكت الكوابل بنفس الطريقة (نفس نوع
  // العطل ونفس البيانات)، بعد ما الفنى قال إن الإصلاح ماتمّش.
  // متاح لـ: الشئون الخارجية / الأدمن (ومنه مدير السنترال) / السوبر أدمن / مهندس الكوابل.
  app.post("/api/box-tickets/reopen", requireAuth, async (req: any, res) => {
    try {
      const role = req.user?.role;
      const allowed = ([ROLES.EXTERNAL, ROLES.ADMIN, ROLES.SUPER_ADMIN] as string[]).includes(role);
      if (!allowed) return res.status(403).json({ message: "غير مسموح" });
      const { source, refKey } = req.body || {};
      const { rows } = await pool.query(
        `SELECT * FROM box_fault_tickets WHERE source = $1 AND ref_key = $2`, [source, refKey]);
      if (!rows.length) return res.status(404).json({ message: "المتعذر مش موجود" });
      const b = rows[0];
      // بنمسح الربط القديم الأول عشان openBoxFaultTicket تقدر تسجّل التكت الجديدة
      // مكانه (المفتاح UNIQUE على source+ref_key) — وبنسيب سجل إعادة الفتح.
      const r = await openBoxFaultTicket({
        central: b.central_name, cabinet: b.cabin_number, box: b.box_number,
        techName: b.tech_name || "غير معروف", source: b.source === "OM" ? "OM" : "طلبات",
        respondedAt: new Date(), refKey: b.ref_key,
      });
      if (!r.ok) return res.status(400).json({ message: (r as any).reason });
      if (!(r as any).created) {
        return res.json({ ok: true, created: false, message: `البكس مغطّى بتكت مفتوحة ${(r as any).ticketNumber}` });
      }
      await pool.query(
        `UPDATE box_fault_tickets
            SET reopened_ticket_number = $3, reopened_by = $4, reopened_at = now()
          WHERE source = $1 AND ref_key = $2`,
        [source, refKey, (r as any).ticketNumber, String(req.user?.username || "")]);
      res.json({ ok: true, created: true, ticketNumber: (r as any).ticketNumber });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/box-lines — الخطوط «الشغّالة» على بكس معيّن، بالاسم والعنوان والموبايل.
  // «الشغّال» = خط بياناته الفنية على البكس ده **وله بورت** (فريم فى ملف المنافذ) —
  // الخطوط اللى ملهاش بورت مابتتحسبش. بتُستخدم فى تحذير «بوكس مليان» لما العدد < 10.
  app.get("/api/box-lines", requireAuth, async (req, res) => {
    try {
      const central = String(req.query.central ?? "").trim();
      const cabinet = String(req.query.cabinet ?? "").trim();
      const box = String(req.query.box ?? "").trim();
      if (!central || !box) return res.json({ data: [], total: 0 });
      const { rows } = await pool.query(
        `SELECT pl.tel_no AS "telNo", pl.full_phone AS "fullPhone",
                pl.cabin_number AS "cabinNumber", pl.box_number AS "boxNumber",
                si.sub_name AS "subName", si.sub_add AS "subAdd",
                mb.m AS mobile
           FROM phone_lines pl
           LEFT JOIN line_subscriber_info si ON si.phone_number = pl.full_phone
           LEFT JOIN LATERAL (
             -- نفس أولوية بحث رقم التليفون: يدوى ← أوامر الشغل ← طلبات FTTH
             SELECT m FROM (
               SELECT lm.mobile AS m, 0 AS pr FROM line_mobiles lm WHERE lm.full_phone = pl.full_phone
               UNION ALL
               SELECT mo.mobile, 1 FROM maintenance_orders mo
                 WHERE mo.phone_number IN (pl.tel_no, pl.full_phone)
                   AND mo.mobile !~ '[A-Za-z=/]' AND mo.mobile ~ '[0-9]{5,}'
               UNION ALL
               SELECT fo.customer_mobile, 2 FROM ftth_orders_current fo
                 WHERE fo.service_number IN (pl.tel_no, pl.full_phone)
                   AND fo.customer_mobile !~ '[A-Za-z=/]' AND fo.customer_mobile ~ '[0-9]{5,}'
             ) x WHERE NULLIF(btrim(x.m),'') IS NOT NULL ORDER BY pr LIMIT 1
           ) mb ON true
          WHERE btrim(pl.central) = btrim($1)
            AND ($2 = '' OR btrim(pl.cabin_number) = btrim($2))
            AND btrim(pl.box_number) = btrim($3)
            AND ${hasFrameSql("pl.full_phone")}
          ORDER BY pl.tel_no`, [central, cabinet, box]);
      res.json({ data: rows, total: rows.length });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/box-tickets/repaired — «متعذرات على بكسيات معطلة تم إصلاحها»:
  // التكتات اللى Service-Flow فتحها ومهندس الكوابل نظّمها والشئون الخارجية أكّدتها
  // (يعنى بقت status = 'closed') — مع بيانات الطلب/المتعذر اللى جات منه.
  app.get("/api/box-tickets/repaired", requireAuth, async (req, res) => {
    try {
      const { from = "", to = "" } = req.query as Record<string, string>;
      const params: any[] = [];
      const conds = [`t.status = 'closed'`];
      if (from) { params.push(from); conds.push(`t.closed_at >= $${params.length}::date`); }
      if (to)   { params.push(to);   conds.push(`t.closed_at < ($${params.length}::date + 1)`); }
      const { rows } = await pool.query(
        `SELECT b.source, b.ref_key AS "refKey", b.central_name AS central,
                b.cabin_number AS cabinet, b.box_number AS box, b.tech_name AS "techName",
                (b.responded_at AT TIME ZONE 'Africa/Cairo') AS "respondedAt",
                b.ticket_number AS "ticketNumber",
                (t.created_at AT TIME ZONE 'Africa/Cairo') AS "ticketCreatedAt",
                (t.closed_at   AT TIME ZONE 'Africa/Cairo') AS "closedAt",
                t.closed_by AS "closedBy",
                t.final_repair_description AS "repairDescription",
                ft.name AS "faultType",
                b.repair_confirm AS "repairConfirm", b.repair_confirm_by AS "repairConfirmBy",
                (b.repair_confirm_at AT TIME ZONE 'Africa/Cairo') AS "repairConfirmAt",
                b.repair_confirm_note AS "repairConfirmNote",
                b.reopened_ticket_number AS "reopenedTicketNumber",
                b.reopened_by AS "reopenedBy",
                (b.reopened_at AT TIME ZONE 'Africa/Cairo') AS "reopenedAt"
           FROM box_fault_tickets b
           JOIN tickets t ON t.id = b.ticket_id
           LEFT JOIN fault_types ft ON ft.id = t.fault_type_id
          WHERE ${conds.join(" AND ")}
          ORDER BY t.closed_at DESC NULLS LAST
          LIMIT 20000`, params);
      res.json({ data: rows, total: rows.length });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/phone-ports/removed — «جدول الخطوط المرفوعة»: أرقام كان لها بورت واختفت
  // من الشيت. بياناتها الأخيرة محفوظة كاملة + إمتى اتشالت ومن أى رفعة.
  app.get("/api/phone-ports/removed", requireAuth, async (req, res) => {
    const { q = "" } = req.query as Record<string, string>;
    const params: any[] = [];
    let where = "";
    if (q.trim()) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      where = `WHERE (${n("phone_number")} LIKE ${p} OR ${n("msan_code")} LIKE ${p} OR ${n("operator")} LIKE ${p})`;
    }
    const { rows } = await pool.query(
      `SELECT phone_number AS "phoneNumber", area_code AS "areaCode", msan_code AS "msanCode",
              frame, shelf, slot, port_number AS "portNumber", port_type AS "portType",
              voice_status AS "voiceStatus", data_status AS "dataStatus", operator, onu,
              (last_uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastUploadedAt",
              (removed_at AT TIME ZONE 'Africa/Cairo') AS "removedAt",
              removed_source AS "removedSource"
         FROM removed_phone_ports ${where}
        ORDER BY removed_at DESC, phone_number
        LIMIT 20000`,
      params);
    res.json({ data: rows, total: rows.length });
  });

  // GET /api/phone-ports/slot-cards — تقرير الكروت: كل (كابينة MSAN + شيلف + سلوت)
  // فى سطر، مع عدد الشغّال عليه ونوع الكارت. مصدره ملف البورتات وحده.
  //  • «الشغّال» = البورت اللى ليه فريم (نفس تعريف الشغّال فى باقى التقارير).
  //  • «نوع الكارت» = نوع البورت الغالب على السلوت (mode) — لأن الكارت واحد
  //    للسلوت كله، فأى خط جوّاه بيدلّ على نوعه. لو السلوت فيه أكتر من نوع
  //    بنرجّع العدد كمان عشان الحالة الشاذة دى تبان بدل ما تتخفى.
  app.get("/api/phone-ports/slot-cards", requireAuth, async (req, res) => {
    try {
      const { q = "", workingLt = "", phone = "" } = req.query as Record<string, string>;
      const params: any[] = [];
      const conds: string[] = [];
      if (q.trim()) {
        params.push(arQ(q));
        const p = `$${params.length}`;
        conds.push(`(${n("msan_code")} LIKE ${p} OR ${n("shelf")} LIKE ${p}
                  OR ${n("slot")} LIKE ${p} OR ${n("port_type")} LIKE ${p})`);
      }
      // بحث برقم التليفون: بيرجّع **السلوت كله** اللى الرقم عليه بعدده الكامل —
      // مش صف الرقم لوحده (وإلا «عدد الشغال» هيطلع 1 وده غلط).
      const ph = phone.replace(/\D/g, "").replace(/^88/, "");
      if (ph) {
        params.push(ph);
        conds.push(`(msan_code, COALESCE(shelf,''), COALESCE(slot,'')) IN (
                      SELECT msan_code, COALESCE(shelf,''), COALESCE(slot,'')
                        FROM phone_ports
                       WHERE regexp_replace(phone_number, '^88', '') = $${params.length})`);
      }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      let having = "";
      const lim = parseInt(workingLt);
      if (workingLt !== "" && !isNaN(lim)) {
        params.push(lim);
        having = `HAVING SUM(work) < $${params.length}`;
      }
      // بنجمّع الأول لكل (سلوت + نوع بورت) عشان نقدر نعرض **كل** الأنواع اللى على
      // السلوت بعددها («VDSL 64 + SV 64») بدل ما نعرض الغالب ونخفى الباقى — السلوت
      // الواحد ساعات بيشيل أكتر من كارت/نوع، وده المفروض يبان مش يتخفى.
      const { rows } = await pool.query(
        `WITH per_type AS (
           SELECT msan_code, shelf, slot, NULLIF(btrim(port_type), '') AS pt,
                  COUNT(*)::int AS ports,
                  COUNT(*) FILTER (WHERE COALESCE(btrim(frame), '') <> '')::int AS work
             FROM phone_ports ${where}
            GROUP BY 1, 2, 3, 4
         )
         SELECT msan_code AS "msanCode", shelf, slot,
                SUM(work)::int  AS "workingCount",
                SUM(ports)::int AS "portsCount",
                string_agg(pt || ' ' || work, ' + ' ORDER BY work DESC, pt)
                  FILTER (WHERE pt IS NOT NULL)          AS "cardType",
                COUNT(*) FILTER (WHERE pt IS NOT NULL)::int AS "cardTypeCount",
                -- النوع الغالب على السلوت (أكبر عدد شغّال) — الكارت واحد للسلوت كله،
                -- فسعته والفاضى فيه بيتحسبوا على النوع ده لما نجمّع بالكابينة × النوع.
                (array_agg(pt ORDER BY work DESC, pt)
                   FILTER (WHERE pt IS NOT NULL))[1]     AS "portType"
           FROM per_type
          GROUP BY 1, 2, 3
          ${having}
          ORDER BY msan_code NULLS LAST,
                   LPAD(COALESCE(shelf, ''), 4, '0'),
                   LPAD(COALESCE(slot, ''), 4, '0')
          LIMIT 20000`, params);
      res.json({ data: rows, total: rows.length });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/phone-ports/cabinet-free?msan=<كود الكابينة>
  // الفاضى فى كابينة واحدة مقسّم على نوع البورت — بتستخدمه شاشة «غيّر البورت»
  // عشان اللى بينقل خط يشوف فوراً أنهى نوع بورت لسه فيه مكان فى كابينة الوجهة.
  // نفس منطق تقرير «الفاضى لكل نوع بورت» بالحرف (shared/card-capacity).
  app.get("/api/phone-ports/cabinet-free", requireAuth, async (req, res) => {
    try {
      const msan = String((req.query as any).msan || "").trim();
      if (!msan) return res.json({ msan: "", data: [], total: { cards: 0, capacity: 0, working: 0, free: 0 } });
      // مطابقة متسامحة مع المسافات (الكود بيتكتب بإيد المستخدم فى النافذة)
      const { rows } = await pool.query(
        `WITH per_type AS (
           SELECT shelf, slot, NULLIF(btrim(port_type), '') AS pt,
                  COUNT(*) FILTER (WHERE COALESCE(btrim(frame), '') <> '')::int AS work
             FROM phone_ports
            WHERE regexp_replace(COALESCE(msan_code, ''), '\\s', '', 'g')
                = regexp_replace($1, '\\s', '', 'g')
            GROUP BY 1, 2, 3
         )
         SELECT shelf, slot, SUM(work)::int AS work,
                (array_agg(pt ORDER BY work DESC, pt) FILTER (WHERE pt IS NOT NULL))[1] AS pt
           FROM per_type GROUP BY 1, 2`,
        [msan]);

      // التجميع بالنوع فى JS بنفس دوال السعة المشتركة
      const byType = new Map<string, { portType: string; cards: number; capacity: number; working: number; free: number }>();
      for (const r of rows) {
        const portType = String(r.pt || "").trim() || "غير محدّد";
        const work = Number(r.work) || 0;
        let g = byType.get(portType);
        if (!g) { g = { portType, cards: 0, capacity: 0, working: 0, free: 0 }; byType.set(portType, g); }
        g.cards += 1;
        g.capacity += cardCapacityOf(msan, work);
        g.working += work;
        g.free += cardFreeOf(msan, work);
      }
      const data = Array.from(byType.values()).sort((a, b) => b.free - a.free);
      const total = data.reduce((t, g) => ({
        cards: t.cards + g.cards, capacity: t.capacity + g.capacity,
        working: t.working + g.working, free: t.free + g.free,
      }), { cards: 0, capacity: 0, working: 0, free: 0 });
      res.json({ msan, data, total });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/phone-ports — list with search
  app.get("/api/phone-ports", requireAuth, async (req, res) => {
    const { q } = req.query as Record<string, string>;
    const params: any[] = [];
    let where = "";
    if (q?.trim()) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      where = `WHERE (${n("phone_number")} LIKE ${p} OR ${n("msan_code")} LIKE ${p} OR ${n("operator")} LIKE ${p})`;
    }
    const { rows } = await pool.query(
      `SELECT id, phone_number AS "phoneNumber", area_code AS "areaCode",
              msan_code AS "msanCode", frame, shelf, slot, port_number AS "portNumber",
              port_type AS "portType", voice_status AS "voiceStatus",
              data_status AS "dataStatus", operator
       FROM phone_ports ${where}
       ORDER BY phone_number`,
      params,
    );
    res.json(rows);
  });

  // POST /api/ftth-orders/import — رفعة متعذرات OM (الحالى): تستبدل الحالى، تتراكم
  // تاريخياً، وتُضيف للـSOY أى مفتاح جديد (مسلسل+order ids)، وتُثرى MSAN فى SOY.
  app.options("/api/ftth-orders/import", (_req, res) => { setUploadCors(res); res.sendStatus(204); });
  app.post("/api/ftth-orders/import", requireAdminOrToken, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const all = parseFtthOrderRows(req.file.buffer);
      const userId = req.user
        ? (req.user as any).id
        : ((await pool.query("SELECT id FROM users WHERE role = $1 LIMIT 1", [ROLES.ADMIN])).rows[0]?.id ?? 1);

      const archivedYear = await archiveIfNewYear("ftth_orders", "ftth_orders_archive", FTTH_ORDER_COLS);
      const hist = await accumulateTable("ftth_orders", FTTH_ORDER_COLS, "service_order_id", all, userId);
      const current = await replaceTable("ftth_orders_current", FTTH_ORDER_COLS, all, userId);
      // تحديث بداية الفترة (SOY) من ملف الحالى: نضيف أى مفتاح جديد (مسلسل+order ids)
      // غير موجود فى SOY، ونُثرى كود MSAN الناقص فيها من الرفعة الحالية.
      const soyAdded = await accumulateSoy(all, userId);
      const msanFilled = await enrichSoyMsan(all);
      // تنظيف أى تكرارات قديمة بنفس المسلسل فى الجدولين (الحالى + بداية الفترة).
      await dedupBySerial("ftth_orders_current");
      await dedupBySerial("ftth_orders_soy");
      const { rows: c } = await pool.query(`SELECT COUNT(*)::int AS n FROM ftth_orders_soy`);

      res.json({ inserted: hist, hist, current, archivedYear, total: all.length, soyAdded, msanFilled, soyTotal: c[0].n });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // POST /api/ftth-orders/import-soy — رفع يدوى لشيت بداية السنة (يتراكم: يضيف المسلسلات الجديدة فقط).
  app.post("/api/ftth-orders/import-soy", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const all = parseFtthOrderRows(req.file.buffer);
      const userId = (req.user as any).id;
      const soyAdded = await accumulateSoy(all, userId);
      await dedupBySerial("ftth_orders_soy");
      const { rows: c } = await pool.query(`SELECT COUNT(*)::int AS n FROM ftth_orders_soy`);
      res.json({ ok: true, soyAdded, soyTotal: c[0].n, total: all.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // POST /api/ftth-orders/soy-reset — تفريغ جدول بداية السنة (أدمن) — لإعادة بنائه نظيفاً.
  app.post("/api/ftth-orders/soy-reset", requireAdmin, async (_req, res) => {
    await pool.query(`TRUNCATE ftth_orders_soy`);
    res.json({ ok: true, soyTotal: 0 });
  });

  // POST /api/ftth-orders/current-reset — تفريغ جدول المتعذرات الحالية (أدمن).
  app.post("/api/ftth-orders/current-reset", requireAdmin, async (_req, res) => {
    await pool.query(`TRUNCATE ftth_orders_current`);
    res.json({ ok: true });
  });

  // GET /api/ftth-orders — ?bucket=historical|current|archive|soy|resolved & ?year= & ?q=
  //   soy      = متعذرات بداية السنة (التراكمى)
  //   resolved = متعذرات تم فكها (موجودة فى SOY وغير موجودة فى الحالى بمفتاح المسلسل+order ids)
  app.get("/api/ftth-orders", requireAuth, async (req, res) => {
    const { q, all, bucket, year, yearFilter, msanFilter, fccFilter, techFilter, dateFrom, dateTo } = req.query as Record<string, string>;
    const table = bucket === "current" ? "ftth_orders_current"
                : bucket === "archive" ? "ftth_orders_archive"
                : (bucket === "soy" || bucket === "resolved") ? "ftth_orders_soy"
                : "ftth_orders";
    const params: any[] = [];
    const conds: string[] = [];
    // فلتر السنة حسب تاريخ إنشاء الطلب (order_create_time مخزَّن UTC ويُعرض UTC):
    //   current = العام الحالى | previous = سنوات سابقة | (فارغ/all) = الكل
    if (yearFilter === "current" || yearFilter === "previous") {
      const nowYear = new Date().getUTCFullYear();
      params.push(nowYear);
      const op = yearFilter === "current" ? "=" : "<";
      conds.push(`EXTRACT(YEAR FROM fo.order_create_time AT TIME ZONE 'UTC') ${op} $${params.length}`);
    }
    if (all !== "true") {
      // متعذرات غنايم المعنية فقط: أكواد غنايم الأربعة + Service Name = FV Survey
      conds.push(`fo.fcc_exchange IN ('GHNAT','AMZAT','DRGAT','NGOAT')`);
      conds.push(`fo.service_name = 'FV Survey'`);
    }
    if (bucket === "resolved") {
      // تم فكها = موجود فى بداية الفترة وغير موجود فى الحالى. الهوية برقم المسلسل
      // (إن وُجد) وإلا بمفتاح order ids للصفوف بدون مسلسل.
      conds.push(`NOT EXISTS (SELECT 1 FROM ftth_orders_current c
        WHERE CASE WHEN COALESCE(TRIM(fo.serial_number),'') <> ''
          THEN TRIM(c.serial_number) = TRIM(fo.serial_number)
          ELSE COALESCE(c.customer_order_id,'') = COALESCE(fo.customer_order_id,'')
           AND COALESCE(c.service_order_id,'')  = COALESCE(fo.service_order_id,'') END)`);
    }
    if (bucket === "archive" && year) { params.push(parseInt(year)); conds.push(`fo.archived_year = $${params.length}`); }
    if (q?.trim()) {
      params.push(arQ(q));
      const p = `$${params.length}`;
      conds.push(`(${n("fo.service_order_id")} LIKE ${p} OR ${n("fo.serial_number")} LIKE ${p} OR ${n("fo.customer_order_id")} LIKE ${p} OR ${n("fo.customer_name")} LIKE ${p} OR ${n("fo.msan_code")} LIKE ${p} OR ${n("fo.fcc_exchange")} LIKE ${p})`);
    }
    if (msanFilter?.trim()) {
      params.push(msanFilter.trim());
      conds.push(`fo.msan_code = $${params.length}`);
    }
    if (fccFilter?.trim()) {
      params.push(fccFilter.trim());
      conds.push(`fo.fcc_exchange = $${params.length}`);
    }
    if (dateFrom?.trim()) {
      params.push(dateFrom.trim());
      conds.push(`fo.order_create_time >= $${params.length}::date`);
    }
    if (dateTo?.trim()) {
      params.push(dateTo.trim());
      conds.push(`fo.order_create_time < ($${params.length}::date + INTERVAL '1 day')::timestamptz`);
    }
    // فلتر اسم الفنى (للأدمن — من الدروب ليست): يطابق الفنى المحسوب للمتعذر
    // ("غير معروف" = المتعذرات اللى مفيش لها فنى)
    if (techFilter?.trim()) {
      params.push(techFilter.trim());
      conds.push(`COALESCE(tn.tech_name, mto.tech_name, 'غير معروف') = $${params.length}`);
    }
    // الفنى: يرى متعذراته فقط (اسم الفنى = اسمه)، + المتعذرات اللى مفيش لها اسم فنى (غير معروف) تظهر للجميع.
    if (req.user?.role === ROLES.TECH) {
      const wc = String((req.user as any).workerCode || "").trim();
      let myTech = "";
      if (wc) {
        const tr = await pool.query(
          `SELECT tech_name FROM technician_names WHERE worker_code = $1 ORDER BY id DESC LIMIT 1`, [wc]);
        myTech = tr.rows[0]?.tech_name || "";
      }
      params.push(myTech);
      conds.push(`(COALESCE(tn.tech_name, mto.tech_name) = $${params.length} OR (tn.tech_name IS NULL AND mto.tech_name IS NULL))`);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const yearCol = bucket === "archive" ? `fo.archived_year AS "archivedYear",` : "";
    const { rows } = await pool.query(
      `SELECT fo.id, ${yearCol} fo.service_order_id AS "serviceOrderId", fo.customer_order_id AS "customerOrderId",
              fo.product, fo.service_number AS "serviceNumber", fo.serial_number AS "serialNumber",
              fo.service_name AS "serviceName", fo.customer_name AS "customerName",
              fo.order_status AS "orderStatus", fo.order_create_time AS "orderCreateTime",
              fo.exchange_name AS "exchangeName", fo.service_type AS "serviceType", fo.msan_code AS "msanCode",
              fo.area_code AS "areaCode",
              -- الأولوية: المحمول المُدخَل يدوياً، ثم من المعاينة، ثم المشفّر من OM
              COALESCE(omm.mobile, wfm.mobile, fo.customer_mobile) AS "customerMobile",
              omm.mobile AS "manualMobile",
              COALESCE(fo.install_address, wfm.address) AS "address",
              fo.current_activity AS "currentActivity", fo.error_name AS "errorName",
              fo.governorate, fo.line_type AS "lineType", fo.fcc_exchange AS "fccExchange",
              COALESCE(tn.tech_name, mto.tech_name, 'غير معروف') AS "techName",
              (tn.tech_name IS NULL AND mto.tech_name IS NOT NULL) AS "techManual",
              -- رد الفنى على المتعذر (om_responses) — نفس دورة الطلبات
              COALESCE(orp.status, 'pending') AS "respStatus",
              orp.rejection_reason AS "respRejectionReason",
              orp.central_name AS "respCentralName", orp.cabin_number AS "respCabinNumber",
              orp.box_number AS "respBoxNumber", orp.nearest_box_distance AS "respNearestBoxDistance",
              orp.additional_notes AS "respAdditionalNotes",
              orp.tech_name AS "respTechName",
              (orp.responded_at AT TIME ZONE 'Africa/Cairo') AS "respRespondedAt",
              orp.external_name AS "respExternalName",
              orp.is_feasible_external AS "respIsFeasibleExternal",
              orp.external_rejection_reason AS "respExternalRejectionReason",
              (orp.external_response_at AT TIME ZONE 'Africa/Cairo') AS "respExternalResponseAt",
              -- عدد الخطوط الشغّالة على البكس اللى الفنى كتبه فى رده. «شغّال» = ليه بورت
              -- (فريم) فى ملف المنافذ؛ أى خط من غير بورت مابيتحسبش.
              bx.c AS "boxWorkingCount"
       FROM ${table} fo
       LEFT JOIN om_responses orp ON orp.serial_number = fo.serial_number
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS c
           FROM phone_lines pl2
          WHERE COALESCE(btrim(orp.box_number), '') <> ''
            AND btrim(pl2.box_number) = btrim(orp.box_number)
            AND (COALESCE(btrim(orp.cabin_number), '') = '' OR btrim(pl2.cabin_number) = btrim(orp.cabin_number))
            AND (COALESCE(btrim(orp.central_name), '') = '' OR btrim(pl2.central) = btrim(orp.central_name))
            AND ${hasFrameSql("pl2.full_phone")}
       ) bx ON true
       LEFT JOIN LATERAL (
         SELECT tn.tech_name
         FROM cabinet_technicians ct
         JOIN technician_names tn ON tn.worker_code = ct.worker_code
         WHERE ct.cabin_code = fo.msan_code
         LIMIT 1
       ) tn ON TRUE
       LEFT JOIN LATERAL (
         SELECT mto.tech_name
         FROM msan_tech_overrides mto
         WHERE mto.cabin_code = fo.msan_code
         LIMIT 1
       ) mto ON TRUE
       LEFT JOIN LATERAL (
         -- ربط المتعذر بالمعاينة المنتظمة: Service Order ID للمتعذر = رقم المرجع للمعاينة
         -- (كان بيطابق serial=phone بالغلط فيطلّع صفر تقريباً). كده الموبايل بيتجاب صح.
         SELECT mobile, address FROM maintenance_orders
         WHERE reference_no = fo.service_order_id
           AND work_order_type ILIKE 'fvmanualsurvey'
         LIMIT 1
       ) wfm ON TRUE
       LEFT JOIN om_manual_mobiles omm ON omm.serial_number = fo.serial_number
       ${where}
       ORDER BY fo.order_create_time DESC NULLS LAST
       LIMIT 5000`,
      params,
    );
    res.json(rows);
  });

  // إدخال/تعديل رقم محمول يدوى لمتعذر OM (للأرقام المشفّرة بنجوم). صلاحية:
  // سوبر أدمن + أدمن (ومنه مدير السنترال) + الشئون الخارجية (ومنها مهندس الكوابل) + أدمن المبيعات.
  app.post("/api/om-rejections/mobile", requireAuth, async (req: any, res) => {
    const role = req.user?.role;
    const allowed = hasAdminAccess(role) || role === ROLES.EXTERNAL || role === ROLES.SALES_ADMIN;
    if (!allowed) return res.status(403).json({ message: "غير مسموح" });
    const serialNumber = String(req.body?.serialNumber ?? "").trim();
    const mobile = String(req.body?.mobile ?? "").trim();
    if (!serialNumber) return res.status(400).json({ message: "المسلسل مطلوب" });
    try {
      if (!mobile) {
        await pool.query(`DELETE FROM om_manual_mobiles WHERE serial_number = $1`, [serialNumber]);
        return res.json({ ok: true, mobile: "" });
      }
      await pool.query(
        `INSERT INTO om_manual_mobiles (serial_number, mobile, updated_by, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (serial_number) DO UPDATE SET mobile = EXCLUDED.mobile, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [serialNumber, mobile, String(req.user?.username || "")],
      );
      res.json({ ok: true, mobile });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ===== رد الفنى على متعذر OM — نفس دورة الطلبات =====
  // الفنى يسجّل «يمكن التنفيذ» أو «لا يمكن» + سبب التعذر، والسوبر أدمن يقدر يحوّله للشئون
  // الخارجية للفحص، والشئون الخارجية بترد. كله متخزّن فى om_responses بمفتاح رقم المسلسل
  // عشان يصمد بعد إعادة رفع ملف المتعذرات.

  // الفنى صاحب المتعذر (حسب كابينة الـ MSAN) أو الأدمن/السوبر أدمن
  const canRespondToOm = async (user: any, serialNumber: string): Promise<boolean> => {
    const role = user?.role;
    if (hasAdminAccess(role)) return true;
    if (role !== ROLES.TECH) return false;
    const wc = String(user?.workerCode || "").trim();
    if (!wc) return false;
    // متعذر بدون فنى معروف متاح لأى فنى (نفس منطق العرض فى /api/ftth-orders)
    const { rows } = await pool.query(
      `SELECT COALESCE(tn.tech_name, mto.tech_name) AS owner,
              (SELECT tech_name FROM technician_names WHERE worker_code = $2 ORDER BY id DESC LIMIT 1) AS me
         FROM ftth_orders_current fo
         LEFT JOIN LATERAL (SELECT tn.tech_name FROM cabinet_technicians ct
                              JOIN technician_names tn ON tn.worker_code = ct.worker_code
                             WHERE ct.cabin_code = fo.msan_code LIMIT 1) tn ON TRUE
         LEFT JOIN LATERAL (SELECT mto.tech_name FROM msan_tech_overrides mto
                             WHERE mto.cabin_code = fo.msan_code LIMIT 1) mto ON TRUE
        WHERE fo.serial_number = $1 LIMIT 1`,
      [serialNumber, wc],
    );
    if (!rows.length) return false;
    return !rows[0].owner || rows[0].owner === rows[0].me;
  };

  // POST /api/om-rejections/response — رد الفنى (يمكن التنفيذ / لا يمكن + سبب)
  app.post("/api/om-rejections/response", requireAuth, async (req: any, res) => {
    try {
      const b = req.body || {};
      const serialNumber = String(b.serialNumber ?? "").trim();
      if (!serialNumber) return res.status(400).json({ message: "رقم المسلسل مطلوب" });
      if (!(await canRespondToOm(req.user, serialNumber))) {
        return res.status(403).json({ message: "غير مسموح — المتعذر ده مش تابع لك" });
      }
      const isFeasible = b.isFeasible === true || b.isFeasible === "true";
      if (!isFeasible && !String(b.rejectionReason ?? "").trim()) {
        return res.status(400).json({ message: "سبب التعذر مطلوب" });
      }
      const clean = (v: any) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
      const status = isFeasible ? ORDER_STATUS.FEASIBLE : ORDER_STATUS.NOT_FEASIBLE;
      const { rows } = await pool.query(
        `INSERT INTO om_responses (serial_number, status, is_feasible, rejection_reason, central_name,
            cabin_number, box_number, nearest_box_distance, additional_notes, tech_id, tech_name, responded_at,
            external_id, external_name, is_feasible_external, external_rejection_reason, external_response_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(), NULL,NULL,NULL,NULL,NULL, now())
         ON CONFLICT (serial_number) DO UPDATE SET
           status = EXCLUDED.status, is_feasible = EXCLUDED.is_feasible,
           rejection_reason = EXCLUDED.rejection_reason, central_name = EXCLUDED.central_name,
           cabin_number = EXCLUDED.cabin_number, box_number = EXCLUDED.box_number,
           nearest_box_distance = EXCLUDED.nearest_box_distance, additional_notes = EXCLUDED.additional_notes,
           tech_id = EXCLUDED.tech_id, tech_name = EXCLUDED.tech_name, responded_at = now(),
           -- رد جديد من الفنى بيلغى أى رد شئون خارجية قديم (زى إعادة الطلب للفنى فى قسم الطلبات)
           external_id = NULL, external_name = NULL, is_feasible_external = NULL,
           external_rejection_reason = NULL, external_response_at = NULL, updated_at = now()
         RETURNING *`,
        [serialNumber, status, isFeasible,
         isFeasible ? null : clean(b.rejectionReason), clean(b.centralName), clean(b.cabinNumber),
         clean(b.boxNumber), clean(b.nearestBoxDistance), clean(b.additionalNotes),
         req.user?.id ?? null, String(req.user?.username || "")],
      );
      // «بوكس معطل» → تكت تلقائى على برنامج الكوابل (نفس منطق قسم الطلبات)
      let boxTicket: any = null;
      const r0 = rows[0];
      if (r0 && isFeasible === true) {
        await settleBoxTicketIfCleared({
          central: r0.central_name, cabinet: r0.cabin_number, box: r0.box_number,
        }).catch(() => {});
      }
      if (r0 && r0.rejection_reason === REJECTION_REASONS.BOX_BROKEN) {
        boxTicket = await openBoxFaultTicket({
          central: r0.central_name, cabinet: r0.cabin_number, box: r0.box_number,
          techName: String(req.user?.username || ""), source: "OM",
          respondedAt: r0.responded_at, refKey: `متعذر ${serialNumber}`,
          serialNumber,
        });
      }
      // لو المتعذر مربوط بطلب مؤكَّد → الرد ينزل على الطلب على طول
      await syncMatchedResponse({ serial: serialNumber });
      res.json({ ok: true, response: r0, boxTicket });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/om-rejections/request-external — تحويل المتعذر للشئون الخارجية للفحص (سوبر أدمن)
  app.post("/api/om-rejections/request-external", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      const serialNumber = String(req.body?.serialNumber ?? "").trim();
      if (!serialNumber) return res.status(400).json({ message: "رقم المسلسل مطلوب" });
      const { rows } = await pool.query(
        `INSERT INTO om_responses (serial_number, status, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (serial_number) DO UPDATE SET
           status = $2,
           external_id = NULL, external_name = NULL, is_feasible_external = NULL,
           external_rejection_reason = NULL, external_response_at = NULL, updated_at = now()
         RETURNING *`,
        [serialNumber, ORDER_STATUS.NEEDS_EXTERNAL],
      );
      await syncMatchedResponse({ serial: serialNumber });
      res.json({ ok: true, response: rows[0] });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/om-rejections/external-response — رد الشئون الخارجية على المتعذر المحوَّل
  app.post("/api/om-rejections/external-response", requireAuth, async (req: any, res) => {
    try {
      const role = req.user?.role;
      if (role !== ROLES.EXTERNAL && !hasAdminAccess(role)) {
        return res.status(403).json({ message: "غير مسموح" });
      }
      const b = req.body || {};
      const serialNumber = String(b.serialNumber ?? "").trim();
      if (!serialNumber) return res.status(400).json({ message: "رقم المسلسل مطلوب" });
      const isFeasible = b.isFeasible === true || b.isFeasible === "true";
      const reason = String(b.rejectionReason ?? "").trim();
      if (!isFeasible && !reason) return res.status(400).json({ message: "سبب عدم الإمكانية مطلوب" });
      const status = isFeasible ? ORDER_STATUS.EXTERNAL_FEASIBLE : ORDER_STATUS.EXTERNAL_NOT_FEASIBLE;
      // زى قسم الطلبات بالظبط: الرد الخارجى مايتقبلش إلا لو المتعذر متحوّل فعلاً
      // (needs_external) — كان بيكتب فوق رد فنى جديد لمجرد إن الصف لسه على الشاشة.
      const { rows: curSt } = await pool.query(
        `SELECT status FROM om_responses WHERE serial_number = $1`, [serialNumber]);
      if (!curSt.length) return res.status(404).json({ message: "المتعذر مش موجود" });
      if (curSt[0].status !== ORDER_STATUS.NEEDS_EXTERNAL) {
        return res.status(400).json({ message: "المتعذر مش محوَّل للشئون الخارجية — اطلب التحويل الأول" });
      }
      const { rows } = await pool.query(
        `UPDATE om_responses
            SET status = $2, is_feasible_external = $3, external_rejection_reason = $4,
                external_id = $5, external_name = $6, external_response_at = now(), updated_at = now()
          WHERE serial_number = $1
          RETURNING *`,
        [serialNumber, status, isFeasible, isFeasible ? null : reason,
         req.user?.id ?? null, String(req.user?.username || "")],
      );
      if (!rows.length) return res.status(404).json({ message: "المتعذر ده مش محوَّل للشئون الخارجية" });
      await syncMatchedResponse({ serial: serialNumber });
      res.json({ ok: true, response: rows[0] });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/om-rejections/reset-response — إلغاء الرد ورجوعه «قيد الانتظار» (أدمن/سوبر أدمن)
  app.post("/api/om-rejections/reset-response", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const serialNumber = String(req.body?.serialNumber ?? "").trim();
      if (!serialNumber) return res.status(400).json({ message: "رقم المسلسل مطلوب" });
      await pool.query(`DELETE FROM om_responses WHERE serial_number = $1`, [serialNumber]);
      await syncMatchedResponse({ serial: serialNumber });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/ftth-orders/msan-codes — قائمة أكواد الكباين المميزة للـ bucket (لفلتر الدروب ليست)
  app.get("/api/ftth-orders/msan-codes", requireAuth, async (req, res) => {
    const { bucket, all, fccFilter } = req.query as Record<string, string>;
    const table = bucket === "current" ? "ftth_orders_current"
                : bucket === "archive" ? "ftth_orders_archive"
                : (bucket === "soy" || bucket === "resolved") ? "ftth_orders_soy"
                : "ftth_orders";
    const params: any[] = [];
    const conds: string[] = [`fo.msan_code IS NOT NULL`, `TRIM(fo.msan_code) <> ''`];
    if (all !== "true") {
      conds.push(`fo.fcc_exchange IN ('GHNAT','AMZAT','DRGAT','NGOAT')`);
      conds.push(`fo.service_name = 'FV Survey'`);
    }
    if (bucket === "resolved") {
      conds.push(`NOT EXISTS (SELECT 1 FROM ftth_orders_current c
        WHERE CASE WHEN COALESCE(TRIM(fo.serial_number),'') <> ''
          THEN TRIM(c.serial_number) = TRIM(fo.serial_number)
          ELSE COALESCE(c.customer_order_id,'') = COALESCE(fo.customer_order_id,'')
           AND COALESCE(c.service_order_id,'')  = COALESCE(fo.service_order_id,'') END)`);
    }
    if (fccFilter?.trim()) {
      params.push(fccFilter.trim());
      conds.push(`fo.fcc_exchange = $${params.length}`);
    }
    const where = "WHERE " + conds.join(" AND ");
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT fo.msan_code AS "msanCode" FROM ${table} fo ${where}
         ORDER BY fo.msan_code`,
        params,
      );
      res.json(rows.map((r) => r.msanCode));
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "فشل تحميل أكواد الكباين" });
    }
  });

  // GET /api/reports/om-stats — إحصائية متعذرات OM (لكل كابينة + لكل فنى)
  //   بداية الفترة (SOY) / الحالى / تم فكها (موجود فى SOY وغير موجود فى الحالى)
  //   ونسبة التحقيق = تم فكها ÷ بداية الفترة.
  app.get("/api/reports/om-stats", requireAuth, async (req, res) => {
    try {
      const FV = `fcc_exchange IN ('GHNAT','AMZAT','DRGAT','NGOAT') AND service_name = 'FV Survey'`;
      // فلتر سنة اختيارى: yearFilter=current → السنة الحالية فقط (2026)، prior → الأعوام السابقة،
      // بدونه = كل السنين (السلوك الأصلى لإحصائية متعذرات OM). حسب سنة order_create_time.
      const yf = String((req.query as Record<string, string>).yearFilter || "");
      const yearClause =
        yf === "current" ? `AND EXTRACT(YEAR FROM order_create_time AT TIME ZONE 'UTC') = EXTRACT(YEAR FROM now())::int`
        : yf === "prior" ? `AND EXTRACT(YEAR FROM order_create_time AT TIME ZONE 'UTC') < EXTRACT(YEAR FROM now())::int`
        : "";
      // فلتر السنترال (اختيارى): السنترال بتاع كل كود كابينة بييجى من cabinet_technicians،
      // فبنفلتر بعد الـ LATERAL. المقارنة بعد التطبيع (ة/ه والهمزات).
      const central = String((req.query as Record<string, string>).central || "").trim();
      const omParams: any[] = [];
      let centralClause = "";
      if (central) {
        omParams.push(arNorm(central));
        centralClause = `WHERE ${n("tech.central_name")} = $${omParams.length}`;
      }
      // تجميع لكل كود MSAN (كابينة): إجمالى البداية + تم فكها (من SOY) + الحالى.
      const { rows: byCabinet } = await pool.query(`
        WITH soy AS (
          SELECT msan_code, serial_number, customer_order_id, service_order_id
          FROM ftth_orders_soy WHERE ${FV} ${yearClause}
        ),
        cur AS (
          SELECT msan_code, serial_number, customer_order_id, service_order_id
          FROM ftth_orders_current WHERE ${FV}
        ),
        soy_agg AS (
          SELECT
            COALESCE(NULLIF(TRIM(msan_code), ''), '—') AS msan,
            COUNT(*)::int AS soy_total,
            COUNT(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM cur c
              WHERE CASE WHEN COALESCE(TRIM(s.serial_number),'') <> ''
                THEN TRIM(c.serial_number) = TRIM(s.serial_number)
                ELSE COALESCE(c.customer_order_id,'') = COALESCE(s.customer_order_id,'')
                 AND COALESCE(c.service_order_id,'')  = COALESCE(s.service_order_id,'') END
            ))::int AS resolved
          FROM soy s GROUP BY 1
        ),
        cur_agg AS (
          SELECT COALESCE(NULLIF(TRIM(msan_code), ''), '—') AS msan, COUNT(*)::int AS cur_total
          FROM cur GROUP BY 1
        ),
        m AS (
          SELECT
            COALESCE(s.msan, c.msan)          AS msan,
            COALESCE(s.soy_total, 0)          AS soy_total,
            COALESCE(s.resolved, 0)           AS resolved,
            COALESCE(c.cur_total, 0)          AS cur_total
          FROM soy_agg s FULL JOIN cur_agg c ON s.msan = c.msan
        )
        SELECT
          m.msan                                       AS "msanCode",
          m.soy_total                                  AS "soyTotal",
          m.cur_total                                  AS "currentTotal",
          m.resolved                                   AS "resolved",
          tech.central_name                            AS "centralName",
          COALESCE(tech.tech_name, mto.tech_name, 'غير معروف') AS "techName",
          (tech.tech_name IS NULL AND mto.tech_name IS NOT NULL) AS "techManual"
        FROM m
        LEFT JOIN LATERAL (
          SELECT MIN(ct.central_name)                        AS central_name,
                 string_agg(DISTINCT tn.tech_name, ' , ')    AS tech_name
          FROM cabinet_technicians ct
          LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
          WHERE ct.cabin_code = m.msan
        ) tech ON TRUE
        LEFT JOIN msan_tech_overrides mto ON mto.cabin_code = m.msan
        ${centralClause}
        ORDER BY m.soy_total DESC, m.msan
      `, omParams);

      // تجميع لكل فنى (مجموع كابيناته) — يُحسب فى JS لضمان تطابق الإجماليات.
      const techMap = new Map<string, { techName: string; soyTotal: number; currentTotal: number; resolved: number }>();
      let tSoy = 0, tCur = 0, tRes = 0;
      for (const r of byCabinet as any[]) {
        const soy = Number(r.soyTotal), cur = Number(r.currentTotal), res2 = Number(r.resolved);
        tSoy += soy; tCur += cur; tRes += res2;
        const key = r.techName || "غير معروف";
        const e = techMap.get(key) || { techName: key, soyTotal: 0, currentTotal: 0, resolved: 0 };
        e.soyTotal += soy; e.currentTotal += cur; e.resolved += res2;
        techMap.set(key, e);
      }
      const pct = (resolved: number, soy: number) => (soy > 0 ? Math.round((1000 * resolved) / soy) / 10 : 0);
      const byCab = (byCabinet as any[]).map((r) => ({
        ...r,
        soyTotal: Number(r.soyTotal), currentTotal: Number(r.currentTotal), resolved: Number(r.resolved),
        pctResolved: pct(Number(r.resolved), Number(r.soyTotal)),
      }));
      const byTech = Array.from(techMap.values())
        .map((e) => ({ ...e, pctResolved: pct(e.resolved, e.soyTotal) }))
        // الأفضل أولاً: أعلى نسبة تحقيق
        .sort((a, b) => b.pctResolved - a.pctResolved || b.resolved - a.resolved);
      const overall = { soyTotal: tSoy, currentTotal: tCur, resolved: tRes, pctResolved: pct(tRes, tSoy) };

      res.json({ byCabinet: byCab, byTech, overall });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // === External API (token-protected, for other sites) ===
  // Requires header: Authorization: Bearer <SF_API_TOKEN>
  const requireApiToken = (req: any, res: any, next: any) => {
    const configured = process.env.SF_API_TOKEN;
    if (!configured) {
      return res.status(503).json({ ok: false, error: "API token not configured" });
    }
    const h = req.headers["authorization"] || "";
    const t = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!t || t !== configured) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    next();
  };

  // GET /api/box-summary — paginated box summary for external consumers
  app.get("/api/box-summary", requireApiToken, async (req, res) => {
    try {
      const { page = "1", limit = "100", q } = req.query as Record<string, string>;
      const pageNum = Math.max(1, parseInt(page) || 1);
      const pageSize = Math.min(1000, Math.max(1, parseInt(limit) || 100));
      const offset = (pageNum - 1) * pageSize;

      const params: any[] = [];
      let where = "";
      if (q && q.trim()) {
        params.push(arQ(q));
        const p = `$${params.length}`;
        where = `WHERE (${n("central")} LIKE ${p} OR ${n("cabin_number")} LIKE ${p} OR ${n("box_number")} LIKE ${p})`;
      }

      const totalRes = await pool.query(
        `SELECT COUNT(*)::int AS c FROM (
           SELECT 1 FROM phone_lines ${where}
           GROUP BY central, cabin_number, box_number
         ) sub`,
        params,
      );
      const total = totalRes.rows[0].c as number;

      params.push(pageSize, offset);
      const { rows } = await pool.query(
        `SELECT central,
                COALESCE(cabin_number, '') AS "cabinNumber",
                COALESCE(box_number, '') AS "boxNumber",
                COUNT(*)::int AS count
         FROM phone_lines ${where}
         GROUP BY central, cabin_number, box_number
         ORDER BY central, cabin_number, box_number
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      res.json({ ok: true, data: rows, total, page: pageNum, limit: pageSize });
    } catch (e) {
      res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // GET /api/phone-report — token-protected, returns phone_lines rows with filters
  app.get("/api/phone-report", requireApiToken, async (req, res) => {
    try {
      const pageNum  = Math.max(1, parseInt(String(req.query.page  || "1"))  || 1);
      const pageSize = Math.min(12000, Math.max(1, parseInt(String(req.query.limit || "100")) || 100));
      const offset   = (pageNum - 1) * pageSize;
      const q        = String(req.query.q        || "").trim();
      const exchange = String(req.query.exchange || "").trim();
      const cabinet  = String(req.query.cabinet  || "").trim();
      const box      = String(req.query.box      || "").trim();

      const params: any[] = [];
      const conds: string[] = [];

      if (exchange) { params.push(arQ(exchange)); conds.push(`${n("central")} LIKE $${params.length}`); }
      if (cabinet)  { params.push(arQ(cabinet));  conds.push(`${n("cabin_number")} LIKE $${params.length}`); }
      if (box)      { params.push(arQ(box));      conds.push(`${n("box_number")} LIKE $${params.length}`); }
      if (q) {
        params.push(arQ(q));
        const p = `$${params.length}`;
        conds.push(`(${n("full_phone")} LIKE ${p} OR ${n("tel_no")} LIKE ${p} OR ${n("central")} LIKE ${p} OR ${n("cabin_number")} LIKE ${p} OR ${n("box_number")} LIKE ${p})`);
      }

      const where = conds.length ? "WHERE " + conds.join(" AND ") : "";

      const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM phone_lines ${where}`, params);
      const total = countRes.rows[0].c as number;

      params.push(pageSize, offset);
      const { rows } = await pool.query(
        `SELECT id,
                tel_no AS "telNo",
                central,
                idu_no AS "iduNo",
                odu_no AS "oduNo",
                cabin_number AS "cabinNumber",
                primary_block_no AS "primaryBlockNo",
                cabinet_in AS "cabinetIn",
                sec_block_no AS "secBlockNo",
                cabinet_out AS "cabinetOut",
                box_number AS "boxNumber",
                dp_terminal AS "dpTerminal",
                port,
                len,
                fiber_block AS "fiberBlock",
                fiber_out AS "fiberOut",
                tel_num_txt AS "telNumTxt",
                full_phone AS "fullPhone"
         FROM phone_lines ${where}
         ORDER BY id
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      res.json({ ok: true, data: rows, total, page: pageNum, limit: pageSize });
    } catch (e) {
      res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // === Phone Line Edits ===

  // PUT /api/phone-lines/:id — edit cabin/box/dpTerminal + create audit record
  app.put("/api/phone-lines/:id", requireAuth, requireTechOrAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const user = req.user as any;
    const { cabinNumber, boxNumber, dpTerminal, cabinetIn } = req.body;

    if (!cabinNumber || !boxNumber || !dpTerminal) {
      return res.status(400).json({ message: "cabinNumber و boxNumber و dpTerminal مطلوبة" });
    }

    // Load current line
    const lineRes = await pool.query(
      `SELECT id, central, cabin_number, box_number, dp_terminal, full_phone FROM phone_lines WHERE id = $1`,
      [id],
    );
    if (lineRes.rows.length === 0) return res.status(404).json({ message: "الخط غير موجود" });
    const line = lineRes.rows[0];

    // Skip if nothing changed
    if (line.cabin_number === cabinNumber && line.box_number === boxNumber && line.dp_terminal === dpTerminal) {
      return res.status(200).json({ message: "لا يوجد تغيير في البيانات" });
    }

    const cabinChanged = line.cabin_number !== cabinNumber;
    if (cabinChanged && !cabinetIn) {
      return res.status(400).json({ message: "عند تغيير الكابينة يجب تحديد قيمة الدخل (cabinet_in)" });
    }

    // Uniqueness check: same (central, cabinNumber, boxNumber, dpTerminal) in another record
    const conflict = await pool.query(
      `SELECT id, full_phone FROM phone_lines WHERE central = $1 AND cabin_number = $2 AND box_number = $3 AND dp_terminal = $4 AND id <> $5 LIMIT 1`,
      [line.central, cabinNumber, boxNumber, dpTerminal, id],
    );
    if (conflict.rows.length > 0) {
      return res.status(409).json({
        message: "هذه البيانات مستخدمة بالفعل مع خط آخر",
        conflictLine: { fullPhone: conflict.rows[0].full_phone, id: conflict.rows[0].id },
      });
    }

    // Update phone_lines (also update cabinet_in + idu_no/odu_no when cabin changes)
    if (cabinChanged) {
      // Derive canonical idu/odu from the new (central, cabin) pair
      const iduOduRes = await pool.query(
        `SELECT idu_no, odu_no FROM phone_lines
         WHERE central = $1 AND cabin_number = $2 AND idu_no IS NOT NULL
         LIMIT 1`,
        [line.central, cabinNumber],
      );
      const newIduNo = iduOduRes.rows[0]?.idu_no ?? null;
      const newOduNo = iduOduRes.rows[0]?.odu_no ?? null;

      await pool.query(
        `UPDATE phone_lines SET cabin_number = $1, box_number = $2, dp_terminal = $3, cabinet_in = $4, idu_no = $5, odu_no = $6 WHERE id = $7`,
        [cabinNumber, boxNumber, dpTerminal, cabinetIn, newIduNo, newOduNo, id],
      );
    } else {
      await pool.query(
        `UPDATE phone_lines SET cabin_number = $1, box_number = $2, dp_terminal = $3 WHERE id = $4`,
        [cabinNumber, boxNumber, dpTerminal, id],
      );
    }

    // Insert audit record
    await pool.query(
      `INSERT INTO phone_line_edits
         (phone_line_id, full_phone, central, old_cabin_number, new_cabin_number, old_box_number, new_box_number, old_dp_terminal, new_dp_terminal, edited_by_id, edited_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, line.full_phone, line.central, line.cabin_number, cabinNumber, line.box_number, boxNumber, line.dp_terminal, dpTerminal, user.id, user.username],
    );

    res.json({ success: true });
  });

  // POST /api/phone-lines/edits/:id/rollback — admin: any pending; tech: only their own
  app.post("/api/phone-lines/edits/:id/rollback", requireAuth, requireTechOrAdmin, async (req, res) => {
    const editId = parseInt(req.params.id);
    const user = req.user as any;

    const editRes = await pool.query(
      `SELECT * FROM phone_line_edits WHERE id = $1`,
      [editId],
    );
    if (editRes.rows.length === 0) return res.status(404).json({ message: "السجل غير موجود" });
    const edit = editRes.rows[0];

    if (edit.status !== "pending") {
      return res.status(400).json({ message: "لا يمكن التراجع — السجل ليس تحت التنفيذ" });
    }

    // Tech/External can only rollback their own edits
    if ((user.role === ROLES.TECH || user.role === ROLES.EXTERNAL) && edit.edited_by_id !== user.id) {
      return res.status(403).json({ message: "يمكنك فقط التراجع عن تعديلاتك الشخصية" });
    }

    // Revert phone_lines to old values
    await pool.query(
      `UPDATE phone_lines SET cabin_number = $1, box_number = $2, dp_terminal = $3 WHERE id = $4`,
      [edit.old_cabin_number, edit.old_box_number, edit.old_dp_terminal, edit.phone_line_id],
    );

    // Mark edit as rolled_back
    await pool.query(
      `UPDATE phone_line_edits SET status = 'rolled_back', rolled_back_by_id = $1, rolled_back_by_name = $2, rolled_back_at = now() WHERE id = $3`,
      [user.id, user.username, editId],
    );

    res.json({ success: true });
  });

  // POST /api/phone-lines/edits/:id/confirm — data_manager only
  app.post("/api/phone-lines/edits/:id/confirm", requireAuth, requireDataManager, async (req, res) => {
    const editId = parseInt(req.params.id);
    const user = req.user as any;

    const editRes = await pool.query(
      `SELECT status FROM phone_line_edits WHERE id = $1`,
      [editId],
    );
    if (editRes.rows.length === 0) return res.status(404).json({ message: "السجل غير موجود" });
    if (editRes.rows[0].status !== "pending") {
      return res.status(400).json({ message: "السجل ليس تحت التنفيذ" });
    }

    await pool.query(
      `UPDATE phone_line_edits SET status = 'completed', confirmed_by_id = $1, confirmed_by_name = $2, confirmed_at = now() WHERE id = $3`,
      [user.id, user.username, editId],
    );

    res.json({ success: true });
  });

  // GET /api/phone-lines/edits — list edits, optional ?status=pending|completed|rolled_back&search=<phone>
  app.get("/api/phone-lines/edits", requireAuth, async (req, res) => {
    const user = req.user as any;
    const allowed = [ROLES.ADMIN, ROLES.TECH, ROLES.DATA_MANAGER, ROLES.SUPER_ADMIN];
    if (!allowed.includes(user.role)) return res.status(403).json({ message: "Forbidden" });

    const { status = "", search = "" } = req.query as Record<string, string>;
    const conds: string[] = [];
    const params: any[] = [];

    if (status) { params.push(status); conds.push(`status = $${params.length}`); }
    if (search.trim()) { params.push(arQ(search)); conds.push(`${n("full_phone")} LIKE $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT id, phone_line_id AS "phoneLineId", full_phone AS "fullPhone", central,
              old_cabin_number AS "oldCabinNumber", new_cabin_number AS "newCabinNumber",
              old_box_number AS "oldBoxNumber", new_box_number AS "newBoxNumber",
              old_dp_terminal AS "oldDpTerminal", new_dp_terminal AS "newDpTerminal",
              status,
              edited_by_id AS "editedById", edited_by_name AS "editedByName", edited_at AS "editedAt",
              confirmed_by_name AS "confirmedByName", confirmed_at AS "confirmedAt",
              rolled_back_by_name AS "rolledBackByName", rolled_back_at AS "rolledBackAt"
       FROM phone_line_edits ${where}
       ORDER BY edited_at DESC`,
      params,
    );

    res.json(rows);
  });

  // === Public API: Box Summary (Bearer Token Auth) ===
  // OPTIONS preflight for cross-origin requests
  // ⚠️ المسار ده كان اسمه /api/box-summary زى اللى فوقه بالظبط — و Express بيدّى
  // الأولوية للأول اللى اتسجّل، فالنسخة دى كانت **مش شغّالة خالص** من غير ما حد
  // ياخد باله (الاتنين مختلفين تماماً: اللى فوق بيرجّع تجميع البكسات من بيان
  // الخطوط، ودى بترجّع الطلبات المتعذرة). اتسمّت باسمها الصح: /api/box-orders.
  app.options("/api/box-orders", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.status(204).end();
  });

  // GET /api/box-orders?page=1&limit=100&q=<search> — الطلبات المتعذرة (لموقع خارجى)
  app.get("/api/box-orders", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token || token !== process.env.SF_API_TOKEN) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) || "100", 10)));
    const q = ((req.query.q as string) || "").trim();
    const offset = (page - 1) * limit;

    const params: any[] = [];
    const conds: string[] = ["status = 'not_feasible'"];

    if (q) {
      params.push(arQ(q));
      conds.push(`(
        ${n("customer_name")} LIKE $${params.length} OR
        ${n("central_name")} LIKE $${params.length} OR
        ${n("cabin_number")} LIKE $${params.length} OR
        ${n("box_number")} LIKE $${params.length}
      )`);
    }

    const where = `WHERE ${conds.join(" AND ")}`;

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM orders ${where}`,
      params,
    );
    const total = parseInt(countRes.rows[0].total, 10);

    params.push(limit);
    params.push(offset);
    const dataRes = await pool.query(
      `SELECT
         id,
         customer_name   AS "customerName",
         customer_phone  AS "customerPhone",
         central_name    AS "centralName",
         cabin_number    AS "cabinNumber",
         box_number      AS "boxNumber",
         nearest_box_distance AS "nearestBoxDistance",
         rejection_reason AS "rejectionReason",
         tech_name       AS "techName",
         tech_response_at AS "techResponseAt",
         sales_name      AS "salesName",
         created_at      AS "createdAt"
       FROM orders ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({
      ok: true,
      data: dataRes.rows,
      total,
      page,
      limit,
    });
  });

  // ===== الأعطال «خارج الشاشة» (اليدوية): زر «الخط به عطل» + انتظام =====
  const MF_FLAG_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EXTERNAL];
  const MF_REG_ROLES = [ROLES.TECH, ROLES.SUPER_ADMIN];

  // تسجيل عطل يدوى للخط — يمنع التكرار لو فيه عطل مفتوح بالفعل
  app.post("/api/manual-faults/flag", requireAuth, async (req: any, res) => {
    if (!MF_FLAG_ROLES.includes(req.user.role)) return res.status(403).json({ message: "غير مسموح" });
    const b = req.body || {};
    const phoneShort = String(b.phoneShort || "").replace(/^88/, "").trim();
    const fullPhone = String(b.fullPhone || (phoneShort ? "88" + phoneShort : "")).trim();
    if (!phoneShort && !b.accountNo) return res.status(400).json({ message: "لا يوجد رقم خط" });
    const { rows: ex } = await pool.query(
      `SELECT id FROM manual_faults WHERE status='open' AND (phone_short=$1 OR full_phone=$2) LIMIT 1`, [phoneShort, fullPhone]);
    if (ex.length) return res.json({ ok: false, duplicate: true, message: "الخط ده فيه عطل مسجّل بالفعل (لم ينتظم بعد)" });
    await pool.query(
      `INSERT INTO manual_faults (full_phone, phone_short, account_no, central, cabin_number, box_number, msan_code, tech_name, status, flagged_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9)`,
      [fullPhone || null, phoneShort || null, b.accountNo || null, b.central || null, b.cabinNumber || null, b.boxNumber || null, b.msanCode || null, b.techName || null, String(req.user.username || "")]);
    res.json({ ok: true });
  });

  // انتظام عطل يدوى: تسجيل سبب الإغلاق + الوقت + فنى الانتظام (لو سوبر أدمن يبعت اسم الفنى)
  app.post("/api/manual-faults/regularize", requireAuth, async (req: any, res) => {
    if (!MF_REG_ROLES.includes(req.user.role)) return res.status(403).json({ message: "غير مسموح" });
    const b = req.body || {};
    const phoneShort = String(b.phoneShort || "").replace(/^88/, "").trim();
    const fullPhone = String(b.fullPhone || (phoneShort ? "88" + phoneShort : "")).trim();
    const closeCode = String(b.closeCode || "").trim();
    if (!closeCode) return res.status(400).json({ message: "اختر سبب الإغلاق" });
    const techName = (req.user.role === ROLES.SUPER_ADMIN && b.techName) ? String(b.techName).trim() : String(req.user.username || "");
    // عند الانتظام نسجّل snapshot للبيان الفنى الحالى (زى بحث برقم التليفون وقت الانتظام):
    // السنترال/الكابينة/البكس من phone_lines، وكود MSAN من phone_ports ثم cabinet_technicians،
    // واسم فنى الكابينة الحالى — فالأرشيف يعكس حالة الخط وقت الانتظام مش وقت تسجيل العطل.
    const { rows } = await pool.query(
      `UPDATE manual_faults mf SET
         status='regularized', regularized_at=now(), regularized_by=$3, close_code=$4,
         central      = COALESCE(cur.central, mf.central),
         cabin_number = COALESCE(cur.cabin_number, mf.cabin_number),
         box_number   = COALESCE(cur.box_number, mf.box_number),
         msan_code    = COALESCE(cur.msan_code, mf.msan_code),
         tech_name    = COALESCE(cur.tech_name, mf.tech_name)
       FROM (
         SELECT pl.central, pl.cabin_number, pl.box_number,
                COALESCE(NULLIF(pp.msan_code,''), ctc.cabin_code) AS msan_code,
                ctc.tech_name
         FROM (SELECT 1) o
         LEFT JOIN LATERAL (SELECT central, cabin_number, box_number FROM phone_lines WHERE full_phone=$2 OR tel_no=$1 LIMIT 1) pl ON true
         LEFT JOIN phone_ports pp ON pp.phone_number=$2
         LEFT JOIN LATERAL (
           SELECT ct.cabin_code, tn.tech_name FROM cabinet_technicians ct
           LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
           WHERE ct.central_name = pl.central AND ct.cabin_number = pl.cabin_number
           ORDER BY (ct.cabin_code IS NOT NULL AND ct.cabin_code <> '') DESC, tn.tech_name NULLS LAST LIMIT 1
         ) ctc ON true
       ) cur
       WHERE mf.status='open' AND (mf.phone_short=$1 OR mf.full_phone=$2) RETURNING mf.id`,
      [phoneShort, fullPhone, techName || null, closeCode]);
    if (!rows.length) return res.json({ ok: false, message: "لا يوجد عطل مفتوح لهذا الخط" });
    res.json({ ok: true, count: rows.length });
  });

  // الأعطال الحالية خارج الشاشة (المفتوحة)
  app.get("/api/manual-faults/current", requireAuth, async (req: any, res) => {
    // الفنى يشوف أعطاله هو بس. و«أعطاله» = أعطال كباينه، وكمان أعطال الزميل اللى هو
    // قائم بالعمل مكانه فى الوردية يوم العطل (نفس منطق areaTechSql المستخدَم فى نسبة
    // الإزالة والتكرار: صاحب الكابينة، إلا لو كان «راحه/إجازة» فالمسؤول فنى الوردية).
    // باقى الأدوار بتشوف الكل.
    const params: any[] = [];
    let techWhere = "";
    if (req.user?.role === ROLES.TECH) {
      const wc = String(req.user.workerCode || "").trim();
      const { rows: tn } = await pool.query(
        `SELECT tech_name FROM technician_names WHERE worker_code = $1 LIMIT 1`, [wc]);
      const techName = String(tn[0]?.tech_name || req.user.fullName || req.user.username || "").trim();
      // مالوش اسم فنى معروف → مايشوفش حاجة (أأمن من إنه يشوف الكل)
      if (!techName) return res.json({ data: [] });
      params.push(techName);
      techWhere = ` AND btrim(COALESCE(${areaTechSql(
        "COALESCE(pl.central, mf.central)",
        "COALESCE(pl.cabin_number, mf.cabin_number)",
        "mf.flagged_at",
      )}, '')) = btrim($${params.length})`;
    }
    // إثراء بنفس بيانات «الأعطال الحالية»: آخر قياس + القياس الحالى (بعد تسجيل العطل) + بيانات
    // البورت + أحداث PO — بالمطابقة بالتليفون الكامل (mf.full_phone = 88+الرقم).
    const { rows } = await pool.query(
      `SELECT mf.id, mf.full_phone AS "fullPhone", mf.phone_short AS "phoneShort",
              COALESCE(mf.account_no, c138p.account_no) AS "accountNo",
              -- بيانات الكابينة/البكس/MSAN: نفضّل البيان الحالى (بعد تغيير البورت) من phone_lines
              -- و phone_ports.msan_code و cabinet_technicians، ونرجع للمخزّن وقت العطل لو مفيش حالى.
              COALESCE(pl.central, mf.central) AS central,
              COALESCE(pl.cabin_number, mf.cabin_number) AS "cabinNumber",
              COALESCE(pl.box_number, mf.box_number) AS "boxNumber",
              COALESCE(NULLIF(pp.msan_code, ''), ctc.cabin_code, mf.msan_code) AS "msanCode",
              COALESCE(NULLIF(ctc.tech_name, ''), mf.tech_name) AS "techName", (mf.flagged_at AT TIME ZONE 'Africa/Cairo') AS "flaggedAt", mf.flagged_by AS "flaggedBy",
              pp.frame AS "frame", pp.shelf AS "shelf", pp.slot AS "slot", pp.port_number AS "portNumber",
              pp.port_type AS "portType", pp.voice_status AS "voiceStatus", pp.data_status AS "dataStatus",
              pp.operator AS "operator", pp.onu AS "onu",
              c138p.current_speed AS "lineCurrentSpeed", c138p.max_speed AS "lineMaxSpeed",
              c138p.score AS "lastMeasScore", c138p.complain_no AS "lastMeasComplainNo",
              (c138p.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime",
              c138c.score AS "curMeasScore", c138c.current_speed AS "curMeasCurrentSpeed",
              c138c.max_speed AS "curMeasMaxSpeed", (c138c.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "curMeasTime",
              (pe.last_raise_at AT TIME ZONE 'Africa/Cairo') AS "lastPoRaiseAt",
              (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') AS "lastPoStopAt",
              mob.m AS "mobile"
       FROM manual_faults mf
       LEFT JOIN phone_ports pp ON pp.phone_number = mf.full_phone
       LEFT JOIN LATERAL (
         SELECT central, cabin_number, box_number, port
         FROM phone_lines WHERE full_phone = mf.full_phone OR tel_no = mf.phone_short LIMIT 1
       ) pl ON true
       LEFT JOIN LATERAL (
         SELECT ct.cabin_code, tn.tech_name FROM cabinet_technicians ct
         LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
         WHERE ct.central_name = COALESCE(pl.central, mf.central)
           AND ct.cabin_number = COALESCE(pl.cabin_number, mf.cabin_number)
         ORDER BY (ct.cabin_code IS NOT NULL AND ct.cabin_code <> '') DESC, tn.tech_name NULLS LAST LIMIT 1
       ) ctc ON true
       LEFT JOIN LATERAL (
         SELECT c.account_no, c.current_speed, c.max_speed, c.score, c.complain_no, c.uploaded_at
         FROM case_138 c WHERE c.full_phone = mf.full_phone ORDER BY c.id DESC LIMIT 1
       ) c138p ON true
       LEFT JOIN LATERAL (
         SELECT c.score, c.current_speed, c.max_speed, c.uploaded_at
         FROM case_138 c WHERE c.full_phone = mf.full_phone AND c.uploaded_at >= mf.flagged_at
         ORDER BY c.id DESC LIMIT 1
       ) c138c ON true
       LEFT JOIN line_po_events pe ON pe.account_no = COALESCE(mf.account_no, c138p.account_no)
       LEFT JOIN LATERAL (
         -- رقم الموبايل المسجّل: الأولوية للمُدخَل يدوياً (line_mobiles) ثم أوامر الشغل ثم FTTH
         SELECT m FROM (
           SELECT lm.mobile AS m, 0 AS pr FROM line_mobiles lm WHERE lm.full_phone = mf.full_phone
           UNION ALL
           SELECT mo.mobile AS m, 1 AS pr FROM maintenance_orders mo
             WHERE mo.phone_number IN (mf.phone_short, mf.full_phone)
               AND mo.mobile !~ '[A-Za-z=/]' AND mo.mobile ~ '[0-9]{5,}'
           UNION ALL
           SELECT fo.customer_mobile AS m, 2 AS pr FROM ftth_orders_current fo
             WHERE fo.service_number IN (mf.phone_short, mf.full_phone)
               AND fo.customer_mobile !~ '[A-Za-z=/]' AND fo.customer_mobile ~ '[0-9]{5,}'
         ) x WHERE NULLIF(btrim(x.m),'') IS NOT NULL ORDER BY pr LIMIT 1
       ) mob ON true
       WHERE mf.status='open'${techWhere} ORDER BY mf.flagged_at DESC`, params);
    res.json({ data: rows });
  });

  // GET /api/reports/engineering-inspection?phones=... — بيانات إيميل «اغلاق تفتيش هندسى»:
  // لكل رقم يرجّع اسم السنترال + كوده + رقم الكابينة الحالى (MSAN) + تاريخ آخر شكوى للمشترك.
  app.get("/api/reports/engineering-inspection", requireAuth, async (req, res) => {
    const raw = String((req.query as any).phones || "");
    const list = raw.split(/[\s,;]+/).map((s) => s.replace(/\D/g, "")).filter(Boolean);
    if (!list.length) return res.json({ data: [] });
    const uniq = Array.from(new Set(list));
    const { rows } = await pool.query(
      `WITH n AS (
         SELECT d AS digits, regexp_replace(d, '^88', '') AS short,
                CASE WHEN d LIKE '88%' THEN d ELSE '88'||d END AS full
         FROM unnest($1::text[]) AS d
       )
       SELECT n.short AS "phoneShort",
              COALESCE(pl.central, cplc.central_name) AS central,
              CASE COALESCE(pl.central, cplc.central_name)
                WHEN 'الغنايم'              THEN 'GHNAT'
                WHEN 'الغنايم-العزايزة'     THEN 'AMZAT'
                WHEN 'الغنايم-دير الجنادله' THEN 'DRGAT'
                WHEN 'الغنايم-نجع العمدة'   THEN 'NGOAT'
                ELSE NULL END AS "centralCode",
              COALESCE(NULLIF(pp.msan_code, ''), ctc.cabin_code) AS "currentCabin",
              (cpl.complain_time AT TIME ZONE 'Africa/Cairo') AS "lastComplaintAt"
       FROM n
       LEFT JOIN LATERAL (
         SELECT central, cabin_number FROM phone_lines WHERE full_phone = n.full OR tel_no = n.short LIMIT 1
       ) pl ON true
       LEFT JOIN phone_ports pp ON pp.phone_number = n.full
       LEFT JOIN LATERAL (
         SELECT ct.cabin_code FROM cabinet_technicians ct
         WHERE ct.central_name = COALESCE(pl.central, '') AND ct.cabin_number = COALESCE(pl.cabin_number, '')
         ORDER BY (ct.cabin_code IS NOT NULL AND ct.cabin_code <> '') DESC LIMIT 1
       ) ctc ON true
       LEFT JOIN LATERAL (
         SELECT complain_time FROM (
           SELECT complain_time FROM complaint_details WHERE phone_number = n.short
           UNION ALL
           SELECT complain_time FROM remaining_complaints WHERE phone_number = n.short
         ) u ORDER BY complain_time DESC NULLS LAST LIMIT 1
       ) cpl ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(NULLIF(central_name,''), exchange_name) AS central_name
         FROM complaint_details WHERE phone_number = n.short ORDER BY complain_time DESC NULLS LAST LIMIT 1
       ) cplc ON true
       ORDER BY n.short`,
      [uniq]);
    res.json({ data: rows });
  });

  // الأعطال المنتظمة خارج الشاشة لفترة
  app.get("/api/manual-faults/regularized", requireAuth, async (req, res) => {
    const { from = "", to = "" } = req.query as Record<string, string>;
    const conds = ["status='regularized'"]; const params: any[] = [];
    // الفلترة بتوقيت القاهرة زى ما التاريخ بيتعرض — المقارنة الخام بـUTC كانت
    // بتسقط الانتظامات اللى حصلت بين منتصف الليل و2/3 الفجر من المدى المختار.
    if (from) { params.push(from); conds.push(`(regularized_at AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}::date`); }
    if (to) { params.push(to); conds.push(`(regularized_at AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}::date`); }
    const { rows } = await pool.query(
      `SELECT id, full_phone AS "fullPhone", phone_short AS "phoneShort", account_no AS "accountNo",
              central, cabin_number AS "cabinNumber", box_number AS "boxNumber", msan_code AS "msanCode",
              tech_name AS "techName", close_code AS "closeCode",
              (flagged_at AT TIME ZONE 'Africa/Cairo') AS "flaggedAt", flagged_by AS "flaggedBy",
              (regularized_at AT TIME ZONE 'Africa/Cairo') AS "regularizedAt", regularized_by AS "regularizedBy"
       FROM manual_faults WHERE ${conds.join(" AND ")} ORDER BY regularized_at DESC`, params);
    res.json({ data: rows });
  });

  // حالة العطل المفتوح + آخر انتظام لخط (لأزرار بحث برقم التليفون) — يقارن اليدوى بـ 430D ويرجّع الأحدث
  app.get("/api/manual-faults/for-line", requireAuth, async (req, res) => {
    const phone = String((req.query as any).phone || "").trim();
    if (!phone) return res.json({ hasOpenFault: false, lastRegularization: null });
    const short = phone.replace(/^88/, ""); const full = phone.startsWith("88") ? phone : "88" + phone;
    const { rows: op } = await pool.query(`SELECT id FROM manual_faults WHERE status='open' AND (phone_short=$1 OR full_phone=$2) LIMIT 1`, [short, full]);
    const { rows: mr } = await pool.query(`SELECT (regularized_at AT TIME ZONE 'Africa/Cairo') AS at, close_code AS code FROM manual_faults WHERE status='regularized' AND (phone_short=$1 OR full_phone=$2) ORDER BY regularized_at DESC LIMIT 1`, [short, full]);
    const { rows: dr } = await pool.query(`SELECT (close_time AT TIME ZONE 'Africa/Cairo') AS at, close_code AS code FROM complaint_details WHERE phone_number=$1 AND close_time IS NOT NULL ORDER BY close_time DESC LIMIT 1`, [short]);
    const cand: any[] = [];
    if (mr[0]?.at) cand.push({ at: mr[0].at, closeCode: mr[0].code, source: "manual" });
    if (dr[0]?.at) cand.push({ at: dr[0].at, closeCode: dr[0].code, source: "430d" });
    cand.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json({ hasOpenFault: op.length > 0, lastRegularization: cand[0] || null });
  });

  // تاريخ أعطال الخط: كل الانتظامات (يدوية + 430D) بتواريخها وأسباب إغلاقها
  app.get("/api/line-fault-history", requireAuth, async (req, res) => {
    const phone = String((req.query as any).phone || "").trim();
    if (!phone) return res.json({ history: [] });
    const short = phone.replace(/^88/, ""); const full = phone.startsWith("88") ? phone : "88" + phone;
    const { rows: mr } = await pool.query(`SELECT (regularized_at AT TIME ZONE 'Africa/Cairo') AS at, close_code AS code, regularized_by AS by FROM manual_faults WHERE status='regularized' AND (phone_short=$1 OR full_phone=$2) ORDER BY regularized_at DESC`, [short, full]);
    const { rows: dr } = await pool.query(`SELECT (close_time AT TIME ZONE 'Africa/Cairo') AS at, close_code AS code, close_by AS by, (complain_time AT TIME ZONE 'Africa/Cairo') AS "complainAt" FROM complaint_details WHERE phone_number=$1 AND close_time IS NOT NULL ORDER BY close_time DESC`, [short]);
    const history = [
      ...(mr as any[]).map((r) => ({ date: r.at, closeCode: r.code, by: r.by, source: "manual" })),
      ...(dr as any[]).map((r) => ({ date: r.at, closeCode: r.code, by: r.by, complainAt: r.complainAt, source: "430d" })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    res.json({ history });
  });

  // GET /api/reports/current-faults — الأعطال الحالية (status 160,173,122,73,72,60,81)
  // Joins case_138 ← phone_ports ← cabinet_technicians
  // البيان معتمد على ملف شكاوى DSL الحالى (ticket_dsl_current) — وليس حاله 138.
  // الأكواد المطلوبة: 160/173/122/81 (Status Code) و 73/72/60 (ComplainTypeName).
  app.get("/api/reports/current-faults", requireAuth, async (req, res) => {
    try {
      const { central = "", q = "" } = req.query as Record<string, string>;
      const params: any[] = [];
      const conds: string[] = [
        `t.close_date IS NULL`,
        `(t.status_code ~ '^(160|173|122|73|72|60|81)' OR t.complain_type_name ~ '^(160|173|122|73|72|60|81)')`,
        `(t.central_name = 'الغنايم' OR t.central_name = 'الغنايم-العزايزة' OR t.central_name = 'الغنايم-دير الجنادله' OR t.central_name = 'الغنايم-نجع العمدة')`,
      ];
      if (central) { params.push(central); conds.push(`t.central_name = $${params.length}`); }
      if (q.trim()) {
        params.push(arQ(q));
        const p = `$${params.length}`;
        conds.push(`(${n("t.phone_number")} LIKE ${p} OR ${n("t.cabinet_no")} LIKE ${p} OR ${n("t.status_code")} LIKE ${p} OR ${n("pl.box_number")} LIKE ${p})`);
      }
      const where = "WHERE " + conds.join(" AND ");

      // DISTINCT ON (ticket_id) — آخر حالة لكل شكوى (أعلى id)، ثم ترتيب بوقت الشكوى.
      const { rows } = await pool.query(
        `SELECT x.*, (pe.last_raise_at AT TIME ZONE 'Africa/Cairo') AS "lastPoRaiseAt",
                (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') AS "lastPoStopAt" FROM (
           SELECT DISTINCT ON (t.ticket_id)
             t.ticket_id             AS "ticketId",
             t.central_name          AS "centralName",
             t.phone_number          AS "phoneShort",
             -- مكرر: يوجد شكوى مغلقة سابقة (complaint_details) لنفس الرقم، تاريخ شكواها
             -- (Complain Time) يقع في نفس شهر الشكوى الحالية، بيوم مختلف.
             -- (المقارنة بتاريخ الشكوى وليس الإغلاق: شكوى تاريخها الشهر السابق وأُغلقت
             --  هذا الشهر لا تُعتبر تكراراً لهذا الشهر.)
             CASE WHEN t.phone_number IS NOT NULL AND t.phone_number <> '' AND t.complaint_time IS NOT NULL
                       AND EXISTS (
                         SELECT 1 FROM complaint_details cd
                         WHERE cd.close_time IS NOT NULL
                           AND regexp_replace(COALESCE(cd.phone_number,''), '\\D', '', 'g') LIKE '%' || t.phone_number
                           AND date_trunc('month', cd.complain_time) = date_trunc('month', t.complaint_time)
                           AND (cd.complain_time IS NULL OR cd.complain_time::date <> t.complaint_time::date)
                       )
                  THEN 'مكرر' ELSE '' END AS "repeatStatus",
             -- monthRepeat: منطق مستقل عن «مكرر» — يوجد رقم شكوى آخر لنفس الرقم خلال شهر
             -- (±30 يوم) من تاريخ الشكوى الحالية، سواء نفس الشهر أو الشهر السابق. لا يُكتب «مكرر».
             (t.phone_number IS NOT NULL AND t.phone_number <> '' AND t.complaint_time IS NOT NULL
              AND (
                EXISTS (
                  SELECT 1 FROM complaint_details cd
                  WHERE regexp_replace(COALESCE(cd.phone_number,''), '\\D', '', 'g') LIKE '%' || t.phone_number
                    AND cd.complain_no <> t.ticket_id
                    AND cd.complain_time IS NOT NULL
                    AND cd.complain_time >= t.complaint_time - interval '1 month'
                    AND cd.complain_time <= t.complaint_time + interval '1 month'
                )
                OR EXISTS (
                  SELECT 1 FROM remaining_complaints rc
                  WHERE regexp_replace(COALESCE(rc.phone_number,''), '\\D', '', 'g') LIKE '%' || t.phone_number
                    AND rc.complain_no <> t.ticket_id
                    AND rc.complain_time IS NOT NULL
                    AND rc.complain_time >= t.complaint_time - interval '1 month'
                    AND rc.complain_time <= t.complaint_time + interval '1 month'
                )
              )) AS "monthRepeat",
             t.status_code           AS "statusCode",
             ct.cabin_code           AS "msanCode",
             pp.frame                AS "frame",
             t.cabinet_no            AS "cabinetNo",
             pl.box_number           AS "boxNo",
             pl.dp_terminal          AS "dpTerminal",
             t.complaint_time        AS "complainTime",
             t.complain_type_name    AS "complainTypeName",
             NULL                    AS "customerName",
             -- التصنيف بيتبع **الوقت الفعلى** (نفس رقم عمود «الوقت الفعلى») مش الزمن
             -- الخام — عشان الشارة والعمود مايتعارضوش، وعشان يتفق مع الإحصائيات
             -- اللى أصلاً بتحسب بالساعات الفعلية.
             CASE
               WHEN t.complaint_time IS NULL THEN NULL
               WHEN (${openEffectiveHoursSql('t', 'rcd')}) < 24 THEN 'اعطال 24 ساعه'
               WHEN (${openEffectiveHoursSql('t', 'rcd')}) < 48 THEN 'اعطال 48 ساعه'
               ELSE 'المتبقيات'
             END                     AS "faultClass",
             t.close_date            AS "closeDate",
             t.onu                   AS "onu",
             ct.worker_code          AS "workerCode",
             tn.tech_name            AS "techName",
             ct.haya_karima          AS "hayaKarima",
             NULL                    AS "faultType",
             pp.voice_status         AS "voiceStatus",
             pp.data_status          AS "dataStatus",
             pp.shelf                AS "shelf",
             pp.slot                 AS "slot",
             pp.port_number          AS "portNumber",
             t.central_code          AS "centralCode",
             c138p.account_no        AS "accountNo",
             c138p.current_speed     AS "lineCurrentSpeed",
             c138p.max_speed         AS "lineMaxSpeed",
             c138p.score             AS "lastMeasScore",
             c138p.complain_no       AS "lastMeasComplainNo",
             (c138p.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime",
             c138c.score             AS "curMeasScore",
             c138c.current_speed     AS "curMeasCurrentSpeed",
             c138c.max_speed         AS "curMeasMaxSpeed",
             (c138c.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "curMeasTime",
             -- الوقت الفعلى للشكوى = (الآن − وقت الشكوى) − الوقت الذى قضته على الحالة 135/138
             -- يُحسب من شيت تفاصيل المتبقى (430D) بمطابقة رقم الشكوى: delta = full − except135
             -- لو time_till_now_full فارغ: نقدّر وقت الحالة 135 = (uploaded_at − complain_time) − time_till_now
             ${openEffectiveHoursSql('t', 'rcd')} AS "effectiveFaultHours"
           FROM ticket_dsl_current t
           -- التطبيع لازم: phone_ports كامل (88+) وticket_dsl_current قصير (شوف
           -- الملاحظة فى تقرير المنتظم) — من غيره عمود Frame بيفضل فاضى للكل.
           LEFT JOIN LATERAL (
             SELECT p.* FROM phone_ports p
              WHERE ${sp("p.phone_number")} = ${sp("t.phone_number")}
              ORDER BY length(p.phone_number) DESC LIMIT 1
           ) pp ON true
           LEFT JOIN phone_lines pl ON pl.tel_no = t.phone_number
           LEFT JOIN cabinet_technicians ct ON ct.central_name = t.central_name AND ct.cabin_number = t.cabinet_no
           LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
           -- آخر قياس للرقم من شيت 138 (أى شكوى) — المطابقة بالتليفون الكامل (88+الرقم)
           LEFT JOIN LATERAL (
             SELECT c.account_no, c.current_speed, c.max_speed, c.score, c.complain_no, c.complain_time, c.uploaded_at
             FROM case_138 c WHERE c.full_phone = '88' || t.phone_number
             ORDER BY c.id DESC LIMIT 1
           ) c138p ON true
           -- القياس الحالى للعطل المفتوح: إمّا قياس مربوط بنفس رقم الشكوى،
           -- أو أى قياس لنفس الخط اتعمل بعد وقت فتح الشكوى (القياس من زر التقرير
           -- بيترفع بالأكونت من غير رقم شكوى، فنعتبره قياس العطل الحالى لأنه بعد فتحه).
           -- المقارنة بتحويل uploaded_at (timestamptz) لتوقيت القاهرة عشان تطابق complaint_time.
           LEFT JOIN LATERAL (
             SELECT c.score, c.current_speed, c.max_speed, c.complain_time, c.uploaded_at
             FROM case_138 c
             WHERE c.complain_no = t.ticket_id
                OR (c.full_phone = '88' || t.phone_number
                    AND t.complaint_time IS NOT NULL
                    AND (c.uploaded_at AT TIME ZONE 'Africa/Cairo') >= t.complaint_time)
             ORDER BY c.id DESC LIMIT 1
           ) c138c ON true
           -- وقت الحالة 135/138 من شيت تفاصيل المتبقى — مطابقة برقم الشكوى
           LEFT JOIN LATERAL (
             SELECT rc.time_till_now, rc.time_till_now_full, rc.uploaded_at, rc.complain_time
             FROM remaining_complaints rc WHERE rc.complain_no = t.ticket_id
             ORDER BY rc.id DESC LIMIT 1
           ) rcd ON true
           ${where}
           ORDER BY t.ticket_id, t.id DESC
         ) x
         LEFT JOIN line_po_events pe ON pe.account_no = x."accountNo"
         ORDER BY x."complainTime" ASC NULLS LAST`,
        params,
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/repeat-details?phone=<القصير>&refDate=<YYYY-MM-DD>
  // تفاصيل الشكاوى المغلقة السابقة لنفس الرقم فى نفس شهر الشكوى المرجعية (لزر «مكرر»)
  app.get("/api/reports/repeat-details", requireAuth, async (req, res) => {
    try {
      const { phone = "", refDate = "" } = req.query as Record<string, string>;
      const ph = String(phone).replace(/\D/g, "").trim();
      if (!ph || !refDate) return res.json({ prev: [] });
      const { rows } = await pool.query(
        `SELECT cd.complain_no AS "complainNo",
                (cd.complain_time AT TIME ZONE 'Africa/Cairo') AS "complainTime",
                (cd.close_time    AT TIME ZONE 'Africa/Cairo') AS "closeTime",
                cd.close_code AS "closeCode",
                COALESCE(
                  (SELECT tn.tech_name FROM technician_names tn WHERE tn.worker_code = cd.close_by LIMIT 1),
                  NULLIF(cd.close_by, ''), 'غير معروف'
                ) AS "closeByName"
         FROM complaint_details cd
         WHERE cd.close_time IS NOT NULL
           AND regexp_replace(COALESCE(cd.phone_number,''), '\\D', '', 'g') LIKE '%' || $1
           AND date_trunc('month', cd.complain_time) = date_trunc('month', $2::timestamptz)
         ORDER BY cd.complain_time DESC
         LIMIT 200`,
        [ph, refDate],
      );
      res.json({ prev: rows });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/regularized-faults — الأعطال المنتظمة اليوم
  // العطل يُعتبر "منتظماً اليوم" إذا:
  //   (أ) كان موجوداً بملف الشكاوى الحالى (ticket_dsl_current) وتاريخ إغلاقه = اليوم، أو
  //   (ب) كان موجوداً في لقطة بداية اليوم (ticket_dsl_sod) ولم يَعُد موجوداً بالحالى.
  // نفس فلاتر تقرير الأعطال الحالية (السنترالات + أكواد الأعطال).
  app.get("/api/reports/regularized-faults", requireAuth, async (req, res) => {
    try {
      const { central = "", q = "", date = "" } = req.query as Record<string, string>;
      const rows = await queryRegularizedFaults({ central, q, date });
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/regularized-faults-range — الأعطال المنتظمة خلال فترة من/إلى
  // المصدر 1: complaint_details (شيت التفاصيل) — كل السجلات المغلقة منتظمة.
  // المصدر 2: remaining_complaints (شيت المتبقى) — فقط status_code 138 و 135 منتظمة.
  app.get("/api/reports/regularized-faults-range", requireAuth, async (req, res) => {
    try {
      const { central = "", q = "", dateFrom = "", dateTo = "" } =
        req.query as Record<string, string>;
      const params: any[] = [];

      // نبنى شرطين منفصلين بنفس أرقام البارامترات — يُشاركان $1..$n فى الـ UNION
      const cdConds: string[] = [
        `cd.close_time IS NOT NULL`,
        `cd.exchange_name ILIKE '%غنايم%'`,
      ];
      const rcConds: string[] = [
        `rc.status_code IN ('138', '135')`,
        `rc.exchange_name ILIKE '%غنايم%'`,
      ];

      if (central) {
        params.push(central);
        cdConds.push(`cd.exchange_name = $${params.length}`);
        rcConds.push(`rc.exchange_name = $${params.length}`);
      }
      if (dateFrom) {
        params.push(dateFrom);
        cdConds.push(`(cd.close_time AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}::date`);
        rcConds.push(`(COALESCE(rc.close_time, rc.complain_time) AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}::date`);
      }
      if (dateTo) {
        params.push(dateTo);
        cdConds.push(`(cd.close_time AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}::date`);
        rcConds.push(`(COALESCE(rc.close_time, rc.complain_time) AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}::date`);
      }
      if (q.trim()) {
        params.push(arQ(q));
        const p = `$${params.length}`;
        cdConds.push(`(${n("cd.phone_number")} LIKE ${p} OR ${n("cd.cabinet_no")} LIKE ${p} OR ${n("cd.close_code")} LIKE ${p} OR ${n("pl.box_number")} LIKE ${p})`);
        rcConds.push(`(${n("rc.phone_number")} LIKE ${p} OR ${n("rc.cabinet_no")} LIKE ${p} OR ${n("rc.status_code")} LIKE ${p})`);
      }
      const cdWhere = "WHERE " + cdConds.join(" AND ");
      const rcWhere = "WHERE " + rcConds.join(" AND ");

      // ماكرو مشترك لكود السنترال
      const centralCodeCase = (col: string) => `CASE ${col}
             WHEN 'الغنايم'              THEN 'GHNAT'
             WHEN 'الغنايم-العزايزة'     THEN 'AMZAT'
             WHEN 'الغنايم-دير الجنادله' THEN 'DRGAT'
             WHEN 'الغنايم-نجع العمدة'   THEN 'NGOAT'
             ELSE NULL END`;

      const { rows } = await pool.query(
        `WITH combined AS (
         (
           -- ===== شيت التفاصيل: كل الأعطال المغلقة منتظمة =====
           SELECT
             cd.complain_no           AS "ticketId",
             cd.exchange_name         AS "centralName",
             cd.phone_number          AS "phoneShort",
             -- مكرر: شكوى تانية لنفس الرقم فى نفس الشهر وبيوم مختلف.
             -- المقارنة بـ **تاريخ الشكوى** مش تاريخ الإغلاق (شكوى من الشهر اللى فات
             -- اتقفلت الشهر ده مش تكرار للشهر ده) — نفس تعريف باقى التقارير بالظبط.
             -- وشرط «يوم مختلف» بيمنع إن شكويتين اتعملوا فى نفس اليوم (نفس العطل
             -- اتسجّل مرتين) يتحسبوا تكرار.
             CASE WHEN cd.phone_number IS NOT NULL AND cd.phone_number <> ''
                       AND cd.complain_time IS NOT NULL
                       AND EXISTS (
                         SELECT 1 FROM complaint_details cd2
                         WHERE cd2.complain_no <> cd.complain_no
                           AND cd2.close_time IS NOT NULL
                           AND cd2.phone_number = cd.phone_number
                           AND cd2.complain_time IS NOT NULL
                           AND date_trunc('month', cd2.complain_time) = date_trunc('month', cd.complain_time)
                           AND cd2.complain_time::date <> cd.complain_time::date
                       )
                  THEN 'مكرر' ELSE '' END AS "repeatStatus",
             -- Status Code من شيت 430D (تفاصيل متبقى) بمطابقة رقم الشكوى —
             -- شيت "التفاصيل" نفسه مافيهوش العمود ده، فنجيبه من المتبقى (آخر حالة)
             (SELECT rc2.status_code FROM remaining_complaints rc2
                WHERE rc2.complain_no = cd.complain_no
                ORDER BY rc2.id DESC LIMIT 1) AS "statusCode",
             cd.close_code            AS "closeCode",
             COALESCE(cd.msan_id, ct.cabin_code) AS "msanCode",
             pp.frame                 AS "frame",
             cd.cabinet_no            AS "cabinetNo",
             pl.box_number            AS "boxNo",
             pl.dp_terminal           AS "dpTerminal",
             cd.complain_time         AS "complainTime",
             cd.complain_type_name    AS "complainTypeName",
             -- نفس الساعات اللى تقارير الإحصائيات بتحسب بيها (closedHoursSql) —
             -- بتستبعد مدة التعليق. قبل كده الشارة كانت بالزمن الخام فكانت
             -- بتخالف الإحصائية لنفس الشكوى.
             CASE
               WHEN cd.complain_time IS NULL THEN 'مغلق'
               WHEN (${closedHoursSql('cd')}) < 24 THEN 'أعطال 24 ساعة'
               WHEN (${closedHoursSql('cd')}) < 48 THEN 'أعطال 48 ساعة'
               ELSE 'المتبقيات'
             END                      AS "regStatus",
             cd.close_time            AS "closeDate",
             pp.onu                   AS "onu",
             ct.worker_code           AS "workerCode",
             COALESCE(tn.tech_name, mcb.tech_name, cd.close_by) AS "techName",
             ct.haya_karima           AS "hayaKarima",
             pp.voice_status          AS "voiceStatus",
             pp.data_status           AS "dataStatus",
             pp.shelf                 AS "shelf",
             pp.slot                  AS "slot",
             pp.port_number           AS "portNumber",
             ${centralCodeCase("cd.exchange_name")} AS "centralCode",
             c138p.account_no         AS "accountNo",
             c138p.current_speed      AS "lineCurrentSpeed",
             c138p.max_speed          AS "lineMaxSpeed",
             c138p.score              AS "lastMeasScore",
             c138p.complain_no        AS "lastMeasComplainNo",
             (c138p.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime",
             c138c.score              AS "curMeasScore",
             c138c.current_speed      AS "curMeasCurrentSpeed",
             c138c.max_speed          AS "curMeasMaxSpeed",
             (c138c.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "curMeasTime",
             'تفاصيل'                 AS "dataSource"
           FROM complaint_details cd
           -- نفس سبب التطبيع: phone_ports كامل (88+) وcomplaint_details قصير
           LEFT JOIN LATERAL (
             SELECT p.* FROM phone_ports p
              WHERE ${sp("p.phone_number")} = ${sp("cd.phone_number")}
              ORDER BY length(p.phone_number) DESC LIMIT 1
           ) pp ON true
           LEFT JOIN phone_lines pl       ON pl.tel_no = cd.phone_number
           LEFT JOIN cabinet_technicians ct ON ct.central_name = cd.exchange_name AND ct.cabin_number = cd.cabinet_no
           LEFT JOIN technician_names tn  ON tn.worker_code = ct.worker_code
           LEFT JOIN manual_close_by mcb  ON mcb.complain_no = cd.complain_no
           LEFT JOIN LATERAL (
             SELECT c.account_no, c.current_speed, c.max_speed, c.score, c.complain_no, c.complain_time, c.uploaded_at
             FROM case_138 c WHERE c.full_phone = '88' || cd.phone_number
             ORDER BY c.id DESC LIMIT 1
           ) c138p ON true
           LEFT JOIN LATERAL (
             SELECT c.score, c.current_speed, c.max_speed, c.complain_time, c.uploaded_at
             FROM case_138 c WHERE c.complain_no = cd.complain_no
             ORDER BY c.id DESC LIMIT 1
           ) c138c ON true
           ${cdWhere}
         )
         UNION ALL
         (
           -- ===== شيت المتبقى: فقط 138 و 135 منتظمة =====
           SELECT
             rc.complain_no           AS "ticketId",
             rc.exchange_name         AS "centralName",
             rc.phone_number          AS "phoneShort",
             -- مكرر: شكوى تانية لنفس الرقم **فى نفس الشهر وبيوم مختلف** — نفس تعريف
             -- «مكرر» المستخدَم فى فرع «التفاصيل» وفى الأعطال الحالية بالظبط.
             -- ⚠️ الشرط ده كان ناقص القيد الزمنى خالص: أى شكوى 138/135 تانية لنفس الرقم
             -- فى **أى وقت** (حتى من شهور فاتت) كانت بتخلّى الصف يتعلّم «مكرر» للأبد،
             -- فأرقام مالهاش غير شكوى واحدة الشهر ده كانت بتظهر مكررة.
             CASE WHEN rc.phone_number IS NOT NULL AND rc.phone_number <> ''
                       AND rc.complain_time IS NOT NULL
                       AND EXISTS (
                         SELECT 1 FROM remaining_complaints rc2
                         WHERE rc2.complain_no <> rc.complain_no
                           AND rc2.status_code IN ('138', '135')
                           AND rc2.phone_number = rc.phone_number
                           AND rc2.complain_time IS NOT NULL
                           AND date_trunc('month', rc2.complain_time) = date_trunc('month', rc.complain_time)
                           AND rc2.complain_time::date <> rc.complain_time::date
                       )
                  THEN 'مكرر' ELSE '' END AS "repeatStatus",
             rc.status_code           AS "statusCode",
             rc.close_code            AS "closeCode",
             COALESCE(rc.msan_id, ct2.cabin_code) AS "msanCode",
             pp2.frame                AS "frame",
             rc.cabinet_no            AS "cabinetNo",
             pl2.box_number           AS "boxNo",
             pl2.dp_terminal          AS "dpTerminal",
             rc.complain_time         AS "complainTime",
             rc.complain_type         AS "complainTypeName",
             CASE
               WHEN rc.complain_time IS NULL THEN 'مغلق'
               WHEN (${closedHoursSql('rc')}) < 24 THEN 'أعطال 24 ساعة'
               WHEN (${closedHoursSql('rc')}) < 48 THEN 'أعطال 48 ساعة'
               ELSE 'المتبقيات'
             END                      AS "regStatus",
             rc.close_time            AS "closeDate",
             pp2.onu                  AS "onu",
             ct2.worker_code          AS "workerCode",
             COALESCE(tn2.tech_name, rc.close_by) AS "techName",
             ct2.haya_karima          AS "hayaKarima",
             pp2.voice_status         AS "voiceStatus",
             pp2.data_status          AS "dataStatus",
             pp2.shelf                AS "shelf",
             pp2.slot                 AS "slot",
             pp2.port_number          AS "portNumber",
             ${centralCodeCase("rc.exchange_name")} AS "centralCode",
             rc138p.account_no        AS "accountNo",
             rc138p.current_speed     AS "lineCurrentSpeed",
             rc138p.max_speed         AS "lineMaxSpeed",
             rc138p.score             AS "lastMeasScore",
             rc138p.complain_no       AS "lastMeasComplainNo",
             (rc138p.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime",
             rc138c.score             AS "curMeasScore",
             rc138c.current_speed     AS "curMeasCurrentSpeed",
             rc138c.max_speed         AS "curMeasMaxSpeed",
             (rc138c.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "curMeasTime",
             'متبقى'                  AS "dataSource"
           FROM remaining_complaints rc
           -- نفس سبب التطبيع: phone_ports كامل (88+) وremaining_complaints قصير
           LEFT JOIN LATERAL (
             SELECT p.* FROM phone_ports p
              WHERE ${sp("p.phone_number")} = ${sp("rc.phone_number")}
              ORDER BY length(p.phone_number) DESC LIMIT 1
           ) pp2 ON true
           LEFT JOIN phone_lines pl2        ON pl2.tel_no = rc.phone_number
           LEFT JOIN cabinet_technicians ct2 ON ct2.central_name = rc.exchange_name AND ct2.cabin_number = rc.cabinet_no
           LEFT JOIN technician_names tn2   ON tn2.worker_code = ct2.worker_code
           LEFT JOIN LATERAL (
             SELECT c.account_no, c.current_speed, c.max_speed, c.score, c.complain_no, c.complain_time, c.uploaded_at
             FROM case_138 c WHERE c.full_phone = '88' || rc.phone_number
             ORDER BY c.id DESC LIMIT 1
           ) rc138p ON true
           LEFT JOIN LATERAL (
             SELECT c.score, c.current_speed, c.max_speed, c.complain_time, c.uploaded_at
             FROM case_138 c WHERE c.complain_no = rc.complain_no
             ORDER BY c.id DESC LIMIT 1
           ) rc138c ON true
           ${rcWhere}
         )
        ),
        agg AS (
          -- لكل شكوى: أول وآخر تاريخ إغلاق عبر كل سجلاتها (تفاصيل + متبقى)
          SELECT "ticketId" AS k,
                 MIN("closeDate") AS first_close,
                 MAX("closeDate") AS last_close
          FROM combined GROUP BY "ticketId"
        )
        SELECT d.*, (pe.last_raise_at AT TIME ZONE 'Africa/Cairo') AS "lastPoRaiseAt",
               (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') AS "lastPoStopAt" FROM (
          -- شكوى واحدة لكل complain_no: نحتفظ بأحدث سجل (آخر تاريخ إغلاق) فيكون
          -- الـ Status Code هو الأخير، ونرفق أول/آخر تاريخ إغلاق
          SELECT DISTINCT ON (c."ticketId")
                 c.*,
                 a.first_close AS "firstCloseDate",
                 a.last_close  AS "lastCloseDate"
          FROM combined c
          JOIN agg a ON a.k = c."ticketId"
          ORDER BY c."ticketId", c."closeDate" DESC NULLS LAST
        ) d
        LEFT JOIN line_po_events pe ON pe.account_no = d."accountNo"
        ORDER BY d."lastCloseDate" ASC NULLS LAST`,
        params,
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/repeated-within-month — الأعطال المكررة خلال شهر من تاريخه
  // تقرير تفصيلى: لكل رقم يُنظر لتاريخ آخر شكوى له؛ لو له شكوى سابقة خلال شهر (±30 يوم
  // قبل آخر شكوى) → يظهر الرقم. المصدر = نفس مصدر الأعطال المنتظمة (تفاصيل مغلقة + متبقى
  // 138/135، غنايم). الفلتر بتاريخ آخر شكوى، الافتراضى من أول الشهر إلى اليوم.
  app.get("/api/reports/repeated-within-month", requireAuth, async (req, res) => {
    try {
      const { central = "", q = "", dateFrom = "", dateTo = "" } = req.query as Record<string, string>;
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const defFrom = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
      const defTo = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const from = dateFrom || defFrom;
      const to = dateTo || defTo;
      const params: any[] = [from, to]; // $1 = from، $2 = to
      let centralParam = "";
      if (central) { params.push(central); centralParam = `$${params.length}`; }
      let qParam = "";
      if (q.trim()) { params.push(arQ(q)); qParam = `$${params.length}`; }
      const cdCentral = central ? `AND cd.exchange_name = ${centralParam}` : "";
      const rcCentral = central ? `AND rc.exchange_name = ${centralParam}` : "";
      const phoneQ = q.trim() ? `AND ${n("lc.phone")} LIKE ${qParam}` : "";

      const { rows } = await pool.query(
        `WITH comps AS (
           -- ⚠️ الشكوى الواحدة بتكون فى الجدولين مع بعض: اتسجّلت فى «المتبقى» وهى مفتوحة
           -- (138/135)، وبعد ما اتقفلت اتسجّلت فى «التفاصيل». كل جدول مفتاحه complain_no
           -- UNIQUE فمفيش تكرار جوّاه، لكن UNION ALL بين الاتنين كان بيعدّ نفس الشكوى
           -- مرتين — فعمود «عدد التكرار خلال الشهر» كان بيطلع الضعف (شكويتين حقيقيتين
           -- بيظهروا 4). DISTINCT ON (no) بتخلّى كل شكوى صف واحد، وبنفضّل صف «التفاصيل»
           -- (pref = 0) لأنه السجل النهائى بعد الإغلاق.
           SELECT DISTINCT ON (no) phone, no, ct, central, cabinet FROM (
             SELECT cd.phone_number AS phone, cd.complain_no AS no, cd.complain_time AS ct,
                    cd.exchange_name AS central, cd.cabinet_no AS cabinet, 0 AS pref
             FROM complaint_details cd
             WHERE cd.close_time IS NOT NULL AND cd.exchange_name ILIKE '%غنايم%'
               AND cd.phone_number IS NOT NULL AND cd.phone_number <> '' AND cd.complain_time IS NOT NULL
               ${cdCentral}
             UNION ALL
             SELECT rc.phone_number, rc.complain_no, rc.complain_time, rc.exchange_name, rc.cabinet_no, 1
             FROM remaining_complaints rc
             WHERE rc.status_code IN ('138', '135') AND rc.exchange_name ILIKE '%غنايم%'
               AND rc.phone_number IS NOT NULL AND rc.phone_number <> '' AND rc.complain_time IS NOT NULL
               ${rcCentral}
           ) u ORDER BY no, pref
         ),
         last_c AS (
           -- آخر شكوى لكل رقم
           SELECT DISTINCT ON (phone) phone, no AS last_no, ct AS last_time, central, cabinet
           FROM comps ORDER BY phone, ct DESC
         ),
         qual AS (
           SELECT lc.phone, lc.last_no, lc.last_time, lc.central, lc.cabinet,
                  p.prev_no, p.prev_time, rc.rep_count
           FROM last_c lc
           LEFT JOIN LATERAL (
             SELECT c.no AS prev_no, c.ct AS prev_time
             FROM comps c
             WHERE c.phone = lc.phone AND c.no <> lc.last_no
               AND c.ct < lc.last_time AND c.ct >= lc.last_time - interval '1 month'
             ORDER BY c.ct DESC LIMIT 1
           ) p ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS rep_count
             FROM comps c
             WHERE c.phone = lc.phone
               AND c.ct <= lc.last_time AND c.ct >= lc.last_time - interval '1 month'
           ) rc ON true
           WHERE lc.last_time::date >= $1::date AND lc.last_time::date <= $2::date
             AND p.prev_no IS NOT NULL
             ${phoneQ}
         )
         SELECT qual.phone                         AS "phoneShort",
                COALESCE(pl.central, qual.central)  AS "centralName",
                COALESCE(pl.cabin_number, qual.cabinet) AS "cabinetNo",
                pl.box_number                       AS "boxNo",
                pl.dp_terminal                      AS "dpTerminal",
                COALESCE(tn.tech_name, '')          AS "techName",
                qual.last_no                        AS "lastComplainNo",
                (qual.last_time AT TIME ZONE 'Africa/Cairo') AS "lastComplainTime",
                qual.prev_no                        AS "prevComplainNo",
                (qual.prev_time AT TIME ZONE 'Africa/Cairo') AS "prevComplainTime",
                qual.rep_count                      AS "repeatCount",
                -- الأكونت: من آخر قياس لو موجود، وإلا من جدول الأكونتات نفسه.
                -- من غير الـ fallback ده الخطوط اللى ماتقاستش قبل كده كانت بتطلع من
                -- غير أكونت — وهى بالظبط اللى محتاجة قياس، فأزرار القياس/رفع السرعة
                -- كانت هتبقى معطّلة عليها.
                COALESCE(c138.account_no, la.account_no) AS "accountNo",
                c138.score                          AS "lastMeasScore",
                c138.current_speed                  AS "lineCurrentSpeed",
                c138.max_speed                      AS "lineMaxSpeed",
                (c138.uploaded_at AT TIME ZONE 'Africa/Cairo') AS "lastMeasTime"
         FROM qual
         LEFT JOIN phone_lines pl ON pl.tel_no = qual.phone
         LEFT JOIN cabinet_technicians ct
           ON ct.central_name = COALESCE(pl.central, qual.central)
          AND ct.cabin_number = COALESCE(pl.cabin_number, qual.cabinet)
         LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
         LEFT JOIN LATERAL (
           SELECT c.account_no, c.score, c.current_speed, c.max_speed, c.uploaded_at
           FROM case_138 c WHERE c.full_phone = '88' || qual.phone ORDER BY c.id DESC LIMIT 1
         ) c138 ON true
         LEFT JOIN line_accounts la ON la.full_phone = '88' || qual.phone
         ORDER BY qual.last_time DESC NULLS LAST`,
        params,
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/cabinet-adsl-faults — لكل كابينة: عدد الشغال ADSL (ثابت من ملف
  // مشتركى FTTH/ADSL حسب كود MSAN) + عدد الأعطال خلال فترة (من 430D حسب كود الكابينة)
  // + اسم الفنى + رقم الكابينة. العمود الفقرى = cabinet_technicians (cabin_code = كود MSAN).
  //   ?dateFrom=YYYY-MM-DD & dateTo=YYYY-MM-DD & central= & q=
  app.get("/api/reports/cabinet-adsl-faults", requireAuth, async (req, res) => {
    try {
      const { dateFrom = "", dateTo = "", central = "", q = "" } = req.query as Record<string, string>;
      const from = dateFrom || "1900-01-01";
      const to   = dateTo   || "2999-12-31";
      const params: any[] = [from, to];
      const conds: string[] = [
        `(ct.central_name = 'الغنايم' OR ct.central_name = 'الغنايم-العزايزة' OR ct.central_name = 'الغنايم-دير الجنادله' OR ct.central_name = 'الغنايم-نجع العمدة')`,
        `COALESCE(ct.cabin_code, '') <> ''`,
      ];
      if (central) { params.push(central); conds.push(`ct.central_name = $${params.length}`); }
      if (q.trim()) {
        params.push(arQ(q));
        const p = `$${params.length}`;
        conds.push(`(${n("ct.cabin_number")} LIKE ${p} OR ${n("ct.cabin_code")} LIKE ${p} OR ${n("tn.tech_name")} LIKE ${p})`);
      }
      const where = "WHERE " + conds.join(" AND ");
      // تُجمّع كباين النحاس التى تشترك فى نفس كود الـ MSAN فى صف واحد (مثل 6-2 و6-3)
      // حتى لا يتكرر حساب الشغال/الأعطال (كلاهما محسوب لكل MSAN مرة واحدة).
      const { rows } = await pool.query(
        `SELECT
           MIN(ct.central_name)                                          AS "centralName",
           string_agg(DISTINCT ct.cabin_number, ' , ' ORDER BY ct.cabin_number) AS "cabinNumber",
           ct.cabin_code                                                 AS "msanCode",
           COALESCE(string_agg(DISTINCT tn.tech_name, ' , '), 'غير معروف') AS "techName",
           -- الشغال ADSL: ثابت من ملف مشتركى FTTH/ADSL حسب كود MSAN (مرة واحدة لكل MSAN)
           COALESCE((SELECT SUM(f.fbb_subs) FROM ftth_subscribers f
                       WHERE f.msan_gpon_code = ct.cabin_code), 0)::int   AS "workingAdsl",
           -- عدد الأعطال خلال الفترة (مغلقة + متبقية) لكود الكابينة (MSAN) — مرة واحدة
           (SELECT COUNT(*) FROM (
              SELECT cd.complain_no FROM complaint_details cd
                WHERE cd.msan_id = ct.cabin_code
                  AND (cd.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $1::date
                  AND (cd.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $2::date
              UNION
              SELECT rc.complain_no FROM remaining_complaints rc
                WHERE rc.msan_id = ct.cabin_code
                  AND (rc.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $1::date
                  AND (rc.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $2::date
           ) u)::int                                                     AS "faultCount"
         FROM cabinet_technicians ct
         LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
         ${where}
         GROUP BY ct.cabin_code
         ORDER BY MIN(ct.central_name), MIN(ct.cabin_number)`,
        params,
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/cabinet-adsl-faults/unassigned — أكواد MSAN موجودة فى ملف المشتركين
  // (نحاس + سنترالات الغنايم) لكنها **مش مسجّلة فى فنيى الكباين**، فمشتركينها مش بيدخلوا
  // حساب «الشغال ADSL» فى التقرير. ده بيفسّر أى فرق بين إجمالى التقرير وإجمالى الشيت.
  app.get("/api/reports/cabinet-adsl-faults/unassigned", requireAuth, async (_req, res) => {
    try {
      const CENTRALS = ["الغنايم", "الغنايم-العزايزة", "الغنايم-دير الجنادله", "الغنايم-نجع العمدة"];
      const FCC = ["GHNAT", "AMZAT", "DRGAT", "NGOAT"];
      const { rows } = await pool.query(
        `SELECT f.msan_gpon_code AS "msanCode", MIN(f.fcc_code) AS "fccCode",
                MIN(f.sub_ex) AS "subEx", SUM(f.fbb_subs)::int AS "fbbSubs"
           FROM ftth_subscribers f
          WHERE f.type = 'Copper' AND f.fcc_code = ANY($1::text[])
            AND COALESCE(f.fbb_subs, 0) > 0
            AND NOT EXISTS (SELECT 1 FROM cabinet_technicians ct
                             WHERE ct.cabin_code = f.msan_gpon_code
                               AND ct.central_name = ANY($2::text[]))
          GROUP BY f.msan_gpon_code
          ORDER BY SUM(f.fbb_subs) DESC`,
        [FCC, CENTRALS],
      );
      const totalSheet = await pool.query(
        `SELECT COALESCE(SUM(fbb_subs), 0)::int AS t FROM ftth_subscribers
          WHERE type = 'Copper' AND fcc_code = ANY($1::text[])`, [FCC]);
      res.json({
        rows,
        missingSubs: rows.reduce((a: number, r: any) => a + (r.fbbSubs || 0), 0),
        totalSheet: totalSheet.rows[0]?.t ?? 0,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/reports/box-faults — لكل بكس: عدد الخطوط (من بيان التليفونات) + عدد الأعطال
  // (من شيت التفاصيل + تفاصيل المتبقى، ربط برقم التليفون) + أعطال لكل 1000 + المتوقع نهاية الشهر.
  //   ?dateFrom=YYYY-MM-DD & dateTo=YYYY-MM-DD & central= & q=
  app.get("/api/reports/box-faults", requireAuth, async (req, res) => {
    try {
      const { dateFrom = "", dateTo = "", central = "", q = "" } = req.query as Record<string, string>;
      const from = dateFrom || "1900-01-01";
      const to   = dateTo   || "2999-12-31";
      const params: any[] = [from, to];
      const conds: string[] = [
        `(pl.central = 'الغنايم' OR pl.central = 'الغنايم-العزايزة' OR pl.central = 'الغنايم-دير الجنادله' OR pl.central = 'الغنايم-نجع العمدة')`,
        `COALESCE(pl.box_number, '') <> ''`,
      ];
      if (central) { params.push(central); conds.push(`pl.central = $${params.length}`); }
      if (q.trim()) {
        params.push(arQ(q));
        const p = `$${params.length}`;
        conds.push(`(${n("pl.cabin_number")} LIKE ${p} OR ${n("pl.box_number")} LIKE ${p} OR ${n("tn.tech_name")} LIKE ${p})`);
      }
      const where = "WHERE " + conds.join(" AND ");
      const { rows } = await pool.query(
        `WITH fault_union AS (
           SELECT phone_number, complain_no
           FROM complaint_details
           WHERE (complain_time AT TIME ZONE 'Africa/Cairo')::date >= $1::date
             AND (complain_time AT TIME ZONE 'Africa/Cairo')::date <= $2::date
           UNION
           SELECT phone_number, complain_no
           FROM remaining_complaints
           WHERE (complain_time AT TIME ZONE 'Africa/Cairo')::date >= $1::date
             AND (complain_time AT TIME ZONE 'Africa/Cairo')::date <= $2::date
         )
         SELECT
           pl.central                                                         AS "centralName",
           pl.cabin_number                                                    AS "cabinNumber",
           pl.box_number                                                      AS "boxNumber",
           COALESCE(string_agg(DISTINCT tn.tech_name, ' , '), 'غير معروف') AS "techName",
           COUNT(DISTINCT pl.tel_no)::int                                     AS "workingLines",
           COUNT(DISTINCT fu.complain_no)::int                                AS "faultCount"
         FROM phone_lines pl
         LEFT JOIN cabinet_technicians ct ON ct.central_name = pl.central AND ct.cabin_number = pl.cabin_number
         LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
         LEFT JOIN fault_union fu ON ${sp("fu.phone_number")} = pl.tel_no
         ${where}
         GROUP BY pl.central, pl.cabin_number, pl.box_number
         ORDER BY pl.central, LPAD(COALESCE(pl.cabin_number,''), 8, '0'), LPAD(COALESCE(pl.box_number,''), 8, '0')`,
        params,
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/maintenance-plan-h2 — خطة صيانة النصف الثانى من العام.
  // لكل كابينة MSAN: الشغال DATA + عدد الأعطال خلال الفترة + أعطال/الألف + عدد الكباين
  // النحاسية + عدد البكسيات + إجمالى الخطوط الشغالة. تُختار الكباين التى عدد أعطالها > 70
  // وأعطالها/الألف > 30، تُرتّب تنازلياً حسب أعطال/الألف، وتُوزّع على أشهر أغسطس/أكتوبر/ديسمبر
  // (ديسمبر كابينتان، الباقى كابينة لكل شهر). القطاع والمنطقة قيم ثابتة.
  //   ?dateFrom=YYYY-MM-DD & dateTo=YYYY-MM-DD & central= (اختيارية)
  app.get("/api/reports/maintenance-plan-h2", requireAuth, async (req, res) => {
    try {
      const { dateFrom = "", dateTo = "", central = "" } = req.query as Record<string, string>;
      const from = dateFrom || "2026-01-01";
      const to   = dateTo   || new Date().toISOString().slice(0, 10);
      // كباين اتعملت لها صيانة فى النصف الأول — تُستثنى من خطة النصف الثانى (بكود MSAN)
      const EXCLUDED_MSAN = [
        "11-2-11-43","11-2-11-57","11-2-11-62","11-2-12-123","11-2-12-92","11-2-12-94",
        "11-2-13-155","11-2-13-156","11-2-13-157","11-2-13-51","11-2-153-13","11-2-153-24",
        "11-2-15-56","11-2-17-09","11-2-17-134","11-2-17-138","11-2-17-141","11-2-17-145",
        "11-2-17-151","11-2-17-153","11-2-17-155","11-2-17-160","11-2-17-162","11-2-17-165",
        "11-2-17-167","11-2-17-32","11-2-17-35","11-2-19-190","11-2-19-191","11-2-19-192",
        "11-2-19-82","11-2-19-85","11-2-19-86","11-2-19-87","11-2-19-90","11-2-19-92",
        "11-2-19-93","11-2-227-23","11-2-24-03","11-2-24-51","11-2-24-55","11-2-25-10",
        "11-2-25-153","11-2-25-155","11-2-25-158","11-2-25-160","11-2-25-161","11-2-25-164",
        "11-2-25-50","11-2-255-20","11-2-255-26","11-2-25-58","11-2-25-59","11-2-25-60",
        "11-2-25-63","11-2-25-65","11-2-26-19","11-2-26-24","11-2-27-46","11-2-27-51",
        "11-2-29-158","11-2-29-178","11-2-29-21","11-2-26-26","11-2-76-01","11-2-88-53","11-2-88-56","11-2-88-66",
      ];
      const params: any[] = [from, to];
      const conds: string[] = [
        `(ct.central_name = 'الغنايم' OR ct.central_name = 'الغنايم-العزايزة' OR ct.central_name = 'الغنايم-دير الجنادله' OR ct.central_name = 'الغنايم-نجع العمدة')`,
        `COALESCE(ct.cabin_code, '') <> ''`,
      ];
      params.push(EXCLUDED_MSAN);
      conds.push(`NOT (ct.cabin_code = ANY($${params.length}::text[]))`);
      if (central) { params.push(central); conds.push(`ct.central_name = $${params.length}`); }
      const where = "WHERE " + conds.join(" AND ");
      const { rows } = await pool.query(
        `SELECT
           MIN(ct.central_name)                                          AS "centralName",
           string_agg(DISTINCT ct.cabin_number, ' , ' ORDER BY ct.cabin_number) AS "cabinNumber",
           ct.cabin_code                                                 AS "msanCode",
           COUNT(DISTINCT ct.cabin_number)::int                          AS "copperCabinets",
           COALESCE((SELECT SUM(f.fbb_subs) FROM ftth_subscribers f
                       WHERE f.msan_gpon_code = ct.cabin_code), 0)::int   AS "workingAdsl",
           COALESCE((SELECT COUNT(DISTINCT pl.box_number) FROM phone_lines pl
                       JOIN cabinet_technicians ct2
                         ON ct2.central_name = pl.central AND ct2.cabin_number = pl.cabin_number
                       WHERE ct2.cabin_code = ct.cabin_code
                         AND COALESCE(pl.box_number, '') <> ''), 0)::int  AS "boxCount",
           COALESCE((SELECT COUNT(DISTINCT pl.tel_no) FROM phone_lines pl
                       JOIN cabinet_technicians ct2
                         ON ct2.central_name = pl.central AND ct2.cabin_number = pl.cabin_number
                       WHERE ct2.cabin_code = ct.cabin_code), 0)::int     AS "workingLines",
           -- السعة = مجموع السعة الثانوية للكباين النحاسية المربوطة على الـ MSAN (من FCC).
           -- الربط بأرقام الكباين النحاسية داخل الـ MSAN؛ نتسامح مع فروق المسافات فى اسم
           -- السنترال وأى مسافات حول رقم الكابينة.
           COALESCE((SELECT SUM(cc.secondary_capacity) FROM cabinet_capacity cc
                       JOIN cabinet_technicians ct2
                         ON REPLACE(ct2.central_name, ' ', '') = REPLACE(cc.central_name, ' ', '')
                        AND TRIM(ct2.cabin_number) = TRIM(cc.cabin_number)
                       WHERE ct2.cabin_code = ct.cabin_code), 0)::int      AS "capacity",
           (SELECT COUNT(*) FROM (
              SELECT cd.complain_no FROM complaint_details cd
                WHERE cd.msan_id = ct.cabin_code
                  AND (cd.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $1::date
                  AND (cd.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $2::date
              UNION
              SELECT rc.complain_no FROM remaining_complaints rc
                WHERE rc.msan_id = ct.cabin_code
                  AND (rc.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $1::date
                  AND (rc.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $2::date
           ) u)::int                                                     AS "faultCount"
         FROM cabinet_technicians ct
         ${where}
         GROUP BY ct.cabin_code`,
        params,
      );
      // حساب أعطال/الألف + الفلترة (> 70 عطل و > 30 عطل/الألف) + الترتيب التنازلى
      const enriched = rows
        .map((r: any) => ({
          ...r,
          perThousand: r.workingAdsl > 0
            ? Math.round((r.faultCount / r.workingAdsl) * 1000 * 10) / 10
            : 0,
        }))
        .filter((r: any) => r.faultCount > 70 && r.perThousand > 30)
        .sort((a: any, b: any) => b.perThousand - a.perThousand);
      // أكواد السنترالات (كود السنترال فى النموذج) حسب الاسم
      const CENTRAL_CODES: Record<string, string> = {
        "الغنايم": "GHNAT",
        "الغنايم-دير الجنادله": "DRGAT",
        "الغنايم-العزايزة": "AMZAT",
        "الغنايم-نجع العمدة": "NGOAT",
      };
      // توزيع الأشهر: أغسطس (1) — أكتوبر (1) — ديسمبر (2)
      const months = ["أغسطس", "أكتوبر", "ديسمبر", "ديسمبر"];
      const plan = enriched.slice(0, months.length).map((r: any, i: number) => ({
        ...r,
        sector: "قطاع وسط الصعيد",
        region: "منطقة تليفونات اسيوط",
        centralCode: CENTRAL_CODES[r.centralName] || "",
        maintenanceMonth: months[i],
      }));
      res.json(plan);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/inspection — بيانات تقارير التفتيش (سنترال + كابينة/كباين مختارة).
  // مصدر البيانات: phone_lines (لكل خط) + cabinet_technicians (كود MSAN لكل كابينة).
  // يرجّع 3 مستويات: lines (لكل خط) / boxes (تجميع لكل بكس) / cabinets (تجميع لكل كابينة).
  //   ?central=<اسم السنترال>  &  cabins=<أرقام كباين نحاسية مفصولة بفاصلة> (اختيارى → كل كباين السنترال)
  // خريطة Mdf Code → اسم السنترال (من Network Inventory)
  const MDF_TO_CENTRAL: Record<string, string> = {
    GHN: "الغنايم",
    NGO: "الغنايم-نجع العمدة",
    DRG: "الغنايم-دير الجنادله",
    AMZ: "الغنايم-العزايزة",
  };

  // parser للّصق Network Inventory (DP): يرجّع صفوف {mdf, central, cabinetNo, dpNo, capacity}
  const parseDpInventory = (text: string) => {
    const out: { mdf: string; central: string; cabinetNo: string; dpNo: string; capacity: number | null }[] = [];
    const lines = String(text || "").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split("\t").map((s) => s.trim());
      // صف الهوية: [Mdf(حروف كبيرة 2-4), CabinetNo, DpNo, ...]
      if (parts.length >= 3 && /^[A-Z]{2,4}$/.test(parts[0]) && parts[1] && parts[2]) {
        const mdf = parts[0];
        let capacity: number | null = null;
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const f0 = (lines[j].split("\t")[0] || "").trim();
          if (/^\d+$/.test(f0)) { capacity = parseInt(f0, 10); break; }
        }
        out.push({ mdf, central: MDF_TO_CENTRAL[mdf] || mdf, cabinetNo: parts[1], dpNo: parts[2], capacity });
      }
    }
    return out;
  };

  // POST /api/dp-inventory/import — استيراد قائمة البكسيات (DP) باللصق من Network Inventory (أدمن).
  // full-replace لكل سنترال موجود فى اللصق.
  app.post("/api/dp-inventory/import", requireAuth, requireAdmin, async (req: any, res) => {
    try {
      const rows = parseDpInventory(String((req.body || {}).text || ""));
      if (!rows.length) return res.status(400).json({ message: "لم يتم التعرّف على أى بكسيات فى النص الملصوق" });
      const centrals = [...new Set(rows.map((r) => r.central))];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM dp_inventory WHERE central = ANY($1::text[])`, [centrals]);
        for (const r of rows) {
          await client.query(
            `INSERT INTO dp_inventory (central, mdf_code, cabinet_no, dp_no, dp_type, capacity, uploaded_by_id)
             VALUES ($1,$2,$3,$4,'weather proof',$5,$6)
             ON CONFLICT (central, cabinet_no, dp_no)
             DO UPDATE SET capacity = EXCLUDED.capacity, mdf_code = EXCLUDED.mdf_code, uploaded_at = now()`,
            [r.central, r.mdf, r.cabinetNo, r.dpNo, r.capacity, req.user.id],
          );
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
      const perCentral: Record<string, number> = {};
      for (const r of rows) perCentral[r.central] = (perCentral[r.central] || 0) + 1;
      res.json({ ok: true, total: rows.length, perCentral });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // بكسيات بيان الصيانة (maintenance.boxes) — كل البكسيات مهما كانت حالتها (اتفحصت و لا لأ).
  // مصدر إضافى لبكسيات تقارير التفتيش بجانب dp_inventory. آمن لو سكيما الصيانة غير موجودة.
  const maintenanceBoxRows = async (central?: string, cabinList?: string[]): Promise<any[]> => {
    try {
      const p: any[] = [];
      const conds: string[] = [];
      if (central) { p.push(central); conds.push(`e.name = $${p.length}`); }
      if (cabinList && cabinList.length) { p.push(cabinList); conds.push(`c.number = ANY($${p.length}::text[])`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const r = await pool.query(
        `SELECT e.name AS central, c.number AS "cabinNumber", b.number AS "boxNumber"
         FROM maintenance.boxes b
         JOIN maintenance.cabinets c ON c.id = b.cabinet_id
         JOIN maintenance.exchanges e ON e.id = c.exchange_id ${where}`, p);
      return r.rows;
    } catch (e) { return []; }
  };

  // GET /api/reports/inspection/options — السنترالات + الكباين من dp_inventory + بيان الصيانة
  app.get("/api/reports/inspection/options", requireAuth, async (_req, res) => {
    try {
      const { rows: dpRows } = await pool.query(`SELECT DISTINCT central, cabinet_no FROM dp_inventory`);
      const maintRows = (await maintenanceBoxRows()).map((r) => ({ central: r.central, cabinet_no: r.cabinNumber }));
      const centralSet = new Set<string>();
      const cabMap = new Map<string, Set<string>>();
      for (const r of [...dpRows, ...maintRows]) {
        if (r.central) centralSet.add(r.central);
        if (r.central && r.cabinet_no) { if (!cabMap.has(r.central)) cabMap.set(r.central, new Set()); cabMap.get(r.central)!.add(r.cabinet_no); }
      }
      const arSort = (a: string, b: string) => a.localeCompare(b, "ar", { numeric: true });
      const centrals = Array.from(centralSet).sort(arSort);
      const cabinsByCentral: Record<string, string[]> = {};
      for (const [c, set] of cabMap) cabinsByCentral[c] = Array.from(set).sort(arSort);
      res.json({ centrals, cabinsByCentral });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/reports/inspection — البكسيات مصدرها dp_inventory (Network Inventory): كل DP = بكس
  // (حتى الفاضى)؛ المشغولية من phone_lines؛ وأى بكس مش فى الـ inventory يُستبعد حتى لو عليه خطوط.
  app.get("/api/reports/inspection", requireAuth, async (req, res) => {
    try {
      const { central = "", cabins = "" } = req.query as Record<string, string>;
      if (!central) return res.json({ lines: [], boxes: [], cabinets: [] });
      const cabinList = String(cabins).split(",").map((s) => s.trim()).filter(Boolean);

      // 1) بكسيات المصدرين معاً (dedup): dp_inventory (Network Inventory) + بيان/موقع الصيانة
      //    (maintenance.boxes مهما كانت الحالة). السعة من dp_inventory إن وُجدت وإلا 10.
      const invParams: any[] = [central];
      let invWhere = "";
      if (cabinList.length) { invParams.push(cabinList); invWhere = ` AND cabinet_no = ANY($${invParams.length}::text[])`; }
      const { rows: dpRows } = await pool.query(
        `SELECT cabinet_no AS "cabinNumber", dp_no AS "boxNumber", capacity
         FROM dp_inventory WHERE central = $1${invWhere}`, invParams);
      const maintRows = await maintenanceBoxRows(central, cabinList);
      const invMap = new Map<string, any>();
      const invKey = (cab: any, box: any) => `${String(cab).trim()}||${String(box).trim()}`;
      for (const r of dpRows) invMap.set(invKey(r.cabinNumber, r.boxNumber), { cabinNumber: r.cabinNumber, boxNumber: r.boxNumber, capacity: r.capacity });
      for (const r of maintRows) { const k = invKey(r.cabinNumber, r.boxNumber); if (!invMap.has(k)) invMap.set(k, { cabinNumber: r.cabinNumber, boxNumber: r.boxNumber, capacity: null }); }
      const inv = Array.from(invMap.values());

      // 2) خطوط السنترال (+ فلتر الكباين) — تُفلتر بعدين على بكسيات الـ inventory
      const plParams: any[] = [central];
      let plWhere = "";
      if (cabinList.length) { plParams.push(cabinList); plWhere = ` AND pl.cabin_number = ANY($${plParams.length}::text[])`; }
      const { rows: allLines } = await pool.query(
        `SELECT pl.central AS "central", COALESCE(pl.cabin_number,'') AS "cabinNumber",
                COALESCE(pl.box_number,'') AS "boxNumber", COALESCE(pl.dp_terminal,'') AS "dpTerminal",
                COALESCE(pl.sec_block_no,'') AS "secBlockNo", COALESCE(pl.cabinet_out,'') AS "cabinetOut",
                COALESCE(pl.cabinet_in,'') AS "cabinetIn", COALESCE(pl.primary_block_no,'') AS "primaryBlockNo",
                COALESCE(pl.tel_no,'') AS "telNo", ctm.cabin_code AS "msanCode"
         FROM phone_lines pl
         LEFT JOIN LATERAL (SELECT ct.cabin_code FROM cabinet_technicians ct
            WHERE ct.central_name = pl.central AND ct.cabin_number = pl.cabin_number LIMIT 1) ctm ON true
         WHERE pl.central = $1${plWhere}`, plParams);

      const key = (cab: any, box: any) => `${String(cab).trim()}||${String(box).trim()}`;
      const digits = (s: any) => { const n = Number(String(s).replace(/[^0-9]/g, "")); return isNaN(n) ? 0 : n; };
      // الأرقام الصريحة فقط: رقم البكس لازم يكون رقم صافى (أرقام فقط) — نستبعد أى لاحقة نصية زى
      // «٢٥مكرر» / «٦مناول» / «3مكرر» (بكس بلاحقة بياخد نفس الربط بتاع بكس رقمه صريح → تعارض).
      const invUsable = inv.filter((b: any) => /^\d+$/.test(String(b.boxNumber).trim()));
      const invSet = new Set(invUsable.map((r: any) => key(r.cabinNumber, r.boxNumber)));
      // خطوط داخل الـ inventory فقط (نستبعد اللى بكسها مش فى الـ inventory) + قيم مشتقة لكل خط:
      //   block (رقم البلوك) = ceil(رقم البكس / 10) — كل 10 أمشاط بلوك.
      //   terminal (الترمنال داخل المشط) = ((الخارج - 1) % 10) + 1.
      const lines = allLines
        .filter((l: any) => invSet.has(key(l.cabinNumber, l.boxNumber)))
        .sort((a: any, b: any) =>
          String(a.cabinNumber).localeCompare(String(b.cabinNumber), "ar", { numeric: true }) ||
          (digits(a.boxNumber) - digits(b.boxNumber)) ||
          String(a.telNo).localeCompare(String(b.telNo)))
        .map((l: any) => {
          const dp = digits(l.boxNumber), outN = digits(l.cabinetOut);
          return { ...l, block: dp > 0 ? String(Math.ceil(dp / 10)) : "", terminal: outN > 0 ? String(((outN - 1) % 10) + 1) : "" };
        });

      const byBox = new Map<string, any[]>();
      for (const l of lines) { const k = key(l.cabinNumber, l.boxNumber); if (!byBox.has(k)) byBox.set(k, []); byBox.get(k)!.push(l); }
      const msanByCab = new Map<string, string>();
      for (const l of lines) { const c = String(l.cabinNumber).trim(); if (l.msanCode && !msanByCab.has(c)) msanByCab.set(c, l.msanCode); }

      // boxes = بكسيات الـ inventory. الربط/البلوك/المشط مشتقة من رقم البكس + السعة (مش من بيانات الخطوط):
      //   الربط: من = (رقم البكس - 1)*10 + 1 ، الي = من + السعة - 1  (بكس 35 سعة 10 → 341-350 ؛ سعة 20 → +20).
      //   رقم البلوك = ceil(رقم البكس / 10) ؛ رقم المشط (نسبى داخل البلوك) = ((رقم البكس - 1) % 10) + 1.
      const boxes = invUsable.map((b: any) => {
        const ls = byBox.get(key(b.cabinNumber, b.boxNumber)) || [];
        const occ = new Set(ls.map((x) => x.telNo).filter(Boolean)).size;
        const dp = digits(b.boxNumber), cap = b.capacity || 10;
        const from = dp > 0 ? (dp - 1) * 10 + 1 : 0;
        const to = dp > 0 ? from + cap - 1 : 0;
        return {
          central, cabinNumber: b.cabinNumber, boxNumber: b.boxNumber,
          msanCode: msanByCab.get(String(b.cabinNumber).trim()) || "",
          block: dp > 0 ? String(Math.ceil(dp / 10)) : "",           // رقم البلوك = ceil(البكس/10)
          comb: dp > 0 ? String(((dp - 1) % 10) + 1) : "",           // رقم المشط النسبى (مع وجود عمود البلوك)
          combAbs: dp > 0 ? String(dp) : "",                          // رقم المشط المطلق (بدون عمود البلوك)
          capacity: cap,
          occupancy: occ,
          linkFrom: from ? String(from) : "", linkTo: to ? String(to) : "",
        };
      }).sort((a: any, b: any) =>
        String(a.cabinNumber).localeCompare(String(b.cabinNumber), "ar", { numeric: true }) ||
        (digits(a.boxNumber) - digits(b.boxNumber)));

      // cabinets = تجميع لكل كابينة (المغلق ≥ السعة، الفاضى = 0 مشغولية)
      const cabMap = new Map<string, any[]>();
      for (const b of boxes) { const c = String(b.cabinNumber).trim(); if (!cabMap.has(c)) cabMap.set(c, []); cabMap.get(c)!.push(b); }
      const cabinets = Array.from(cabMap.values()).map((bs) => ({
        central, cabinNumber: bs[0].cabinNumber, msanCode: bs[0].msanCode || "",
        boxCount: bs.length,
        closedBoxes: bs.filter((b) => b.occupancy >= b.capacity).length,
        emptyBoxes: bs.filter((b) => b.occupancy === 0).length,
      }));

      res.json({ lines, boxes, cabinets });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // === جدول ورديات الفنيين الأسبوعى (shift_schedules) ===
  // المحرّرون: الأدمن/السوبر أدمن/الشئون الخارجية. الفنى يشوف فقط بدون تعديل.
  const canEditShifts = (role: string) => hasAdminAccess(role) || role === ROLES.EXTERNAL;

  // GET /api/shift-schedule?weekStart=YYYY-MM-DD → قائمة الفنيين + قيم الأسبوع
  app.get("/api/shift-schedule", requireAuth, async (req: any, res) => {
    try {
      const weekStart = String((req.query.weekStart as string) || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return res.status(400).json({ message: "weekStart غير صحيح" });
      const { rows: tnRows } = await pool.query(
        `SELECT DISTINCT tech_name FROM technician_names WHERE COALESCE(tech_name,'') <> ''`);
      const { rows: schedRows } = await pool.query(
        `SELECT tech_name, days, covers, notes FROM shift_schedules WHERE week_start = $1`, [weekStart]);
      const nameSet = new Set<string>();
      for (const r of tnRows) nameSet.add(r.tech_name);
      for (const r of schedRows) nameSet.add(r.tech_name);
      const techs = Array.from(nameSet).sort((a, b) => a.localeCompare(b, "ar"));
      const map: Record<string, { days: string[]; covers: string[]; notes: string }> = {};
      for (const r of schedRows) map[r.tech_name] = {
        days: Array.isArray(r.days) ? r.days : [],
        covers: Array.isArray(r.covers) ? r.covers : [],
        notes: r.notes || "",
      };
      res.json({ weekStart, techs, rows: map, canEdit: canEditShifts(req.user.role) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // PUT /api/shift-schedule → حفظ صف فنى كامل (7 أيام + ملاحظات) — للمحرّرين فقط
  app.put("/api/shift-schedule", requireAuth, async (req: any, res) => {
    if (!canEditShifts(req.user.role)) return res.status(403).json({ message: "غير مسموح بالتعديل" });
    try {
      const { weekStart, techName, days, covers, notes } = req.body || {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart || "")) || !techName)
        return res.status(400).json({ message: "بيانات ناقصة" });
      const to7 = (a: any) => { const arr = Array.isArray(a) ? a.slice(0, 7).map((v: any) => String(v ?? "")) : []; while (arr.length < 7) arr.push(""); return arr; };
      const dArr = to7(days);
      const cArr = to7(covers);
      await pool.query(
        `INSERT INTO shift_schedules (week_start, tech_name, days, covers, notes, updated_by)
         VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6)
         ON CONFLICT (week_start, tech_name)
         DO UPDATE SET days = $3::jsonb, covers = $4::jsonb, notes = $5, updated_at = now(), updated_by = $6`,
        [weekStart, techName, JSON.stringify(dArr), JSON.stringify(cArr), notes ?? null, String(req.user.username || "")],
      );
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // === منح التغطية الدائمة (tech_coverage_grants) — السوبر أدمن فقط ===
  app.get("/api/coverage-grants", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, grantee_tech_name AS "granteeTechName", covered_tech_name AS "coveredTechName",
                created_by AS "createdBy", created_at AS "createdAt"
         FROM tech_coverage_grants ORDER BY grantee_tech_name, covered_tech_name`);
      res.json(rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post("/api/coverage-grants", requireAuth, requireSuperAdmin, async (req: any, res) => {
    try {
      const grantee = String((req.body || {}).granteeTechName || "").trim();
      const covered = String((req.body || {}).coveredTechName || "").trim();
      if (!grantee || !covered) return res.status(400).json({ message: "اختر الفنى القائم بالعمل والفنى صاحب الخطوط" });
      if (grantee === covered) return res.status(400).json({ message: "لا يمكن منح الفنى تغطية نفسه" });
      await pool.query(
        `INSERT INTO tech_coverage_grants (grantee_tech_name, covered_tech_name, created_by)
         VALUES ($1,$2,$3) ON CONFLICT (grantee_tech_name, covered_tech_name) DO NOTHING`,
        [grantee, covered, String(req.user.username || "")]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.delete("/api/coverage-grants/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      await pool.query(`DELETE FROM tech_coverage_grants WHERE id = $1`, [parseInt(req.params.id)]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // مولّد موحّد لتقارير أوامر الشغل (تركيبات / معاينات) — يستخدم queryWfmReport.
  const wfmReportHandler = (typesLc: string[], regularized: boolean) =>
    async (req: any, res: any) => {
      try {
        const { central = "", q = "" } = req.query as Record<string, string>;
        // الفنى: أوامر كباينه بس. باقى الأدوار بتشوف الكل.
        const workerCode = req.user?.role === ROLES.TECH
          ? String(req.user.workerCode || "").trim() || "__none__"
          : "";
        const rows = await queryWfmReport(typesLc, regularized, { central, q, workerCode });
        res.json(rows);
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    };

  // التركيبات والنقل (حالات التركيب wfm)
  app.get("/api/reports/current-installations", requireAuth, wfmReportHandler(INSTALL_TYPES_LC, false));
  app.get("/api/reports/regularized-installations", requireAuth, wfmReportHandler(INSTALL_TYPES_LC, true));

  // المعاينات (حالات معاينات wfm)
  app.get("/api/reports/current-surveys", requireAuth, wfmReportHandler(SURVEY_TYPES_LC, false));
  app.get("/api/reports/regularized-surveys", requireAuth, wfmReportHandler(SURVEY_TYPES_LC, true));

  // GET /api/reports/regularized-daily — الأرشيف اليومى للمنتظمات بتاريخ من/إلى.
  //   ?category=faults|installations|surveys & ?dateFrom= & ?dateTo= & ?central= & ?q=
  // المصدر جدول regularized_daily الذى يُكتب تلقائياً كل ليلة. يُرجع صفوف التقرير
  // كما حُفظت (نفس شكل التقرير اليومى) مع إضافة snapshotDate لكل صف.
  app.get("/api/reports/regularized-daily", requireAuth, async (req: any, res) => {
    try {
      // الفنى مالوش تاب للتقرير ده أصلاً، والمسار مافيهوش فلترة كباين زى تقارير
      // الفنى — فكان باب خلفى يشوف منه شغل كل الفنيين بأسماء وعناوين العملاء.
      if (req.user?.role === ROLES.TECH) return res.status(403).json({ message: "غير مسموح" });
      const { category = "faults", dateFrom = "", dateTo = "", central = "", q = "" } =
        req.query as Record<string, string>;
      // تركيبات/معاينات: تُحسب مباشرة (التاريخى ناقص الحالى) بدل أرشيف الـ11 مساءً.
      if (category === "installations" || category === "surveys") {
        const types = category === "installations" ? INSTALL_TYPES_LC : SURVEY_TYPES_LC;
        const rows = await queryWfmRegularizedRange(types, { dateFrom, dateTo, central, q });
        return res.json(rows);
      }
      const params: any[] = [category];
      const conds: string[] = [`category = $1`];
      if (dateFrom) { params.push(dateFrom); conds.push(`snapshot_date >= $${params.length}::date`); }
      if (dateTo)   { params.push(dateTo);   conds.push(`snapshot_date <= $${params.length}::date`); }
      if (central)  { params.push(central);  conds.push(`central_name = $${params.length}`); }
      if (q.trim()) { params.push(arQ(q)); conds.push(`${n("data")} LIKE $${params.length}`); }
      const where = "WHERE " + conds.join(" AND ");
      const { rows } = await pool.query(
        `SELECT snapshot_date AS "snapshotDate", data
         FROM regularized_daily ${where}
         ORDER BY snapshot_date DESC, id DESC`,
        params,
      );
      res.json(rows.map((r: any) => ({ ...r.data, snapshotDate: r.snapshotDate })));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/reports/regularized-daily/run — تشغيل يدوى للحفظ اليومى (admin).
  // يلتقط لقطة اليوم الحالى فوراً (للاختبار أو التعويض اليدوى).
  app.post("/api/reports/regularized-daily/run", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const { date } = cairoNow();
      const r = await recordDailySnapshot(date);
      res.json({ date, ...r });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/removal-stats — إحصائيات الإزالة خلال 24/48/120 ساعة
  // ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
  app.get("/api/reports/removal-stats", requireAuth, async (req, res) => {
    try {
      const { dateFrom, dateTo } = req.query as Record<string, string>;
      const params: any[] = [];
      // نجلب الأعطال التى أُغلقت (close_time NOT NULL) وأُبلغ عنها في الفترة المحددة
      // العمود الصحيح هو exchange_name (وليس central_name الذى يكون NULL دائماً في complaint_details)
      const conds: string[] = [
        `cd.close_time IS NOT NULL`,
        `cd.exchange_name ILIKE '%غنايم%'`,
      ];
      if (dateFrom) { params.push(dateFrom); conds.push(`(cd.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}`); }
      if (dateTo)   { params.push(dateTo);   conds.push(`(cd.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}`); }
      const where = "WHERE " + conds.join(" AND ");

      const { rows } = await pool.query(`
        WITH base AS (
          SELECT
            cd.exchange_name                                AS central_name,
            ${effTechSql("cd.complain_no", "cd.close_by", "cd.exchange_name", "cd.cabinet_no", "cd.complain_time", "cd.phone_number")}
                                                            AS tech_name,
            ${closedHoursSql('cd')} AS hours
          FROM complaint_details cd
          ${where}
        )
        SELECT
          central_name    AS "centralName",
          tech_name       AS "techName",
          COUNT(*)::int                                             AS total,
          COUNT(*) FILTER (WHERE hours <= 24)::int                 AS within24h,
          COUNT(*) FILTER (WHERE hours <= 48)::int                 AS within48h,
          COUNT(*) FILTER (WHERE hours <= 120)::int                AS within120h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 24)  / NULLIF(COUNT(*), 0), 1) AS pct24h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 48)  / NULLIF(COUNT(*), 0), 1) AS pct48h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 120) / NULLIF(COUNT(*), 0), 1) AS pct120h
        FROM base
        GROUP BY GROUPING SETS (
          (central_name, tech_name),
          (central_name),
          (tech_name),
          ()
        )
        ORDER BY central_name NULLS LAST, tech_name NULLS LAST
      `, params);

      // فصل النتائج إلى أربع مجموعات
      const overall      = rows.find(r => r.centralName === null && r.techName === null) ?? null;
      const byCentral    = rows.filter(r => r.centralName !== null && r.techName === null);
      const byTech       = rows.filter(r => r.centralName !== null && r.techName !== null).sort(byCentralThen(cmpTechBest));
      const byTechOnly   = rows.filter(r => r.centralName === null && r.techName !== null)
                               .sort(cmpTechBest);

      // إذا لم توجد بيانات — أضف معلومات تشخيصية
      let diag: any = undefined;
      if (!overall) {
        const diagRes = await pool.query(`
          SELECT
            COUNT(*) AS total_all,
            COUNT(*) FILTER (WHERE close_time IS NOT NULL) AS total_closed,
            MIN(complain_time) AS min_complain,
            MAX(complain_time) AS max_complain,
            json_agg(DISTINCT exchange_name ORDER BY exchange_name) FILTER (WHERE exchange_name ILIKE '%غنايم%') AS centrals
          FROM complaint_details
        `);
        diag = diagRes.rows[0];
      }

      res.json({ overall, byCentral, byTech, byTechOnly, _diag: diag });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/remaining-stats — إحصائيات إزالة المتبقيات (حالات 135 و138 فقط)
  // ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
  app.get("/api/reports/remaining-stats", requireAuth, async (req, res) => {
    try {
      const { dateFrom, dateTo } = req.query as Record<string, string>;
      const params: any[] = [];
      const conds: string[] = [
        // الـ 135 مفتوح (close_time ممكن NULL)، الـ 138 لازم يكون عنده close_time
        `(FLOOR(rc.status_code::numeric)::int = 135 OR rc.close_time IS NOT NULL)`,
        `rc.exchange_name ILIKE '%غنايم%'`,
        `FLOOR(rc.status_code::numeric)::int IN (135, 138)`,
      ];
      if (dateFrom) { params.push(dateFrom); conds.push(`(rc.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}`); }
      if (dateTo)   { params.push(dateTo);   conds.push(`(rc.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}`); }
      const where = "WHERE " + conds.join(" AND ");

      const { rows } = await pool.query(`
        WITH base AS (
          SELECT
            rc.exchange_name                                AS central_name,
            ${effTechSql("rc.complain_no", "rc.close_by", "rc.exchange_name", "rc.cabinet_no", "rc.complain_time", "rc.phone_number")}
                                                            AS tech_name,
            -- الـ 135 (مفتوح): المدة من الشكوى حتى الآن (حيّة)
            -- الـ 138 (أُزيل): المدة من الشكوى حتى وقت الإزالة الفعلى
            CASE
              WHEN FLOOR(rc.status_code::numeric)::int = 135
                THEN EXTRACT(EPOCH FROM (${NOW_SHEET} - rc.complain_time)) / 3600.0
              ELSE
                ${closedHoursSql('rc')}
            END                                             AS hours
          FROM remaining_complaints_current rc
          ${where}
        )
        SELECT
          central_name    AS "centralName",
          tech_name       AS "techName",
          COUNT(*)::int                                             AS total,
          COUNT(*) FILTER (WHERE hours <= 24)::int                 AS within24h,
          COUNT(*) FILTER (WHERE hours <= 48)::int                 AS within48h,
          COUNT(*) FILTER (WHERE hours <= 120)::int                AS within120h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 24)  / NULLIF(COUNT(*), 0), 1) AS pct24h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 48)  / NULLIF(COUNT(*), 0), 1) AS pct48h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 120) / NULLIF(COUNT(*), 0), 1) AS pct120h
        FROM base
        GROUP BY GROUPING SETS (
          (central_name, tech_name),
          (central_name),
          (tech_name),
          ()
        )
        ORDER BY central_name NULLS LAST, tech_name NULLS LAST
      `, params);

      const overall    = rows.find(r => r.centralName === null && r.techName === null) ?? null;
      const byCentral  = rows.filter(r => r.centralName !== null && r.techName === null);
      const byTech     = rows.filter(r => r.centralName !== null && r.techName !== null).sort(byCentralThen(cmpTechBest));
      const byTechOnly = rows.filter(r => r.centralName === null && r.techName !== null)
                             .sort(cmpTechBest);
      res.json({ overall, byCentral, byTech, byTechOnly });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/combined-stats — إحصائيات الأعطال الإجمالية
  // = (الأعطال المغلقة complaint_details) + (الأعطال المفتوحة remaining_complaints 135/138)
  // النِسب تُحسب على إجمالى الأعطال مجتمعة. ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
  app.get("/api/reports/combined-stats", requireAuth, async (req, res) => {
    try {
      const { dateFrom, dateTo, central } = req.query as Record<string, string>;
      const params: any[] = [];
      // فلتر التاريخ يُطبَّق على المصدرين بنفس البارامترات
      let dateClause = "";
      if (dateFrom) { params.push(dateFrom); dateClause += ` AND (src.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}`; }
      if (dateTo)   { params.push(dateTo);   dateClause += ` AND (src.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}`; }
      // فلتر السنترال — المقارنة بعد التطبيع (ة/ه والهمزات) لأن اسم السنترال بيتكتب
      // بأكتر من صيغة فى شيتات 430D المختلفة.
      if (central?.trim()) {
        params.push(arNorm(central.trim()));
        dateClause += ` AND ${n("src.exchange_name")} = $${params.length}`;
      }

      const { rows } = await pool.query(`
        WITH src_raw AS (
          -- الأعطال المغلقة (complaint_details): كلها عندها close_time — جدول دائم متراكم
          SELECT cd.complain_no, cd.exchange_name, cd.complain_time, cd.close_time, cd.close_by, cd.cabinet_no,
                 cd.phone_number, FALSE AS is_open, cd.time_till_now, 1 AS pr
          FROM complaint_details cd
          WHERE cd.close_time IS NOT NULL AND cd.exchange_name ILIKE '%غنايم%'
          UNION ALL
          -- الأعطال المتبقية (135/138): تُقرأ من الجدول التاريخى الدائم remaining_complaints
          -- (وليس _current المتطاير) حتى لا تختفى الأعطال المُزالة عند رفع ملف 430D أحدث.
          SELECT rc.complain_no, rc.exchange_name, rc.complain_time, rc.close_time, rc.close_by, rc.cabinet_no,
                 rc.phone_number, (FLOOR(rc.status_code::numeric)::int = 135 AND rc.close_time IS NULL) AS is_open, rc.time_till_now, 2 AS pr
          FROM remaining_complaints rc
          WHERE rc.exchange_name ILIKE '%غنايم%'
            AND FLOOR(rc.status_code::numeric)::int IN (135, 138)
            AND (FLOOR(rc.status_code::numeric)::int = 135 OR rc.close_time IS NOT NULL)
        ),
        -- إزالة التكرار بمفتاح رقم الشكوى — تفضيل السجل المغلق (pr=1) على المتبقى (pr=2)
        src AS (
          SELECT DISTINCT ON (complain_no)
                 complain_no, exchange_name, complain_time, close_time, close_by, cabinet_no, phone_number, is_open, time_till_now
          FROM src_raw ORDER BY complain_no, pr
        ),
        base AS (
          SELECT
            src.exchange_name                               AS central_name,
            ${effTechSql("src.complain_no", "src.close_by", "src.exchange_name", "src.cabinet_no", "src.complain_time", "src.phone_number")}
                                                            AS tech_name,
            CASE
              WHEN src.is_open
                THEN EXTRACT(EPOCH FROM (${NOW_SHEET} - src.complain_time)) / 3600.0
              ELSE
                ${closedHoursSql('src')}
            END                                             AS hours
          FROM src
          WHERE TRUE ${dateClause}
        )
        SELECT
          central_name    AS "centralName",
          tech_name       AS "techName",
          COUNT(*)::int                                             AS total,
          COUNT(*) FILTER (WHERE hours <= 24)::int                 AS within24h,
          COUNT(*) FILTER (WHERE hours <= 48)::int                 AS within48h,
          COUNT(*) FILTER (WHERE hours <= 120)::int                AS within120h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 24)  / NULLIF(COUNT(*), 0), 1) AS pct24h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 48)  / NULLIF(COUNT(*), 0), 1) AS pct48h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 120) / NULLIF(COUNT(*), 0), 1) AS pct120h
        FROM base
        GROUP BY GROUPING SETS (
          (central_name, tech_name),
          (central_name),
          (tech_name),
          ()
        )
        ORDER BY central_name NULLS LAST, tech_name NULLS LAST
      `, params);

      const overall    = rows.find(r => r.centralName === null && r.techName === null) ?? null;
      const byCentral  = rows.filter(r => r.centralName !== null && r.techName === null);
      const byTech     = rows.filter(r => r.centralName !== null && r.techName !== null).sort(byCentralThen(cmpTechBest));
      const byTechOnly = rows.filter(r => r.centralName === null && r.techName !== null)
                             .sort(cmpTechBest);
      res.json({ overall, byCentral, byTech, byTechOnly });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // إحصائيات التكرار — ثلاثة endpoint لنفس هيكل التقرير الثلاثى
  // قاعدة التبعية: يُحسَب التكرار على الفنى الذى أغلق أقدم شكوى (حسب close_time):
  //   إذا نزل الخط N مرة، رتبة k (1=أقدم) تحصل على (N-k) مرة تكرار، الأحدث يحصل على 0.
  // ──────────────────────────────────────────────────────────────────────────

  // GET /api/reports/repetition-closed — complaint_details (أعطال مغلقة)
  app.get("/api/reports/repetition-closed", requireAuth, async (req, res) => {
    try {
      const { dateFrom, dateTo } = req.query as Record<string, string>;
      const params: any[] = [];
      let dateClause = "";
      if (dateFrom) { params.push(dateFrom); dateClause += ` AND (cd.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}`; }
      if (dateTo)   { params.push(dateTo);   dateClause += ` AND (cd.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}`; }

      const { rows } = await pool.query(`
        WITH phone_occ AS (
          SELECT
            cd.exchange_name AS central_name,
            cd.phone_number,
            cd.close_time,
            cd.complain_time,
            ${effTechSql("cd.complain_no", "cd.close_by", "cd.exchange_name", "cd.cabinet_no", "cd.complain_time", "cd.phone_number")} AS tech_name
          FROM complaint_details cd
          WHERE cd.close_time IS NOT NULL
            AND cd.exchange_name ILIKE '%غنايم%'
            ${dateClause}
        ),
        ranked AS (
          SELECT
            central_name, phone_number, tech_name,
            COUNT(*) OVER (PARTITION BY phone_number)                                     AS appearances,
            -- rk=1 = صاحب إغلاق أول شكوى (الأقدم بتاريخ الشكوى) — عليه يُحسب التكرار
            ROW_NUMBER() OVER (PARTITION BY phone_number ORDER BY complain_time ASC NULLS LAST, close_time ASC NULLS LAST) AS rk
          FROM phone_occ
        )
        SELECT
          central_name                                                                      AS "centralName",
          tech_name                                                                         AS "techName",
          COUNT(*)::int                                                                     AS total,
          COUNT(DISTINCT phone_number)::int                                                 AS "distinctPhones",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances = 1)::int                  AS "nonRepeated",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances > 1)::int                  AS "repeatedPhones",
          -- التكرار يُحسب على صاحب إغلاق أول شكوى (صف rk=1) بكل مرات التكرار (appearances - 1)
          SUM(CASE WHEN rk = 1 THEN appearances - 1 ELSE 0 END)::int                          AS "repCharges",
          ROUND(
            100.0 * SUM(CASE WHEN rk = 1 THEN appearances - 1 ELSE 0 END)
            / NULLIF(COUNT(DISTINCT phone_number), 0),
          1)                                                                                AS "repRatio"
        FROM ranked
        GROUP BY GROUPING SETS (
          (central_name, tech_name),
          (central_name),
          (tech_name),
          ()
        )
        ORDER BY central_name NULLS LAST, tech_name NULLS LAST
      `, params);

      const overall    = rows.find(r => r.centralName === null && r.techName === null) ?? null;
      const byCentral  = rows.filter(r => r.centralName !== null && r.techName === null);
      const byTech     = rows.filter(r => r.centralName !== null && r.techName !== null).sort(byCentralThen(cmpTechBest));
      const byTechOnly = rows.filter(r => r.centralName === null && r.techName !== null)
                             .sort(cmpTechBest);
      res.json({ overall, byCentral, byTech, byTechOnly });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/repetition-open — remaining_complaints (حالات 135 و138 فقط)
  app.get("/api/reports/repetition-open", requireAuth, async (req, res) => {
    try {
      const { dateFrom, dateTo } = req.query as Record<string, string>;
      const params: any[] = [];
      let dateClause = "";
      if (dateFrom) { params.push(dateFrom); dateClause += ` AND (rc.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}`; }
      if (dateTo)   { params.push(dateTo);   dateClause += ` AND (rc.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}`; }

      const { rows } = await pool.query(`
        WITH phone_occ AS (
          SELECT
            rc.exchange_name AS central_name,
            rc.phone_number,
            rc.close_time,
            rc.complain_time,
            ${effTechSql("rc.complain_no", "rc.close_by", "rc.exchange_name", "rc.cabinet_no", "rc.complain_time", "rc.phone_number")} AS tech_name
          FROM remaining_complaints_current rc
          WHERE rc.exchange_name ILIKE '%غنايم%'
            AND FLOOR(rc.status_code::numeric)::int IN (135, 138)
            AND (FLOOR(rc.status_code::numeric)::int = 135 OR rc.close_time IS NOT NULL)
            ${dateClause}
        ),
        ranked AS (
          SELECT
            central_name, phone_number, tech_name,
            COUNT(*) OVER (PARTITION BY phone_number)                                     AS appearances,
            -- rk=1 = صاحب إغلاق أول شكوى (الأقدم بتاريخ الشكوى) — عليه يُحسب التكرار
            ROW_NUMBER() OVER (PARTITION BY phone_number ORDER BY complain_time ASC NULLS LAST, close_time ASC NULLS LAST) AS rk
          FROM phone_occ
        )
        SELECT
          central_name                                                                      AS "centralName",
          tech_name                                                                         AS "techName",
          COUNT(*)::int                                                                     AS total,
          COUNT(DISTINCT phone_number)::int                                                 AS "distinctPhones",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances = 1)::int                  AS "nonRepeated",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances > 1)::int                  AS "repeatedPhones",
          -- التكرار يُحسب على صاحب إغلاق أول شكوى (صف rk=1) بكل مرات التكرار (appearances - 1)
          SUM(CASE WHEN rk = 1 THEN appearances - 1 ELSE 0 END)::int                          AS "repCharges",
          ROUND(
            100.0 * SUM(CASE WHEN rk = 1 THEN appearances - 1 ELSE 0 END)
            / NULLIF(COUNT(DISTINCT phone_number), 0),
          1)                                                                                AS "repRatio"
        FROM ranked
        GROUP BY GROUPING SETS (
          (central_name, tech_name),
          (central_name),
          (tech_name),
          ()
        )
        ORDER BY central_name NULLS LAST, tech_name NULLS LAST
      `, params);

      const overall    = rows.find(r => r.centralName === null && r.techName === null) ?? null;
      const byCentral  = rows.filter(r => r.centralName !== null && r.techName === null);
      const byTech     = rows.filter(r => r.centralName !== null && r.techName !== null).sort(byCentralThen(cmpTechBest));
      const byTechOnly = rows.filter(r => r.centralName === null && r.techName !== null)
                             .sort(cmpTechBest);
      res.json({ overall, byCentral, byTech, byTechOnly });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/repetition-combined — المصدران معاً (UNION ALL) لتحديد التكرار عبر المغلقة والمفتوحة
  app.get("/api/reports/repetition-combined", requireAuth, async (req, res) => {
    try {
      const { dateFrom, dateTo, central } = req.query as Record<string, string>;
      const params: any[] = [];
      let dateClause = "";
      if (dateFrom) { params.push(dateFrom); dateClause += ` AND (po.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}`; }
      if (dateTo)   { params.push(dateTo);   dateClause += ` AND (po.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}`; }
      if (central?.trim()) {
        params.push(arNorm(central.trim()));
        dateClause += ` AND ${n("po.exchange_name")} = $${params.length}`;
      }

      const { rows } = await pool.query(`
        WITH src_raw AS (
          SELECT complain_no, exchange_name, phone_number, complain_time, close_time, close_by, cabinet_no, 1 AS src_priority
          FROM complaint_details
          WHERE close_time IS NOT NULL AND exchange_name ILIKE '%غنايم%'
          UNION ALL
          -- المتبقى من الجدول التاريخى الدائم (وليس _current) حتى لا تختفى المُزالة عند رفعة أحدث
          SELECT complain_no, exchange_name, phone_number, complain_time, close_time, close_by, cabinet_no, 2 AS src_priority
          FROM remaining_complaints
          WHERE exchange_name ILIKE '%غنايم%'
            AND FLOOR(status_code::numeric)::int IN (135, 138)
            AND (FLOOR(status_code::numeric)::int = 135 OR close_time IS NOT NULL)
        ),
        -- توحيد العطل الواحد: لو نفس complain_no ظهر في الجدولين (مفتوح ثم مغلق)
        -- يُحسب مرة واحدة، مع تفضيل النسخة المغلقة (src_priority=1) للتبعية الصحيحة
        src AS (
          SELECT DISTINCT ON (complain_no)
            complain_no, exchange_name, phone_number, complain_time, close_time, close_by, cabinet_no
          FROM src_raw
          ORDER BY complain_no, src_priority
        ),
        phone_occ AS (
          SELECT
            po.exchange_name AS central_name,
            po.phone_number,
            po.close_time,
            po.complain_time,
            ${effTechSql("po.complain_no", "po.close_by", "po.exchange_name", "po.cabinet_no", "po.complain_time", "po.phone_number")} AS tech_name
          FROM src po
          WHERE TRUE ${dateClause}
        ),
        ranked AS (
          SELECT
            central_name, phone_number, tech_name,
            COUNT(*) OVER (PARTITION BY phone_number)                                     AS appearances,
            -- rk=1 = صاحب إغلاق أول شكوى (الأقدم بتاريخ الشكوى) — عليه يُحسب التكرار
            ROW_NUMBER() OVER (PARTITION BY phone_number ORDER BY complain_time ASC NULLS LAST, close_time ASC NULLS LAST) AS rk
          FROM phone_occ
        )
        SELECT
          central_name                                                                      AS "centralName",
          tech_name                                                                         AS "techName",
          COUNT(*)::int                                                                     AS total,
          COUNT(DISTINCT phone_number)::int                                                 AS "distinctPhones",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances = 1)::int                  AS "nonRepeated",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances > 1)::int                  AS "repeatedPhones",
          -- التكرار يُحسب على صاحب إغلاق أول شكوى (صف rk=1) بكل مرات التكرار (appearances - 1)
          SUM(CASE WHEN rk = 1 THEN appearances - 1 ELSE 0 END)::int                          AS "repCharges",
          ROUND(
            100.0 * SUM(CASE WHEN rk = 1 THEN appearances - 1 ELSE 0 END)
            / NULLIF(COUNT(DISTINCT phone_number), 0),
          1)                                                                                AS "repRatio"
        FROM ranked
        GROUP BY GROUPING SETS (
          (central_name, tech_name),
          (central_name),
          (tech_name),
          ()
        )
        ORDER BY central_name NULLS LAST, tech_name NULLS LAST
      `, params);

      const overall    = rows.find(r => r.centralName === null && r.techName === null) ?? null;
      const byCentral  = rows.filter(r => r.centralName !== null && r.techName === null);
      const byTech     = rows.filter(r => r.centralName !== null && r.techName !== null).sort(byCentralThen(cmpTechBest));
      const byTechOnly = rows.filter(r => r.centralName === null && r.techName !== null)
                             .sort(cmpTechBest);
      res.json({ overall, byCentral, byTech, byTechOnly });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/removal-beyond24 — تفصيل الأعطال التى تجاوزت 24 ساعة
  // ?tab=combined|details|remaining&dateFrom=...&dateTo=...
  app.get("/api/reports/removal-beyond24", requireAuth, async (req, res) => {
    try {
      const { dateFrom, dateTo, tab } = req.query as Record<string, string>;
      const srcTab = tab || "combined";
      const params: any[] = [];
      let dateClause = "";
      if (dateFrom) { params.push(dateFrom); dateClause += ` AND (src.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}`; }
      if (dateTo)   { params.push(dateTo);   dateClause += ` AND (src.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}`; }

      // الفنى: يرى أعطاله فقط — سواء هو فنى الإغلاق أو فنى المنطقة (على الأسماء المحسوبة)
      let techClause = "";
      if (req.user?.role === ROLES.TECH) {
        const wc = String((req.user as any).workerCode || "").trim();
        let myTech = "";
        if (wc) {
          const tr = await pool.query(`SELECT tech_name FROM technician_names WHERE worker_code = $1 ORDER BY id DESC LIMIT 1`, [wc]);
          myTech = tr.rows[0]?.tech_name || "";
        }
        params.push(myTech);
        techClause = ` AND (b."closeByName" = $${params.length} OR b."areaTechName" = $${params.length})`;
      }

      let srcCTE: string;
      if (srcTab === "details") {
        srcCTE = `
          WITH src AS (
            SELECT complain_no, exchange_name, cabinet_no, phone_number, complain_time, close_time, close_by, close_code,
                   FALSE AS is_open, time_till_now
            FROM complaint_details
            WHERE close_time IS NOT NULL AND exchange_name ILIKE '%غنايم%'
          )`;
      } else if (srcTab === "remaining") {
        srcCTE = `
          WITH src AS (
            SELECT complain_no, exchange_name, cabinet_no, phone_number, complain_time, close_time, close_by, close_code,
                   (FLOOR(status_code::numeric)::int = 135 AND close_time IS NULL) AS is_open, time_till_now
            FROM remaining_complaints_current
            WHERE exchange_name ILIKE '%غنايم%'
              AND FLOOR(status_code::numeric)::int IN (135, 138)
              AND (FLOOR(status_code::numeric)::int = 135 OR close_time IS NOT NULL)
          )`;
      } else {
        srcCTE = `
          WITH src_raw AS (
            SELECT complain_no, exchange_name, cabinet_no, phone_number, complain_time, close_time, close_by, close_code, 1 AS sp, FALSE::bool AS is_open, time_till_now
            FROM complaint_details WHERE close_time IS NOT NULL AND exchange_name ILIKE '%غنايم%'
            UNION ALL
            -- المتبقى من الجدول التاريخى الدائم (وليس _current) حتى لا تختفى المُزالة عند رفعة أحدث
            SELECT complain_no, exchange_name, cabinet_no, phone_number, complain_time, close_time, close_by, close_code, 2 AS sp,
                   (FLOOR(status_code::numeric)::int = 135 AND close_time IS NULL)::bool AS is_open, time_till_now
            FROM remaining_complaints WHERE exchange_name ILIKE '%غنايم%'
              AND FLOOR(status_code::numeric)::int IN (135, 138)
              AND (FLOOR(status_code::numeric)::int = 135 OR close_time IS NOT NULL)
          ),
          src AS (
            SELECT DISTINCT ON (complain_no) complain_no, exchange_name, cabinet_no, phone_number, complain_time, close_time, close_by, close_code, is_open, time_till_now
            FROM src_raw ORDER BY complain_no, sp
          )`;
      }

      const { rows } = await pool.query(`
        ${srcCTE},
        base AS (
          SELECT
            src.complain_no                                                              AS "complainNo",
            src.phone_number                                                             AS "phoneNumber",
            src.exchange_name                                                            AS "centralName",
            src.cabinet_no                                                               AS "cabinetNo",
            src.complain_time                                                            AS "complainTime",
            src.close_time                                                               AS "closeTime",
            src.close_code                                                               AS "closeCode",
            ROUND(CASE
              WHEN src.is_open
                THEN EXTRACT(EPOCH FROM (${NOW_SHEET} - src.complain_time)) / 3600.0
              ELSE
                ${closedHoursSql('src')}
            END, 1)                                                                      AS hours,
            -- الساعات محسوبة من التوقيتين وحدهما (إغلاق − شكوى) — للمقارنة مع
            -- «ساعات» أعلاه اللى بتاخد قيمة الشيت الرسمية «فترة الاستمرار باستبعاد
            -- الحالة 135». الفرق بينهم = مدة تعليق الشكوى (135)، وده اللى بيخلّى
            -- عطل مقفول بعد 23 ساعة بالتوقيتين يتحسب رسمياً أكتر أو أقل من 24.
            ROUND(EXTRACT(EPOCH FROM (src.close_time - src.complain_time)) / 3600.0, 1) AS "hoursByStamps",
            (src.time_till_now IS NOT NULL AND NOT src.is_open)                          AS "hoursFromSheet",
            COALESCE(
              (SELECT mcb.tech_name FROM manual_close_by mcb WHERE mcb.complain_no = src.complain_no LIMIT 1),
              (SELECT tn.tech_name FROM technician_names tn WHERE tn.worker_code = src.close_by LIMIT 1),
              'غير معروف'
            )                                                                            AS "closeByName",
            EXISTS (SELECT 1 FROM manual_close_by mcb WHERE mcb.complain_no = src.complain_no) AS "closeByManual",
            COALESCE(
              ${areaTechSql("src.exchange_name", "src.cabinet_no", "src.complain_time", "src.phone_number")},
              'غير معروف'
            )                                                                            AS "areaTechName",
            (SELECT pl.cabin_number FROM phone_lines pl WHERE pl.tel_no = src.phone_number LIMIT 1)
                                                                                         AS "lineCabin",
            (SELECT pl.box_number   FROM phone_lines pl WHERE pl.tel_no = src.phone_number LIMIT 1)
                                                                                         AS "lineBox",
            (SELECT pp.msan_code FROM phone_lines pl
               JOIN phone_ports pp ON pp.phone_number = pl.full_phone
               WHERE pl.tel_no = src.phone_number LIMIT 1)                               AS "msanCode",
            (SELECT pp.frame     FROM phone_lines pl
               JOIN phone_ports pp ON pp.phone_number = pl.full_phone
               WHERE pl.tel_no = src.phone_number LIMIT 1)                               AS "frame",
            -- اسم وعنوان العميل من بيانات المشتركين (أحدث بيان)
            (SELECT si.sub_name FROM line_subscriber_info si
               WHERE si.phone_number = src.phone_number
                  OR regexp_replace(COALESCE(si.phone_number,''), '^88', '') = src.phone_number
               LIMIT 1)                                                                  AS "subName",
            (SELECT si.sub_add FROM line_subscriber_info si
               WHERE si.phone_number = src.phone_number
                  OR regexp_replace(COALESCE(si.phone_number,''), '^88', '') = src.phone_number
               LIMIT 1)                                                                  AS "subAdd"
          FROM src
          WHERE TRUE ${dateClause}
        )
        SELECT * FROM base b WHERE b.hours > 24 ${techClause} ORDER BY b.hours DESC LIMIT 5000
      `, params);

      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/repetition-detail — تفصيل الخطوط المكررة (appearances > 1)
  // ?tab=combined|closed|open&dateFrom=...&dateTo=...
  app.get("/api/reports/repetition-detail", requireAuth, async (req, res) => {
    try {
      const { dateFrom, dateTo, tab } = req.query as Record<string, string>;
      const srcTab = tab || "combined";
      const params: any[] = [];
      let dateClause = "";
      if (dateFrom) { params.push(dateFrom); dateClause += ` AND (po.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}`; }
      if (dateTo)   { params.push(dateTo);   dateClause += ` AND (po.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}`; }

      // الفنى: يرى الأرقام المحسوبة عليه فقط — أى اللى هو «الفنى المحمَّل» عليها (صاحب إغلاق
      // أول شكوى، أو فنى المنطقة لو فنى الإغلاق غير معروف).
      let techClause = "";
      if (req.user?.role === ROLES.TECH) {
        const wc = String((req.user as any).workerCode || "").trim();
        let myTech = "";
        if (wc) {
          const tr = await pool.query(`SELECT tech_name FROM technician_names WHERE worker_code = $1 ORDER BY id DESC LIMIT 1`, [wc]);
          myTech = tr.rows[0]?.tech_name || "";
        }
        params.push(myTech);
        techClause = ` AND e."chargedTech" = $${params.length}`;
      }

      let srcCTE: string;
      if (srcTab === "closed") {
        srcCTE = `
          WITH src AS (
            SELECT complain_no, exchange_name, cabinet_no, phone_number, complain_time, close_time, close_by, close_code
            FROM complaint_details
            WHERE close_time IS NOT NULL AND exchange_name ILIKE '%غنايم%'
          )`;
      } else if (srcTab === "open") {
        srcCTE = `
          WITH src AS (
            SELECT complain_no, exchange_name, cabinet_no, phone_number, complain_time, close_time, close_by, close_code
            FROM remaining_complaints_current
            WHERE exchange_name ILIKE '%غنايم%'
              AND FLOOR(status_code::numeric)::int IN (135, 138)
              AND (FLOOR(status_code::numeric)::int = 135 OR close_time IS NOT NULL)
          )`;
      } else {
        srcCTE = `
          WITH src_raw AS (
            SELECT complain_no, exchange_name, cabinet_no, phone_number, complain_time, close_time, close_by, close_code, 1 AS sp
            FROM complaint_details WHERE close_time IS NOT NULL AND exchange_name ILIKE '%غنايم%'
            UNION ALL
            -- المتبقى من الجدول التاريخى الدائم (وليس _current) حتى لا تختفى المُزالة عند رفعة أحدث
            SELECT complain_no, exchange_name, cabinet_no, phone_number, complain_time, close_time, close_by, close_code, 2 AS sp
            FROM remaining_complaints WHERE exchange_name ILIKE '%غنايم%'
              AND FLOOR(status_code::numeric)::int IN (135, 138)
              AND (FLOOR(status_code::numeric)::int = 135 OR close_time IS NOT NULL)
          ),
          src AS (
            SELECT DISTINCT ON (complain_no) complain_no, exchange_name, cabinet_no, phone_number, complain_time, close_time, close_by, close_code
            FROM src_raw ORDER BY complain_no, sp
          )`;
      }

      const { rows } = await pool.query(`
        ${srcCTE},
        phone_occ AS (
          SELECT
            po.complain_no, po.exchange_name AS central_name, po.cabinet_no,
            po.phone_number, po.complain_time, po.close_time, po.close_by, po.close_code,
            COUNT(*) OVER (PARTITION BY po.phone_number) AS appearances
          FROM src po
          WHERE TRUE ${dateClause}
        ),
        repeated AS (
          SELECT * FROM phone_occ WHERE appearances > 1
        )
        SELECT * FROM (
        SELECT d.*,
          -- الفنى المحمَّل على الرقم = فنى إغلاق أول شكوى (الأقدم)، أو فنى المنطقة لو الإغلاق غير معروف
          FIRST_VALUE(CASE WHEN d."closeByName" <> 'غير معروف' THEN d."closeByName" ELSE d."areaTechName" END)
            OVER (PARTITION BY d."phoneNumber" ORDER BY d."complainTime" ASC NULLS LAST, d."closeTime" ASC NULLS LAST) AS "chargedTech"
        FROM (
        SELECT
          r.complain_no                                                                AS "complainNo",
          r.phone_number                                                               AS "phoneNumber",
          r.central_name                                                               AS "centralName",
          r.cabinet_no                                                                 AS "cabinetNo",
          r.complain_time                                                              AS "complainTime",
          r.close_time                                                                 AS "closeTime",
          r.close_code                                                                 AS "closeCode",
          r.appearances::int                                                           AS appearances,
          COALESCE(
            (SELECT mcb.tech_name FROM manual_close_by mcb WHERE mcb.complain_no = r.complain_no LIMIT 1),
            (SELECT tn.tech_name FROM technician_names tn WHERE tn.worker_code = r.close_by LIMIT 1),
            'غير معروف'
          )                                                                            AS "closeByName",
          EXISTS (SELECT 1 FROM manual_close_by mcb WHERE mcb.complain_no = r.complain_no) AS "closeByManual",
          COALESCE(
            ${areaTechSql("r.central_name", "r.cabinet_no", "r.complain_time", "r.phone_number")},
            'غير معروف'
          )                                                                            AS "areaTechName",
          (SELECT pl.cabin_number FROM phone_lines pl WHERE pl.tel_no = r.phone_number LIMIT 1)
                                                                                       AS "lineCabin",
          (SELECT pl.box_number   FROM phone_lines pl WHERE pl.tel_no = r.phone_number LIMIT 1)
                                                                                       AS "lineBox",
          (SELECT pp.msan_code FROM phone_lines pl
             JOIN phone_ports pp ON pp.phone_number = pl.full_phone
             WHERE pl.tel_no = r.phone_number LIMIT 1)                                 AS "msanCode",
          (SELECT pp.frame     FROM phone_lines pl
             JOIN phone_ports pp ON pp.phone_number = pl.full_phone
             WHERE pl.tel_no = r.phone_number LIMIT 1)                                 AS "frame",
          -- اسم وعنوان العميل من بيانات المشتركين (أحدث بيان)
          (SELECT si.sub_name FROM line_subscriber_info si
             WHERE si.phone_number = r.phone_number
                OR regexp_replace(COALESCE(si.phone_number,''), '^88', '') = r.phone_number
             LIMIT 1)                                                                   AS "subName",
          (SELECT si.sub_add FROM line_subscriber_info si
             WHERE si.phone_number = r.phone_number
                OR regexp_replace(COALESCE(si.phone_number,''), '^88', '') = r.phone_number
             LIMIT 1)                                                                   AS "subAdd"
        FROM repeated r
        ) d
        ) e
        WHERE TRUE ${techClause}
        ORDER BY e."phoneNumber", e."complainTime"
        LIMIT 5000
      `, params);

      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Cable-Fault-Manager live proxy ──────────────────────────────────────
  app.get("/api/proxy/cfm-debug", requireAdmin, async (_req, res) => {
    try {
      cfmCookie = null;
      await cfmLogin();
      const r = await fetch(`${CFM_BASE}/api/tickets`, { headers: { Cookie: cfmCookie! } });
      const json = await r.json();
      const arr = Array.isArray(json) ? json : (json.data ?? json.tickets ?? []);
      // أرجع أول تذكرة خام كاملة لمعرفة أسماء الحقول بالظبط
      res.json({ count: arr.length, firstTicketRaw: arr[0] ?? null });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/proxy/cfm-tickets", requireAuth, async (_req, res) => {
    try {
      // البيانات دلوقتى من قاعدة بياناتنا (الكوابل مدمج) بدل الموقع الخارجى القديم
      const tickets: any[] = await cfmStorage.getAllTickets();

      // إثراء كل تذكرة بمتوسط قياس البكسات التابعة لها (من بيانات Service Flow)
      let agg: Map<string, { sum: number; measured: number; lines: number }> | null = null;
      try { agg = await getBoxScoreAgg(); } catch { agg = null; }

      if (agg) {
        for (const t of tickets) {
          const central = normCentral(t?.central?.name ?? t?.centralDepartment);
          const cabin = String(t?.cable?.number ?? "").trim();
          const boxes = parseTicketBoxes(t?.box);
          let sum = 0, measured = 0, boxesWithData = 0;
          const perBox: { box: string; avg: number | null; measured: number }[] = [];
          for (const b of boxes) {
            const hit = agg.get(`${central}|${cabin}|${b}`);
            if (hit && hit.measured > 0) {
              sum += hit.sum; measured += hit.measured; boxesWithData++;
              perBox.push({ box: b, avg: Math.round((hit.sum / hit.measured) * 10) / 10, measured: hit.measured });
            } else {
              perBox.push({ box: b, avg: null, measured: 0 });
            }
          }
          t.boxAvgScore = measured > 0 ? Math.round((sum / measured) * 10) / 10 : null;
          t.boxMeasuredLines = measured;
          t.boxCount = boxes.length;
          t.boxesWithData = boxesWithData;
          t.boxBreakdown = perBox;
        }
      }

      res.json(tickets);
    } catch (e: any) {
      res.status(502).json({ message: `تعذّر الاتصال بـ Cable Fault Manager: ${e.message}` });
    }
  });

  // GET /api/proxy/cfm-fault-counts?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
  // يحسب لكل تذكرة CFM عدد أعطال 430D فى البكسات التابعة لها:
  //   faultCountInRange  — خلال الفترة التى يختارها المستخدم (complain_time)
  //   faultCountPreTicket — من (تاريخ إنشاء التكت − 7 أيام) حتى الآن
  // مصدر البيانات: complaint_details ∪ remaining_complaints ← join مع phone_lines على tel_no=phone_number
  app.get("/api/proxy/cfm-fault-counts", requireAuth, async (req, res) => {
    try {
      const dateFrom = (req.query.dateFrom as string | undefined)?.trim();
      const dateTo   = (req.query.dateTo   as string | undefined)?.trim();

      // 1. سحب قائمة التذاكر من قاعدة بياناتنا (الكوابل مدمج)
      const tickets: any[] = await cfmStorage.getAllTickets();

      // 2. جمع اسماء السنترالات وأرقام الكابينات الفريدة لتقليل حجم الـ query
      const exchSet = new Set<string>();
      const cabSet  = new Set<string>();
      for (const t of tickets) {
        const exch = String(t?.central?.name ?? t?.centralDepartment ?? "").trim();
        const cab  = String(t?.cable?.number ?? "").trim();
        if (exch && cab) { exchSet.add(exch); cabSet.add(cab); }
      }
      if (!exchSet.size) return res.json([]);

      const exchArr = Array.from(exchSet);
      const cabArr  = Array.from(cabSet);

      // 3. عد أعطال الفترة المختارة (موزّعة على بكسات)
      const rangeMap = new Map<string, number>(); // key: "normCentral|cab|box"
      if (dateFrom && dateTo) {
        const { rows: rr } = await pool.query(`
          SELECT x.exch, x.cab, x.box, SUM(x.cnt)::int AS cnt FROM (
            SELECT cd.exchange_name AS exch, cd.cabinet_no AS cab,
                   pl.box_number   AS box, COUNT(*)       AS cnt
            FROM complaint_details cd
            LEFT JOIN phone_lines pl ON pl.tel_no = cd.phone_number
            WHERE cd.exchange_name = ANY($1) AND cd.cabinet_no = ANY($2)
              AND cd.complain_time >= $3::timestamptz
              AND cd.complain_time <= ($4 || ' 23:59:59')::timestamptz
            GROUP BY cd.exchange_name, cd.cabinet_no, pl.box_number
            UNION ALL
            SELECT rc.exchange_name, rc.cabinet_no,
                   pl2.box_number, COUNT(*) AS cnt
            FROM remaining_complaints rc
            LEFT JOIN phone_lines pl2 ON pl2.tel_no = rc.phone_number
            WHERE rc.exchange_name = ANY($1) AND rc.cabinet_no = ANY($2)
              AND rc.complain_time >= $3::timestamptz
              AND rc.complain_time <= ($4 || ' 23:59:59')::timestamptz
            GROUP BY rc.exchange_name, rc.cabinet_no, pl2.box_number
          ) x GROUP BY x.exch, x.cab, x.box
        `, [exchArr, cabArr, dateFrom, dateTo]);
        for (const r of rr) {
          const key = `${normCentral(r.exch)}|${String(r.cab ?? "").trim()}|${String(r.box ?? "").trim()}`;
          rangeMap.set(key, (rangeMap.get(key) ?? 0) + (Number(r.cnt) || 0));
        }
      }

      // 4. بيانات ما قبل التكت: نجلب تجميعًا يوميًا من (أقدم تكت − 7 أيام) حتى الآن
      //    ثم نحسب per-ticket فى Node.js بناءً على تاريخ كل تكت
      let minDate = new Date();
      for (const t of tickets) {
        if (t.createdAt) { const d = new Date(t.createdAt); if (d < minDate) minDate = d; }
      }
      const preFrom = new Date(minDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      // Map: "normCentral|cab|box" → [{dt, cnt}]
      const preTimeMap = new Map<string, { dt: Date; cnt: number }[]>();
      const { rows: pr } = await pool.query(`
        SELECT x.exch, x.cab, x.box, x.dt, SUM(x.cnt)::int AS cnt FROM (
          SELECT cd.exchange_name AS exch, cd.cabinet_no AS cab,
                 pl.box_number   AS box,
                 DATE(cd.complain_time AT TIME ZONE 'Africa/Cairo') AS dt,
                 COUNT(*) AS cnt
          FROM complaint_details cd
          LEFT JOIN phone_lines pl ON pl.tel_no = cd.phone_number
          WHERE cd.exchange_name = ANY($1) AND cd.cabinet_no = ANY($2)
            AND cd.complain_time >= $3::timestamptz
          GROUP BY cd.exchange_name, cd.cabinet_no, pl.box_number, dt
          UNION ALL
          SELECT rc.exchange_name, rc.cabinet_no,
                 pl2.box_number,
                 DATE(rc.complain_time AT TIME ZONE 'Africa/Cairo') AS dt,
                 COUNT(*) AS cnt
          FROM remaining_complaints rc
          LEFT JOIN phone_lines pl2 ON pl2.tel_no = rc.phone_number
          WHERE rc.exchange_name = ANY($1) AND rc.cabinet_no = ANY($2)
            AND rc.complain_time >= $3::timestamptz
          GROUP BY rc.exchange_name, rc.cabinet_no, pl2.box_number, dt
        ) x GROUP BY x.exch, x.cab, x.box, x.dt
      `, [exchArr, cabArr, preFrom]);

      for (const r of pr) {
        const key = `${normCentral(r.exch)}|${String(r.cab ?? "").trim()}|${String(r.box ?? "").trim()}`;
        const dt = r.dt instanceof Date ? r.dt : new Date(String(r.dt));
        if (!preTimeMap.has(key)) preTimeMap.set(key, []);
        preTimeMap.get(key)!.push({ dt, cnt: Number(r.cnt) || 0 });
      }

      // 5. حساب العدد لكل تذكرة
      const result = tickets.map((t: any) => {
        const central  = normCentral(t?.central?.name ?? t?.centralDepartment);
        const cabin    = String(t?.cable?.number ?? "").trim();
        const boxes    = parseTicketBoxes(t?.box);
        const ticketDt = t.createdAt ? new Date(t.createdAt) : null;
        const preStart = ticketDt ? new Date(ticketDt.getTime() - 7 * 24 * 60 * 60 * 1000) : null;

        let faultCountInRange = 0;
        for (const b of boxes) {
          faultCountInRange += rangeMap.get(`${central}|${cabin}|${b}`) ?? 0;
        }

        let faultCountPreTicket = 0;
        if (preStart) {
          for (const b of boxes) {
            for (const { dt, cnt } of preTimeMap.get(`${central}|${cabin}|${b}`) ?? []) {
              if (dt >= preStart) faultCountPreTicket += cnt;
            }
          }
        }

        return { id: t.id, faultCountInRange, faultCountPreTicket };
      });

      res.json(result);
    } catch (e: any) {
      res.status(502).json({ message: `تعذّر حساب أعطال 430D: ${e.message}` });
    }
  });

  // GET /api/proxy/cfm-open-ticket-lines
  // أرقام التليفونات الموجودة على البكسيات التى لها تذكرة عطل شبكة أرضية (CFM) حالتها "مفتوحة".
  //   - يسحب تذاكر CFM ويأخذ فقط status === "open"
  //   - يبنى مجموعة مفاتيح (normCentral|cabin|box) من بكسيات هذه التذاكر
  //   - يجلب كل خطوط phone_lines المطابِقة لهذه البكسيات + بيانات الأكونت + آخر قياس من شيت 138
  app.get("/api/proxy/cfm-open-ticket-lines", requireAuth, async (_req, res) => {
    try {
      const tickets: any[] = await cfmStorage.getAllTickets();

      // مفتاح "normCentral|cabin|box" → بيانات التذكرة (للإلحاق بكل خط)
      const keyMeta = new Map<string, { ticketNumber: string; faultType: string; createdAt: string }>();
      for (const t of tickets) {
        if (t?.status !== "open") continue;
        const central = normCentral(t?.central?.name ?? t?.centralDepartment);
        const cabin   = String(t?.cable?.number ?? "").trim();
        if (!central || !cabin) continue;
        const boxes = parseTicketBoxes(t?.box);
        for (const b of boxes) {
          const key = `${central}|${cabin}|${b}`;
          // أول تذكرة مفتوحة تطابق هذا البكس تكفى للعرض
          if (!keyMeta.has(key)) {
            keyMeta.set(key, {
              ticketNumber: String(t?.ticketNumber ?? ""),
              faultType: String(t?.faultType?.name ?? ""),
              createdAt: String(t?.createdAt ?? ""),
            });
          }
        }
      }

      if (!keyMeta.size) return res.json({ lines: [], total: 0 });

      // نستخرج أرقام الكابينات الفريدة لتضييق الـ SQL query
      // ثم نطابق (central + box) فى Node.js باستخدام normCentral — لتفادى أى تعقيد regex فى PostgreSQL
      const cabArr = [...new Set([...keyMeta.keys()].map((k) => k.split("|")[1]).filter(Boolean))];

      const { rows } = await pool.query(
        `SELECT pl.tel_no AS "telNo", pl.central, pl.cabin_number AS "cabinNumber",
                pl.box_number AS "boxNumber", pl.full_phone AS "fullPhone",
                pl.idu_no AS "iduNo", pl.dp_terminal AS "dpTerminal",
                la.account_no AS "accountNo", la.source AS "accountSource",
                c138p.current_speed AS "lineCurrentSpeed", c138p.max_speed AS "lineMaxSpeed",
                c138p.score AS "lastMeasScore",
                (pe.last_raise_at AT TIME ZONE 'Africa/Cairo') AS "lastPoRaiseAt",
                (pe.last_stop_at AT TIME ZONE 'Africa/Cairo') AS "lastPoStopAt"
         FROM phone_lines pl
         LEFT JOIN line_accounts la ON la.full_phone = pl.full_phone
         LEFT JOIN line_po_events pe ON pe.account_no = la.account_no
         LEFT JOIN LATERAL (
           SELECT c.current_speed, c.max_speed, c.score
           FROM case_138 c WHERE c.full_phone = pl.full_phone ORDER BY c.id DESC LIMIT 1
         ) c138p ON true
         WHERE pl.cabin_number = ANY($1)
           AND NOT EXISTS (SELECT 1 FROM lines_no_account na WHERE na.full_phone = pl.full_phone)
           -- أى رقم مالوش فريم (مش متركّب على المسان) مايدخلش تقارير القياسات
           AND ${hasFrameSql("pl.full_phone")}
         ORDER BY pl.central, LPAD(COALESCE(pl.cabin_number,''),8,'0'),
                  LPAD(COALESCE(pl.box_number,''),8,'0'), pl.full_phone`,
        [cabArr],
      );

      // الفلترة فى Node.js: ابنِ المفتاح بنفس normCentral وطابِق مع keyMeta
      // هذا يضمن نفس منطق المطابقة المستخدم فى باقى الكود وبدون regex SQL معقّد
      const lines: any[] = [];
      for (const r of rows) {
        const key = `${normCentral(r.central)}|${String(r.cabinNumber ?? "").trim()}|${String(r.boxNumber ?? "").trim()}`;
        const meta = keyMeta.get(key);
        if (!meta) continue;
        lines.push({
          telNo: r.telNo, central: r.central, cabinNumber: r.cabinNumber, boxNumber: r.boxNumber,
          fullPhone: r.fullPhone, iduNo: r.iduNo, dpTerminal: r.dpTerminal,
          accountNo: r.accountNo, accountSource: r.accountSource,
          lineCurrentSpeed: r.lineCurrentSpeed, lineMaxSpeed: r.lineMaxSpeed, lastMeasScore: r.lastMeasScore,
          ticketNumber: meta.ticketNumber, faultType: meta.faultType,
          ticketCreatedAt: meta.createdAt,
        });
      }

      res.json({ lines, total: lines.length });
    } catch (e: any) {
      res.status(502).json({ message: `تعذّر جلب خطوط التذاكر المفتوحة: ${e.message}` });
    }
  });

  // GET /api/proxy/box-ground-ticket?central=&cabin=&box= → هل للبكس تذكرة عطل شبكة أرضية (CFM) مفتوحة؟
  app.get("/api/proxy/box-ground-ticket", requireAuth, async (req, res) => {
    try {
      const { central = "", cabin = "", box = "" } = req.query as Record<string, string>;
      if (!box) return res.json({ hasOpenTicket: false });
      const tickets: any[] = await cfmStorage.getAllTickets();
      const wantCentral = normCentral(central);
      const wantCabin = String(cabin).trim();
      const wantBox = String(box).trim();
      let hit: any = null;
      for (const t of tickets) {
        if (t?.status !== "open") continue;
        const tCentral = normCentral(t?.central?.name ?? t?.centralDepartment);
        const tCabin = String(t?.cable?.number ?? "").trim();
        // طابق البكس؛ ولو عندنا سنترال/كابينة طابقهم كمان (loosely للسنترال)
        if (wantCabin && tCabin && tCabin !== wantCabin) continue;
        if (wantCentral && tCentral && !(tCentral.includes(wantCentral) || wantCentral.includes(tCentral))) continue;
        const boxes = parseTicketBoxes(t?.box);
        if (boxes.some((b) => String(b).trim() === wantBox)) {
          hit = { ticketNumber: String(t?.ticketNumber ?? ""), faultType: String(t?.faultType?.name ?? ""), createdAt: String(t?.createdAt ?? "") };
          break;
        }
      }
      res.json({ hasOpenTicket: !!hit, ticket: hit });
    } catch (e: any) {
      res.status(502).json({ message: `تعذّر التحقق من تذاكر الشبكة الأرضية: ${e.message}` });
    }
  });

  // ── بروكسى نظام صيانة البوكسات (maintenance-we) ────────────────────────────
  // GET /api/proxy/maintenance-comprehensive — تقرير الفحوصات الشامل (كل الصفحات)
  //   فلاتر اختيارية: central, cabin, box, dateFrom, dateTo
  app.get("/api/proxy/maintenance-comprehensive", requireAuth, async (req, res) => {
    try {
      const { central = "", cabin = "", box = "", dateFrom = "", dateTo = "" } =
        req.query as Record<string, string>;
      const base = new URLSearchParams();
      if (central) base.set("central", central);
      if (cabin)   base.set("cabin", cabin);
      if (box)     base.set("box", box);
      if (dateFrom) base.set("dateFrom", dateFrom);
      if (dateTo)   base.set("dateTo", dateTo);
      base.set("limit", "500");

      // نجيب كل الصفحات (الإجمالى صغير ~مئات) عشان المطابقة بالبكس تبقى كاملة
      let page = 1;
      let all: any[] = [];
      let totalPages = 1;
      do {
        base.set("page", String(page));
        const upstream = await maintFetch(`/api/reports/comprehensive?${base}`);
        if (!upstream.ok) {
          // نقرأ نص الخطأ من موقع الصيانة عشان التشخيص (يظهر سبب الـ 500 الحقيقى)
          const body = await upstream.text().catch(() => "");
          return res.status(502).json({
            message: `Maintenance API returned ${upstream.status}: ${body.slice(0, 400) || "(no body)"}`,
          });
        }
        const j: any = await upstream.json();
        all = all.concat(Array.isArray(j?.data) ? j.data : []);
        totalPages = Number(j?.totalPages ?? 1) || 1;
        page++;
      } while (page <= totalPages && page <= 30);

      res.json({ data: all, total: all.length });
    } catch (e: any) {
      res.status(502).json({ message: `تعذّر جلب بيانات الصيانة: ${e.message}` });
    }
  });

  // بدء جدولة الحفظ اليومى (cron داخلى + تعويض عند الصحيان)
  startDailySnapshotScheduler();

  return httpServer;
}
