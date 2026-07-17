// ── Public JSON API for external integrations (Service-Flow) ──────────────────
// Server-to-server, no session. Auth via static token in the X-API-Token header.
const express = require('express');
const db = require('../database');

const router = express.Router();

// Static token — override in Replit Secrets as COMPREHENSIVE_API_TOKEN
const API_TOKEN = process.env.COMPREHENSIVE_API_TOKEN || 'sf-comprehensive-2026-GHNAT-7Kx9';

// Same checklist as the comprehensive report
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

// Maintenance status → Arabic label
const STATUS_LABELS = {
  pending:          'بانتظار الصيانة',
  in_progress:      'قيد الصيانة',
  pending_approval: 'بانتظار الاعتماد',
  completed:        'مكتمل',
};

// CORS — allow Service-Flow (or any origin) to call server-to-server / from browser
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.SERVICE_FLOW_ORIGIN || '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'X-API-Token, Content-Type, Authorization');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Token check
router.use((req, res, next) => {
  const token = req.get('X-API-Token')
    || (req.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    || req.query.token;
  if (token !== API_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized — invalid or missing X-API-Token' });
  }
  next();
});

// GET /api/reports/comprehensive
// Filters: central, cabin, box, dateFrom, dateTo | Pagination: page, limit
router.get('/reports/comprehensive', async (req, res) => {
  try {
    const { central, cabin, box, dateFrom, dateTo } = req.query;
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));

    let sql = `
      SELECT i.id AS insp_id, i.date, i.general_notes,
             i.latitude AS insp_lat, i.longitude AS insp_lng,
             b.id AS box_id, b.number AS box_number,
             b.latitude AS box_lat, b.longitude AS box_lng, b.status AS box_status,
             c.number AS cabinet_number,
             e.name AS exchange_name,
             u.full_name AS inspector_name,
             mt.id AS task_id, mt.status AS task_status, mt.notes AS task_notes,
             mt.prelim_confirmed_at,
             ut.full_name AS tech_name
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
    if (central)  { sql += ' AND e.name ILIKE ?'; params.push(`%${central}%`); }
    if (cabin)    { sql += ` AND REPLACE(c.number,' ','') = REPLACE(?,' ','')`; params.push(cabin); }
    if (box)      { sql += ' AND b.number = ?'; params.push(box); }
    if (dateFrom) { sql += ' AND i.date >= ?'; params.push(dateFrom); }
    if (dateTo)   { sql += ' AND i.date <= ?'; params.push(dateTo); }
    sql += ' ORDER BY i.date DESC, e.name, c.number, b.number';

    const allRows = await db.all(sql, params);
    const total = allRows.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const rows = allRows.slice((page - 1) * limit, (page - 1) * limit + limit);

    // Bulk-fetch inspection items + completed maintenance items for this page
    const inspItems = {};
    const taskItems = {};
    if (rows.length) {
      const inspIds = rows.map(r => r.insp_id);
      const taskIds = rows.filter(r => r.task_id).map(r => r.task_id);
      const allItems = await db.all('SELECT * FROM inspection_items WHERE inspection_id = ANY(?)', [inspIds]);
      allItems.forEach(it => {
        (inspItems[it.inspection_id] ||= {})[it.item_key] = it;
      });
      if (taskIds.length) {
        const allTaskItems = await db.all(
          'SELECT mis.*, mt.inspection_id FROM maintenance_item_status mis JOIN maintenance_tasks mt ON mt.id = mis.task_id WHERE mis.task_id = ANY(?)',
          [taskIds]
        );
        allTaskItems.forEach(it => {
          (taskItems[it.inspection_id] ||= {})[it.item_key] = it;
        });
      }
    }

    const data = rows.map(r => {
      const iItems = inspItems[r.insp_id] || {};
      const tItems = taskItems[r.insp_id] || {};
      const checklist = CHECKLIST.map(ci => {
        const it = iItems[ci.key];
        const value = it ? it.value : null;                 // good|bad|yes|no|null
        const isIssue = value === 'bad' || value === 'yes';
        return {
          key: ci.key,
          label: ci.label,
          type: ci.type,                                    // good_bad | yes_no
          value,
          is_issue: isIssue,
          is_done: !!(tItems[ci.key] && tItems[ci.key].is_done),
          notes: (it && it.notes) || null,
          extra_type: (it && it.extra_type) || null,
          extra_distance: (it && it.extra_distance != null) ? it.extra_distance : null,
        };
      });
      const hasIssues = checklist.some(c => c.is_issue);
      const completedItems = checklist.filter(c => c.is_done).map(c => c.key);
      const lat = (r.insp_lat != null ? r.insp_lat : r.box_lat);
      const lng = (r.insp_lng != null ? r.insp_lng : r.box_lng);

      // work_date = latest done_at among completed maintenance items (no real column)
      let workDate = null;
      Object.values(tItems).forEach(ti => {
        if (ti.is_done && ti.done_at) {
          const d = new Date(ti.done_at);
          if (!workDate || d > workDate) workDate = d;
        }
      });

      return {
        inspection_id: r.insp_id,
        box_id: r.box_id,
        // ── Box key (use these to match) ──
        central: r.exchange_name,                                       // e.g. "الغنايم-دير الجنادله"
        central_prefix: String(r.exchange_name || '').split(/\s*-\s*/)[0].trim(), // e.g. "الغنايم"
        cabin_number: r.cabinet_number,                                 // e.g. "1-1"
        box_number: r.box_number,                                       // e.g. "5" or "sp1"
        // ── Dates / people ──
        inspection_date: r.date ? new Date(r.date).toISOString().split('T')[0] : null,
        work_date: workDate ? workDate.toISOString().split('T')[0] : null,
        inspector_name: r.inspector_name || null,
        technician_name: r.tech_name || null,
        // ── Coordinates ──
        latitude: lat != null ? lat : null,
        longitude: lng != null ? lng : null,
        // ── Maintenance status ──
        maintenance_status: r.task_status || null,                      // null|pending|in_progress|pending_approval|completed
        maintenance_status_ar: r.task_status ? (STATUS_LABELS[r.task_status] || r.task_status) : 'لا توجد ملاحظات — بوكس سليم',
        box_status: r.box_status || null,
        prelim_confirmed: !!r.prelim_confirmed_at,
        // ── Notes ──
        inspection_notes: r.general_notes || null,
        maintenance_notes: r.task_notes || null,
        // ── Checklist results ──
        has_issues: hasIssues,
        checklist,
        completed_items: completedItems,
      };
    });

    res.json({ ok: true, total, page, limit, totalPages, count: data.length, data });
  } catch (e) {
    console.error('/api/reports/comprehensive error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
