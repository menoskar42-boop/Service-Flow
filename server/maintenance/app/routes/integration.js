// ── Public JSON integration API (Service-Flow) ────────────────────────────────
// Server-to-server, no session. Auth via static token in the X-Integration-Token header.
const express = require('express');
const reports = require('./reports');

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
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
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

module.exports = router;
