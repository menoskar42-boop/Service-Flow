// ── Public JSON integration API (Service-Flow) ────────────────────────────────
// Server-to-server, no session. Auth via static token in the X-Integration-Token header.
const express = require('express');
const reports = require('./reports');
const db = require('../database');

const router = express.Router();

// Static token — override in Replit Secrets as INTEGRATION_TOKEN
const INTEGRATION_TOKEN = process.env.INTEGRATION_TOKEN || 'sf-integration-2026-GHNAT-overlap-Qz7m';

// Arabic labels (identical to the report page / Excel export)
const ITEM_LABELS = { overlap: 'تخاطي', air_conflict: 'تعارض هواء' };
const BOX_STATUS_AR = {
  pending_inspection: 'بانتظار الفحص',
  inspected: 'تم الفحص',
  needs_maintenance: 'يحتاج صيانة',
  in_progress: 'قيد الصيانة',
  completed: 'مكتمل',
};

// CORS — allow calls from another domain (Service-Flow)
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.SERVICE_FLOW_ORIGIN || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Integration-Token');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Token check
router.use((req, res, next) => {
  const token = req.get('X-Integration-Token');
  if (token !== INTEGRATION_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing X-Integration-Token' });
  }
  next();
});

// GET /api/integration/overlap-distance-pending
// Filters (optional): from, to, box, cabin, central
router.get('/overlap-distance-pending', async (req, res) => {
  try {
    // Map integration query params to the report's internal filter names
    const filters = {
      from: req.query.from,
      to: req.query.to,
      box_q: req.query.box,
      cabinet_id: req.query.cabin,       // internal cabinet id (numeric) if provided
      exchange_id: req.query.central,    // internal exchange id (numeric) if provided
    };

    // completed = false → "لم يتم الإصلاح بعد" (same query used by the page)
    const rows = await reports.overlapDistanceRows(false, filters);

    const data = rows.map(r => ({
      central: r.exchange_name,
      cabin: r.cabinet_number,
      box: r.box_number,
      status: BOX_STATUS_AR[r.box_status] || r.box_status || '',
      item: ITEM_LABELS[r.item_key] || r.item_key,
      cableType: r.extra_type || '',
      distance: r.extra_distance != null ? Number(r.extra_distance) : null,
      observer: r.inspector_name,
      date: r.date ? new Date(r.date).toISOString().split('T')[0] : null,
    }));

    // Same summary cards as the page (totals per type + count of "بكس مناول ١٠ جوز")
    const { totals, counts } = reports.overlapSummary(rows);
    const totalDistance = Object.values(totals).reduce((a, b) => a + b, 0);
    const summary = {
      totalDistance: Math.round(totalDistance),
      handledBoxes10: counts['بكس مناول ١٠ جوز'] || 0,
      totalHandled10: Math.round(totals['بكس مناول ١٠ جوز'] || 0),
      totalAerial10:  Math.round(totals['كابل هوائي ١٠ جوز'] || 0),
      totalAerial6:   Math.round(totals['كابل هوائي ٦ جوز'] || 0),
    };

    res.json({ rows: data, summary });
  } catch (e) {
    console.error('/api/integration/overlap-distance-pending error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/integration/box-data-review ───────────────────────────────────
// بيتنادى من Service-Flow لما فنى يرد «بوكس مليان» (من متعذرات OM أو من الطلبات).
// الخطوات:
//   1. نلاقى البكس (وننشئ السنترال/الكابينة/البكس لو مش موجودين).
//   2. نلاقى فحص **غير مكتمل** للبكس ده. لو موجود → نضيف عليه بند «مراجعة بيانات
//      البكس»؛ لو مش موجود → ننشئ فحص جديد كل بنوده بملاحظات عشان فنى الصيانة
//      يخلّصه بالطريقة المعتادة.
//   3. نسجّل أرقام التليفونات اللى على البكس (الفنى بيعدّلها/يحذفها بعدين).
//   4. نسجّل «تم الفتح بواسطة» = اسم الفنى + جهة الفتح (OM / طلبات).
// idempotent: نداء تانى لنفس البكس بيحدّث نفس الفحص ومابيكرّرش الأرقام.
const CHECKLIST_KEYS = [
  ['connector_fix', 'good_bad'], ['box_fix', 'good_bad'], ['box_cover', 'good_bad'],
  ['box_numbering', 'good_bad'], ['box_height', 'good_bad'], ['branch_path', 'good_bad'],
  ['wire_path', 'good_bad'], ['electricity_conflict', 'yes_no'], ['air_conflict', 'yes_no'],
  ['overlap', 'yes_no'], ['data_review', 'yes_no'],
];
const OPEN_STATUSES = ['pending_inspection', 'inspected', 'needs_maintenance', 'in_progress', 'pending_approval'];

router.post('/box-data-review', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const b = req.body || {};
    const central = String(b.central || '').trim();
    const cabinet = String(b.cabinet || '').trim();
    const box     = String(b.box || '').trim();
    const openedBy = String(b.openedBy || '').trim();     // «اسلام-OM» أو «اسلام-طلبات»
    const origin   = String(b.origin || '').trim();       // OM | طلبات
    const originRef = String(b.originRef || '').trim();
    const phones = Array.isArray(b.phones) ? b.phones : [];
    if (!central || !cabinet || !box) {
      return res.status(400).json({ error: 'central و cabinet و box مطلوبين' });
    }

    // (1) السنترال/الكابينة/البكس — بننشئهم لو مش موجودين
    let ex = await db.get('SELECT id FROM exchanges WHERE name = ?', [central]);
    if (!ex) ex = await db.get('INSERT INTO exchanges (name) VALUES (?) RETURNING id', [central]);
    let cab = await db.get('SELECT id FROM cabinets WHERE exchange_id = ? AND number = ?', [ex.id, cabinet]);
    if (!cab) cab = await db.get('INSERT INTO cabinets (exchange_id, number) VALUES (?, ?) RETURNING id', [ex.id, cabinet]);
    let bx = await db.get('SELECT id, status FROM boxes WHERE cabinet_id = ? AND number = ?', [cab.id, box]);
    if (!bx) bx = await db.get(
      "INSERT INTO boxes (cabinet_id, number, status) VALUES (?, ?, 'pending_inspection') RETURNING id, status", [cab.id, box]);

    // (2) فحص غير مكتمل للبكس ده؟ (مش مؤرشف، والمهمة بتاعته مش completed)
    let insp = await db.get(
      `SELECT i.id FROM inspections i
        WHERE i.box_id = ? AND COALESCE(i.is_archived, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM maintenance_tasks t
                           WHERE t.inspection_id = i.id AND t.status = 'completed')
        ORDER BY i.id DESC LIMIT 1`, [bx.id]);

    let created = false;
    const noteTxt = `مطلوب مراجعة بيانات البكس — ${openedBy || 'Service-Flow'}${originRef ? ' · ' + originRef : ''}`;
    if (!insp) {
      // مفيش فحص → ننشئ واحد كل بنوده بملاحظات، وفنى الصيانة بيخلّصه بالطريقة المعتادة
      const sys = await db.get(
        "SELECT id FROM users WHERE role IN ('admin','inspector') AND COALESCE(is_active,1) = 1 ORDER BY id LIMIT 1");
      if (!sys) return res.status(500).json({ error: 'مافيش مستخدم فاحص/أدمن نربط بيه الفحص' });
      insp = await db.get(
        `INSERT INTO inspections (box_id, inspector_id, general_notes, opened_by_name, origin, origin_ref, auto_created)
         VALUES (?, ?, ?, ?, ?, ?, 1) RETURNING id`,
        [bx.id, sys.id, noteTxt, openedBy || null, origin || null, originRef || null]);
      for (const [key, type] of CHECKLIST_KEYS) {
        // البند المطلوب = «yes» (فيه شغل)، والباقى بيتفتح بقيمة سليمة **ومعاه ملاحظة**
        const isTarget = key === 'data_review';
        const value = isTarget ? 'yes' : (type === 'good_bad' ? 'good' : 'no');
        const notes = isTarget ? noteTxt : `اتفتح تلقائياً مع طلب مراجعة بيانات البكس (${openedBy || 'Service-Flow'})`;
        await db.run(
          `INSERT INTO inspection_items (inspection_id, item_key, item_type, value, notes)
           VALUES (?, ?, ?, ?, ?) ON CONFLICT (inspection_id, item_key) DO NOTHING`,
          [insp.id, key, type, value, notes]);
      }
      created = true;
      if (OPEN_STATUSES.includes(bx.status)) {
        await db.run("UPDATE boxes SET status = 'needs_maintenance', updated_at = now() WHERE id = ?", [bx.id]);
      }
    } else {
      // فيه فحص شغّال → نضيف/نحدّث بند مراجعة البيانات بس
      await db.run(
        `INSERT INTO inspection_items (inspection_id, item_key, item_type, value, notes)
         VALUES (?, 'data_review', 'yes_no', 'yes', ?)
         ON CONFLICT (inspection_id, item_key)
         DO UPDATE SET value = 'yes', notes = EXCLUDED.notes`,
        [insp.id, noteTxt]);
      // ⚠️ الفحص ده عمله فاحص حقيقى — مابنحطّش عليه علامة auto_created ولا بنغيّر
      // origin، وإلا كان هيتشال من تقارير الصيانة بالغلط. مين طلب المراجعة مسجّل
      // فى ملاحظات البند نفسه.
    }

    // بند «مراجعة بيانات البكس» = شغل مطلوب → لازم يبقى فيه **مهمة صيانة** عشان
    // الفنى يشوفها ويعلّم البند إنه اكتمل (نفس منطق الفاحص لما يلاقى بند محتاج شغل).
    const openTask = await db.get(
      "SELECT id FROM maintenance_tasks WHERE inspection_id = ? AND status <> 'completed' ORDER BY id DESC LIMIT 1",
      [insp.id]);
    if (!openTask) {
      await db.run("INSERT INTO maintenance_tasks (inspection_id, status) VALUES (?, 'pending')", [insp.id]);
    }
    if (OPEN_STATUSES.includes(bx.status) && bx.status !== 'in_progress' && bx.status !== 'pending_approval') {
      await db.run("UPDATE boxes SET status = 'needs_maintenance', updated_at = now() WHERE id = ?", [bx.id]);
    }

    // (3) الأرقام اللى على البكس — مابنكرّرش رقم موجود فى نفس الفحص
    let added = 0;
    for (const raw of phones) {
      const phone = String(typeof raw === 'string' ? raw : (raw && raw.phone) || '').trim();
      if (!phone) continue;
      const dup = await db.get('SELECT id FROM box_line_numbers WHERE inspection_id = ? AND phone = ?', [insp.id, phone]);
      if (dup) continue;
      const note = String((raw && raw.notes) || '').trim();
      await db.run(
        "INSERT INTO box_line_numbers (inspection_id, phone, notes, source) VALUES (?, ?, ?, 'service_flow')",
        [insp.id, phone, note]);
      added++;
    }

    res.json({ ok: true, inspectionId: insp.id, boxId: bx.id, created, phonesAdded: added });
  } catch (e) {
    console.error('/api/integration/box-data-review error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
