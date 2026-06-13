import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { pool } from "./db";
import { insertOrderSchema, updateOrderSchema, updateExternalResponseSchema, ROLES, WS_EVENTS, CONTRACT_STATUS, ORDER_STATUS } from "@shared/schema";
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

const scryptAsync = promisify(scrypt);
const SessionStore = MemoryStore(session);

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

// Excel serial date (or string) → JS Date | null
function toDate(v: any): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && v > 1) {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return new Date(d.y, d.m - 1, d.d, d.H ?? 0, d.M ?? 0, d.S ?? 0);
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

// Parse a TicketQueue sheet (Arabic OR English headers) into value arrays
// matching TICKET_COLS. Stores ALL centrals (name falls back to the code).
// Deduplicated by (ticket_id, status_code) for the historical unique key.
function parseTicketFile(buffer: Buffer): any[][] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
  const { find, dataRows } = smartSheet(rows, ["رقم الشكوي", "رقم الشكوى", "complain no"]);
  const iTicket   = find("رقم الشكوي", "رقم الشكوى", "complain no");
  const iStatus   = find("status code");
  const iOrg      = find("كود السنترال", "exch code", "exchange code", "exch");
  const iTime     = find("وقت الشكوي", "وقت الشكوى", "complain time");
  const iTech     = find("كود الفنى", "كود الفني", "repman code", "repman");
  const iLineType = find("line type");
  const iPhone    = find("رقم التلفون", "رقم التليفون", "tel no");
  const iCabinet  = find("cabinet no", "رقم الكابينة", "رقم الكابينه");
  const iPriority = find("كود الأولوية", "كود الاولويه", "priority", "customer segment");
  const iCloseDate = find("تاريخ الإغلاق", "تاريخ الاغلاق", "close date");
  const iOperation = find("نوع العملية", "نوع العمليه", "process type");
  const iType     = find("complaintypename", "نوع العطل", "complain type");
  const iOnu      = find("onu");
  const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

  const out: any[][] = [];
  const seen = new Set<string>();
  for (const r of dataRows) {
    const ticketId = String(g(r, iTicket)).trim();
    if (!ticketId) continue;
    const status = String(g(r, iStatus)).trim();
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

// Accumulate into a historical table (dedup via ON CONFLICT DO NOTHING).
async function accumulateTable(table: string, cols: string[], conflict: string, rows: any[][], userId: number): Promise<number> {
  if (!rows.length) return 0;
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
    const res = await pool.query(
      `INSERT INTO ${table} (${allCols.join(",")}) VALUES ${ph} ON CONFLICT (${conflict}) DO NOTHING`,
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
}) {
  const firstToday = await isFirstUploadToday(opts.sodTable);
  const hist = await accumulateTable(opts.histTable, opts.cols, opts.conflict, opts.rows, opts.userId);
  const current = await replaceTable(opts.curTable, opts.cols, opts.rows, opts.userId);
  // first upload of a new day clears the previous day's snapshot first; then both
  // the fresh-day and same-day paths accumulate (ON CONFLICT DO NOTHING),
  // tolerating duplicate keys inside the file.
  if (firstToday) await pool.query(`DELETE FROM ${opts.sodTable}`);
  const startOfDay = await accumulateTable(opts.sodTable, opts.cols, opts.conflict, opts.rows, opts.userId);
  return { hist, current, startOfDay, sodReplaced: firstToday, total: opts.rows.length };
}

// FTTH-order data columns (shared by historical / current / archive tables).
const FTTH_ORDER_COLS = [
  "service_order_id", "customer_order_id", "product", "service_number", "customer_name",
  "order_status", "order_create_time", "exchange_name", "service_type", "msan_code",
  "area_code", "customer_mobile", "current_activity", "error_name", "governorate",
  "line_type", "fcc_exchange", "raw",
];

const COMPLAINT_DETAILS_COLS = [
  "complain_no","sector","region","exchange_name","phone_number","msan_id","cabinet_no",
  "complain_time","close_time","close_code","complain_side_name","complain_type_name","close_by",
];

const REMAINING_COMPLAINTS_COLS = [
  "complain_no","sector","region","exchange_name","phone_number","complain_time",
  "dispatch_time","dispatch_user","msan_id","close_time","close_code","close_by",
  "status_code","cabinet_no","complain_type",
];

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
async function queryRegularizedFaults(opts: { central?: string; q?: string }) {
  const { central = "", q = "" } = opts;
  const params: any[] = [];
  const conds: string[] = [
    `(t.status_code ~ '^(160|173|122|73|72|60)' OR t.complain_type_name ~ '^(160|173|122|73|72|60)')`,
    `(t.central_name = 'الغنايم' OR t.central_name = 'الغنايم-العزايزة' OR t.central_name = 'الغنايم-دير الجنادله' OR t.central_name = 'الغنايم-نجع العمدة')`,
  ];
  if (central) { params.push(central); conds.push(`t.central_name = $${params.length}`); }
  if (q.trim()) {
    params.push(`%${q.trim()}%`);
    const p = `$${params.length}`;
    conds.push(`(t.phone_number ILIKE ${p} OR t.cabinet_no ILIKE ${p} OR t.status_code ILIKE ${p} OR pl.box_number ILIKE ${p})`);
  }
  const where = "WHERE " + conds.join(" AND ");
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (t.ticket_id)
         t.ticket_id             AS "ticketId",
         t.central_name          AS "centralName",
         t.phone_number          AS "phoneShort",
         CASE WHEN t.phone_number IS NOT NULL AND t.phone_number <> '' AND t.complaint_time IS NOT NULL
                   AND EXISTS (
                     SELECT 1 FROM complaint_details cd
                     WHERE cd.close_time IS NOT NULL
                       AND regexp_replace(COALESCE(cd.phone_number,''), '\\D', '', 'g') LIKE '%' || t.phone_number
                       AND date_trunc('month', cd.close_time) = date_trunc('month', t.complaint_time)
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
         t.central_code          AS "centralCode"
       FROM (
         SELECT *, 'مغلق اليوم' AS reg_source FROM ticket_dsl_current
         WHERE close_date IS NOT NULL
           AND (close_date AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date
         UNION ALL
         SELECT *, 'اختفى من الحالى' AS reg_source FROM ticket_dsl_sod s
         WHERE NOT EXISTS (SELECT 1 FROM ticket_dsl_current c WHERE c.ticket_id = s.ticket_id)
       ) t
       LEFT JOIN phone_ports pp ON pp.phone_number = t.phone_number
       LEFT JOIN phone_lines pl ON pl.tel_no = t.phone_number
       LEFT JOIN cabinet_technicians ct ON ct.central_name = t.central_name AND ct.cabin_number = t.cabinet_no
       LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
       ${where}
       ORDER BY t.ticket_id, t.id DESC
     ) x
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
  typesLc: string[], regularized: boolean, opts: { central?: string; q?: string },
) {
  const { central = "", q = "" } = opts;
  const params: any[] = [typesLc];
  const conds: string[] = [
    `lower(trim(t.work_order_type)) = ANY($1::text[])`,
    `(t.central_name = 'الغنايم' OR t.central_name = 'الغنايم-العزايزة' OR t.central_name = 'الغنايم-دير الجنادله' OR t.central_name = 'الغنايم-نجع العمدة')`,
  ];
  if (regularized) {
    conds.push(`NOT EXISTS (SELECT 1 FROM wfm_current c WHERE c.central_name = t.central_name AND c.work_order_id = t.work_order_id)`);
  }
  if (central) { params.push(central); conds.push(`t.central_name = $${params.length}`); }
  if (q.trim()) {
    params.push(`%${q.trim()}%`);
    const p = `$${params.length}`;
    conds.push(`(t.phone_number ILIKE ${p} OR t.work_order_type ILIKE ${p} OR pl.cabin_number ILIKE ${p} OR pl.box_number ILIKE ${p} OR t.description ILIKE ${p})`);
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
      const r = await recordDailySnapshot(targetDate);
      console.log(`[daily-snapshot] recorded ${targetDate}:`, r);
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

  // Notify the sales rep who created the order + all admins when an order
  // becomes feasible (by tech or external affairs).
  const notifyOrderFeasible = async (order: any, source: "tech" | "external") => {
    const sourceLabel = source === "external" ? "الشئون الخارجية" : "القسم الفني";
    const recipientIds = new Set<number>();
    if (order.salesId) recipientIds.add(order.salesId);
    const admins = (await storage.getUsers()).filter((u) => u.role === ROLES.ADMIN);
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
      store: new SessionStore({ checkPeriod: 86400000 }),
      secret: "super-secret-session-key",
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 86400000 },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

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

  // === Auth Routes ===
  app.post(api.auth.login.path, passport.authenticate("local"), (req, res) => {
    res.json(req.user);
  });

  app.post(api.auth.logout.path, (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ message: "Logged out" });
    });
  });

  app.get(api.auth.me.path, (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(req.user);
  });

  // === Middleware ===
  const requireAuth = (req: any, res: any, next: any) => {
    if (req.isAuthenticated()) return next();
    res.sendStatus(401);
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && req.user.role === ROLES.ADMIN) return next();
    res.status(403).json({ message: "Admin access required" });
  };

  const requireTechOrAdmin = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && (req.user.role === ROLES.TECH || req.user.role === ROLES.ADMIN)) return next();
    res.status(403).json({ message: "Tech or Admin access required" });
  };

  const requireDataManager = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && req.user.role === ROLES.DATA_MANAGER) return next();
    res.status(403).json({ message: "Data Manager access required" });
  };

  // === User Management Routes ===
  app.get(api.users.list.path, requireAuth, requireAdmin, async (req, res) => {
    const userList = await storage.getUsers();
    const sanitized = userList.map(u => ({ id: u.id, username: u.username, role: u.role, suspended: u.suspended, createdAt: u.createdAt }));
    res.json(sanitized);
  });

  app.post(api.users.create.path, requireAuth, requireAdmin, async (req, res) => {
    try {
      const { username, password, role } = req.body;
      
      if (!username || !password || !role) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      
      const validRoles = [ROLES.SALES, ROLES.TECH, ROLES.EXTERNAL, ROLES.DATA_MANAGER];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ message: "Role must be sales, tech, external, or data_manager" });
      }

      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({ username, password: hashedPassword, role });
      res.status(201).json({ id: user.id, username: user.username, role: user.role });
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

  app.delete(api.users.delete.path, requireAuth, requireAdmin, async (req, res) => {
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

      await storage.deleteUser(userId);
      res.json({ message: "User deleted successfully" });
    } catch (e) {
      res.status(500).json({ message: "Error deleting user" });
    }
  });

  app.put(api.users.suspend.path, requireAuth, requireAdmin, async (req, res) => {
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

      const updatedUser = await storage.suspendUser(userId, suspended);
      res.json({ id: updatedUser.id, username: updatedUser.username, role: updatedUser.role, suspended: updatedUser.suspended });
    } catch (e) {
      res.status(500).json({ message: "Error updating user suspension" });
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
      // External sees only orders in needs_external state
      const externalOrders = await storage.getOrdersForExternal();
      return res.json(externalOrders);
    }

    if (user.role === ROLES.TECH) {
      // Tech sees all orders EXCEPT those in needs_external state
      const allOrders = await storage.getOrders();
      const techOrders = allOrders.filter(o => o.status !== ORDER_STATUS.NEEDS_EXTERNAL);
      return res.json(techOrders);
    }

    // Admin sees all orders
    const orders = await storage.getOrders();
    res.json(orders);
  });

  app.post(api.orders.create.path, requireAuth, async (req, res) => {
    const user = req.user as any;
    if (user.role !== ROLES.SALES && user.role !== ROLES.ADMIN) {
      return res.status(403).json({ message: "Only Sales can create orders" });
    }

    try {
      const input = insertOrderSchema.parse(req.body);
      const order = await storage.createOrder({
        ...input,
        salesId: user.id,
        salesName: user.username,
      });
      
      broadcast({ type: WS_EVENTS.ORDER_CREATE, payload: order });
      res.status(201).json(order);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json(e.errors);
      } else {
        throw e;
      }
    }
  });

  app.put(api.orders.update.path, requireAuth, async (req, res) => {
    const user = req.user as any;
    // Only Tech (or Admin) can update status/feasibility
    if (user.role !== ROLES.TECH && user.role !== ROLES.ADMIN) {
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
        techId: user.id,
        techName: user.username,
        techResponseAt: new Date(),
      });

      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
      if (status === "feasible") {
        await notifyOrderFeasible(order, "tech");
      }
      res.json(order);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json(e.errors);
      } else {
        throw e;
      }
    }
  });

  app.post(api.orders.resetTechResponse.path, requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      const existingOrder = await storage.getOrder(id);
      if (!existingOrder) {
        return res.status(404).json({ message: "Order not found" });
      }

      const order = await storage.resetTechResponse(id);
      broadcast({ type: WS_EVENTS.ORDER_UPDATE, payload: order });
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
      } else if (user.role !== ROLES.ADMIN) {
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

      if (user.role !== ROLES.SALES && user.role !== ROLES.ADMIN) {
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
      res.json(order);
    } catch (e) {
      res.status(500).json({ message: "Error requesting external review" });
    }
  });

  app.put(api.orders.externalResponse.path, requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const id = parseInt(req.params.id);

      if (user.role !== ROLES.EXTERNAL && user.role !== ROLES.ADMIN) {
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
      const sorted = Array.from(set).sort((a, b) => {
        const na = parseInt(a), nb = parseInt(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        if (!isNaN(na)) return -1;
        if (!isNaN(nb)) return 1;
        return a.localeCompare(b);
      });
      boxes[key] = sorted;
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
    const { search = "", central = "", cabin = "", box = "", page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const pageSize = Math.min(20000, Math.max(1, parseInt(limit)));
    const q = search.trim().toLowerCase();

    const conds: string[] = [];
    const params: any[] = [];
    if (central) { params.push(central); conds.push(`pl.central = $${params.length}`); }
    if (cabin) { params.push(cabin); conds.push(`pl.cabin_number = $${params.length}`); }
    if (box) { params.push(box); conds.push(`pl.box_number = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      conds.push(`(LOWER(pl.full_phone) LIKE ${p} OR LOWER(pl.tel_no) LIKE ${p} OR LOWER(pl.central) LIKE ${p} OR LOWER(pl.cabin_number) LIKE ${p} OR LOWER(pl.box_number) LIKE ${p})`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const joinClause = `FROM phone_lines pl LEFT JOIN phone_ports pp ON pp.phone_number = pl.full_phone`;

    const totalRes = await pool.query(`SELECT COUNT(*)::int AS c ${joinClause} ${where}`, params);
    const total = totalRes.rows[0].c as number;

    const offset = (pageNum - 1) * pageSize;
    params.push(pageSize); params.push(offset);
    const dataRes = await pool.query(
      `SELECT pl.id, pl.tel_no AS "telNo", pl.central, pl.idu_no AS "iduNo", pl.odu_no AS "oduNo",
              pl.cabin_number AS "cabinNumber", pl.primary_block_no AS "primaryBlockNo",
              pl.cabinet_in AS "cabinetIn", pl.sec_block_no AS "secBlockNo", pl.cabinet_out AS "cabinetOut",
              pl.box_number AS "boxNumber", pl.dp_terminal AS "dpTerminal",
              COALESCE(pp.frame, pl.port) AS port, pl.len,
              pl.fiber_block AS "fiberBlock", pl.fiber_out AS "fiberOut",
              pl.tel_num_txt AS "telNumTxt", pl.full_phone AS "fullPhone"
       ${joinClause} ${where}
       ORDER BY pl.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({ data: dataRes.rows, total, page: pageNum, pageSize });
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

  // === Work Orders (تركيبات) ===
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

  // POST /api/work-orders/import — admin uploads تركيبات xlsx
  app.post("/api/work-orders/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    if (!req.file) return res.status(400).json({ message: "لم يتم إرسال ملف" });
    try {
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (rows.length < 2) return res.status(400).json({ message: "الملف فارغ" });

      // Detect column indices from header row by partial (case-insensitive)
      // match — supports the WFM "Voice Installation Raw Data" English layout
      // as well as the older Arabic تركيبات layout.
      const header = rows[0].map((h: any) => String(h ?? "").trim().toLowerCase());
      const findCol = (...keywords: string[]) =>
        header.findIndex((h) => h !== "" && keywords.some((k) => h.includes(k.toLowerCase())));

      const iCentral   = findCol("سنترال", "central");
      const iOrg       = findCol("organization", "كود السنترال", "المنظمه");
      const iCloseCat  = findCol("close category", "success", "حاله الاغلاق", "نتيجه الاغلاق");
      const iWorkOrder = findCol("work order id", "امر الشغل", "رقم الامر", "تذكرة");
      const iPhone     = findCol("service no", "التليفون", "تليفون", "هاتف", "phone");
      const iService   = findCol("work order type", "نوع الخدمه", "نوع الخدمة", "service type");
      const iDate      = findCol("close date", "تاريخ الاغلاق", "تاريخ الإغلاق", "الاغلاق");
      const iItem      = findCol("اسم الصنف", "الصنف", "item name");
      const iCable     = findCol("consumed cables", "كميه السلك", "كمية السلك", "السلك", "cable");
      const iTech      = findCol("tech name", "اسم الفنى", "اسم الفني", "الفنى");

      // central header is blank in the WFM export → fall back to first column
      const g = (row: any[], detected: number, fallback: number) =>
        row[detected >= 0 ? detected : fallback] ?? "";
      // optional fields: blank when the column is absent (no positional guess)
      const opt = (row: any[], detected: number) =>
        detected >= 0 ? (row[detected] ?? "") : "";

      const dataRows = rows.slice(1).filter((r) => {
        const id = g(r, iWorkOrder, 1);
        return id !== "" && id !== null && id !== undefined;
      });

      let inserted = 0;
      let skipped = 0;

      for (const r of dataRows) {
        // لا تُحمَّل إلا أوامر الشغل المغلقة بنجاح (Close Category = Success).
        const closeCategory = String(g(r, iCloseCat, 10)).trim().toLowerCase();
        if (closeCategory !== "success") { skipped++; continue; }
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
        const rawDate      = g(r, iDate, 12);
        const itemName     = "سلك واحد جوز"; // اسم الصنف ثابت دائماً
        const cableQuantity = ""; // كميه السلك تُترك فارغة عمداً (لا تؤخذ من الملف)
        const techName     = String(g(r, iTech, 15)).trim();

        if (!workOrderId || isNaN(workOrderId)) { skipped++; continue; }

        let closeDate: Date;
        if (rawDate instanceof Date) {
          closeDate = rawDate;
        } else if (typeof rawDate === "number") {
          closeDate = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
        } else {
          closeDate = new Date(rawDate);
        }
        if (isNaN(closeDate.getTime())) { skipped++; continue; }

        // المقارنة على (اسم السنترال + رقم امر الشغل): لو موجود يُتخطّى، لو جديد يُضاف.
        const ins = await pool.query(
          `INSERT INTO work_orders (central_name, work_order_id, phone_number, service_type, close_date, item_name, cable_quantity, tech_name, uploaded_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (central_name, work_order_id) DO NOTHING`,
          [centralName, workOrderId, phoneNumber, serviceType, closeDate, itemName || null, cableQuantity || null, techName, (req.user as any).id],
        );
        if (ins.rowCount && ins.rowCount > 0) inserted++; else skipped++;
      }

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

      console.log(`work-orders import: purged=${purged}, headers=${JSON.stringify(header)}, cols={central:${iCentral},order:${iWorkOrder},phone:${iPhone},svc:${iService},date:${iDate},item:${iItem},cable:${iCable},tech:${iTech}}, rows=${dataRows.length}, inserted=${inserted}, skipped=${skipped}`);
      res.json({ ok: true, inserted, skipped, purged, total: dataRows.length });
    } catch (e: any) {
      console.error("work-orders import error:", e);
      res.status(500).json({ message: "خطأ أثناء معالجة الملف", detail: e.message });
    }
  });

  // GET /api/work-orders — list with date range filter
  app.get("/api/work-orders", requireAuth, async (req, res) => {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const params: any[] = [];
    const conds: string[] = [];

    if (dateFrom) { params.push(dateFrom); conds.push(`close_date >= $${params.length}::date`); }
    if (dateTo) { params.push(dateTo); conds.push(`close_date < ($${params.length}::date + interval '1 day')`); }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT id, central_name AS "centralName", work_order_id AS "workOrderId",
              phone_number AS "phoneNumber", service_type AS "serviceType",
              close_date AS "closeDate", item_name AS "itemName",
              cable_quantity AS "cableQuantity", tech_name AS "techName"
       FROM work_orders ${where}
       ORDER BY close_date ASC`,
      params,
    );
    res.json(rows);
  });

  // === Multi-file upload section ===

  // POST /api/maintenance-orders/import — Work_Orders / wfm (3 destinations)
  app.post("/api/maintenance-orders/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
      if (rows.length < 2) return res.json({ inserted: 0 });

      // smart header detection (tolerant of column reorder / leading title rows)
      const { find, dataRows } = smartSheet(rows, ["رقم أمر الشغل", "رقم امر الشغل", "work order"]);
      const iDate     = find("تاريخ الانشاء", "تاريخ الإنشاء", "creation");
      const iWorkOrder = find("رقم أمر الشغل", "رقم امر الشغل", "work order id", "work order no");
      const iOrg      = find("المؤسسة", "المنظمه", "organization");
      const iPhone    = find("رقم الخدمة", "رقم الخدمه", "service no", "التليفون", "tel no");
      const iType     = find("نوع أمر الشغل", "نوع امر الشغل", "work order type");
      const iStage    = find("المرحلة", "stage");
      const iStatus   = find("الحالة", "status");
      const iPriority = find("الأهمية", "الاهميه", "priority");
      const iWorkspec = find("currentworkspec", "workspec");
      const iNotes    = find("notes", "ملاحظات");
      const iDesc     = find("الوصف", "description");
      const iMobile   = find("رقم الموبايل", "mobile");
      const iCustomer = find("اسم العميل", "customer name", "customer");
      const iAddress  = find("العنوان", "address");
      const iRef      = find("رقم المرجع", "reference no", "reference");
      // "اسم السنترال" = كود السنترال/رقم الكابينة (مثال GHNAT/7-3) — نستخرج
      // منه رقم الكابينة لربط أمر الشغل بفنى الكابينة فى تقارير التركيبات.
      const iExchName = find("اسم السنترال", "exchange name");
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

      const r = await writeThreeDestinations({
        histTable: "maintenance_orders", sodTable: "wfm_sod", curTable: "wfm_current",
        cols: WFM_COLS, conflict: "central_name, work_order_id", rows: wfmRows, userId: (req.user as any).id,
      });
      res.json({ inserted: r.hist, ...r });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // POST /api/ticket-queue/import — DSL/copper TicketQueue (3 destinations)
  app.post("/api/ticket-queue/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const rows = parseTicketFile(req.file.buffer);
      const r = await writeThreeDestinations({
        histTable: "ticket_queue", sodTable: "ticket_dsl_sod", curTable: "ticket_dsl_current",
        cols: TICKET_COLS, conflict: "ticket_id, status_code", rows, userId: (req.user as any).id,
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
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      conds.push(`(ticket_id ILIKE ${p} OR phone_number ILIKE ${p} OR central_name ILIKE ${p} OR cabinet_no ILIKE ${p})`);
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
  app.post("/api/complaint-details/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const userId: number = (req as any).user.id;

      let detailsInserted = 0, detailsTotal = 0;
      let remainingInserted = 0, remainingTotal = 0;

      // ── Sheet: التفاصيل (accumulating, dedup by complain_no) ──
      const ws1 = wb.Sheets["التفاصيل"];
      if (ws1) {
        const rows1: any[][] = XLSX.utils.sheet_to_json(ws1, { header: 1, defval: "" }) as any[][];
        const { find, dataRows } = smartSheet(rows1, ["complain no"]);
        const iNo = find("complain no");
        const iSector = find("sector");
        const iRegion = find("region");
        const iExchange = find("exchange name", "exchange");
        const iPhone = find("التليفون", "tel no");
        const iMsan = find("msan id", "msan");
        const iCabinet = find("cabinet no");
        const iCloseCode = find("close code");
        const iComplainTime = find("compalin time", "complain time");
        const iCloseTime = find("close time");
        const iSide = find("complain side name", "side name");
        const iType = find("complain type name", "complain type");
        const iCloseBy = find("close by");
        const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

        const inserts: any[][] = [];
        const seen = new Set<string>();
        for (const r of dataRows) {
          const no = String(g(r, iNo)).trim();
          if (!no || no === "0" || seen.has(no)) continue;
          seen.add(no);
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
            String(g(r, iSide)) || null,
            String(g(r, iType)) || null,
            String(g(r, iCloseBy)) || null,
          ]);
        }
        detailsTotal = inserts.length;
        // All 3 destinations accumulate — no full replace — so uploading multiple
        // parts of the national 430D file combines them instead of overwriting.
        const r1hist = await accumulateTable("complaint_details", COMPLAINT_DETAILS_COLS, "complain_no", inserts, userId);
        await accumulateTable("complaint_details_current", COMPLAINT_DETAILS_COLS, "complain_no", inserts, userId);
        const firstToday1 = await isFirstUploadToday("complaint_details_sod");
        if (firstToday1) await pool.query("DELETE FROM complaint_details_sod");
        await accumulateTable("complaint_details_sod", COMPLAINT_DETAILS_COLS, "complain_no", inserts, userId);
        detailsInserted = r1hist;
      }

      // ── Sheet: تفاصيل متبقى (full replace) ──
      const ws2 = wb.Sheets["تفاصيل متبقى"];
      if (ws2) {
        const rows2: any[][] = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: "" }) as any[][];
        const { find, dataRows } = smartSheet(rows2, ["complain no"]);
        const iNo = find("complain no");
        const iSector = find("sector");
        const iRegion = find("region");
        const iExchange = find("exchange name", "exchange");
        const iPhone = find("tel no", "التليفون");
        const iComplainTime = find("complain time");
        const iDispatchTime = find("dispatch time");
        const iDispatchUser = find("dispatch user");
        const iMsan = find("msan id", "msan");
        const iCloseTime = find("close time");
        const iCloseCode = find("close code");
        const iCloseBy = find("close by");
        const iStatus = find("status code");
        const iCabinet = find("cabinet no");
        // "Complain Type" (not "Complain Type Code")
        const iType = (() => {
          const exact = find("complain type");
          // prefer the column whose header is exactly "complain type"
          return exact;
        })();
        const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

        const inserts: any[][] = [];
        const seen = new Set<string>();
        for (const r of dataRows) {
          const no = String(g(r, iNo)).trim();
          if (!no || no === "0" || seen.has(no)) continue;
          seen.add(no);
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
          ]);
        }
        remainingTotal = inserts.length;
        // المتبقى snapshot: current is fully replaced each upload (fresh open-faults
        // snapshot), while the historical table keeps accumulating.
        const r2 = await writeThreeDestinations({
          histTable: "remaining_complaints",
          sodTable: "remaining_complaints_sod",
          curTable: "remaining_complaints_current",
          cols: REMAINING_COMPLAINTS_COLS,
          conflict: "complain_no",
          rows: inserts,
          userId,
        });
        remainingInserted = r2.hist;
      }

      res.json({
        inserted: detailsInserted + remainingInserted,
        details: { inserted: detailsInserted, total: detailsTotal },
        remaining: { inserted: remainingInserted, total: remainingTotal },
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
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      conds.push(`(complain_no ILIKE ${p} OR phone_number ILIKE ${p} OR exchange_name ILIKE ${p} OR cabinet_no ILIKE ${p})`);
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
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      conds.push(`(complain_no ILIKE ${p} OR phone_number ILIKE ${p} OR exchange_name ILIKE ${p} OR cabinet_no ILIKE ${p})`);
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
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
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

      await pool.query("DELETE FROM ftth_subscribers");
      let inserted = 0;
      const BATCH = 300;
      for (let s = 0; s < inserts.length; s += BATCH) {
        const chunk = inserts.slice(s, s + BATCH);
        const ph = chunk.map((_, ci) => {
          const o = ci * 9;
          return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9})`;
        }).join(",");
        const r = await pool.query(
          `INSERT INTO ftth_subscribers
             (sector, region, main_ex, sub_ex, fcc_code, type, msan_gpon_code, fbb_subs, fv_subs)
           VALUES ${ph}`,
          chunk.flat(),
        );
        inserted += r.rowCount ?? 0;
      }
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
      if (mode === "replace") await pool.query("DELETE FROM ftth_subscribers");
      const toInt = (v: any) => { const n = parseInt(String(v)); return isNaN(n) ? null : n; };
      let inserted = 0;
      const BATCH = 300;
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
        const r2 = await pool.query(
          `INSERT INTO ftth_subscribers
             (sector, region, main_ex, sub_ex, fcc_code, type, msan_gpon_code, fbb_subs, fv_subs)
           VALUES ${ph}`,
          chunk.flat(),
        );
        inserted += r2.rowCount ?? 0;
      }
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
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      where = `WHERE (fcc_code ILIKE ${p} OR main_ex ILIKE ${p} OR sub_ex ILIKE ${p} OR msan_gpon_code ILIKE ${p} OR type ILIKE ${p})`;
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

  // POST /api/case-138/import — full replace from حاله 138 sheet
  app.post("/api/case-138/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets["حاله 138"] || wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
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

      // Dedup by رقم الشكوى (complain_no) — keep the LAST row for each (Map.set overwrites).
      // Rows without a complain number keep a unique key so they are not merged.
      const byComplain = new Map<string, any[]>();
      let noKeySeq = 0;
      for (const r of dataRows) {
        const complainNo = String(g(r, iComplainNo)).trim();
        const central = String(g(r, iCentral)).trim();
        if (!complainNo && !central) continue;
        const key = complainNo || `__no_complain_${noKeySeq++}`;
        byComplain.set(key, [
          central || null,
          String(g(r, iPhoneShort)) || null,
          complainNo || null,
          toInt(g(r, iScore)),
          String(g(r, iCurSpeed)) || null,
          String(g(r, iMaxSpeed)) || null,
          String(g(r, iFullPhone)) || null,
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
      const inserts = Array.from(byComplain.values());

      await pool.query("DELETE FROM case_138");
      let inserted = 0;
      const BATCH = 200;
      for (let s = 0; s < inserts.length; s += BATCH) {
        const chunk = inserts.slice(s, s + BATCH);
        const ph = chunk.map((_, ci) => {
          const o = ci * 19;
          return "(" + Array.from({ length: 19 }, (_, k) => `$${o+k+1}`).join(",") + ")";
        }).join(",");
        const r = await pool.query(
          `INSERT INTO case_138
             (central_name, phone_short, complain_no, score, current_speed, max_speed,
              full_phone, account_no, status_code, cabinet_no, box_no, complain_type_name,
              complain_time, customer_name, dispatch_time, tech_code, close_date, onu, fault_type)
           VALUES ${ph}`,
          chunk.flat(),
        );
        inserted += r.rowCount ?? 0;
      }
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
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      conds.push(`(complain_no ILIKE ${p} OR full_phone ILIKE ${p} OR phone_short ILIKE ${p} OR central_name ILIKE ${p} OR cabinet_no ILIKE ${p})`);
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

  // POST /api/cabinet-technicians/import — الفنيين بأرقام الكباين (full replace each upload)
  app.post("/api/cabinet-technicians/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
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

      await pool.query("DELETE FROM cabinet_technicians");
      let inserted = 0;
      const BATCH = 200;
      for (let s = 0; s < inserts.length; s += BATCH) {
        const chunk = inserts.slice(s, s + BATCH);
        const ph = chunk.map((_, ci) => {
          const o = ci * 10;
          return "(" + Array.from({ length: 10 }, (_, k) => `$${o+k+1}`).join(",") + ")";
        }).join(",");
        const r = await pool.query(
          `INSERT INTO cabinet_technicians
             (central_name, cabin_number, worker_code, haya_karima, region_name,
              active, central_finish, village_code, cabin_code, idu)
           VALUES ${ph}`,
          chunk.flat(),
        );
        inserted += r.rowCount ?? 0;
      }
      res.json({ inserted, total: inserts.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // GET /api/cabinet-technicians — list with search
  app.get("/api/cabinet-technicians", requireAuth, async (req, res) => {
    const { q } = req.query as Record<string, string>;
    const params: any[] = [];
    let where = "";
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      where = `WHERE (central_name ILIKE ${p} OR cabin_number ILIKE ${p} OR worker_code ILIKE ${p} OR region_name ILIKE ${p} OR cabin_code ILIKE ${p} OR idu ILIKE ${p})`;
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
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
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

      await pool.query("DELETE FROM technician_names");
      let inserted = 0;
      const BATCH = 200;
      for (let s = 0; s < inserts.length; s += BATCH) {
        const chunk = inserts.slice(s, s + BATCH);
        const uidPos = chunk.length * 2 + 1;
        const ph = chunk.map((_, ci) => `($${ci * 2 + 1},$${ci * 2 + 2},$${uidPos})`).join(",");
        const vals: any[] = chunk.flatMap(([code, name]) => [code, name]);
        vals.push(req.user.id);
        const r = await pool.query(
          `INSERT INTO technician_names (worker_code, tech_name, uploaded_by_id) VALUES ${ph}`,
          vals,
        );
        inserted += r.rowCount ?? 0;
      }
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
      params.push(`%${q.trim()}%`);
      where = `WHERE (worker_code ILIKE $1 OR tech_name ILIKE $1)`;
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
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
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
      const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

      // dedup within file by phone (last occurrence wins)
      const byPhone = new Map<string, any[]>();
      for (const r of dataRows) {
        const phone = String(g(r, iPhone)).trim();
        if (!phone) continue;
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
        ]);
      }
      const all = Array.from(byPhone.values());

      let affected = 0;
      const BATCH = 300;
      for (let s = 0; s < all.length; s += BATCH) {
        const chunk = all.slice(s, s + BATCH);
        const ph = chunk.map((_, ci) => {
          const o = ci * 11;
          return "(" + Array.from({ length: 11 }, (_, k) => `$${o+k+1}`).join(",") + ")";
        }).join(",");
        const r = await pool.query(
          `INSERT INTO phone_ports
             (phone_number, area_code, msan_code, frame, shelf, slot, port_number,
              port_type, voice_status, data_status, operator)
           VALUES ${ph}
           ON CONFLICT (phone_number) DO UPDATE SET
             area_code = EXCLUDED.area_code, msan_code = EXCLUDED.msan_code,
             frame = EXCLUDED.frame, shelf = EXCLUDED.shelf, slot = EXCLUDED.slot,
             port_number = EXCLUDED.port_number, port_type = EXCLUDED.port_type,
             voice_status = EXCLUDED.voice_status, data_status = EXCLUDED.data_status,
             operator = EXCLUDED.operator, uploaded_at = now()`,
          chunk.flat(),
        );
        affected += r.rowCount ?? 0;
      }
      res.json({ inserted: affected, total: all.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // GET /api/phone-ports — list with search
  app.get("/api/phone-ports", requireAuth, async (req, res) => {
    const { q } = req.query as Record<string, string>;
    const params: any[] = [];
    let where = "";
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      where = `WHERE (phone_number ILIKE ${p} OR msan_code ILIKE ${p} OR operator ILIKE ${p})`;
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

  // POST /api/ftth-orders/import — historical (accumulate + yearly archive) + current (replace)
  app.post("/api/ftth-orders/import", requireAuth, requireAdmin, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "لا يوجد ملف" });
      const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
      const ws = wb.Sheets["Order"] || wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
      const { find, findExact, dataRows, headerRowIdx } = smartSheet(rows, ["service order id", "service number"]);
      const origHeaders = (rows[headerRowIdx] || []).map((h) => String(h ?? "").trim());

      const iSO = find("service order id");
      const iCO = find("customer order id");
      const iProduct = findExact("product");
      const iServiceNo = find("service number");
      const iCustomer = findExact("customer name");
      const iStatus = findExact("order status");
      const iCreate = find("order create time");
      const iExch = findExact("exchange name");
      const iSvcType = findExact("service type");
      const iMsan = find("msan code");
      const iArea = findExact("area code");
      const iMobile = find("customer mobile number", "customer mobile");
      const iActivity = findExact("current activity");
      const iError = find("error name");
      const iGov = find("governorate");
      const iLineType = findExact("line type");
      const iFcc = find("fcc exchange");
      const g = (r: any[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

      const byId = new Map<string, any[]>();
      for (const r of dataRows) {
        const soId = String(g(r, iSO)).trim();
        if (!soId) continue;
        const raw: Record<string, any> = {};
        origHeaders.forEach((h, idx) => { if (h) raw[h] = r[idx] ?? null; });
        byId.set(soId, [
          soId,
          String(g(r, iCO)) || null,
          String(g(r, iProduct)) || null,
          String(g(r, iServiceNo)) || null,
          String(g(r, iCustomer)) || null,
          String(g(r, iStatus)) || null,
          toDate(g(r, iCreate)),
          String(g(r, iExch)) || null,
          String(g(r, iSvcType)) || null,
          String(g(r, iMsan)) || null,
          String(g(r, iArea)) || null,
          String(g(r, iMobile)) || null,
          String(g(r, iActivity)) || null,
          String(g(r, iError)) || null,
          String(g(r, iGov)) || null,
          String(g(r, iLineType)) || null,
          String(g(r, iFcc)) || null,
          JSON.stringify(raw),
        ]);
      }
      const all = Array.from(byId.values());
      const userId = (req.user as any).id;

      // archive last year's historical data if the year rolled over
      const archivedYear = await archiveIfNewYear("ftth_orders", "ftth_orders_archive", FTTH_ORDER_COLS);
      const hist = await accumulateTable("ftth_orders", FTTH_ORDER_COLS, "service_order_id", all, userId);
      const current = await replaceTable("ftth_orders_current", FTTH_ORDER_COLS, all, userId);

      res.json({ inserted: hist, hist, current, archivedYear, total: all.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message || "خطأ في الاستيراد" });
    }
  });

  // GET /api/ftth-orders — ?bucket=historical|current|archive & ?year= & ?q= (الغنايم only by default)
  app.get("/api/ftth-orders", requireAuth, async (req, res) => {
    const { q, all, bucket, year } = req.query as Record<string, string>;
    const table = bucket === "current" ? "ftth_orders_current" : bucket === "archive" ? "ftth_orders_archive" : "ftth_orders";
    const params: any[] = [];
    const conds: string[] = [];
    if (all !== "true") {
      conds.push(`fcc_exchange IN ('GHNAT','AMZAT','DRGAT','NGOAT')`);
    }
    if (bucket === "archive" && year) { params.push(parseInt(year)); conds.push(`archived_year = $${params.length}`); }
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      conds.push(`(service_order_id ILIKE ${p} OR service_number ILIKE ${p} OR customer_name ILIKE ${p} OR msan_code ILIKE ${p} OR fcc_exchange ILIKE ${p})`);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const yearCol = bucket === "archive" ? `archived_year AS "archivedYear",` : "";
    const { rows } = await pool.query(
      `SELECT id, ${yearCol} service_order_id AS "serviceOrderId", customer_order_id AS "customerOrderId",
              product, service_number AS "serviceNumber", customer_name AS "customerName",
              order_status AS "orderStatus", order_create_time AS "orderCreateTime",
              exchange_name AS "exchangeName", service_type AS "serviceType", msan_code AS "msanCode",
              area_code AS "areaCode", customer_mobile AS "customerMobile",
              current_activity AS "currentActivity", error_name AS "errorName",
              governorate, line_type AS "lineType", fcc_exchange AS "fccExchange"
       FROM ${table} ${where}
       ORDER BY order_create_time DESC NULLS LAST
       LIMIT 5000`,
      params,
    );
    res.json(rows);
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
        params.push(`%${q.trim().toLowerCase()}%`);
        const p = `$${params.length}`;
        where = `WHERE (LOWER(central) LIKE ${p} OR LOWER(cabin_number) LIKE ${p} OR LOWER(box_number) LIKE ${p})`;
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

      if (exchange) { params.push(`%${exchange}%`); conds.push(`central ILIKE $${params.length}`); }
      if (cabinet)  { params.push(`%${cabinet}%`);  conds.push(`cabin_number ILIKE $${params.length}`); }
      if (box)      { params.push(`%${box}%`);      conds.push(`box_number ILIKE $${params.length}`); }
      if (q) {
        params.push(`%${q}%`);
        const p = `$${params.length}`;
        conds.push(`(full_phone ILIKE ${p} OR tel_no ILIKE ${p} OR central ILIKE ${p} OR cabin_number ILIKE ${p} OR box_number ILIKE ${p})`);
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

    // Tech can only rollback their own edits
    if (user.role === ROLES.TECH && edit.edited_by_id !== user.id) {
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
    const allowed = [ROLES.ADMIN, ROLES.TECH, ROLES.DATA_MANAGER];
    if (!allowed.includes(user.role)) return res.status(403).json({ message: "Forbidden" });

    const { status = "", search = "" } = req.query as Record<string, string>;
    const conds: string[] = [];
    const params: any[] = [];

    if (status) { params.push(status); conds.push(`status = $${params.length}`); }
    if (search.trim()) { params.push(`%${search.trim()}%`); conds.push(`full_phone ILIKE $${params.length}`); }
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
  app.options("/api/box-summary", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.status(204).end();
  });

  // GET /api/box-summary?page=1&limit=100&q=<search>
  app.get("/api/box-summary", async (req, res) => {
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
      params.push(`%${q}%`);
      conds.push(`(
        customer_name ILIKE $${params.length} OR
        central_name ILIKE $${params.length} OR
        cabin_number ILIKE $${params.length} OR
        box_number ILIKE $${params.length}
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

  // GET /api/reports/current-faults — الأعطال الحالية (status 160,173,122,73,72,60)
  // Joins case_138 ← phone_ports ← cabinet_technicians
  // البيان معتمد على ملف شكاوى DSL الحالى (ticket_dsl_current) — وليس حاله 138.
  // الأكواد المطلوبة: 160/173/122 (Status Code) و 73/72/60 (ComplainTypeName).
  app.get("/api/reports/current-faults", requireAuth, async (req, res) => {
    try {
      const { central = "", q = "" } = req.query as Record<string, string>;
      const params: any[] = [];
      const conds: string[] = [
        `t.close_date IS NULL`,
        `(t.status_code ~ '^(160|173|122|73|72|60)' OR t.complain_type_name ~ '^(160|173|122|73|72|60)')`,
        `(t.central_name = 'الغنايم' OR t.central_name = 'الغنايم-العزايزة' OR t.central_name = 'الغنايم-دير الجنادله' OR t.central_name = 'الغنايم-نجع العمدة')`,
      ];
      if (central) { params.push(central); conds.push(`t.central_name = $${params.length}`); }
      if (q.trim()) {
        params.push(`%${q.trim()}%`);
        const p = `$${params.length}`;
        conds.push(`(t.phone_number ILIKE ${p} OR t.cabinet_no ILIKE ${p} OR t.status_code ILIKE ${p} OR pl.box_number ILIKE ${p})`);
      }
      const where = "WHERE " + conds.join(" AND ");

      // DISTINCT ON (ticket_id) — آخر حالة لكل شكوى (أعلى id)، ثم ترتيب بوقت الشكوى.
      const { rows } = await pool.query(
        `SELECT * FROM (
           SELECT DISTINCT ON (t.ticket_id)
             t.central_name          AS "centralName",
             t.phone_number          AS "phoneShort",
             -- مكرر: الرقم موجود في شيت التفاصيل (430D) وتاريخ الإغلاق (Close Time)
             -- هناك يقع في نفس شهر/سنة الشكوى الحالية، بتاريخ (يوم) مختلف.
             -- (المقارنة بتاريخ الإغلاق لأن شكوى التفاصيل قد تبدأ آخر الشهر السابق
             --  وتُغلق في نفس شهر الشكوى الحالية — وتُعتبر تكراراً.)
             CASE WHEN t.phone_number IS NOT NULL AND t.phone_number <> '' AND t.complaint_time IS NOT NULL
                       AND EXISTS (
                         SELECT 1 FROM complaint_details cd
                         WHERE cd.close_time IS NOT NULL
                           AND regexp_replace(COALESCE(cd.phone_number,''), '\\D', '', 'g') LIKE '%' || t.phone_number
                           AND date_trunc('month', cd.close_time) = date_trunc('month', t.complaint_time)
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
             NULL                    AS "customerName",
             CASE
               WHEN t.complaint_time IS NULL THEN NULL
               WHEN (now() - t.complaint_time) < interval '24 hours' THEN 'اعطال 24 ساعه'
               WHEN (now() - t.complaint_time) < interval '48 hours' THEN 'اعطال 48 ساعه'
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
             t.central_code          AS "centralCode"
           FROM ticket_dsl_current t
           LEFT JOIN phone_ports pp ON pp.phone_number = t.phone_number
           LEFT JOIN phone_lines pl ON pl.tel_no = t.phone_number
           LEFT JOIN cabinet_technicians ct ON ct.central_name = t.central_name AND ct.cabin_number = t.cabinet_no
           LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
           ${where}
           ORDER BY t.ticket_id, t.id DESC
         ) x
         ORDER BY x."complainTime" ASC NULLS LAST`,
        params,
      );
      res.json(rows);
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
      const { central = "", q = "" } = req.query as Record<string, string>;
      const rows = await queryRegularizedFaults({ central, q });
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/regularized-faults-range — الأعطال المنتظمة (مغلقة) خلال فترة من/إلى
  // مثل تقرير الأعطال المنتظمة اليوم، لكن المصدر هو السجل التاريخى (ticket_queue)
  // مفلتراً بتاريخ الإغلاق (close_date) ضمن المدى [dateFrom, dateTo] بتوقيت القاهرة.
  // نفس فلاتر السنترالات + أكواد الأعطال + نفس الأعمدة والوصلات.
  app.get("/api/reports/regularized-faults-range", requireAuth, async (req, res) => {
    try {
      const { central = "", q = "", dateFrom = "", dateTo = "" } =
        req.query as Record<string, string>;
      const params: any[] = [];
      const conds: string[] = [
        `(t.status_code ~ '^(160|173|122|73|72|60)' OR t.complain_type_name ~ '^(160|173|122|73|72|60)')`,
        `(t.central_name = 'الغنايم' OR t.central_name = 'الغنايم-العزايزة' OR t.central_name = 'الغنايم-دير الجنادله' OR t.central_name = 'الغنايم-نجع العمدة')`,
      ];
      if (central) { params.push(central); conds.push(`t.central_name = $${params.length}`); }
      if (dateFrom) {
        params.push(dateFrom);
        conds.push(`(t.close_date AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}::date`);
      }
      if (dateTo) {
        params.push(dateTo);
        conds.push(`(t.close_date AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}::date`);
      }
      if (q.trim()) {
        params.push(`%${q.trim()}%`);
        const p = `$${params.length}`;
        conds.push(`(t.phone_number ILIKE ${p} OR t.cabinet_no ILIKE ${p} OR t.status_code ILIKE ${p} OR pl.box_number ILIKE ${p})`);
      }
      const where = "WHERE " + conds.join(" AND ");

      const { rows } = await pool.query(
        `SELECT * FROM (
           SELECT DISTINCT ON (t.ticket_id)
             t.central_name          AS "centralName",
             t.phone_number          AS "phoneShort",
             CASE WHEN t.phone_number IS NOT NULL AND t.phone_number <> '' AND t.complaint_time IS NOT NULL
                       AND EXISTS (
                         SELECT 1 FROM complaint_details cd
                         WHERE cd.close_time IS NOT NULL
                           AND regexp_replace(COALESCE(cd.phone_number,''), '\\D', '', 'g') LIKE '%' || t.phone_number
                           AND date_trunc('month', cd.close_time) = date_trunc('month', t.complaint_time)
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
             'مغلق'                  AS "regStatus",
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
             t.central_code          AS "centralCode"
           FROM ticket_queue t
           LEFT JOIN phone_ports pp ON pp.phone_number = t.phone_number
           LEFT JOIN phone_lines pl ON pl.tel_no = t.phone_number
           LEFT JOIN cabinet_technicians ct ON ct.central_name = t.central_name AND ct.cabin_number = t.cabinet_no
           LEFT JOIN technician_names tn ON tn.worker_code = ct.worker_code
           ${where} AND t.close_date IS NOT NULL
           ORDER BY t.ticket_id, t.id DESC
         ) x
         ORDER BY x."closeDate" ASC NULLS LAST`,
        params,
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // مولّد موحّد لتقارير أوامر الشغل (تركيبات / معاينات) — يستخدم queryWfmReport.
  const wfmReportHandler = (typesLc: string[], regularized: boolean) =>
    async (req: any, res: any) => {
      try {
        const { central = "", q = "" } = req.query as Record<string, string>;
        const rows = await queryWfmReport(typesLc, regularized, { central, q });
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
  app.get("/api/reports/regularized-daily", requireAuth, async (req, res) => {
    try {
      const { category = "faults", dateFrom = "", dateTo = "", central = "", q = "" } =
        req.query as Record<string, string>;
      const params: any[] = [category];
      const conds: string[] = [`category = $1`];
      if (dateFrom) { params.push(dateFrom); conds.push(`snapshot_date >= $${params.length}::date`); }
      if (dateTo)   { params.push(dateTo);   conds.push(`snapshot_date <= $${params.length}::date`); }
      if (central)  { params.push(central);  conds.push(`central_name = $${params.length}`); }
      if (q.trim()) { params.push(`%${q.trim()}%`); conds.push(`data::text ILIKE $${params.length}`); }
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
            COALESCE(
              -- أولاً: close_by كود عامل مباشر
              (SELECT tn.tech_name FROM technician_names tn WHERE tn.worker_code = cd.close_by LIMIT 1),
              -- احتياطاً: التبعية بالكابينة والسنترال
              (SELECT tn.tech_name FROM cabinet_technicians ct
                 JOIN technician_names tn ON tn.worker_code = ct.worker_code
                 WHERE ct.central_name = cd.exchange_name AND ct.cabin_number = cd.cabinet_no LIMIT 1),
              'غير معروف'
            )                                               AS tech_name,
            EXTRACT(EPOCH FROM (cd.close_time - cd.complain_time)) / 3600.0 AS hours
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
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 24)  / COUNT(*), 1) AS pct24h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 48)  / COUNT(*), 1) AS pct48h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 120) / COUNT(*), 1) AS pct120h
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
      const byTech       = rows.filter(r => r.centralName !== null && r.techName !== null);
      const byTechOnly   = rows.filter(r => r.centralName === null && r.techName !== null)
                               .sort((a, b) => b.total - a.total);

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
        `rc.close_time IS NOT NULL`,
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
            COALESCE(
              (SELECT tn.tech_name FROM technician_names tn WHERE tn.worker_code = rc.close_by LIMIT 1),
              (SELECT tn.tech_name FROM cabinet_technicians ct
                 JOIN technician_names tn ON tn.worker_code = ct.worker_code
                 WHERE ct.central_name = rc.exchange_name AND ct.cabin_number = rc.cabinet_no LIMIT 1),
              'غير معروف'
            )                                               AS tech_name,
            EXTRACT(EPOCH FROM (rc.close_time - rc.complain_time)) / 3600.0 AS hours
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
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 24)  / COUNT(*), 1) AS pct24h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 48)  / COUNT(*), 1) AS pct48h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 120) / COUNT(*), 1) AS pct120h
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
      const byTech     = rows.filter(r => r.centralName !== null && r.techName !== null);
      const byTechOnly = rows.filter(r => r.centralName === null && r.techName !== null)
                             .sort((a, b) => b.total - a.total);
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
      const { dateFrom, dateTo } = req.query as Record<string, string>;
      const params: any[] = [];
      // فلتر التاريخ يُطبَّق على المصدرين بنفس البارامترات
      let dateClause = "";
      if (dateFrom) { params.push(dateFrom); dateClause += ` AND (src.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}`; }
      if (dateTo)   { params.push(dateTo);   dateClause += ` AND (src.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}`; }

      const { rows } = await pool.query(`
        WITH src AS (
          -- الأعطال المغلقة
          SELECT cd.exchange_name, cd.complain_time, cd.close_time, cd.close_by, cd.cabinet_no
          FROM complaint_details cd
          WHERE cd.close_time IS NOT NULL AND cd.exchange_name ILIKE '%غنايم%'
          UNION ALL
          -- الأعطال المفتوحة (متبقيات 135/138)
          SELECT rc.exchange_name, rc.complain_time, rc.close_time, rc.close_by, rc.cabinet_no
          FROM remaining_complaints_current rc
          WHERE rc.close_time IS NOT NULL AND rc.exchange_name ILIKE '%غنايم%'
            AND FLOOR(rc.status_code::numeric)::int IN (135, 138)
        ),
        base AS (
          SELECT
            src.exchange_name                               AS central_name,
            COALESCE(
              (SELECT tn.tech_name FROM technician_names tn WHERE tn.worker_code = src.close_by LIMIT 1),
              (SELECT tn.tech_name FROM cabinet_technicians ct
                 JOIN technician_names tn ON tn.worker_code = ct.worker_code
                 WHERE ct.central_name = src.exchange_name AND ct.cabin_number = src.cabinet_no LIMIT 1),
              'غير معروف'
            )                                               AS tech_name,
            EXTRACT(EPOCH FROM (src.close_time - src.complain_time)) / 3600.0 AS hours
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
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 24)  / COUNT(*), 1) AS pct24h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 48)  / COUNT(*), 1) AS pct48h,
          ROUND(100.0 * COUNT(*) FILTER (WHERE hours <= 120) / COUNT(*), 1) AS pct120h
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
      const byTech     = rows.filter(r => r.centralName !== null && r.techName !== null);
      const byTechOnly = rows.filter(r => r.centralName === null && r.techName !== null)
                             .sort((a, b) => b.total - a.total);
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
            COALESCE(
              (SELECT tn.tech_name FROM technician_names tn WHERE tn.worker_code = cd.close_by LIMIT 1),
              (SELECT tn.tech_name FROM cabinet_technicians ct
                 JOIN technician_names tn ON tn.worker_code = ct.worker_code
                 WHERE ct.central_name = cd.exchange_name AND ct.cabin_number = cd.cabinet_no LIMIT 1),
              'غير معروف'
            ) AS tech_name
          FROM complaint_details cd
          WHERE cd.close_time IS NOT NULL
            AND cd.exchange_name ILIKE '%غنايم%'
            ${dateClause}
        ),
        ranked AS (
          SELECT
            central_name, phone_number, tech_name,
            COUNT(*) OVER (PARTITION BY phone_number)                                     AS appearances,
            ROW_NUMBER() OVER (PARTITION BY phone_number ORDER BY close_time ASC NULLS LAST) AS rk
          FROM phone_occ
        )
        SELECT
          central_name                                                                      AS "centralName",
          tech_name                                                                         AS "techName",
          COUNT(*)::int                                                                     AS total,
          COUNT(DISTINCT phone_number)::int                                                 AS "distinctPhones",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances = 1)::int                  AS "nonRepeated",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances > 1)::int                  AS "repeatedPhones",
          SUM(CASE WHEN rk = appearances THEN 0 ELSE appearances - rk END)::int             AS "repCharges",
          ROUND(
            100.0 * COUNT(DISTINCT phone_number) FILTER (WHERE appearances > 1)
            / NULLIF(COUNT(DISTINCT phone_number) FILTER (WHERE appearances = 1), 0),
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
      const byTech     = rows.filter(r => r.centralName !== null && r.techName !== null);
      const byTechOnly = rows.filter(r => r.centralName === null && r.techName !== null)
                             .sort((a, b) => b.total - a.total);
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
            COALESCE(
              (SELECT tn.tech_name FROM technician_names tn WHERE tn.worker_code = rc.close_by LIMIT 1),
              (SELECT tn.tech_name FROM cabinet_technicians ct
                 JOIN technician_names tn ON tn.worker_code = ct.worker_code
                 WHERE ct.central_name = rc.exchange_name AND ct.cabin_number = rc.cabinet_no LIMIT 1),
              'غير معروف'
            ) AS tech_name
          FROM remaining_complaints_current rc
          WHERE rc.close_time IS NOT NULL
            AND rc.exchange_name ILIKE '%غنايم%'
            AND FLOOR(rc.status_code::numeric)::int IN (135, 138)
            ${dateClause}
        ),
        ranked AS (
          SELECT
            central_name, phone_number, tech_name,
            COUNT(*) OVER (PARTITION BY phone_number)                                     AS appearances,
            ROW_NUMBER() OVER (PARTITION BY phone_number ORDER BY close_time ASC NULLS LAST) AS rk
          FROM phone_occ
        )
        SELECT
          central_name                                                                      AS "centralName",
          tech_name                                                                         AS "techName",
          COUNT(*)::int                                                                     AS total,
          COUNT(DISTINCT phone_number)::int                                                 AS "distinctPhones",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances = 1)::int                  AS "nonRepeated",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances > 1)::int                  AS "repeatedPhones",
          SUM(CASE WHEN rk = appearances THEN 0 ELSE appearances - rk END)::int             AS "repCharges",
          ROUND(
            100.0 * COUNT(DISTINCT phone_number) FILTER (WHERE appearances > 1)
            / NULLIF(COUNT(DISTINCT phone_number) FILTER (WHERE appearances = 1), 0),
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
      const byTech     = rows.filter(r => r.centralName !== null && r.techName !== null);
      const byTechOnly = rows.filter(r => r.centralName === null && r.techName !== null)
                             .sort((a, b) => b.total - a.total);
      res.json({ overall, byCentral, byTech, byTechOnly });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/reports/repetition-combined — المصدران معاً (UNION ALL) لتحديد التكرار عبر المغلقة والمفتوحة
  app.get("/api/reports/repetition-combined", requireAuth, async (req, res) => {
    try {
      const { dateFrom, dateTo } = req.query as Record<string, string>;
      const params: any[] = [];
      let dateClause = "";
      if (dateFrom) { params.push(dateFrom); dateClause += ` AND (po.complain_time AT TIME ZONE 'Africa/Cairo')::date >= $${params.length}`; }
      if (dateTo)   { params.push(dateTo);   dateClause += ` AND (po.complain_time AT TIME ZONE 'Africa/Cairo')::date <= $${params.length}`; }

      const { rows } = await pool.query(`
        WITH src_raw AS (
          SELECT complain_no, exchange_name, phone_number, complain_time, close_time, close_by, cabinet_no, 1 AS src_priority
          FROM complaint_details
          WHERE close_time IS NOT NULL AND exchange_name ILIKE '%غنايم%'
          UNION ALL
          SELECT complain_no, exchange_name, phone_number, complain_time, close_time, close_by, cabinet_no, 2 AS src_priority
          FROM remaining_complaints_current
          WHERE close_time IS NOT NULL AND exchange_name ILIKE '%غنايم%'
            AND FLOOR(status_code::numeric)::int IN (135, 138)
        ),
        -- توحيد العطل الواحد: لو نفس complain_no ظهر في الجدولين (مفتوح ثم مغلق)
        -- يُحسب مرة واحدة، مع تفضيل النسخة المغلقة (src_priority=1) للتبعية الصحيحة
        src AS (
          SELECT DISTINCT ON (complain_no)
            exchange_name, phone_number, complain_time, close_time, close_by, cabinet_no
          FROM src_raw
          ORDER BY complain_no, src_priority
        ),
        phone_occ AS (
          SELECT
            po.exchange_name AS central_name,
            po.phone_number,
            po.close_time,
            COALESCE(
              (SELECT tn.tech_name FROM technician_names tn WHERE tn.worker_code = po.close_by LIMIT 1),
              (SELECT tn.tech_name FROM cabinet_technicians ct
                 JOIN technician_names tn ON tn.worker_code = ct.worker_code
                 WHERE ct.central_name = po.exchange_name AND ct.cabin_number = po.cabinet_no LIMIT 1),
              'غير معروف'
            ) AS tech_name
          FROM src po
          WHERE TRUE ${dateClause}
        ),
        ranked AS (
          SELECT
            central_name, phone_number, tech_name,
            COUNT(*) OVER (PARTITION BY phone_number)                                     AS appearances,
            ROW_NUMBER() OVER (PARTITION BY phone_number ORDER BY close_time ASC NULLS LAST) AS rk
          FROM phone_occ
        )
        SELECT
          central_name                                                                      AS "centralName",
          tech_name                                                                         AS "techName",
          COUNT(*)::int                                                                     AS total,
          COUNT(DISTINCT phone_number)::int                                                 AS "distinctPhones",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances = 1)::int                  AS "nonRepeated",
          COUNT(DISTINCT phone_number) FILTER (WHERE appearances > 1)::int                  AS "repeatedPhones",
          SUM(CASE WHEN rk = appearances THEN 0 ELSE appearances - rk END)::int             AS "repCharges",
          ROUND(
            100.0 * COUNT(DISTINCT phone_number) FILTER (WHERE appearances > 1)
            / NULLIF(COUNT(DISTINCT phone_number) FILTER (WHERE appearances = 1), 0),
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
      const byTech     = rows.filter(r => r.centralName !== null && r.techName !== null);
      const byTechOnly = rows.filter(r => r.centralName === null && r.techName !== null)
                             .sort((a, b) => b.total - a.total);
      res.json({ overall, byCentral, byTech, byTechOnly });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // بدء جدولة الحفظ اليومى (cron داخلى + تعويض عند الصحيان)
  startDailySnapshotScheduler();

  return httpServer;
}
