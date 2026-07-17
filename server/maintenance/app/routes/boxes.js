const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const db = require('../database');
const DATA_DIR = require('../utils/datadir');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();
const adminOnly = requireRole('admin');

async function cascadeDeleteBox(boxId) {
  const photos = await db.all('SELECT filename FROM photos WHERE box_id = ?', [boxId]);
  await db.transaction(async (q) => {
    await q(`DELETE FROM maintenance_item_status WHERE task_id IN (
      SELECT id FROM maintenance_tasks WHERE inspection_id IN (
        SELECT id FROM inspections WHERE box_id = $1))`, [boxId]);
    await q(`DELETE FROM maintenance_tasks WHERE inspection_id IN (
      SELECT id FROM inspections WHERE box_id = $1)`, [boxId]);
    await q(`DELETE FROM inspection_items WHERE inspection_id IN (
      SELECT id FROM inspections WHERE box_id = $1)`, [boxId]);
    await q('DELETE FROM inspections WHERE box_id = $1', [boxId]);
    await q('DELETE FROM photos WHERE box_id = $1', [boxId]);
    await q('DELETE FROM boxes WHERE id = $1', [boxId]);
  });
  const uploadsDir = path.join(DATA_DIR, 'uploads');
  photos.forEach(p => { try { fs.unlinkSync(path.join(uploadsDir, p.filename)); } catch {} });
}

const CHECKLIST = [
  { key: 'connector_fix',        label: 'تثبيت الخوصة',          type: 'good_bad' },
  { key: 'box_fix',              label: 'تثبيت البوكس',           type: 'good_bad' },
  { key: 'box_cover',            label: 'غطاء البوكس',            type: 'good_bad' },
  { key: 'box_numbering',        label: 'ترقيم البوكس',           type: 'good_bad' },
  { key: 'box_height',           label: 'ارتفاع البوكس',          type: 'good_bad' },
  { key: 'branch_path',          label: 'الفرعات على الترمنال',   type: 'good_bad' },
  { key: 'wire_path',            label: 'مسار السلك',             type: 'good_bad' },
  { key: 'electricity_conflict', label: 'تعارض كهرباء',           type: 'yes_no'   },
  { key: 'air_conflict',         label: 'تعارض هواء',             type: 'yes_no'   },
  { key: 'overlap',              label: 'تخاطي',                  type: 'yes_no'   },
];

// ── Exchanges ─────────────────────────────────────────────────────────────────

router.get('/exchanges', requireRole('admin', 'inspector'), async (req, res) => {
  const exchanges = await db.all(`
    SELECT e.*, COUNT(DISTINCT c.id) as cabinet_count,
           COUNT(DISTINCT b.id) as box_count
    FROM exchanges e
    LEFT JOIN cabinets c ON c.exchange_id = e.id
    LEFT JOIN boxes b ON b.cabinet_id = c.id
    GROUP BY e.id ORDER BY e.name
  `);
  res.render('boxes/exchange_list', { title: 'السنترالات', exchanges });
});

router.get('/exchanges/create', adminOnly, (req, res) => {
  res.render('boxes/exchange_form', { title: 'إضافة سنترال', exchange: null, errors: [] });
});

router.post('/exchanges/create', adminOnly, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.render('boxes/exchange_form', { title: 'إضافة سنترال', exchange: req.body, errors: ['اسم السنترال مطلوب.'] });
  try {
    await db.run('INSERT INTO exchanges (name) VALUES (?)', [name.trim()]);
    req.session.flash = { type: 'success', msg: 'تم إضافة السنترال.' };
  } catch {
    return res.render('boxes/exchange_form', { title: 'إضافة سنترال', exchange: req.body, errors: ['السنترال موجود بالفعل.'] });
  }
  res.redirect('/boxes/exchanges');
});

router.post('/exchanges/:id/delete', adminOnly, async (req, res) => {
  try {
    const cabinets = await db.all('SELECT id FROM cabinets WHERE exchange_id = ?', [req.params.id]);
    for (const c of cabinets) {
      const boxes = await db.all('SELECT id FROM boxes WHERE cabinet_id = ?', [c.id]);
      for (const b of boxes) await cascadeDeleteBox(b.id);
      await db.run('DELETE FROM cabinets WHERE id = ?', [c.id]);
    }
    await db.run('DELETE FROM exchanges WHERE id = ?', [req.params.id]);
    req.session.flash = { type: 'success', msg: 'تم حذف السنترال وجميع بياناته.' };
  } catch (e) {
    req.session.flash = { type: 'danger', msg: 'فشل الحذف: ' + e.message };
  }
  res.redirect('/boxes/exchanges');
});

// ── Cabinets ──────────────────────────────────────────────────────────────────

router.get('/exchanges/:eid/cabinets', requireRole('admin', 'inspector'), async (req, res) => {
  const exchange = await db.get('SELECT * FROM exchanges WHERE id = ?', [req.params.eid]);
  if (!exchange) return res.redirect('/boxes/exchanges');
  const cabinets = await db.all(`
    SELECT c.*, COUNT(b.id) as box_count FROM cabinets c
    LEFT JOIN boxes b ON b.cabinet_id = c.id
    WHERE c.exchange_id = ? GROUP BY c.id ORDER BY c.number
  `, [req.params.eid]);
  res.render('boxes/cabinet_list', { title: `كباين: ${exchange.name}`, exchange, cabinets });
});

router.post('/exchanges/:eid/cabinets/create', adminOnly, async (req, res) => {
  const { number } = req.body;
  if (!number || !number.trim()) { req.session.flash = { type: 'danger', msg: 'رقم الكابينة مطلوب.' }; return res.redirect(`/boxes/exchanges/${req.params.eid}/cabinets`); }
  try {
    await db.run('INSERT INTO cabinets (exchange_id, number) VALUES (?, ?)', [req.params.eid, number.trim()]);
    req.session.flash = { type: 'success', msg: 'تم إضافة الكابينة.' };
  } catch {
    req.session.flash = { type: 'danger', msg: 'الكابينة موجودة بالفعل.' };
  }
  res.redirect(`/boxes/exchanges/${req.params.eid}/cabinets`);
});

router.post('/cabinets/:id/delete', adminOnly, async (req, res) => {
  const cab = await db.get('SELECT exchange_id FROM cabinets WHERE id = ?', [req.params.id]);
  try {
    const boxes = await db.all('SELECT id FROM boxes WHERE cabinet_id = ?', [req.params.id]);
    for (const b of boxes) await cascadeDeleteBox(b.id);
    await db.run('DELETE FROM cabinets WHERE id = ?', [req.params.id]);
    req.session.flash = { type: 'success', msg: 'تم حذف الكابينة وجميع بياناتها.' };
  } catch (e) {
    req.session.flash = { type: 'danger', msg: 'فشل الحذف: ' + e.message };
  }
  res.redirect(`/boxes/exchanges/${cab ? cab.exchange_id : ''}/cabinets`);
});

// ── Boxes ─────────────────────────────────────────────────────────────────────

router.get('/', requireLogin, async (req, res) => {
  const { status, exchange_id, cabinet_id, search } = req.query;
  const user = req.session.user;

  let sql = `
    SELECT b.*, c.number as cabinet_number, e.name as exchange_name
    FROM boxes b
    JOIN cabinets c ON c.id = b.cabinet_id
    JOIN exchanges e ON e.id = c.exchange_id
    WHERE 1=1
  `;
  const params = [];

  if (user.role === 'technician') {
    sql += ` AND b.status IN ('needs_maintenance','in_progress','completed')`;
  } else {
    if (status) { sql += ` AND b.status = ?`; params.push(status); }
    if (exchange_id) { sql += ` AND e.id = ?`; params.push(exchange_id); }
    if (cabinet_id) { sql += ` AND b.cabinet_id = ?`; params.push(cabinet_id); }
    if (search) { sql += ` AND (b.number LIKE ? OR c.number LIKE ? OR e.name LIKE ?)`; const s = `%${search}%`; params.push(s, s, s); }
  }
  sql += " ORDER BY e.name, c.number, CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number";

  const boxes = await db.all(sql, params);
  const exchanges = await db.all('SELECT * FROM exchanges ORDER BY name');
  const cabinets = exchange_id
    ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id])
    : [];
  const statusCounts = await db.all(`SELECT status, COUNT(*) as c FROM boxes GROUP BY status`);
  const counts = {};
  statusCounts.forEach(r => { counts[r.status] = parseInt(r.c); });

  res.render('boxes/list', { title: 'البوكسات', boxes, exchanges, cabinets, counts, query: req.query });
});

router.get('/cabinets/:cid/create', requireRole('admin', 'inspector'), async (req, res) => {
  const cabinet = await db.get('SELECT c.*, e.name as exchange_name FROM cabinets c JOIN exchanges e ON e.id = c.exchange_id WHERE c.id = ?', [req.params.cid]);
  if (!cabinet) return res.redirect('/boxes/exchanges');
  res.render('boxes/box_form', { title: 'إضافة بوكس', cabinet, errors: [], inputNumber: req.query.number || '' });
});

router.post('/cabinets/:cid/create', requireRole('admin', 'inspector'), async (req, res) => {
  const { number } = req.body;
  if (!number || !number.trim()) {
    req.session.flash = { type: 'danger', msg: 'رقم البوكس مطلوب.' };
    return res.redirect(`/boxes/cabinets/${req.params.cid}/create`);
  }
  const existing = await db.get('SELECT id FROM boxes WHERE cabinet_id = ? AND number = ?', [req.params.cid, number.trim()]);
  if (existing) {
    req.session.flash = { type: 'danger', msg: `البوكس رقم ${number.trim()} موجود بالفعل في هذه الكابينة.` };
    return res.redirect(`/boxes/cabinets/${req.params.cid}/create?number=${encodeURIComponent(number.trim())}`);
  }
  try {
    await db.run('INSERT INTO boxes (cabinet_id, number) VALUES (?, ?)', [req.params.cid, number.trim()]);
    req.session.flash = { type: 'success', msg: `تم إضافة البوكس رقم ${number.trim()} بنجاح.` };
  } catch (e) {
    req.session.flash = { type: 'danger', msg: 'فشل إضافة البوكس: ' + e.message };
    return res.redirect(`/boxes/cabinets/${req.params.cid}/create?number=${encodeURIComponent(number.trim())}`);
  }
  const cab = await db.get('SELECT exchange_id FROM cabinets WHERE id = ?', [req.params.cid]);
  res.redirect(`/boxes/exchanges/${cab.exchange_id}/cabinets`);
});

router.get('/:id', requireLogin, async (req, res) => {
  const box = await db.get(`
    SELECT b.*, c.number as cabinet_number, e.name as exchange_name, e.id as exchange_id
    FROM boxes b JOIN cabinets c ON c.id = b.cabinet_id JOIN exchanges e ON e.id = c.exchange_id
    WHERE b.id = ?
  `, [req.params.id]);
  if (!box) return res.redirect('/boxes');

  const inspection = await db.get(`
    SELECT i.*, u.full_name as inspector_name FROM inspections i
    JOIN users u ON u.id = i.inspector_id
    WHERE i.box_id = ? ORDER BY i.id DESC LIMIT 1
  `, [req.params.id]);

  const archivedInspections = await db.all(`
    SELECT i.*, u.full_name as inspector_name FROM inspections i
    JOIN users u ON u.id = i.inspector_id
    WHERE i.box_id = ? AND i.id != (SELECT COALESCE(MAX(id),0) FROM inspections WHERE box_id = ?)
    ORDER BY i.id ASC
  `, [req.params.id, req.params.id]);

  const items = inspection ? await db.all('SELECT * FROM inspection_items WHERE inspection_id = ?', [inspection.id]) : [];
  const photos = await db.all('SELECT p.id, p.box_id, p.inspection_id, p.photo_type, p.filename, p.uploaded_by, p.taken_at, p.latitude, p.longitude, p.uploaded_at, u.full_name as uploader FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by WHERE p.box_id = ? ORDER BY p.uploaded_at', [req.params.id]);
  const task = inspection ? await db.get(`SELECT mt.*, u.full_name as tech_name FROM maintenance_tasks mt LEFT JOIN users u ON u.id = mt.technician_id WHERE mt.inspection_id = ?`, [inspection.id]) : null;

  const itemStatusMap = {};
  if (task) {
    const statuses = await db.all('SELECT * FROM maintenance_item_status WHERE task_id = ?', [task.id]);
    statuses.forEach(s => { itemStatusMap[s.item_key] = s; });
  }

  // Preliminary-confirmation eligibility: every relevant note (bad/yes) outside the
  // excluded set (تعارض الكهرباء/الهواء + التخاطى) has been fixed by the technician.
  const PRELIM_EXCLUDED = ['electricity_conflict', 'air_conflict', 'overlap'];
  const relevant = items.filter(it =>
    ['bad', 'yes'].includes(it.value) && !PRELIM_EXCLUDED.includes(it.item_key));
  const prelimReady = !!task && relevant.length > 0 &&
    relevant.every(it => itemStatusMap[it.item_key] && itemStatusMap[it.item_key].is_done);

  res.render('boxes/detail', { title: `بوكس ${box.number}`, box, inspection, archivedInspections, items, checklist: CHECKLIST, itemStatusMap, photos, task, prelimReady, query: req.query });
});

router.post('/:id/delete', adminOnly, async (req, res) => {
  try {
    await cascadeDeleteBox(req.params.id);
    req.session.flash = { type: 'success', msg: 'تم حذف البوكس وجميع بياناته.' };
  } catch (e) {
    req.session.flash = { type: 'danger', msg: 'فشل الحذف: ' + e.message };
  }
  res.redirect('/boxes');
});

router.get('/:id/photos/download', requireLogin, async (req, res) => {
  const box = await db.get(`
    SELECT b.*, c.number as cabinet_number, e.name as exchange_name
    FROM boxes b JOIN cabinets c ON c.id = b.cabinet_id JOIN exchanges e ON e.id = c.exchange_id
    WHERE b.id = ?`, [req.params.id]);
  if (!box) return res.redirect('/boxes');

  const beforePhotos = await db.all(`SELECT id, filename, data FROM photos WHERE box_id = ? AND photo_type = 'before' ORDER BY uploaded_at`, [req.params.id]);
  const afterPhotos  = await db.all(`SELECT id, filename, data FROM photos WHERE box_id = ? AND photo_type = 'after'  ORDER BY uploaded_at`, [req.params.id]);

  if (!beforePhotos.length && !afterPhotos.length) {
    req.session.flash = { type: 'warning', msg: 'لا توجد صور لهذا البوكس.' };
    return res.redirect(`/boxes/${req.params.id}`);
  }

  const rootFolder = `${box.exchange_name} - كابينة ${box.cabinet_number} - بوكس ${box.number}`;
  const uploadsDir = path.join(DATA_DIR, 'uploads');

  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`box_${box.number}.zip`)}`);
  res.setHeader('Content-Type', 'application/zip');

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', err => { if (!res.headersSent) res.status(500).send(err.message); });
  archive.pipe(res);

  function appendPhoto(p, idx, folderName) {
    const name = `${rootFolder}/${folderName}/${idx + 1}${path.extname(p.filename) || '.jpg'}`;
    const filePath = path.join(uploadsDir, p.filename);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name });
    } else if (p.data) {
      archive.append(p.data, { name });
    }
  }
  beforePhotos.forEach((p, idx) => appendPhoto(p, idx, 'قبل الصيانة'));
  afterPhotos.forEach((p, idx) => appendPhoto(p, idx, 'بعد الصيانة'));
  archive.finalize();
});

router.post('/:id/location', requireRole('admin', 'inspector'), async (req, res) => {
  const { lat, lng } = req.body;
  if (!lat || !lng) return res.status(400).json({ ok: false, msg: 'لا توجد إحداثيات.' });
  const box = await db.get('SELECT id FROM boxes WHERE id = ?', [req.params.id]);
  if (!box) return res.status(404).json({ ok: false, msg: 'البوكس غير موجود.' });
  try {
    await db.run('UPDATE boxes SET latitude=?, longitude=? WHERE id=?', [parseFloat(lat), parseFloat(lng), req.params.id]);
    res.json({ ok: true, lat: parseFloat(lat), lng: parseFloat(lng) });
  } catch (e) {
    res.status(500).json({ ok: false, msg: 'فشل حفظ الموقع: ' + e.message });
  }
});

router.post('/photos/:photoId/location', requireLogin, async (req, res) => {
  const { lat, lng } = req.body;
  if (!lat || !lng) return res.status(400).json({ ok: false, msg: 'لا توجد إحداثيات.' });
  const photo = await db.get('SELECT id FROM photos WHERE id = ?', [req.params.photoId]);
  if (!photo) return res.status(404).json({ ok: false, msg: 'الصورة غير موجودة.' });
  await db.run('UPDATE photos SET latitude=?, longitude=? WHERE id=?', [parseFloat(lat), parseFloat(lng), req.params.photoId]);
  res.json({ ok: true, lat: parseFloat(lat), lng: parseFloat(lng) });
});

module.exports = router;
