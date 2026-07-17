const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const db = require('../database');
const DATA_DIR = require('../utils/datadir');
const { requireRole } = require('../middleware/auth');
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const { buildBoxCountMap } = require('./service_flow');

const router = express.Router();
const staffOnly = requireRole('admin', 'inspector');

router.get('/', staffOnly, async (req, res) => {
  try {
    const totalRow = await db.get('SELECT COUNT(*) as c FROM boxes');
    const totalBoxes = parseInt(totalRow.c);
    const statusCounts = await db.all('SELECT status, COUNT(*) as c FROM boxes GROUP BY status');
    const counts = {};
    statusCounts.forEach(r => { counts[r.status] = parseInt(r.c); });

    const recentInspections = await db.all(`SELECT i.*, b.number as box_number, c.number as cabinet_number,
      e.name as exchange_name, u.full_name as inspector_name
      FROM inspections i JOIN boxes b ON b.id = i.box_id JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id JOIN users u ON u.id = i.inspector_id
      ORDER BY i.id DESC LIMIT 5`);

    res.render('reports/dashboard', { title: 'لوحة التقارير', totalBoxes, counts, recentInspections });
  } catch (e) {
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

router.get('/inspected', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, cabinet_id, box_q } = req.query;
    let sql = `SELECT i.*, b.number as box_number, b.status as box_status,
      c.number as cabinet_number, e.name as exchange_name, u.full_name as inspector_name
      FROM inspections i JOIN boxes b ON b.id = i.box_id JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id JOIN users u ON u.id = i.inspector_id WHERE 1=1`;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(cabinet_id); }
    if (box_q)       { sql += ' AND b.number LIKE ?'; params.push(`%${box_q}%`); }
    if (from) { sql += ' AND i.date >= ?'; params.push(from); }
    if (to) { sql += ' AND i.date <= ?'; params.push(to); }
    sql += ' ORDER BY i.id DESC';
    const rows = await db.all(sql, params);
    const exchanges = await db.all('SELECT * FROM exchanges ORDER BY name');
    const cabinets = exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : [];
    res.render('reports/inspected', { title: 'البوكسات التي تم فحصها', rows, exchanges, cabinets, query: req.query });
  } catch (e) {
    console.error('/reports/inspected error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل التقرير. حاول مرة أخرى.' });
  }
});

router.get('/issues', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, cabinet_id, box_q } = req.query;
    const cond = []; const params = [];
    if (exchange_id) { params.push(exchange_id); cond.push(`e.id = ?`); }
    if (cabinet_id)  { params.push(cabinet_id);  cond.push(`b.cabinet_id = ?`); }
    if (box_q)       { params.push(`%${box_q}%`); cond.push(`b.number LIKE ?`); }
    if (from) { params.push(from); cond.push(`i.date >= ?`); }
    if (to)   { params.push(to);   cond.push(`i.date <= ?`); }
    const extraWhere = cond.length ? ' AND ' + cond.join(' AND ') : '';
    const rows = await db.all(`
      SELECT b.id, b.number, b.status,
             c.number as cabinet_number, e.name as exchange_name,
             i.date as insp_date,
             CONCAT_WS(' | ',
               NULLIF(TRIM(i.general_notes), ''),
               (SELECT STRING_AGG(ii2.notes, ' | ')
                FROM inspection_items ii2
                WHERE ii2.inspection_id = i.id
                  AND ii2.notes IS NOT NULL AND TRIM(ii2.notes) != '')
             ) as all_notes
      FROM boxes b
      JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      JOIN LATERAL (
        SELECT * FROM inspections
        WHERE box_id = b.id AND COALESCE(is_archived, 0) = 0
        ORDER BY id DESC LIMIT 1
      ) i ON true
      WHERE EXISTS (
        SELECT 1 FROM inspection_items ii
        WHERE ii.inspection_id = i.id
          AND ((ii.item_type='good_bad' AND ii.value='bad')
            OR (ii.item_type='yes_no'  AND ii.value='yes'))
      ) ${extraWhere}
      ORDER BY e.name, c.number,
               CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number`, params);
    const exchanges = await db.all('SELECT id,name FROM exchanges ORDER BY name');
    const cabinets = exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : [];
    res.render('reports/issues', { title: 'البوكسات التي بها ملاحظات', rows, exchanges, cabinets, query: req.query });
  } catch (e) {
    console.error('/reports/issues error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل التقرير. حاول مرة أخرى.' });
  }
});

router.get('/maintenance', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, cabinet_id, box_q } = req.query;
    let sql = `SELECT mt.*, b.number as box_number, b.status as box_status,
      c.number as cabinet_number, e.name as exchange_name,
      u.full_name as tech_name, ins.full_name as inspector_name
      FROM maintenance_tasks mt
      JOIN inspections i ON i.id = mt.inspection_id
      JOIN boxes b ON b.id = i.box_id JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      LEFT JOIN users u ON u.id = mt.technician_id
      LEFT JOIN users ins ON ins.id = i.inspector_id
      WHERE 1=1`;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(cabinet_id); }
    if (box_q)       { sql += ' AND b.number LIKE ?'; params.push(`%${box_q}%`); }
    if (from) { sql += ' AND i.date >= ?'; params.push(from); }
    if (to)   { sql += ' AND i.date <= ?'; params.push(to); }
    sql += ' ORDER BY mt.id DESC';
    const rows = await db.all(sql, params);
    const exchanges = await db.all('SELECT id,name FROM exchanges ORDER BY name');
    const cabinets = exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : [];
    res.render('reports/maintenance', { title: 'البوكسات المطلوبة للصيانة', rows, exchanges, cabinets, query: req.query });
  } catch (e) {
    console.error('/reports/maintenance error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل التقرير. حاول مرة أخرى.' });
  }
});

router.get('/completed', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, tab, cabinet_id, box_q } = req.query;
    const activeStatus = tab === 'pending' ? 'pending_approval' : 'completed';
    const conditions = [`mt.status = '${activeStatus}'`];
    const params = [];
    if (exchange_id) { params.push(exchange_id); conditions.push(`e.id = ?`); }
    if (cabinet_id)  { params.push(cabinet_id);  conditions.push(`b.cabinet_id = ?`); }
    if (box_q)       { params.push(`%${box_q}%`); conditions.push(`b.number LIKE ?`); }
    if (from) { params.push(from); conditions.push(`mt.completed_at >= ?`); }
    if (to)   { params.push(to);   conditions.push(`DATE(mt.completed_at) <= ?`); }
    const where = conditions.join(' AND ');
    const BASE = `FROM maintenance_tasks mt
      JOIN inspections i ON i.id = mt.inspection_id
      JOIN boxes b ON b.id = i.box_id JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      LEFT JOIN users u ON u.id = mt.technician_id
      LEFT JOIN users ins ON ins.id = i.inspector_id`;
    const rows = await db.all(`SELECT mt.*, b.number as box_number,
      c.number as cabinet_number, e.name as exchange_name,
      u.full_name as tech_name, ins.full_name as inspector_name
      ${BASE} WHERE ${where} ORDER BY mt.completed_at DESC`, params);
    const totalRow = await db.get(`SELECT COUNT(*) as c ${BASE} WHERE mt.status = 'completed'`, []);
    const pendingRow = await db.get(`SELECT COUNT(*) as c ${BASE} WHERE mt.status = 'pending_approval'`, []);
    const exchanges = await db.all('SELECT id,name FROM exchanges ORDER BY name');
    const cabinets = exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : [];
    const sfResult = await buildBoxCountMap().catch(() => ({ map: new Map(), total: 0 }));
    res.render('reports/completed', {
      title: 'الأعمال المكتملة', rows, exchanges, cabinets,
      query: { exchange_id: exchange_id || '', from: from || '', to: to || '', tab: tab || '' },
      totalAll: parseInt(totalRow.c),
      countFinal: parseInt(totalRow.c),
      countPending: parseInt(pendingRow.c),
      sfMap: sfResult.map, sfTotal: sfResult.total,
    });
  } catch (e) {
    console.error('/reports/completed error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل التقرير. حاول مرة أخرى.' });
  }
});

async function needsItemRows(itemKey, filters = {}) {
  const { exchange_id, from, to, cabinet_id, box_q } = filters;
  const extra = []; const extraParams = [];
  if (exchange_id) { extraParams.push(exchange_id); extra.push(`AND e.id = ?`); }
  if (cabinet_id)  { extraParams.push(cabinet_id);  extra.push(`AND b.cabinet_id = ?`); }
  if (box_q)       { extraParams.push(`%${box_q}%`); extra.push(`AND b.number LIKE ?`); }
  if (from) { extraParams.push(from); extra.push(`AND i.date >= ?`); }
  if (to)   { extraParams.push(to);   extra.push(`AND i.date <= ?`); }
  return db.all(`
    SELECT b.number as box_number, b.id as box_id,
      c.number as cabinet_number, e.name as exchange_name,
      i.date as insp_date, u.full_name as inspector_name
    FROM inspection_items ii
    JOIN inspections i ON i.id = ii.inspection_id
    JOIN boxes b ON b.id = i.box_id
    JOIN cabinets c ON c.id = b.cabinet_id
    JOIN exchanges e ON e.id = c.exchange_id
    JOIN users u ON u.id = i.inspector_id
    WHERE ii.item_key = ? AND ii.value IN ('bad','yes')
      AND i.id = (SELECT MAX(id) FROM inspections WHERE box_id = b.id)
      AND NOT EXISTS (
        SELECT 1 FROM maintenance_item_status mis
        JOIN maintenance_tasks mt ON mt.id = mis.task_id
        WHERE mt.inspection_id = i.id AND mis.item_key = ? AND mis.is_done = 1
      )
      ${extra.join(' ')}
    ORDER BY e.name, c.number, CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number
  `, [itemKey, itemKey, ...extraParams]);
}

// ── Shared status label map ───────────────────────────────────────────────────
const STATUS_AR = {
  pending_inspection: 'بانتظار الفحص', inspected: 'تم الفحص',
  needs_maintenance: 'يحتاج صيانة', in_progress: 'قيد الصيانة',
  completed: 'مكتمل', pending: 'بانتظار',
};

// ── Helper: build xlsx buffer and send ────────────────────────────────────────
function sendXlsx(res, data, filename) {
  const ws = xlsx.utils.aoa_to_sheet(data);
  ws['!cols'] = data[0].map(() => ({ wch: 20 }));
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'تقرير');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}

async function sendStyledMaintenanceXlsx(res, headers, dataRows, filename) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'نظام صيانة البوكسات';
  // No worksheet-level RTL — that setting converts digits to Arabic-Indic.
  // RTL is applied per-cell via readingOrder on text-only cells.
  const ws = wb.addWorksheet('تقرير');

  const headerRow = ws.addRow(headers);
  headerRow.height = 35;
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7030A0' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top:{style:'thin',color:{argb:'FFD0D0D0'}}, left:{style:'thin',color:{argb:'FFD0D0D0'}}, bottom:{style:'thin',color:{argb:'FFD0D0D0'}}, right:{style:'thin',color:{argb:'FFD0D0D0'}} };
  });

  // Columns with numbers/dates/Latin codes → LTR so digits stay Western on Arabic Windows.
  // Col: 3=worker_code 6=date 7=exchange_code 9=MSAN 10=PASSIVE_NO 11=BOX_NO 12=phone
  const ltrCols = new Set([3, 6, 7, 9, 10, 11, 12]);

  const altFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3EEF9' } };
  dataRows.forEach((rowData, i) => {
    const row = ws.addRow(rowData.map(v => String(v ?? '')));
    row.height = 22;
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      if (i % 2 === 1) cell.fill = altFill;
      cell.font = { name: 'Calibri', size: 10 };
      cell.numFmt = '@';
      const isLtr = ltrCols.has(colNum);
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: isLtr ? 'ltr' : 'rtl' };
      cell.border = { top:{style:'thin',color:{argb:'FFD0D0D0'}}, left:{style:'thin',color:{argb:'FFD0D0D0'}}, bottom:{style:'thin',color:{argb:'FFD0D0D0'}}, right:{style:'thin',color:{argb:'FFD0D0D0'}} };
    });
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  const colWidths = [14, 28, 14, 20, 22, 16, 18, 18, 18, 14, 12, 14];
  ws.columns = headers.map((_, i) => ({ width: colWidths[i] || 18 }));

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}

// ── Export routes ─────────────────────────────────────────────────────────────
router.get('/inspected/export', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, cabinet_id, box_q } = req.query;
    let sql = `SELECT i.*, b.number as box_number, b.status as box_status,
      c.number as cabinet_number, e.name as exchange_name, u.full_name as inspector_name
      FROM inspections i JOIN boxes b ON b.id = i.box_id JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id JOIN users u ON u.id = i.inspector_id WHERE 1=1`;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(cabinet_id); }
    if (box_q)       { sql += ' AND b.number LIKE ?'; params.push(`%${box_q}%`); }
    if (from) { sql += ' AND i.date >= ?'; params.push(from); }
    if (to)   { sql += ' AND i.date <= ?'; params.push(to); }
    sql += ' ORDER BY i.id DESC';
    const rows = await db.all(sql, params);
    const data = [['السنترال', 'الكابينة', 'البوكس', 'الحالة', 'المراقب', 'التاريخ']];
    rows.forEach(r => data.push([r.exchange_name, r.cabinet_number, r.box_number, STATUS_AR[r.box_status] || r.box_status, r.inspector_name, r.date ? new Date(r.date).toISOString().split('T')[0] : '']));
    sendXlsx(res, data, `inspected_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) { res.status(500).render('error', { title: 'خطأ', message: e.message }); }
});

router.get('/issues/export', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, cabinet_id, box_q } = req.query;
    const cond = []; const params = [];
    if (exchange_id) { params.push(exchange_id); cond.push(`e.id = ?`); }
    if (cabinet_id)  { params.push(cabinet_id);  cond.push(`b.cabinet_id = ?`); }
    if (box_q)       { params.push(`%${box_q}%`); cond.push(`b.number LIKE ?`); }
    if (from) { params.push(from); cond.push(`i.date >= ?`); }
    if (to)   { params.push(to);   cond.push(`i.date <= ?`); }
    const extraWhere = cond.length ? ' AND ' + cond.join(' AND ') : '';
    const rows = await db.all(`
      SELECT b.id, b.number, b.status,
             c.number as cabinet_number, e.name as exchange_name,
             i.date as insp_date,
             CONCAT_WS(' | ',
               NULLIF(TRIM(i.general_notes), ''),
               (SELECT STRING_AGG(ii2.notes, ' | ')
                FROM inspection_items ii2
                WHERE ii2.inspection_id = i.id
                  AND ii2.notes IS NOT NULL AND TRIM(ii2.notes) != '')
             ) as all_notes
      FROM boxes b
      JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      JOIN LATERAL (
        SELECT * FROM inspections
        WHERE box_id = b.id AND COALESCE(is_archived, 0) = 0
        ORDER BY id DESC LIMIT 1
      ) i ON true
      WHERE EXISTS (
        SELECT 1 FROM inspection_items ii
        WHERE ii.inspection_id = i.id
          AND ((ii.item_type='good_bad' AND ii.value='bad')
            OR (ii.item_type='yes_no'  AND ii.value='yes'))
      ) ${extraWhere}
      ORDER BY e.name, c.number,
               CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number`, params);
    const data = [['السنترال', 'الكابينة', 'البوكس', 'الحالة', 'تاريخ الفحص', 'الملاحظات']];
    rows.forEach(r => data.push([
      r.exchange_name, r.cabinet_number, r.number,
      STATUS_AR[r.status] || r.status,
      r.insp_date ? new Date(r.insp_date).toISOString().split('T')[0] : '',
      r.all_notes || '',
    ]));
    sendXlsx(res, data, `issues_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) { res.status(500).render('error', { title: 'خطأ', message: e.message }); }
});

router.get('/maintenance/export', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, cabinet_id, box_q } = req.query;
    let sql = `SELECT mt.*, b.number as box_number, b.status as box_status,
      c.number as cabinet_number, e.name as exchange_name,
      u.full_name as tech_name, ins.full_name as inspector_name
      FROM maintenance_tasks mt JOIN inspections i ON i.id = mt.inspection_id
      JOIN boxes b ON b.id = i.box_id JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      LEFT JOIN users u ON u.id = mt.technician_id LEFT JOIN users ins ON ins.id = i.inspector_id
      WHERE 1=1`;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(cabinet_id); }
    if (box_q)       { sql += ' AND b.number LIKE ?'; params.push(`%${box_q}%`); }
    if (from) { sql += ' AND i.date >= ?'; params.push(from); }
    if (to)   { sql += ' AND i.date <= ?'; params.push(to); }
    sql += ' ORDER BY mt.id DESC';
    const rows = await db.all(sql, params);
    const data = [['السنترال', 'الكابينة', 'البوكس', 'المراقب', 'الفني', 'الحالة', 'ملاحظات']];
    rows.forEach(r => data.push([r.exchange_name, r.cabinet_number, r.box_number, r.inspector_name || '', r.tech_name || '', STATUS_AR[r.status] || r.status, r.notes || '']));
    sendXlsx(res, data, `maintenance_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) { res.status(500).render('error', { title: 'خطأ', message: e.message }); }
});

router.get('/completed/export', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, tab, cabinet_id, box_q } = req.query;
    const activeStatus = tab === 'pending' ? 'pending_approval' : 'completed';
    const conditions = [`mt.status = '${activeStatus}'`];
    const params = [];
    if (exchange_id) { params.push(exchange_id); conditions.push(`e.id = ?`); }
    if (cabinet_id)  { params.push(cabinet_id);  conditions.push(`b.cabinet_id = ?`); }
    if (box_q)       { params.push(`%${box_q}%`); conditions.push(`b.number LIKE ?`); }
    if (from) { params.push(from); conditions.push(`mt.completed_at >= ?`); }
    if (to)   { params.push(to);   conditions.push(`DATE(mt.completed_at) <= ?`); }
    const rows = await db.all(`SELECT mt.*, b.number as box_number,
      c.number as cabinet_number, e.name as exchange_name,
      u.full_name as tech_name, ins.full_name as inspector_name
      FROM maintenance_tasks mt JOIN inspections i ON i.id = mt.inspection_id
      JOIN boxes b ON b.id = i.box_id JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      LEFT JOIN users u ON u.id = mt.technician_id LEFT JOIN users ins ON ins.id = i.inspector_id
      WHERE ${conditions.join(' AND ')} ORDER BY mt.completed_at DESC`, params);
    const data = [['السنترال', 'الكابينة', 'البوكس', 'المراقب', 'الفني', 'تاريخ الاكتمال', 'ملاحظات']];
    rows.forEach(r => data.push([r.exchange_name, r.cabinet_number, r.box_number, r.inspector_name || '', r.tech_name || '', r.completed_at ? new Date(r.completed_at).toISOString().split('T')[0] : '', r.notes || '']));
    sendXlsx(res, data, `completed_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) { res.status(500).render('error', { title: 'خطأ', message: e.message }); }
});

router.get('/needs-item/export', staffOnly, async (req, res) => {
  try {
    const { key, title } = req.query;
    if (!key) return res.status(400).send('missing key');
    const rows = await needsItemRows(key, req.query);
    const data = [['السنترال', 'الكابينة', 'البوكس', 'تاريخ الفحص', 'المراقب']];
    rows.forEach(r => data.push([r.exchange_name, r.cabinet_number, r.box_number, r.insp_date ? new Date(r.insp_date).toISOString().split('T')[0] : '', r.inspector_name]));
    sendXlsx(res, data, `${key}_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) { res.status(500).render('error', { title: 'خطأ', message: e.message }); }
});

// ── Needs-item HTML routes ────────────────────────────────────────────────────
router.get('/needs-box-cover', staffOnly, async (req, res) => {
  try {
    const rows = await needsItemRows('box_cover', req.query);
    const exchanges = await db.all('SELECT id,name FROM exchanges ORDER BY name');
    const cabinets = req.query.exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [req.query.exchange_id]) : [];
    res.render('reports/needs_item', { title: 'البوكسات التي تحتاج غطاء بوكس', itemLabel: 'غطاء البوكس', countLabel: 'إجمالي الأغطية المطلوبة', itemKey: 'box_cover', rows, exchanges, cabinets, query: req.query });
  } catch (e) {
    console.error('/reports/needs-box-cover error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل التقرير. حاول مرة أخرى.' });
  }
});

router.get('/needs-connector-fix', staffOnly, async (req, res) => {
  try {
    const rows = await needsItemRows('connector_fix', req.query);
    const exchanges = await db.all('SELECT id,name FROM exchanges ORDER BY name');
    const cabinets = req.query.exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [req.query.exchange_id]) : [];
    res.render('reports/needs_item', { title: 'البوكسات التي تحتاج تثبيت الخوصة', itemLabel: 'تثبيت الخوصة', countLabel: 'إجمالي الخوص المطلوبة', itemKey: 'connector_fix', rows, exchanges, cabinets, query: req.query });
  } catch (e) {
    console.error('/reports/needs-connector-fix error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل التقرير. حاول مرة أخرى.' });
  }
});

router.get('/needs-box-height', staffOnly, async (req, res) => {
  try {
    const rows = await needsItemRows('box_height', req.query);
    const exchanges = await db.all('SELECT id,name FROM exchanges ORDER BY name');
    const cabinets = req.query.exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [req.query.exchange_id]) : [];
    res.render('reports/needs_item', { title: 'البوكسات التي ارتفاعها سيء', itemLabel: 'ارتفاع البوكس', countLabel: 'إجمالي البوكسات المطلوبة', itemKey: 'box_height', rows, exchanges, cabinets, query: req.query });
  } catch (e) {
    console.error('/reports/needs-box-height error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ: ' + e.message });
  }
});

router.get('/needs-wire-path', staffOnly, async (req, res) => {
  try {
    const rows = await needsItemRows('wire_path', req.query);
    const exchanges = await db.all('SELECT id,name FROM exchanges ORDER BY name');
    const cabinets = req.query.exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [req.query.exchange_id]) : [];
    res.render('reports/needs_item', { title: 'البوكسات التي مسار السلك فيها سيء', itemLabel: 'مسار السلك', countLabel: 'إجمالي البوكسات المطلوبة', itemKey: 'wire_path', rows, exchanges, cabinets, query: req.query });
  } catch (e) {
    console.error('/reports/needs-wire-path error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ: ' + e.message });
  }
});

router.get('/cabinet', staffOnly, async (req, res) => {
  try {
    const exchanges = await db.all('SELECT * FROM exchanges ORDER BY name');
    const cabinets = await db.all(`
      SELECT c.*, e.name as exchange_name,
        COUNT(DISTINCT b.id) as box_count,
        COUNT(DISTINCT i.id) as inspected_count
      FROM cabinets c
      JOIN exchanges e ON e.id = c.exchange_id
      LEFT JOIN boxes b ON b.cabinet_id = c.id
      LEFT JOIN inspections i ON i.box_id = b.id
      GROUP BY c.id, e.name ORDER BY e.name, c.number
    `);
    res.render('reports/cabinet_select', { title: 'تقرير كابينة مجمع', exchanges, cabinets });
  } catch (e) {
    console.error('/reports/cabinet error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل التقرير. حاول مرة أخرى.' });
  }
});

router.get('/cabinet/:cabId', staffOnly, async (req, res) => {
  try {
  const cabinet = await db.get(`
    SELECT c.*, e.name as exchange_name
    FROM cabinets c JOIN exchanges e ON e.id = c.exchange_id WHERE c.id = ?
  `, [req.params.cabId]);
  if (!cabinet) return res.redirect('/reports/cabinet');

  const CHECKLIST_LABELS = {
    connector_fix: 'تثبيت الخوصة', box_fix: 'تثبيت البوكس', box_cover: 'غطاء البوكس',
    box_numbering: 'ترقيم البوكس', box_height: 'ارتفاع البوكس',
    branch_path: 'الفرعات على الترمنال', wire_path: 'مسار السلك',
    electricity_conflict: 'تعارض كهرباء', air_conflict: 'تعارض هواء', overlap: 'تخاطي',
  };

  const boxes = await db.all(`
    SELECT b.*,
      (SELECT id FROM inspections WHERE box_id = b.id ORDER BY id DESC LIMIT 1) as insp_id
    FROM boxes b
    WHERE b.cabinet_id = ?
      AND EXISTS (SELECT 1 FROM inspections WHERE box_id = b.id)
    ORDER BY CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number
  `, [req.params.cabId]);

  if (!boxes.length) {
    req.session.flash = { type: 'warning', msg: 'لا توجد بوكسات مفحوصة في هذه الكابينة.' };
    return res.redirect('/reports/cabinet');
  }

  const boxData = await Promise.all(boxes.map(async box => {
    const inspection = await db.get(`
      SELECT i.*, u.full_name as inspector_name
      FROM inspections i JOIN users u ON u.id = i.inspector_id WHERE i.id = ?
    `, [box.insp_id]);
    const items = await db.all('SELECT * FROM inspection_items WHERE inspection_id = ?', [box.insp_id]);
    const beforePhotos = await db.all(`SELECT id, box_id, inspection_id, photo_type, filename, uploaded_by, taken_at, latitude, longitude, uploaded_at FROM photos WHERE inspection_id = ? AND photo_type='before' ORDER BY uploaded_at`, [box.insp_id]);
    const afterPhotos  = await db.all(`SELECT id, box_id, inspection_id, photo_type, filename, uploaded_by, taken_at, latitude, longitude, uploaded_at FROM photos WHERE inspection_id = ? AND photo_type='after'  ORDER BY uploaded_at`, [box.insp_id]);
    const task = await db.get(`SELECT mt.*, u.full_name as tech_name FROM maintenance_tasks mt LEFT JOIN users u ON u.id = mt.technician_id WHERE mt.inspection_id = ?`, [box.insp_id]);
    const itemStatusMap = {};
    if (task) {
      const statuses = await db.all('SELECT * FROM maintenance_item_status WHERE task_id = ?', [task.id]);
      statuses.forEach(s => { itemStatusMap[s.item_key] = s; });
    }
    return { box, inspection, items, beforePhotos, afterPhotos, task, itemStatusMap };
  }));

  res.render('reports/cabinet_report', { title: `تقرير كابينة ${cabinet.number} — ${cabinet.exchange_name}`, cabinet, boxData, CHECKLIST_LABELS });
  } catch (e) {
    console.error('/reports/cabinet/:cabId error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل التقرير. حاول مرة أخرى.' });
  }
});

router.get('/box/:boxId', staffOnly, async (req, res) => {
  try {
    const box = await db.get(`
      SELECT b.*, c.number as cabinet_number, e.name as exchange_name
      FROM boxes b JOIN cabinets c ON c.id = b.cabinet_id JOIN exchanges e ON e.id = c.exchange_id
      WHERE b.id = ?`, [req.params.boxId]);
    if (!box) return res.redirect('/reports');

    const inspection = await db.get(`
      SELECT i.*, u.full_name as inspector_name FROM inspections i
      JOIN users u ON u.id = i.inspector_id WHERE i.box_id = ? ORDER BY i.id DESC LIMIT 1`, [req.params.boxId]);

    const items = inspection ? await db.all('SELECT * FROM inspection_items WHERE inspection_id = ?', [inspection.id]) : [];
    const beforePhotos = await db.all(`SELECT id, box_id, inspection_id, photo_type, filename, uploaded_by, taken_at, latitude, longitude, uploaded_at FROM photos WHERE box_id = ? AND photo_type = 'before' ORDER BY uploaded_at`, [req.params.boxId]);
    const afterPhotos  = await db.all(`SELECT id, box_id, inspection_id, photo_type, filename, uploaded_by, taken_at, latitude, longitude, uploaded_at FROM photos WHERE box_id = ? AND photo_type = 'after'  ORDER BY uploaded_at`, [req.params.boxId]);
    const task = inspection ? await db.get(`SELECT mt.*, u.full_name as tech_name FROM maintenance_tasks mt LEFT JOIN users u ON u.id = mt.technician_id WHERE mt.inspection_id = ?`, [inspection.id]) : null;
    const itemStatusMap = {};
    if (task) {
      const statuses = await db.all('SELECT * FROM maintenance_item_status WHERE task_id = ?', [task.id]);
      statuses.forEach(s => { itemStatusMap[s.item_key] = s; });
    }

    const CHECKLIST_LABELS = {
      connector_fix: 'تثبيت الخوصة', box_fix: 'تثبيت البوكس', box_cover: 'غطاء البوكس',
      box_numbering: 'ترقيم البوكس', box_height: 'ارتفاع البوكس', branch_path: 'الفرعات على الترمنال',
      wire_path: 'مسار السلك', electricity_conflict: 'تعارض كهرباء', air_conflict: 'تعارض هواء', overlap: 'تخاطي',
    };

    res.render('reports/box_report', { title: `تقرير بوكس ${box.number}`, box, inspection, items, beforePhotos, afterPhotos, task, itemStatusMap, CHECKLIST_LABELS });
  } catch (e) {
    console.error('/reports/box/:boxId error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل التقرير. حاول مرة أخرى.' });
  }
});

const CHECKLIST = [
  { key: 'connector_fix',        label: 'تثبيت الخوصة',        short: 'خوصة',    type: 'good_bad' },
  { key: 'box_fix',              label: 'تثبيت البوكس',         short: 'تثبيت',   type: 'good_bad' },
  { key: 'box_cover',            label: 'غطاء البوكس',          short: 'غطاء',    type: 'good_bad' },
  { key: 'box_numbering',        label: 'ترقيم البوكس',         short: 'ترقيم',   type: 'good_bad' },
  { key: 'box_height',           label: 'ارتفاع البوكس',        short: 'ارتفاع',  type: 'good_bad' },
  { key: 'branch_path',          label: 'الفرعات على الترمنال', short: 'فرعات',   type: 'good_bad' },
  { key: 'wire_path',            label: 'مسار السلك',           short: 'سلك',     type: 'good_bad' },
  { key: 'electricity_conflict', label: 'تعارض كهرباء',         short: 'كهرباء',  type: 'yes_no'   },
  { key: 'air_conflict',         label: 'تعارض هواء',           short: 'هواء',    type: 'yes_no'   },
  { key: 'overlap',              label: 'تخاطي',                short: 'تخاطي',   type: 'yes_no'   },
];

router.get('/comprehensive', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, cabinet_id, box_q } = req.query;
    let sql = `
      SELECT i.id as insp_id, i.date, i.general_notes,
             i.latitude as insp_lat, i.longitude as insp_lng,
             b.id as box_id, b.number as box_number, b.latitude as box_lat, b.longitude as box_lng,
             c.number as cabinet_number,
             e.name as exchange_name,
             u.full_name as inspector_name,
             mt.id as task_id, mt.status as task_status, mt.notes as task_notes,
             ut.full_name as tech_name
      FROM inspections i
      JOIN boxes b ON b.id = i.box_id
      JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      JOIN users u ON u.id = i.inspector_id
      LEFT JOIN maintenance_tasks mt ON mt.inspection_id = i.id
      LEFT JOIN users ut ON ut.id = mt.technician_id
      WHERE COALESCE(i.is_archived, 0) = 0
    `;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(cabinet_id); }
    if (box_q)       { sql += ' AND b.number LIKE ?'; params.push(`%${box_q}%`); }
    if (from) { sql += ' AND i.date >= ?'; params.push(from); }
    if (to)   { sql += ' AND i.date <= ?'; params.push(to); }
    sql += ' ORDER BY i.date DESC, e.name, c.number';

    const rows = await db.all(sql, params);
    const exchanges = await db.all('SELECT * FROM exchanges ORDER BY name');
    const cabinets = exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : [];

    // Fetch inspection items and task items in bulk (avoid N+1)
    const inspItems = {};
    const taskItems = {};
    if (rows.length) {
      const inspIds = rows.map(r => r.insp_id);
      const taskIds  = rows.filter(r => r.task_id).map(r => r.task_id);
      const allItems = await db.all('SELECT * FROM inspection_items WHERE inspection_id = ANY(?)', [inspIds]);
      allItems.forEach(it => {
        if (!inspItems[it.inspection_id]) inspItems[it.inspection_id] = {};
        inspItems[it.inspection_id][it.item_key] = it;
      });
      if (taskIds.length) {
        const allTaskItems = await db.all(
          'SELECT mis.*, mt.inspection_id FROM maintenance_item_status mis JOIN maintenance_tasks mt ON mt.id = mis.task_id WHERE mis.task_id = ANY(?)',
          [taskIds]
        );
        allTaskItems.forEach(it => {
          if (!taskItems[it.inspection_id]) taskItems[it.inspection_id] = {};
          taskItems[it.inspection_id][it.item_key] = it;
        });
      }
    }
    res.render('reports/comprehensive', { title: 'تقرير الفحوصات الشامل', rows, inspItems, taskItems, exchanges, cabinets, query: req.query, CHECKLIST });
  } catch (e) {
    console.error('/reports/comprehensive error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ: ' + e.message });
  }
});


// ── Completed-work comprehensive report ──────────────────────────────────────
router.get('/completed-work', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, cabinet_id, box_q } = req.query;
    let sql = `
      SELECT i.id as insp_id, i.date, i.general_notes,
             b.id as box_id, b.number as box_number, b.latitude as box_lat, b.longitude as box_lng,
             c.number as cabinet_number,
             e.name as exchange_name,
             u.full_name as inspector_name,
             mt.id as task_id, mt.status as task_status, mt.notes as task_notes,
             ut.full_name as tech_name
      FROM inspections i
      JOIN boxes b ON b.id = i.box_id
      JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      JOIN users u ON u.id = i.inspector_id
      INNER JOIN maintenance_tasks mt ON mt.inspection_id = i.id
        AND mt.status IN ('completed', 'pending_approval')
      LEFT JOIN users ut ON ut.id = mt.technician_id
      WHERE COALESCE(i.is_archived, 0) = 0
    `;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(cabinet_id); }
    if (box_q)       { sql += ' AND b.number LIKE ?'; params.push(`%${box_q}%`); }
    if (from) { sql += ' AND i.date >= ?'; params.push(from); }
    if (to)   { sql += ' AND i.date <= ?'; params.push(to); }
    sql += ' ORDER BY mt.completed_at DESC, e.name, c.number';

    const rows = await db.all(sql, params);
    const exchanges = await db.all('SELECT * FROM exchanges ORDER BY name');
    const cabinets = exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : [];

    const inspItems = {}, taskItems = {};
    if (rows.length) {
      const inspIds = rows.map(r => r.insp_id);
      const taskIds  = rows.filter(r => r.task_id).map(r => r.task_id);
      const allItems = await db.all('SELECT * FROM inspection_items WHERE inspection_id = ANY(?)', [inspIds]);
      allItems.forEach(it => {
        if (!inspItems[it.inspection_id]) inspItems[it.inspection_id] = {};
        inspItems[it.inspection_id][it.item_key] = it;
      });
      if (taskIds.length) {
        const allTaskItems = await db.all(
          'SELECT mis.*, mt.inspection_id FROM maintenance_item_status mis JOIN maintenance_tasks mt ON mt.id = mis.task_id WHERE mis.task_id = ANY(?)',
          [taskIds]
        );
        allTaskItems.forEach(it => {
          if (!taskItems[it.inspection_id]) taskItems[it.inspection_id] = {};
          taskItems[it.inspection_id][it.item_key] = it;
        });
      }
    }
    res.render('reports/completed_work', {
      title: 'الفحوصات الشاملة - الأعمال المنجزة', rows, inspItems, taskItems, exchanges, cabinets, query: req.query, CHECKLIST
    });
  } catch (e) {
    console.error('/reports/completed-work error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ: ' + e.message });
  }
});

router.get('/completed-work/export', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, cabinet_id, box_q } = req.query;
    let sql = `
      SELECT i.date, e.name as exchange_name, c.number as cabinet_number,
             b.number as box_number, u.full_name as inspector_name,
             mt.notes as task_notes, ut.full_name as tech_name
      FROM inspections i
      JOIN boxes b ON b.id = i.box_id
      JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      JOIN users u ON u.id = i.inspector_id
      INNER JOIN maintenance_tasks mt ON mt.inspection_id = i.id
        AND mt.status IN ('completed', 'pending_approval')
      LEFT JOIN users ut ON ut.id = mt.technician_id
      WHERE COALESCE(i.is_archived, 0) = 0
    `;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(cabinet_id); }
    if (box_q)       { sql += ' AND b.number LIKE ?'; params.push(`%${box_q}%`); }
    if (from) { sql += ' AND i.date >= ?'; params.push(from); }
    if (to)   { sql += ' AND i.date <= ?'; params.push(to); }
    sql += ' ORDER BY mt.completed_at DESC';
    const rows = await db.all(sql, params);
    const ws = xlsx.utils.json_to_sheet(rows.map(r => ({
      'التاريخ': r.date ? new Date(r.date).toISOString().split('T')[0] : '',
      'السنترال': r.exchange_name,
      'الكابينة': r.cabinet_number,
      'البوكس': r.box_number,
      'المراقب': r.inspector_name,
      'الفني': r.tech_name || '',
      'ملاحظات الصيانة': r.task_notes || '',
    })));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'الأعمال المنجزة');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="completed_work.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) {
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

// ── Per-technician completed-work summary ────────────────────────────────────
function buildTechSummarySql(query) {
  let sql = `
    SELECT ut.id AS tech_id, ut.full_name AS tech_name,
           mis.item_key AS item_key, COUNT(*) AS cnt
    FROM maintenance_item_status mis
    JOIN maintenance_tasks mt ON mt.id = mis.task_id
    JOIN inspections i ON i.id = mt.inspection_id
    JOIN boxes b ON b.id = i.box_id
    JOIN cabinets c ON c.id = b.cabinet_id
    JOIN exchanges e ON e.id = c.exchange_id
    JOIN users ut ON ut.id = mt.technician_id
    WHERE mis.is_done = 1 AND COALESCE(i.is_archived, 0) = 0
  `;
  const params = [];
  if (query.exchange_id) { sql += ' AND e.id = ?'; params.push(query.exchange_id); }
  if (query.cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(query.cabinet_id); }
  if (query.box_id)      { sql += ' AND b.id = ?'; params.push(query.box_id); }
  if (query.from) { sql += ' AND DATE(mis.done_at) >= ?'; params.push(query.from); }
  if (query.to)   { sql += ' AND DATE(mis.done_at) <= ?'; params.push(query.to); }
  sql += ' GROUP BY ut.id, ut.full_name, mis.item_key';
  return { sql, params };
}

function pivotTechSummary(grouped) {
  const techMap = {};
  const totals = {};
  let grandTotal = 0;
  grouped.forEach(r => {
    const n = parseInt(r.cnt) || 0;
    if (!techMap[r.tech_id]) techMap[r.tech_id] = { tech_id: r.tech_id, tech_name: r.tech_name || '—', counts: {}, total: 0, boxCount: 0 };
    techMap[r.tech_id].counts[r.item_key] = n;
    techMap[r.tech_id].total += n;
    totals[r.item_key] = (totals[r.item_key] || 0) + n;
    grandTotal += n;
  });
  const techs = Object.values(techMap).sort((a, b) => b.total - a.total);
  return { techs, totals, grandTotal };
}

function buildTechBoxCountSql(query) {
  let sql = `
    SELECT mt.technician_id AS tech_id, COUNT(DISTINCT i.box_id) AS box_count
    FROM maintenance_item_status mis
    JOIN maintenance_tasks mt ON mt.id = mis.task_id
    JOIN inspections i ON i.id = mt.inspection_id
    JOIN boxes b ON b.id = i.box_id
    JOIN cabinets c ON c.id = b.cabinet_id
    JOIN exchanges e ON e.id = c.exchange_id
    WHERE mis.is_done = 1 AND COALESCE(i.is_archived, 0) = 0
  `;
  const params = [];
  if (query.exchange_id) { sql += ' AND e.id = ?'; params.push(query.exchange_id); }
  if (query.cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(query.cabinet_id); }
  if (query.box_id)      { sql += ' AND b.id = ?'; params.push(query.box_id); }
  if (query.from) { sql += ' AND DATE(mis.done_at) >= ?'; params.push(query.from); }
  if (query.to)   { sql += ' AND DATE(mis.done_at) <= ?'; params.push(query.to); }
  sql += ' GROUP BY mt.technician_id';
  return { sql, params };
}

function buildTotalNeedingWorkSql(query) {
  let sql = `
    SELECT COUNT(DISTINCT i.box_id) AS total
    FROM inspection_items ii
    JOIN inspections i ON i.id = ii.inspection_id
    JOIN boxes b ON b.id = i.box_id
    JOIN cabinets c ON c.id = b.cabinet_id
    JOIN exchanges e ON e.id = c.exchange_id
    WHERE (ii.value = 'bad' OR ii.value = 'yes') AND COALESCE(i.is_archived, 0) = 0
  `;
  const params = [];
  if (query.exchange_id) { sql += ' AND e.id = ?'; params.push(query.exchange_id); }
  if (query.cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(query.cabinet_id); }
  if (query.box_id)      { sql += ' AND b.id = ?'; params.push(query.box_id); }
  return { sql, params };
}

router.get('/technician-summary', staffOnly, async (req, res) => {
  try {
    const sumQ  = buildTechSummarySql(req.query);
    const boxQ  = buildTechBoxCountSql(req.query);
    const needQ = buildTotalNeedingWorkSql(req.query);
    const [grouped, boxRows, needRow, exchanges, cabinets, boxes] = await Promise.all([
      db.all(sumQ.sql, sumQ.params),
      db.all(boxQ.sql, boxQ.params),
      db.get(needQ.sql, needQ.params),
      db.all('SELECT id, name FROM exchanges ORDER BY name'),
      req.query.exchange_id
        ? db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [req.query.exchange_id])
        : Promise.resolve([]),
      req.query.cabinet_id
        ? db.all('SELECT id, number FROM boxes WHERE cabinet_id = ? ORDER BY number', [req.query.cabinet_id])
        : Promise.resolve([]),
    ]);
    const { techs, totals, grandTotal } = pivotTechSummary(grouped);
    const boxCountMap = {};
    boxRows.forEach(r => { boxCountMap[r.tech_id] = parseInt(r.box_count) || 0; });
    techs.forEach(t => { t.boxCount = boxCountMap[t.tech_id] || 0; });
    const totalBoxCount    = techs.reduce((s, t) => s + t.boxCount, 0);
    const totalNeedingWork = parseInt(needRow && needRow.total) || 0;
    res.render('reports/technician_summary', {
      title: 'ملخص أعمال فنيي الصيانة', techs, totals, grandTotal,
      totalBoxCount, totalNeedingWork, exchanges, cabinets, boxes, query: req.query, CHECKLIST
    });
  } catch (e) {
    console.error('/reports/technician-summary error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ: ' + e.message });
  }
});

router.get('/technician-summary/export', staffOnly, async (req, res) => {
  try {
    const sumQ  = buildTechSummarySql(req.query);
    const boxQ  = buildTechBoxCountSql(req.query);
    const needQ = buildTotalNeedingWorkSql(req.query);
    const [grouped, boxRows, needRow] = await Promise.all([db.all(sumQ.sql, sumQ.params), db.all(boxQ.sql, boxQ.params), db.get(needQ.sql, needQ.params)]);
    const { techs, totals, grandTotal } = pivotTechSummary(grouped);
    const boxCountMap = {};
    boxRows.forEach(r => { boxCountMap[r.tech_id] = parseInt(r.box_count) || 0; });
    techs.forEach(t => { t.boxCount = boxCountMap[t.tech_id] || 0; });
    const totalBoxCount    = techs.reduce((s, t) => s + t.boxCount, 0);
    const totalNeedingWork = parseInt(needRow && needRow.total) || 0;
    const data = techs.map(t => {
      const pct = totalNeedingWork > 0 ? (t.boxCount / totalNeedingWork * 100).toFixed(1) + '%' : '0.0%';
      const row = { 'الفني': t.tech_name };
      CHECKLIST.forEach(ci => { row[ci.label] = t.counts[ci.key] || 0; });
      row['الإجمالي'] = t.total;
      row['البوكسات المنجزة'] = t.boxCount;
      row['إجمالي تحتاج صيانة'] = totalNeedingWork;
      row['نسبة الإنجاز %'] = pct;
      return row;
    });
    const totalRow = { 'الفني': 'الإجمالي العام' };
    CHECKLIST.forEach(ci => { totalRow[ci.label] = totals[ci.key] || 0; });
    totalRow['الإجمالي'] = grandTotal;
    totalRow['البوكسات المنجزة'] = totalBoxCount;
    totalRow['إجمالي تحتاج صيانة'] = totalNeedingWork;
    totalRow['نسبة الإنجاز %'] = totalNeedingWork > 0 ? (totalBoxCount / totalNeedingWork * 100).toFixed(1) + '%' : '0%';
    data.push(totalRow);
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'ملخص الفنيين');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="technician_summary.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) {
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

// ── Comprehensive report Excel export ────────────────────────────────────────
router.get('/comprehensive/export', staffOnly, async (req, res) => {
  try {
    const { exchange_id, from, to, cabinet_id, box_q } = req.query;
    let sql = `
      SELECT i.id as insp_id, i.date, i.general_notes,
             i.latitude as insp_lat, i.longitude as insp_lng,
             b.id as box_id, b.number as box_number, b.latitude as box_lat, b.longitude as box_lng,
             c.number as cabinet_number,
             e.name as exchange_name,
             u.full_name as inspector_name,
             mt.id as task_id, mt.notes as task_notes,
             ut.full_name as tech_name
      FROM inspections i
      JOIN boxes b ON b.id = i.box_id
      JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      JOIN users u ON u.id = i.inspector_id
      LEFT JOIN maintenance_tasks mt ON mt.inspection_id = i.id
      LEFT JOIN users ut ON ut.id = mt.technician_id
      WHERE COALESCE(i.is_archived, 0) = 0
    `;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(cabinet_id); }
    if (box_q)       { sql += ' AND b.number LIKE ?'; params.push(`%${box_q}%`); }
    if (from) { sql += ' AND i.date >= ?'; params.push(from); }
    if (to)   { sql += ' AND i.date <= ?'; params.push(to); }
    sql += ' ORDER BY i.date DESC, e.name, c.number';

    const rows = await db.all(sql, params);

    const inspItems = {};
    const taskItems = {};
    if (rows.length) {
      const inspIds = rows.map(r => r.insp_id);
      const taskIds  = rows.filter(r => r.task_id).map(r => r.task_id);
      const allItems = await db.all('SELECT * FROM inspection_items WHERE inspection_id = ANY(?)', [inspIds]);
      allItems.forEach(it => {
        if (!inspItems[it.inspection_id]) inspItems[it.inspection_id] = {};
        inspItems[it.inspection_id][it.item_key] = it;
      });
      if (taskIds.length) {
        const allTaskItems = await db.all(
          'SELECT mis.*, mt.inspection_id FROM maintenance_item_status mis JOIN maintenance_tasks mt ON mt.id = mis.task_id WHERE mis.task_id = ANY(?)',
          [taskIds]
        );
        allTaskItems.forEach(it => {
          if (!taskItems[it.inspection_id]) taskItems[it.inspection_id] = {};
          taskItems[it.inspection_id][it.item_key] = it;
        });
      }
    }

    const VALUE_MAP = { good: 'جيد', bad: 'سيء', yes: 'يوجد', no: 'لا يوجد' };

    // Build worksheet rows
    const headers = [
      'السنترال', 'الكابينة', 'البوكس', 'التاريخ', 'المراقب',
      'خط العرض', 'خط الطول',
      // checklist item value + notes columns
      ...CHECKLIST.flatMap(ci => [ci.label, `ملاحظات: ${ci.label}`]),
      'ملاحظات الفحص',
      'الفني', 'الأعمال المنجزة', 'ملاحظات الصيانة',
    ];

    const sheetData = [headers];
    rows.forEach(row => {
      const iItems = inspItems[row.insp_id] || {};
      const tItems = taskItems[row.insp_id] || {};
      const doneLabels = CHECKLIST.filter(ci => tItems[ci.key] && tItems[ci.key].is_done).map(ci => ci.label).join('، ');
      const checklistCols = CHECKLIST.flatMap(ci => {
        const it = iItems[ci.key];
        const val = it ? (VALUE_MAP[it.value] || it.value) : '';
        const note = it ? (it.notes || '') : '';
        return [val, note];
      });
      sheetData.push([
        row.exchange_name,
        row.cabinet_number,
        row.box_number,
        row.date ? new Date(row.date).toISOString().split('T')[0] : '',
        row.inspector_name,
        row.box_lat || '',
        row.box_lng || '',
        ...checklistCols,
        row.general_notes || '',
        row.tech_name || '',
        doneLabels,
        row.task_notes || '',
      ]);
    });

    const ws = xlsx.utils.aoa_to_sheet(sheetData);
    // Set column widths
    ws['!cols'] = headers.map((h, i) => ({ wch: i < 7 ? 18 : (i % 2 === 0 ? 20 : 22) }));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'الفحوصات الشاملة');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `comprehensive_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (e) {
    console.error('/reports/comprehensive/export error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'فشل التصدير: ' + e.message });
  }
});

// ── Overlap / Air-conflict distance reports ───────────────────────────────────

async function overlapDistanceRows(completed, filters) {
  const { exchange_id, from, to, cabinet_id, box_q } = filters;
  const cond = [`ii.item_key IN ('overlap','air_conflict')`,
                `ii.value = 'yes'`,
                `ii.extra_distance IS NOT NULL`,
                `ii.extra_type IS NOT NULL`,
                `TRIM(ii.extra_type) <> ''`,
                `(i.is_archived IS NULL OR i.is_archived = 0)`];
  const params = [];

  if (completed) {
    // Show items where the technician pressed "تم الإصلاح" for this specific item
    cond.push(`EXISTS (
      SELECT 1 FROM maintenance_tasks mt2
      JOIN maintenance_item_status mis ON mis.task_id = mt2.id
      WHERE mt2.inspection_id = i.id
        AND mis.item_key = ii.item_key
        AND mis.is_done = 1
    )`);
  } else {
    cond.push(`NOT EXISTS (
      SELECT 1 FROM maintenance_tasks mt2
      JOIN maintenance_item_status mis ON mis.task_id = mt2.id
      WHERE mt2.inspection_id = i.id
        AND mis.item_key = ii.item_key
        AND mis.is_done = 1
    )`);
  }

  if (exchange_id) { params.push(exchange_id); cond.push(`e.id = ?`); }
  if (cabinet_id)  { params.push(cabinet_id);  cond.push(`b.cabinet_id = ?`); }
  if (box_q)       { params.push(`%${box_q}%`); cond.push(`b.number LIKE ?`); }
  if (from)        { params.push(from);         cond.push(`i.date >= ?`); }
  if (to)          { params.push(to);           cond.push(`DATE(i.date) <= ?`); }

  return db.all(`
    SELECT b.id as box_id, b.number as box_number, b.status as box_status,
           c.number as cabinet_number, e.name as exchange_name,
           i.date, u.full_name as inspector_name,
           ii.item_key, ii.extra_type, ii.extra_distance,
           mt.status as task_status
    FROM inspection_items ii
    JOIN inspections i   ON i.id  = ii.inspection_id
    JOIN boxes b         ON b.id  = i.box_id
    JOIN cabinets c      ON c.id  = b.cabinet_id
    JOIN exchanges e     ON e.id  = c.exchange_id
    JOIN users u         ON u.id  = i.inspector_id
    LEFT JOIN maintenance_tasks mt ON mt.inspection_id = i.id
    WHERE ${cond.join(' AND ')}
    ORDER BY i.date DESC, e.name, c.number,
             CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number
  `, params);
}

function overlapSummary(rows) {
  const totals = {};
  const counts = {};
  rows.forEach(r => {
    if (!r.extra_type) return;
    totals[r.extra_type] = (totals[r.extra_type] || 0) + (parseFloat(r.extra_distance) || 0);
    counts[r.extra_type] = (counts[r.extra_type] || 0) + 1;
  });
  return { totals, counts };
}

function renderOverlapReport(res, rows, exchanges, cabinets, query, completed) {
  const { totals, counts } = overlapSummary(rows);
  res.render('reports/overlap_distance', {
    title: completed ? 'مسافات التخاطي والتعارض — تم الإصلاح'
                     : 'مسافات التخاطي والتعارض — لم يتم الإصلاح بعد',
    rows, exchanges, cabinets, query, completed, totals, counts,
  });
}

router.get('/overlap-distance-completed', staffOnly, async (req, res) => {
  try {
    const exchanges = await db.all('SELECT id,name FROM exchanges ORDER BY name');
    const cabinets = req.query.exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [req.query.exchange_id]) : [];
    const rows = await overlapDistanceRows(true, req.query);
    renderOverlapReport(res, rows, exchanges, cabinets, req.query, true);
  } catch (e) { res.status(500).render('error', { title: 'خطأ', message: e.message }); }
});

router.get('/overlap-distance-pending', staffOnly, async (req, res) => {
  try {
    const exchanges = await db.all('SELECT id,name FROM exchanges ORDER BY name');
    const cabinets = req.query.exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [req.query.exchange_id]) : [];
    const rows = await overlapDistanceRows(false, req.query);
    renderOverlapReport(res, rows, exchanges, cabinets, req.query, false);
  } catch (e) { res.status(500).render('error', { title: 'خطأ', message: e.message }); }
});

async function exportOverlapXlsx(res, completed, filters) {
  const rows = await overlapDistanceRows(completed, filters);
  const ITEM_LABELS = { overlap: 'تخاطي', air_conflict: 'تعارض هواء' };
  const BOX_STATUS_AR = {
    pending_inspection: 'بانتظار الفحص', inspected: 'تم الفحص',
    needs_maintenance: 'يحتاج صيانة', in_progress: 'قيد الصيانة', completed: 'مكتمل',
  };
  const data = [['السنترال','الكابينة','البوكس','حالة البوكس','البند','نوع الكابل / البكس','المسافة (م)','المراقب','التاريخ']];
  rows.forEach(r => data.push([
    r.exchange_name, r.cabinet_number, r.box_number,
    BOX_STATUS_AR[r.box_status] || r.box_status || '',
    ITEM_LABELS[r.item_key] || r.item_key,
    r.extra_type || '', r.extra_distance || '',
    r.inspector_name, r.date ? new Date(r.date).toISOString().split('T')[0] : '',
  ]));
  // summary rows
  const { totals, counts } = overlapSummary(rows);
  data.push([]);
  data.push(['الإجماليات بالمتر']);
  Object.entries(totals).forEach(([t, v]) => data.push([t, v + ' م']));
  data.push([]);
  data.push(['عدد البكسيات المناوله ١٠ جوز', counts['بكس مناول ١٠ جوز'] || 0]);
  sendXlsx(res, data, `overlap_distance_${completed?'completed':'pending'}_${new Date().toISOString().split('T')[0]}.xlsx`);
}

router.get('/overlap-distance-completed/export', staffOnly, async (req, res) => {
  try { await exportOverlapXlsx(res, true, req.query); }
  catch (e) { res.status(500).render('error', { title: 'خطأ', message: e.message }); }
});

router.get('/overlap-distance-pending/export', staffOnly, async (req, res) => {
  try { await exportOverlapXlsx(res, false, req.query); }
  catch (e) { res.status(500).render('error', { title: 'خطأ', message: e.message }); }
});

router.get('/missing-boxes', staffOnly, async (req, res) => {
  try {
    const rows = await db.all(`
      WITH box_ranges AS (
        SELECT c.id AS cabinet_id,
               c.number AS cabinet_number,
               e.name AS exchange_name,
               MAX(CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END) AS max_num
        FROM cabinets c
        JOIN exchanges e ON e.id = c.exchange_id
        LEFT JOIN boxes b ON b.cabinet_id = c.id
        GROUP BY c.id, c.number, e.name
        HAVING MAX(CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END) > 0
      ),
      series AS (
        SELECT cabinet_id, cabinet_number, exchange_name, max_num,
               generate_series(1, max_num) AS n
        FROM box_ranges
      ),
      existing AS (
        SELECT b.cabinet_id, b.number::INTEGER AS n
        FROM boxes b
        WHERE b.number ~ '^[0-9]+$'
      )
      SELECT s.exchange_name, s.cabinet_number, s.max_num, s.n AS missing_num
      FROM series s
      LEFT JOIN existing ex ON ex.cabinet_id = s.cabinet_id AND ex.n = s.n
      WHERE ex.n IS NULL
      ORDER BY s.exchange_name,
               CASE WHEN s.cabinet_number ~ '^[0-9]+$' THEN s.cabinet_number::INTEGER ELSE 0 END,
               s.cabinet_number, s.n
    `);
    const grouped = {};
    rows.forEach(r => {
      const key = `${r.exchange_name}||${r.cabinet_number}`;
      if (!grouped[key]) grouped[key] = { exchange_name: r.exchange_name, cabinet_number: r.cabinet_number, max_num: r.max_num, missing: [] };
      grouped[key].missing.push(r.missing_num);
    });
    const cabinets = Object.values(grouped);
    const totalMissing = rows.length;
    res.render('reports/missing_boxes', { title: 'البكسيات الناقصة', cabinets, totalMissing });
  } catch (e) {
    console.error('/reports/missing-boxes error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

router.get('/missing-boxes/export', staffOnly, async (req, res) => {
  try {
    const rows = await db.all(`
      WITH box_ranges AS (
        SELECT c.id AS cabinet_id,
               c.number AS cabinet_number,
               e.name AS exchange_name,
               MAX(CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END) AS max_num
        FROM cabinets c
        JOIN exchanges e ON e.id = c.exchange_id
        LEFT JOIN boxes b ON b.cabinet_id = c.id
        GROUP BY c.id, c.number, e.name
        HAVING MAX(CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END) > 0
      ),
      series AS (
        SELECT cabinet_id, cabinet_number, exchange_name, max_num,
               generate_series(1, max_num) AS n
        FROM box_ranges
      ),
      existing AS (
        SELECT b.cabinet_id, b.number::INTEGER AS n
        FROM boxes b
        WHERE b.number ~ '^[0-9]+$'
      )
      SELECT s.exchange_name, s.cabinet_number, s.max_num, s.n AS missing_num
      FROM series s
      LEFT JOIN existing ex ON ex.cabinet_id = s.cabinet_id AND ex.n = s.n
      WHERE ex.n IS NULL
      ORDER BY s.exchange_name,
               CASE WHEN s.cabinet_number ~ '^[0-9]+$' THEN s.cabinet_number::INTEGER ELSE 0 END,
               s.cabinet_number, s.n
    `);
    const data = [['السنترال', 'الكابينة', 'أعلى رقم بكس', 'رقم البكس الناقص']];
    rows.forEach(r => data.push([r.exchange_name, r.cabinet_number, r.max_num, r.missing_num]));
    sendXlsx(res, data, `missing_boxes_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) {
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

// ── Technical data report ─────────────────────────────────────────────────────

router.get('/technical-data', staffOnly, async (req, res) => {
  try {
    const { exchange_id, cabinet_id, box_q, status } = req.query;
    let sql = `
      SELECT b.id as box_id, b.number as box_number, b.status as box_status,
             c.number as cabinet_number, e.name as exchange_name,
             i.date as last_inspection_date, u.full_name as inspector_name
      FROM boxes b
      JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      LEFT JOIN LATERAL (
        SELECT * FROM inspections
        WHERE box_id = b.id AND COALESCE(is_archived, 0) = 0
        ORDER BY id DESC LIMIT 1
      ) i ON true
      LEFT JOIN users u ON u.id = i.inspector_id
      WHERE 1=1
    `;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(cabinet_id); }
    if (box_q)       { sql += ' AND b.number LIKE ?'; params.push(`%${box_q}%`); }
    if (status)      { sql += ' AND b.status = ?'; params.push(status); }
    sql += ` ORDER BY e.name,
             CASE WHEN c.number ~ '^[0-9]+$' THEN c.number::INTEGER ELSE 0 END, c.number,
             CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number`;
    const rows = await db.all(sql, params);
    const exchanges = await db.all('SELECT id, name FROM exchanges ORDER BY name');
    const cabinets = exchange_id ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : [];
    const statusCountRows = await db.all('SELECT status, COUNT(*) as c FROM boxes GROUP BY status');
    const statusCounts = {};
    statusCountRows.forEach(r => { statusCounts[r.status] = parseInt(r.c); });
    res.render('reports/technical_data', {
      title: 'البيانات الفنية المسجلة', rows, exchanges, cabinets, statusCounts, query: req.query,
    });
  } catch (e) {
    console.error('/reports/technical-data error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

router.get('/technical-data/export', staffOnly, async (req, res) => {
  try {
    const { exchange_id, cabinet_id, box_q, status } = req.query;
    let sql = `
      SELECT b.id as box_id, b.number as box_number, b.status as box_status,
             c.number as cabinet_number, e.name as exchange_name,
             i.date as last_inspection_date, u.full_name as inspector_name
      FROM boxes b
      JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      LEFT JOIN LATERAL (
        SELECT * FROM inspections
        WHERE box_id = b.id AND COALESCE(is_archived, 0) = 0
        ORDER BY id DESC LIMIT 1
      ) i ON true
      LEFT JOIN users u ON u.id = i.inspector_id
      WHERE 1=1
    `;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND b.cabinet_id = ?'; params.push(cabinet_id); }
    if (box_q)       { sql += ' AND b.number LIKE ?'; params.push(`%${box_q}%`); }
    if (status)      { sql += ' AND b.status = ?'; params.push(status); }
    sql += ` ORDER BY e.name,
             CASE WHEN c.number ~ '^[0-9]+$' THEN c.number::INTEGER ELSE 0 END, c.number,
             CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number`;
    const rows = await db.all(sql, params);
    const STATUS_LABELS = {
      pending_inspection: 'بانتظار الفحص', inspected: 'تم الفحص',
      needs_maintenance: 'يحتاج صيانة', in_progress: 'قيد الصيانة',
      pending_approval: 'في انتظار التأكيد', completed: 'مكتمل',
    };
    const data = [['#', 'السنترال', 'الكابينة', 'رقم البوكس', 'الحالة', 'تاريخ آخر فحص', 'المراقب']];
    rows.forEach((r, idx) => data.push([
      idx + 1, r.exchange_name, r.cabinet_number, r.box_number,
      STATUS_LABELS[r.box_status] || r.box_status || 'بانتظار الفحص',
      r.last_inspection_date ? new Date(r.last_inspection_date).toISOString().split('T')[0] : 'لم يُفحص',
      r.inspector_name || '',
    ]));
    sendXlsx(res, data, `technical_data_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) {
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

// ── Cabinet photos ZIP download ───────────────────────────────────────────────
router.get('/cabinet/:cabId/photos/download', staffOnly, async (req, res) => {
  try {
    const cabinet = await db.get(`
      SELECT c.*, e.name as exchange_name
      FROM cabinets c JOIN exchanges e ON e.id = c.exchange_id WHERE c.id = ?
    `, [req.params.cabId]);
    if (!cabinet) return res.redirect('/reports/cabinet');

    const boxes = await db.all(`
      SELECT b.number FROM boxes b
      WHERE b.cabinet_id = ? AND EXISTS (SELECT 1 FROM inspections WHERE box_id = b.id)
      ORDER BY CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number
    `, [req.params.cabId]);

    if (!boxes.length) {
      req.session.flash = { type: 'warning', msg: 'لا توجد بوكسات مفحوصة في هذه الكابينة.' };
      return res.redirect(`/reports/cabinet/${req.params.cabId}`);
    }

    const rootFolder = `${cabinet.exchange_name} - كابينة ${cabinet.number}`;
    const uploadsDir = path.join(DATA_DIR, 'uploads');
    const zipName = `${cabinet.exchange_name}_كابينة_${cabinet.number}.zip`;

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', err => { if (!res.headersSent) res.status(500).send(err.message); });
    archive.pipe(res);

    const appendPhoto = (boxFolder, p, idx, subFolder) => {
      const name = `${boxFolder}/${subFolder}/${idx + 1}${path.extname(p.filename) || '.jpg'}`;
      const filePath = path.join(uploadsDir, p.filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name });
      } else if (p.data) {
        archive.append(p.data, { name });
      }
    };

    for (const box of boxes) {
      const boxFolder = `${rootFolder}/بوكس ${box.number}`;
      const beforePhotos = await db.all(`
        SELECT p.filename, p.data FROM photos p
        JOIN inspections i ON i.id = p.inspection_id
        JOIN boxes b ON b.id = i.box_id
        WHERE b.number = ? AND b.cabinet_id = ? AND p.photo_type = 'before'
        ORDER BY p.uploaded_at
      `, [box.number, req.params.cabId]);
      const afterPhotos = await db.all(`
        SELECT p.filename, p.data FROM photos p
        JOIN inspections i ON i.id = p.inspection_id
        JOIN boxes b ON b.id = i.box_id
        WHERE b.number = ? AND b.cabinet_id = ? AND p.photo_type = 'after'
        ORDER BY p.uploaded_at
      `, [box.number, req.params.cabId]);

      beforePhotos.forEach((p, idx) => appendPhoto(boxFolder, p, idx, 'قبل الصيانة'));
      afterPhotos.forEach((p, idx) => appendPhoto(boxFolder, p, idx, 'بعد الصيانة'));
    }

    archive.finalize();
  } catch (e) {
    console.error('/reports/cabinet/:cabId/photos/download error:', e.message);
    if (!res.headersSent) res.status(500).render('error', { title: 'خطأ', message: 'فشل تحميل الصور: ' + e.message });
  }
});

// ── All-photos report ──────────────────────────────────────────────────────────
router.get('/photos', staffOnly, async (req, res) => {
  try {
    const { exchange_id, cabinet_id, box_id } = req.query;
    let sql = `
      SELECT e.id as exchange_id, e.name as exchange_name,
             c.id as cabinet_id, c.number as cabinet_number,
             b.id as box_id, b.number as box_number,
             p.photo_type, COUNT(*) as photo_count
      FROM photos p
      JOIN inspections i ON i.id = p.inspection_id
      JOIN boxes b ON b.id = i.box_id
      JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      WHERE COALESCE(p.media_type,'photo') = 'photo' AND COALESCE(i.is_archived,0) = 0
    `;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND c.id = ?'; params.push(cabinet_id); }
    if (box_id)      { sql += ' AND b.id = ?'; params.push(box_id); }
    sql += ' GROUP BY e.id, e.name, c.id, c.number, b.id, b.number, p.photo_type ORDER BY e.name, c.number, b.number, p.photo_type';

    const [rows, exchanges, cabinets, boxes] = await Promise.all([
      db.all(sql, params),
      db.all('SELECT id, name FROM exchanges ORDER BY name'),
      exchange_id ? db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : Promise.resolve([]),
      cabinet_id  ? db.all('SELECT id, number FROM boxes WHERE cabinet_id = ? ORDER BY number', [cabinet_id]) : Promise.resolve([]),
    ]);

    // Pivot to nested structure: exchange → cabinet → box
    const exchangeMap = {};
    let totalBefore = 0, totalAfter = 0;
    const boxSet = new Set();
    rows.forEach(r => {
      const cnt = parseInt(r.photo_count) || 0;
      if (!exchangeMap[r.exchange_name]) exchangeMap[r.exchange_name] = { id: r.exchange_id, cabinets: {} };
      const cab = exchangeMap[r.exchange_name].cabinets;
      if (!cab[r.cabinet_number]) cab[r.cabinet_number] = { id: r.cabinet_id, boxes: {} };
      const bxs = cab[r.cabinet_number].boxes;
      if (!bxs[r.box_number]) bxs[r.box_number] = { id: r.box_id, before: 0, after: 0 };
      bxs[r.box_number][r.photo_type === 'before' ? 'before' : 'after'] += cnt;
      if (r.photo_type === 'before') totalBefore += cnt; else totalAfter += cnt;
      boxSet.add(r.box_id);
    });

    res.render('reports/photos', {
      title: 'تقرير الصور الكامل', exchangeMap, totalBefore, totalAfter,
      totalPhotos: totalBefore + totalAfter, totalBoxesWithPhotos: boxSet.size,
      exchanges, cabinets, boxes, query: req.query
    });
  } catch (e) {
    console.error('/reports/photos error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ: ' + e.message });
  }
});

router.get('/photos/download', staffOnly, async (req, res) => {
  try {
    const { exchange_id, cabinet_id, box_id } = req.query;
    let sql = `
      SELECT DISTINCT e.name as exchange_name, c.number as cabinet_number,
             b.id as box_id, b.number as box_number
      FROM photos p
      JOIN inspections i ON i.id = p.inspection_id
      JOIN boxes b ON b.id = i.box_id
      JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      WHERE COALESCE(p.media_type,'photo') = 'photo' AND COALESCE(i.is_archived,0) = 0
    `;
    const params = [];
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND c.id = ?'; params.push(cabinet_id); }
    if (box_id)      { sql += ' AND b.id = ?'; params.push(box_id); }
    sql += ' ORDER BY e.name, c.number, b.number';

    const boxList = await db.all(sql, params);
    if (!boxList.length) return res.status(404).send('لا توجد صور مطابقة.');

    const uploadsDir = path.join(DATA_DIR, 'uploads');
    const zipName = exchange_id
      ? (cabinet_id ? `صور_كابينة_${boxList[0].cabinet_number}.zip` : `صور_سنترال_${boxList[0].exchange_name}.zip`)
      : 'صور_كامل_الموقع.zip';

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', err => { if (!res.headersSent) res.status(500).send(err.message); });
    archive.pipe(res);

    const appendPhoto = (folder, p, idx, sub) => {
      const name = `${folder}/${sub}/${String(idx + 1).padStart(3, '0')}${path.extname(p.filename) || '.jpg'}`;
      const filePath = path.join(uploadsDir, p.filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name });
      } else if (p.data) {
        archive.append(p.data, { name });
      }
    };

    for (const box of boxList) {
      const folder = `${box.exchange_name}/${box.cabinet_number}/${box.box_number}`;
      const [beforePhotos, afterPhotos] = await Promise.all([
        db.all(`SELECT p.filename, p.data FROM photos p JOIN inspections i ON i.id = p.inspection_id
                WHERE i.box_id = ? AND p.photo_type = 'before' AND COALESCE(p.media_type,'photo')='photo'
                ORDER BY p.uploaded_at`, [box.box_id]),
        db.all(`SELECT p.filename, p.data FROM photos p JOIN inspections i ON i.id = p.inspection_id
                WHERE i.box_id = ? AND p.photo_type = 'after' AND COALESCE(p.media_type,'photo')='photo'
                ORDER BY p.uploaded_at`, [box.box_id]),
      ]);
      beforePhotos.forEach((p, idx) => appendPhoto(folder, p, idx, 'قبل الصيانة'));
      afterPhotos.forEach((p, idx) => appendPhoto(folder, p, idx, 'بعد الصيانة'));
    }

    archive.finalize();
  } catch (e) {
    console.error('/reports/photos/download error:', e.message);
    if (!res.headersSent) res.status(500).render('error', { title: 'خطأ', message: 'فشل تحميل الصور: ' + e.message });
  }
});

// ── Service-Flow report ────────────────────────────────────────────────────────
router.get('/service-flow', staffOnly, async (req, res) => {
  try {
    const apiUrl = process.env.SERVICE_FLOW_API_URL || 'https://service-flow-menoskar42.replit.app/api/box-summary';
    const token  = process.env.SERVICE_FLOW_API_TOKEN || '';
    const response = await fetch(apiUrl, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    const data = await response.json();
    const rows = Array.isArray(data) ? data : (data.data || data.rows || data.items || data.result || []);

    // optional filters
    const { q, exchange } = req.query;
    let filtered = rows;
    if (q) {
      const lq = q.toLowerCase();
      filtered = filtered.filter(r =>
        (r.central||'').toLowerCase().includes(lq) ||
        (r.cabinNumber||'').toString().toLowerCase().includes(lq) ||
        (r.boxNumber||'').toString().toLowerCase().includes(lq)
      );
    }
    if (exchange) {
      filtered = filtered.filter(r => (r.central||'').toLowerCase().includes(exchange.toLowerCase()));
    }

    // totals per central
    const centralTotals = {};
    filtered.forEach(r => {
      centralTotals[r.central] = (centralTotals[r.central] || 0) + (parseInt(r.count) || 0);
    });

    res.render('reports/service_flow', {
      title: 'ملخص البوكسيات – الطلبات المتعذرة',
      rows: filtered, total: rows.length, centralTotals, query: req.query
    });
  } catch (e) {
    console.error('/reports/service-flow error:', e.message);
    res.render('reports/service_flow', {
      title: 'ملخص البوكسيات – service-flow',
      rows: [], total: 0, query: req.query, error: e.message
    });
  }
});

// ── تقرير البوكسات بدون ملاحظات ──────────────────────────────────────────────
async function noIssuesReportRows(filters) {
  const { from, to, exchange_id, cabinet_id, box_q } = filters;
  const conds = [];
  const params = [];
  if (from)        { params.push(from);        conds.push(`i.date >= ?`); }
  if (to)          { params.push(to);           conds.push(`i.date <= ?`); }
  if (exchange_id) { params.push(exchange_id);  conds.push(`e.id = ?`); }
  if (cabinet_id)  { params.push(cabinet_id);   conds.push(`c.id = ?`); }
  if (box_q)       { params.push(`%${box_q}%`); conds.push(`b.number ILIKE ?`); }
  const extra = conds.length ? 'AND ' + conds.join(' AND ') : '';
  return db.all(`
    SELECT
      i.id           AS inspection_id,
      i.date         AS work_date,
      b.id           AS box_id,
      b.number       AS box_number,
      c.id           AS cabinet_id,
      c.number       AS cabinet_number,
      e.id           AS exchange_id,
      e.name         AS exchange_name,
      cc.exchange_code,
      cc.cabinet_code
    FROM inspections i
    JOIN boxes b ON b.id = i.box_id
    JOIN cabinets c ON c.id = b.cabinet_id
    JOIN exchanges e ON e.id = c.exchange_id
    LEFT JOIN cabinet_codes cc ON cc.exchange_name = e.name AND cc.cabinet_number = c.number
    WHERE NOT EXISTS (
      SELECT 1 FROM inspection_items ii
      WHERE ii.inspection_id = i.id AND ii.value IN ('bad','yes')
    )
    ${extra}
    ORDER BY i.date DESC,
      CASE WHEN c.number ~ '^[0-9\\-]+$' THEN c.number ELSE c.number END,
      CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number
  `, params);
}

router.get('/no-issues-report', staffOnly, async (req, res) => {
  try {
    const { buildPhoneFirstMap } = require('./service_flow');
    const { exchange_id } = req.query;
    const [exchanges, cabinets, rows, phoneMap, khalid] = await Promise.all([
      db.all('SELECT id, name FROM exchanges ORDER BY name'),
      exchange_id ? db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : Promise.resolve([]),
      noIssuesReportRows(req.query),
      buildPhoneFirstMap().catch(() => new Map()),
      db.get(`SELECT full_name, worker_code FROM users WHERE full_name ILIKE '%خالد عبد الرحمن%' LIMIT 1`),
    ]);
    const techName   = (khalid && khalid.full_name)   || 'خالد عبد الرحمن';
    const workerCode = (khalid && khalid.worker_code) || '180769';
    rows.forEach(r => {
      const exchFull   = String(r.exchange_name || '').trim().toLowerCase().replace(/\s*-\s*/g, '-');
      const exchPrefix = exchFull.split('-')[0].trim();
      const cab = String(r.cabinet_number || '').trim().toLowerCase().replace(/\s*-\s*/g, '-');
      const box = String(r.box_number || '').trim();
      r.phone_number = phoneMap.get(`${exchFull}__${cab}__${box}`) || phoneMap.get(`${exchPrefix}__${cab}__${box}`) || '';
    });
    res.render('reports/no_issues_report', {
      title: 'تقرير البوكسات بدون ملاحظات',
      rows, exchanges, cabinets, query: req.query, techName, workerCode,
    });
  } catch (e) {
    console.error('/reports/no-issues-report error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

router.get('/no-issues-report/export', staffOnly, async (req, res) => {
  try {
    const { buildPhoneFirstMap } = require('./service_flow');
    const [rows, phoneMap, khalid] = await Promise.all([
      noIssuesReportRows(req.query),
      buildPhoneFirstMap().catch(() => new Map()),
      db.get(`SELECT full_name, worker_code FROM users WHERE full_name ILIKE '%خالد عبد الرحمن%' LIMIT 1`),
    ]);
    const techName   = (khalid && khalid.full_name)   || 'خالد عبد الرحمن';
    const workerCode = (khalid && khalid.worker_code) || '180769';
    const headers = [
      'الادارة العامة','ادارة تشغيل الشبكة و عمليات العملاء','رقم العامل',
      'الاسم','العمل الفعلى القائم بة','تاريخ الاعمال',
      'exchange code للسنترال الفرعي','نوع البوكس (نحاس- فيبر)',
      'MSAN CODE \\GPON CODE','PASSIVE NO','BOX NO','رقم ارضي',
    ];
    const dataRows = rows.map(r => {
      const _e = String(r.exchange_name || '').split(/\s*-\s*/)[0].trim().toLowerCase();
      const _c = String(r.cabinet_number || '').trim().toLowerCase().replace(/\s*-\s*/g, '-');
      const _k = (_e + '__' + _c + '__' + r.box_number).toLowerCase();
      const phone = phoneMap.get(_k) || '';
      return [
        'أسيوط', 'سنترال الغنايم', workerCode, techName,
        'فنى صيانه بوكسيات',
        r.work_date ? new Date(r.work_date).toISOString().split('T')[0] : '',
        r.exchange_code || '', 'نحاس',
        r.cabinet_code || '', r.cabinet_number, r.box_number, phone,
      ];
    });
    await sendStyledMaintenanceXlsx(res, headers, dataRows, `no_issues_report_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) {
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

// ── تقرير الصيانة ──────────────────────────────────────────────────────────────
const EXCLUDED_ITEMS = `('electricity_conflict','air_conflict','overlap')`;

async function maintenanceReportRows(filters) {
  const { from, to, exchange_id, cabinet_id, box_q } = filters;
  const cwWhere = ['work_date IS NOT NULL'];
  const params = [];
  if (from)        { params.push(from);            cwWhere.push(`work_date >= ?`); }
  if (to)          { params.push(to);               cwWhere.push(`DATE(work_date) <= ?`); }
  if (exchange_id) { params.push(exchange_id);      cwWhere.push(`exchange_id = ?`); }
  if (cabinet_id)  { params.push(cabinet_id);       cwWhere.push(`cabinet_id = ?`); }
  if (box_q)       { params.push(`%${box_q}%`);     cwWhere.push(`box_number ILIKE ?`); }

  return db.all(`
    WITH completed_work AS (
      SELECT
        mt.id          AS task_id,
        b.id           AS box_id,
        b.number       AS box_number,
        c.id           AS cabinet_id,
        c.number       AS cabinet_number,
        e.id           AS exchange_id,
        e.name         AS exchange_name,
        u.full_name    AS tech_name,
        u.worker_code  AS worker_code,
        cc.cabinet_code,
        cc.exchange_code,
        (
          SELECT MAX(mis.done_at)
          FROM maintenance_item_status mis
          JOIN inspection_items ii_sub
            ON ii_sub.inspection_id = i.id AND ii_sub.item_key = mis.item_key
          WHERE mis.task_id = mt.id
            AND mis.is_done = 1
            AND ii_sub.value IN ('bad','yes')
            AND ii_sub.item_key NOT IN ${EXCLUDED_ITEMS}
        ) AS work_date
      FROM maintenance_tasks mt
      JOIN inspections i  ON i.id  = mt.inspection_id
      JOIN boxes b        ON b.id  = i.box_id
      JOIN cabinets c     ON c.id  = b.cabinet_id
      JOIN exchanges e    ON e.id  = c.exchange_id
      JOIN users u        ON u.id  = mt.technician_id
      LEFT JOIN cabinet_codes cc
        ON cc.exchange_name = e.name AND cc.cabinet_number = c.number
      WHERE mt.technician_id IS NOT NULL
        AND (i.is_archived IS NULL OR i.is_archived = 0)
        AND EXISTS (
          SELECT 1 FROM inspection_items ii
          JOIN maintenance_item_status mis2
            ON mis2.task_id = mt.id AND mis2.item_key = ii.item_key AND mis2.is_done = 1
          WHERE ii.inspection_id = i.id
            AND ii.value IN ('bad','yes')
            AND ii.item_key NOT IN ${EXCLUDED_ITEMS}
        )
        AND NOT EXISTS (
          SELECT 1 FROM inspection_items ii2
          WHERE ii2.inspection_id = i.id
            AND ii2.value IN ('bad','yes')
            AND ii2.item_key NOT IN ${EXCLUDED_ITEMS}
            AND NOT EXISTS (
              SELECT 1 FROM maintenance_item_status mis3
              WHERE mis3.task_id = mt.id
                AND mis3.item_key = ii2.item_key
                AND mis3.is_done = 1
            )
        )
    )
    SELECT * FROM completed_work
    WHERE ${cwWhere.join(' AND ')}
    ORDER BY work_date DESC, exchange_name,
             CASE WHEN cabinet_number ~ '^[0-9\\-]+$' THEN cabinet_number ELSE cabinet_number END,
             CASE WHEN box_number ~ '^[0-9]+$' THEN box_number::INTEGER ELSE 0 END, box_number
  `, params);
}

router.get('/maintenance-report', staffOnly, async (req, res) => {
  try {
    const { buildPhoneFirstMap } = require('./service_flow');
    const { exchange_id } = req.query;
    const [exchanges, cabinets, rows, phoneMap] = await Promise.all([
      db.all('SELECT id, name FROM exchanges ORDER BY name'),
      exchange_id ? db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : Promise.resolve([]),
      maintenanceReportRows(req.query),
      buildPhoneFirstMap().catch(() => new Map()),
    ]);
    // Attach first phone number to each row — try full name then prefix-only
    rows.forEach(r => {
      const exchFull   = String(r.exchange_name || '').trim().toLowerCase().replace(/\s*-\s*/g, '-');
      const exchPrefix = exchFull.split('-')[0].trim();
      const cab = String(r.cabinet_number || '').trim().toLowerCase().replace(/\s*-\s*/g, '-');
      const box = String(r.box_number || '').trim();
      // Try exact exchange name first, then prefix match
      r.phone_number =
        phoneMap.get(`${exchFull}__${cab}__${box}`) ||
        phoneMap.get(`${exchPrefix}__${cab}__${box}`) ||
        '';
      if (r.phone_number)
        console.log(`[phone match] ${exchFull} | ${cab} | ${box} → ${r.phone_number}`);
    });
    res.render('reports/maintenance_report', {
      title: 'تقرير الصيانة',
      rows, exchanges, cabinets, query: req.query,
    });
  } catch (e) {
    console.error('/reports/maintenance-report error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

router.get('/maintenance-report/export', staffOnly, async (req, res) => {
  try {
    const { buildPhoneFirstMap } = require('./service_flow');
    const [rows, phoneMap] = await Promise.all([
      maintenanceReportRows(req.query),
      buildPhoneFirstMap().catch(() => new Map()),
    ]);
    const headers = [
      'الادارة العامة','ادارة تشغيل الشبكة و عمليات العملاء','رقم العامل',
      'الاسم','العمل الفعلى القائم بة','تاريخ الاعمال',
      'exchange code للسنترال الفرعي','نوع البوكس (نحاس- فيبر)',
      'MSAN CODE \\GPON CODE','PASSIVE NO','BOX NO','رقم ارضي',
    ];
    const dataRows = rows.map(r => {
      const _e = String(r.exchange_name || '').split(/\s*-\s*/)[0].trim().toLowerCase();
      const _c = String(r.cabinet_number || '').trim().toLowerCase().replace(/\s*-\s*/g, '-');
      const _k = (_e + '__' + _c + '__' + r.box_number).toLowerCase();
      const phone = phoneMap.get(_k) || '';
      return [
        'أسيوط',
        'سنترال الغنايم',
        r.worker_code || '',
        r.tech_name,
        'فنى صيانه بوكسيات',
        r.work_date ? new Date(r.work_date).toISOString().split('T')[0] : '',
        r.exchange_code || '',
        'نحاس',
        r.cabinet_code || '',
        r.cabinet_number,
        r.box_number,
        phone,
      ];
    });
    await sendStyledMaintenanceXlsx(res, headers, dataRows, `maintenance_report_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) {
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

// ── تقرير التأكيد المبدئى (شئون خارجية) ──────────────────────────────────────────
async function prelimConfirmationRows(filters) {
  const { from, to, exchange_id, cabinet_id, box_q } = filters;
  const cwWhere = ['work_date IS NOT NULL'];
  const params = [];
  if (from)        { params.push(from);            cwWhere.push(`work_date >= ?`); }
  if (to)          { params.push(to);               cwWhere.push(`DATE(work_date) <= ?`); }
  if (exchange_id) { params.push(exchange_id);      cwWhere.push(`exchange_id = ?`); }
  if (cabinet_id)  { params.push(cabinet_id);       cwWhere.push(`cabinet_id = ?`); }
  if (box_q)       { params.push(`%${box_q}%`);     cwWhere.push(`box_number ILIKE ?`); }

  return db.all(`
    WITH prelim_work AS (
      SELECT
        mt.id          AS task_id,
        b.id           AS box_id,
        b.number       AS box_number,
        c.id           AS cabinet_id,
        c.number       AS cabinet_number,
        e.id           AS exchange_id,
        e.name         AS exchange_name,
        u.full_name    AS tech_name,
        u.worker_code  AS worker_code,
        cc.cabinet_code,
        cc.exchange_code,
        mt.prelim_confirmed_at AS prelim_date,
        (
          SELECT MAX(mis.done_at)
          FROM maintenance_item_status mis
          JOIN inspection_items ii_sub
            ON ii_sub.inspection_id = i.id AND ii_sub.item_key = mis.item_key
          WHERE mis.task_id = mt.id
            AND mis.is_done = 1
            AND ii_sub.value IN ('bad','yes')
            AND ii_sub.item_key NOT IN ${EXCLUDED_ITEMS}
        ) AS work_date
      FROM maintenance_tasks mt
      JOIN inspections i  ON i.id  = mt.inspection_id
      JOIN boxes b        ON b.id  = i.box_id
      JOIN cabinets c     ON c.id  = b.cabinet_id
      JOIN exchanges e    ON e.id  = c.exchange_id
      JOIN users u        ON u.id  = mt.technician_id
      LEFT JOIN cabinet_codes cc
        ON cc.exchange_name = e.name AND cc.cabinet_number = c.number
      WHERE mt.technician_id IS NOT NULL
        AND mt.prelim_confirmed_at IS NOT NULL
        AND (i.is_archived IS NULL OR i.is_archived = 0)
    )
    SELECT * FROM prelim_work
    WHERE ${cwWhere.join(' AND ')}
    ORDER BY prelim_date DESC, exchange_name,
             CASE WHEN cabinet_number ~ '^[0-9\\-]+$' THEN cabinet_number ELSE cabinet_number END,
             CASE WHEN box_number ~ '^[0-9]+$' THEN box_number::INTEGER ELSE 0 END, box_number
  `, params);
}

router.get('/prelim-confirmation', staffOnly, async (req, res) => {
  try {
    const { buildPhoneFirstMap } = require('./service_flow');
    const { exchange_id } = req.query;
    const [exchanges, cabinets, rows, phoneMap] = await Promise.all([
      db.all('SELECT id, name FROM exchanges ORDER BY name'),
      exchange_id ? db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : Promise.resolve([]),
      prelimConfirmationRows(req.query),
      buildPhoneFirstMap().catch(() => new Map()),
    ]);
    rows.forEach(r => {
      const exchFull   = String(r.exchange_name || '').trim().toLowerCase().replace(/\s*-\s*/g, '-');
      const exchPrefix = exchFull.split('-')[0].trim();
      const cab = String(r.cabinet_number || '').trim().toLowerCase().replace(/\s*-\s*/g, '-');
      const box = String(r.box_number || '').trim();
      r.phone_number =
        phoneMap.get(`${exchFull}__${cab}__${box}`) ||
        phoneMap.get(`${exchPrefix}__${cab}__${box}`) ||
        '';
    });
    res.render('reports/prelim_confirmation', {
      title: 'تقرير التأكيد المبدئى',
      rows, exchanges, cabinets, query: req.query,
    });
  } catch (e) {
    console.error('/reports/prelim-confirmation error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

router.get('/prelim-confirmation/export', staffOnly, async (req, res) => {
  try {
    const { buildPhoneFirstMap } = require('./service_flow');
    const [rows, phoneMap] = await Promise.all([
      prelimConfirmationRows(req.query),
      buildPhoneFirstMap().catch(() => new Map()),
    ]);
    // Same columns as the maintenance report — preliminary date is NOT included in Excel.
    const headers = [
      'الادارة العامة','ادارة تشغيل الشبكة و عمليات العملاء','رقم العامل',
      'الاسم','العمل الفعلى القائم بة','تاريخ الاعمال',
      'exchange code للسنترال الفرعي','نوع البوكس (نحاس- فيبر)',
      'MSAN CODE \\GPON CODE','PASSIVE NO','BOX NO','رقم ارضي',
    ];
    const dataRows = rows.map(r => {
      const _e = String(r.exchange_name || '').split(/\s*-\s*/)[0].trim().toLowerCase();
      const _c = String(r.cabinet_number || '').trim().toLowerCase().replace(/\s*-\s*/g, '-');
      const _k = (_e + '__' + _c + '__' + r.box_number).toLowerCase();
      const phone = phoneMap.get(_k) || r.phone_number || '';
      return [
        'أسيوط',
        'سنترال الغنايم',
        r.worker_code || '',
        r.tech_name,
        'فنى صيانه بوكسيات',
        r.work_date ? new Date(r.work_date).toISOString().split('T')[0] : '',
        r.exchange_code || '',
        'نحاس',
        r.cabinet_code || '',
        r.cabinet_number,
        r.box_number,
        phone,
      ];
    });
    await sendStyledMaintenanceXlsx(res, headers, dataRows, `prelim_confirmation_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) {
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

// ── أكواد الكباين ────────────────────────────────────────────────────────────
router.get('/cabinet-codes', staffOnly, async (req, res) => {
  const { exchange, q } = req.query;
  const cond = [];
  const params = [];
  if (exchange) { params.push(exchange); cond.push(`exchange_name = ?`); }
  if (q) {
    params.push(`%${q}%`);
    cond.push(`(cabinet_number ILIKE ? OR cabinet_code ILIKE ? OR area_technician ILIKE ? OR exchange_code ILIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const [rows, exchanges] = await Promise.all([
    db.all(`SELECT * FROM cabinet_codes ${where} ORDER BY exchange_name, cabinet_number`, params),
    db.all(`SELECT DISTINCT exchange_name FROM cabinet_codes ORDER BY exchange_name`),
  ]);
  res.render('reports/cabinet_codes', {
    title: 'أكواد الكباين',
    rows, exchanges, query: req.query,
  });
});

router.get('/cabinet-codes/export', staffOnly, async (req, res) => {
  const rows = await db.all(`SELECT * FROM cabinet_codes ORDER BY exchange_name, cabinet_number`);
  const data = [
    ['اسم السنترال','رقم الكابينة','كود السنترال','حياة كريمة','فنى المنطقه','كود العامل','كود الكابينه'],
    ...rows.map(r => [r.exchange_name, r.cabinet_number, r.exchange_code, r.decent_life, r.area_technician, r.worker_code, r.cabinet_code]),
  ];
  sendXlsx(res, data, `cabinet_codes_${new Date().toISOString().split('T')[0]}.xlsx`);
});

// ── بيان التليفونات (live from service-flow) ──────────────────────────────────
router.get('/phone-report', staffOnly, async (req, res) => {
  const { fetchPhonePage } = require('./service_flow');
  const { q, exchange_id, cabinet_id, box, page = '1' } = req.query;
  let rows = [], columns = [], error = null, totalPages = 1, totalCount = 0;
  const [exchanges, cabinets] = await Promise.all([
    db.all('SELECT id, name FROM exchanges ORDER BY name'),
    exchange_id ? db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id]) : Promise.resolve([]),
  ]);
  const exchange = exchange_id ? ((exchanges.find(e => e.id == exchange_id) || {}).name || null) : null;
  const cabinet  = cabinet_id  ? ((cabinets.find(c => c.id == cabinet_id)   || {}).number || null) : null;
  try {
    const data = await fetchPhonePage({ q, exchange, cabinet, box, page });
    if (data.ok && Array.isArray(data.data)) {
      rows = data.data;
      if (rows.length) columns = Object.keys(rows[0]);
      if (data.total && data.limit) {
        totalPages = Math.ceil(data.total / data.limit);
        totalCount = data.total;
      }
    } else {
      error = data.error || 'خطأ في الاستجابة من service-flow';
    }
  } catch (e) { error = e.message; }
  res.render('reports/phone_report', {
    title: 'بيان التليفونات',
    rows, columns, error, query: req.query,
    currentPage: parseInt(page), totalPages, totalCount,
    exchanges, cabinets,
  });
});

router.get('/phone-report/export', staffOnly, async (req, res) => {
  const { fetchPhonePage } = require('./service_flow');
  const { q, exchange_id, cabinet_id, box } = req.query;
  try {
    const [exRows, cabRows] = await Promise.all([
      exchange_id ? db.all('SELECT name FROM exchanges WHERE id = ?', [exchange_id]) : Promise.resolve([]),
      cabinet_id  ? db.all('SELECT number FROM cabinets WHERE id = ?',  [cabinet_id])  : Promise.resolve([]),
    ]);
    const exchange = exchange_id ? (exRows[0] || {}).name   || null : null;
    const cabinet  = cabinet_id  ? (cabRows[0] || {}).number || null : null;
    let allRows = [];
    const first = await fetchPhonePage({ q, exchange, cabinet, box, page: '1' });
    if (!first.ok || !Array.isArray(first.data)) throw new Error(first.error || 'فشل جلب البيانات');
    allRows = allRows.concat(first.data);
    if (first.total && first.limit) {
      const maxPages = Math.min(Math.ceil(first.total / first.limit), 200);
      if (maxPages > 1) {
        const rest = await Promise.allSettled(
          Array.from({ length: maxPages - 1 }, (_, i) =>
            fetchPhonePage({ q, exchange, cabinet, box, page: String(i + 2) })
          )
        );
        rest.forEach(r => {
          if (r.status === 'fulfilled' && r.value.ok && Array.isArray(r.value.data))
            allRows = allRows.concat(r.value.data);
        });
      }
    }
    const cols = allRows.length ? Object.keys(allRows[0]) : [];
    const data = [cols, ...allRows.map(row => cols.map(c => row[c] !== null && row[c] !== undefined ? row[c] : ''))];
    sendXlsx(res, data, `phone_report_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (e) {
    res.status(500).render('error', { title: 'خطأ', message: e.message });
  }
});

module.exports = router;
module.exports.overlapDistanceRows = overlapDistanceRows;
module.exports.overlapSummary = overlapSummary;
