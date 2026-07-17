const express = require('express');
const db = require('../database');
const { requireRole } = require('../middleware/auth');
const { memUpload, compressToBuffer, memVideoUpload, compressVideoToDisk } = require('../utils/photo');

const router = express.Router();

const CHECKLIST_LABELS = {
  connector_fix:        'تثبيت الخوصة',
  box_fix:              'تثبيت البوكس',
  box_cover:            'غطاء البوكس',
  box_numbering:        'ترقيم البوكس',
  box_height:           'ارتفاع البوكس',
  branch_path:          'الفرعات على الترمنال',
  wire_path:            'مسار السلك',
  electricity_conflict: 'تعارض كهرباء',
  air_conflict:         'تعارض هواء',
  overlap:              'تخاطي',
};
const techOrAdmin = requireRole('admin', 'technician');

router.get('/', techOrAdmin, async (req, res) => {
  try {
    const { status, q, exchange_id, cabinet_id, box_q, from, to } = req.query;

    const exchanges = await db.all('SELECT id, name FROM exchanges ORDER BY name');
    const cabinets = exchange_id
      ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id])
      : [];

    let sql = `SELECT mt.*, i.box_id, i.general_notes as inspection_notes,
      b.number as box_number, c.number as cabinet_number, e.name as exchange_name,
      u.full_name as tech_name
      FROM maintenance_tasks mt
      JOIN inspections i ON i.id = mt.inspection_id
      JOIN boxes b ON b.id = i.box_id JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      LEFT JOIN users u ON u.id = mt.technician_id
      WHERE (COALESCE(i.is_archived, 0) = 0 OR mt.status IN ('completed','pending_approval'))`;
    const params = [];
    if (status)      { sql += ' AND mt.status = ?'; params.push(status); }
    if (q)           { const s = `%${q}%`; sql += ' AND (e.name LIKE ? OR c.number LIKE ? OR b.number LIKE ?)'; params.push(s, s, s); }
    if (exchange_id) { sql += ' AND e.id = ?'; params.push(exchange_id); }
    if (cabinet_id)  { sql += ' AND c.id = ?'; params.push(cabinet_id); }
    if (box_q)       { sql += ' AND b.number LIKE ?'; params.push(`%${box_q}%`); }
    if (from)        { sql += ' AND i.date >= ?'; params.push(from); }
    if (to)          { sql += ' AND i.date <= ?'; params.push(to); }
    sql += " ORDER BY e.name, c.number, CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number";

    const tasks = await db.all(sql, params);

    let archivedTasks = [];
    if (!status && !q) {
      archivedTasks = await db.all(`
        SELECT mt.*, i.box_id, i.general_notes as inspection_notes,
          b.number as box_number, c.number as cabinet_number, e.name as exchange_name,
          u.full_name as tech_name
          FROM maintenance_tasks mt
          JOIN inspections i ON i.id = mt.inspection_id
          JOIN boxes b ON b.id = i.box_id JOIN cabinets c ON c.id = b.cabinet_id
          JOIN exchanges e ON e.id = c.exchange_id
          LEFT JOIN users u ON u.id = mt.technician_id
          WHERE COALESCE(i.is_archived, 0) = 1 AND mt.status != 'completed'
          ORDER BY mt.id DESC`);
    }

    res.render('technician/list', { title: 'مهام الصيانة', tasks, archivedTasks, query: req.query, exchanges, cabinets });
  } catch (e) {
    console.error('technician list error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل المهام. حاول مرة أخرى.' });
  }
});

router.get('/:id', techOrAdmin, async (req, res) => {
  try {
    const task = await db.get(`SELECT mt.*, i.box_id, i.general_notes as inspection_notes, i.date as inspection_date,
      i.latitude as insp_latitude, i.longitude as insp_longitude,
      b.number as box_number, b.latitude as box_latitude, b.longitude as box_longitude,
      c.number as cabinet_number, e.name as exchange_name,
      u.full_name as tech_name, ins.full_name as inspector_name
      FROM maintenance_tasks mt
      JOIN inspections i ON i.id = mt.inspection_id
      JOIN boxes b ON b.id = i.box_id JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
      LEFT JOIN users u ON u.id = mt.technician_id
      LEFT JOIN users ins ON ins.id = i.inspector_id
      WHERE mt.id = ?`, [req.params.id]);
    if (!task) return res.redirect('/technician');

    const inspItems = await db.all('SELECT * FROM inspection_items WHERE inspection_id = (SELECT inspection_id FROM maintenance_tasks WHERE id = ?)', [req.params.id]);
    const MEDIA_COLS = 'p.id, p.box_id, p.inspection_id, p.photo_type, p.media_type, p.filename, p.uploaded_by, p.taken_at, p.latitude, p.longitude, p.uploaded_at';
    const beforePhotos = await db.all(
      `SELECT ${MEDIA_COLS}, u.full_name as uploader FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.inspection_id = ? AND p.photo_type = 'before' AND COALESCE(p.media_type,'photo')='photo'`, [task.inspection_id]);
    const afterPhotos = await db.all(
      `SELECT ${MEDIA_COLS}, u.full_name as uploader FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.inspection_id = ? AND p.photo_type = 'after' AND COALESCE(p.media_type,'photo')='photo'`, [task.inspection_id]);
    const beforeVideos = await db.all(
      `SELECT ${MEDIA_COLS}, u.full_name as uploader FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.inspection_id = ? AND p.photo_type = 'before' AND p.media_type='video' ORDER BY p.uploaded_at`, [task.inspection_id]);
    const afterVideos = await db.all(
      `SELECT ${MEDIA_COLS}, u.full_name as uploader FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.inspection_id = ? AND p.photo_type = 'after' AND p.media_type='video' ORDER BY p.uploaded_at`, [task.inspection_id]);
    const itemStatuses = await db.all('SELECT * FROM maintenance_item_status WHERE task_id = ?', [req.params.id]);
    const itemStatusMap = {};
    itemStatuses.forEach(s => { itemStatusMap[s.item_key] = s; });

    res.render('technician/detail', { title: `مهمة صيانة #${req.params.id}`, task, inspItems, beforePhotos, afterPhotos, beforeVideos, afterVideos, CHECKLIST_LABELS, itemStatusMap });
  } catch (e) {
    console.error('technician detail error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل المهمة. حاول مرة أخرى.' });
  }
});

router.post('/:id/items/:itemKey/toggle', techOrAdmin, async (req, res) => {
  try {
    const task = await db.get('SELECT * FROM maintenance_tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.redirect('/technician');

    const existing = await db.get('SELECT * FROM maintenance_item_status WHERE task_id = ? AND item_key = ?', [req.params.id, req.params.itemKey]);
    if (existing) {
      const newDone = existing.is_done ? 0 : 1;
      await db.run("UPDATE maintenance_item_status SET is_done=?, done_at=CASE WHEN ? THEN NOW() ELSE NULL END, done_by=? WHERE id=?",
        [newDone, newDone, req.session.user.id, existing.id]);
    } else {
      await db.run("INSERT INTO maintenance_item_status (task_id, item_key, is_done, done_at, done_by) VALUES (?, ?, 1, NOW(), ?)",
        [req.params.id, req.params.itemKey, req.session.user.id]);
    }
    res.redirect(`/technician/${req.params.id}`);
  } catch (e) {
    console.error('technician toggle error:', e.message);
    req.session.flash = { type: 'danger', msg: 'حدث خطأ. حاول مرة أخرى.' };
    res.redirect(`/technician/${req.params.id}`);
  }
});

router.post('/:id/start', techOrAdmin, async (req, res) => {
  try {
    const task = await db.get('SELECT * FROM maintenance_tasks WHERE id = ?', [req.params.id]);
    if (!task || task.status !== 'pending') {
      req.session.flash = { type: 'danger', msg: 'لا يمكن بدء هذه المهمة.' };
      return res.redirect(`/technician/${req.params.id}`);
    }
    await db.transaction(async (q) => {
      await q("UPDATE maintenance_tasks SET status='in_progress', technician_id=$1, started_at=NOW() WHERE id=$2", [req.session.user.id, req.params.id]);
      await q("UPDATE boxes SET status='in_progress', updated_at=NOW() WHERE id=(SELECT box_id FROM inspections WHERE id=$1)", [task.inspection_id]);
    });
    req.session.flash = { type: 'success', msg: 'تم بدء العمل على المهمة.' };
    res.redirect(`/technician/${req.params.id}`);
  } catch (e) {
    console.error('technician start error:', e.message);
    req.session.flash = { type: 'danger', msg: 'حدث خطأ أثناء بدء المهمة. حاول مرة أخرى.' };
    res.redirect(`/technician/${req.params.id}`);
  }
});

router.post('/:id/notes', techOrAdmin, async (req, res) => {
  try {
    await db.run('UPDATE maintenance_tasks SET notes = ? WHERE id = ?', [req.body.notes || '', req.params.id]);
    req.session.flash = { type: 'success', msg: 'تم حفظ الملاحظات.' };
    res.redirect(`/technician/${req.params.id}`);
  } catch (e) {
    console.error('technician notes error:', e.message);
    req.session.flash = { type: 'danger', msg: 'حدث خطأ أثناء حفظ الملاحظات.' };
    res.redirect(`/technician/${req.params.id}`);
  }
});

router.post('/:id/complete', techOrAdmin, async (req, res) => {
  try {
    const task = await db.get('SELECT * FROM maintenance_tasks WHERE id = ?', [req.params.id]);
    if (!task || task.status === 'completed' || task.status === 'pending_approval') {
      req.session.flash = { type: 'danger', msg: 'لا يمكن إكمال هذه المهمة.' };
      return res.redirect(`/technician/${req.params.id}`);
    }
    const afterRow = await db.get(`SELECT COUNT(*) as c FROM photos WHERE box_id=(SELECT box_id FROM inspections WHERE id=?) AND photo_type='after'`, [task.inspection_id]);
    if (parseInt(afterRow.c) === 0) {
      req.session.flash = { type: 'danger', msg: 'يجب رفع صورة أو فيديو واحد على الأقل بعد الصيانة قبل الإكمال.' };
      return res.redirect(`/technician/${req.params.id}`);
    }
    const badItems = await db.all(
      `SELECT item_key FROM inspection_items WHERE inspection_id = ? AND value IN ('bad','yes')`,
      [task.inspection_id]
    );
    if (badItems.length) {
      const doneItems = await db.all(
        `SELECT item_key FROM maintenance_item_status WHERE task_id = ? AND is_done = 1`,
        [req.params.id]
      );
      const doneKeys = new Set(doneItems.map(d => d.item_key));
      const undone = badItems.filter(i => !doneKeys.has(i.item_key));
      if (undone.length) {
        req.session.flash = { type: 'danger', msg: `يجب الضغط على "تم الإصلاح" لجميع الملاحظات — تبقّى ${undone.length} ملاحظة.` };
        return res.redirect(`/technician/${req.params.id}`);
      }
    }
    await db.transaction(async (q) => {
      await q("UPDATE maintenance_tasks SET status='pending_approval', completed_at=NULL WHERE id=$1", [req.params.id]);
      await q("UPDATE boxes SET status='pending_approval', updated_at=NOW() WHERE id=(SELECT box_id FROM inspections WHERE id=$1)", [task.inspection_id]);
    });
    req.session.flash = { type: 'success', msg: 'تم إنهاء العمل. بانتظار تأكيد المراقب.' };
    res.redirect(`/technician/${req.params.id}`);
  } catch (e) {
    console.error('technician complete error:', e.message);
    req.session.flash = { type: 'danger', msg: 'حدث خطأ أثناء إكمال المهمة. حاول مرة أخرى.' };
    res.redirect(`/technician/${req.params.id}`);
  }
});

router.post('/:id/before-photos', techOrAdmin, memUpload.single('photo'), async (req, res) => {
  const isAjax = (req.headers.accept || '').includes('application/json');
  const task = await db.get('SELECT * FROM maintenance_tasks WHERE id = ?', [req.params.id]);
  if (!task) {
    if (isAjax) return res.status(404).json({ ok: false, msg: 'المهمة غير موجودة.' });
    return res.redirect('/technician');
  }
  if (!req.file) {
    if (isAjax) return res.status(400).json({ ok: false, msg: 'يرجى اختيار صورة.' });
    req.session.flash = { type: 'danger', msg: 'يرجى اختيار صورة.' };
    return res.redirect(`/technician/${req.params.id}`);
  }
  try {
    const insp = await db.get('SELECT box_id FROM inspections WHERE id = ?', [task.inspection_id]);
    const { filename, data } = await compressToBuffer(req.file.buffer, `before_task${req.params.id}`);
    const takenAt = req.body.taken_at || null;
    const lat = req.body.lat ? parseFloat(req.body.lat) : null;
    const lng = req.body.lng ? parseFloat(req.body.lng) : null;
    await db.run("INSERT INTO photos (box_id, inspection_id, photo_type, media_type, filename, data, uploaded_by, taken_at, latitude, longitude) VALUES (?, ?, 'before', 'photo', ?, ?, ?, ?, ?, ?)",
      [insp.box_id, task.inspection_id, filename, data, req.session.user.id, takenAt, lat, lng]);
    if (isAjax) return res.json({ ok: true, filename });
    req.session.flash = { type: 'success', msg: 'تم رفع صورة قبل الصيانة.' };
  } catch (e) {
    if (isAjax) return res.status(500).json({ ok: false, msg: e.message });
    req.session.flash = { type: 'danger', msg: `فشل رفع الصورة: ${e.message}` };
  }
  res.redirect(`/technician/${req.params.id}`);
});

router.post('/:id/photos', techOrAdmin, memUpload.single('photo'), async (req, res) => {
  const isAjax = (req.headers.accept || '').includes('application/json');
  const task = await db.get('SELECT * FROM maintenance_tasks WHERE id = ?', [req.params.id]);
  if (!task) {
    if (isAjax) return res.status(404).json({ ok: false, msg: 'المهمة غير موجودة.' });
    return res.redirect('/technician');
  }
  if (!req.file) {
    if (isAjax) return res.status(400).json({ ok: false, msg: 'يرجى اختيار صورة.' });
    req.session.flash = { type: 'danger', msg: 'يرجى اختيار صورة.' };
    return res.redirect(`/technician/${req.params.id}`);
  }
  try {
    const insp = await db.get('SELECT box_id FROM inspections WHERE id = ?', [task.inspection_id]);
    const { filename, data } = await compressToBuffer(req.file.buffer, `after_task${req.params.id}`);
    const takenAt = req.body.taken_at || null;
    const lat = req.body.lat ? parseFloat(req.body.lat) : null;
    const lng = req.body.lng ? parseFloat(req.body.lng) : null;
    await db.run("INSERT INTO photos (box_id, inspection_id, photo_type, media_type, filename, data, uploaded_by, taken_at, latitude, longitude) VALUES (?, ?, 'after', 'photo', ?, ?, ?, ?, ?, ?)",
      [insp.box_id, task.inspection_id, filename, data, req.session.user.id, takenAt, lat, lng]);
    if (isAjax) return res.json({ ok: true, filename });
    req.session.flash = { type: 'success', msg: 'تم رفع صورة ما بعد الصيانة وضغطها.' };
  } catch (e) {
    if (isAjax) return res.status(500).json({ ok: false, msg: e.message });
    req.session.flash = { type: 'danger', msg: `فشل رفع الصورة: ${e.message}` };
  }
  res.redirect(`/technician/${req.params.id}`);
});

// ── Video upload routes ──────────────────────────────────────────────────────────────

router.post('/:id/before-videos', techOrAdmin, memVideoUpload.single('video'), async (req, res) => {
  const isAjax = (req.headers.accept || '').includes('application/json');
  try {
    const task = await db.get('SELECT * FROM maintenance_tasks WHERE id = ?', [req.params.id]);
    if (!task) {
      if (isAjax) return res.status(404).json({ ok: false, msg: 'المهمة غير موجودة.' });
      return res.redirect('/technician');
    }
    if (!req.file) {
      if (isAjax) return res.status(400).json({ ok: false, msg: 'يرجى اختيار فيديو.' });
      req.session.flash = { type: 'danger', msg: 'يرجى اختيار فيديو.' };
      return res.redirect(`/technician/${req.params.id}`);
    }
    const insp = await db.get('SELECT box_id FROM inspections WHERE id = ?', [task.inspection_id]);
    const { filename } = await compressVideoToDisk(req.file.buffer, `bvid_task${req.params.id}`);
    await db.run(
      "INSERT INTO photos (box_id, inspection_id, photo_type, media_type, filename, uploaded_by) VALUES (?, ?, 'before', 'video', ?, ?)",
      [insp.box_id, task.inspection_id, filename, req.session.user.id]
    );
    if (isAjax) return res.json({ ok: true, filename });
    req.session.flash = { type: 'success', msg: 'تم رفع فيديو قبل الصيانة.' };
  } catch (e) {
    console.error('technician before-video error:', e.message);
    if (isAjax) return res.status(500).json({ ok: false, msg: e.message });
    req.session.flash = { type: 'danger', msg: `فشل رفع الفيديو: ${e.message}` };
  }
  res.redirect(`/technician/${req.params.id}`);
});

router.post('/:id/after-videos', techOrAdmin, memVideoUpload.single('video'), async (req, res) => {
  const isAjax = (req.headers.accept || '').includes('application/json');
  try {
    const task = await db.get('SELECT * FROM maintenance_tasks WHERE id = ?', [req.params.id]);
    if (!task) {
      if (isAjax) return res.status(404).json({ ok: false, msg: 'المهمة غير موجودة.' });
      return res.redirect('/technician');
    }
    if (!req.file) {
      if (isAjax) return res.status(400).json({ ok: false, msg: 'يرجى اختيار فيديو.' });
      req.session.flash = { type: 'danger', msg: 'يرجى اختيار فيديو.' };
      return res.redirect(`/technician/${req.params.id}`);
    }
    const insp = await db.get('SELECT box_id FROM inspections WHERE id = ?', [task.inspection_id]);
    const { filename } = await compressVideoToDisk(req.file.buffer, `avid_task${req.params.id}`);
    await db.run(
      "INSERT INTO photos (box_id, inspection_id, photo_type, media_type, filename, uploaded_by) VALUES (?, ?, 'after', 'video', ?, ?)",
      [insp.box_id, task.inspection_id, filename, req.session.user.id]
    );
    if (isAjax) return res.json({ ok: true, filename });
    req.session.flash = { type: 'success', msg: 'تم رفع فيديو بعد الصيانة.' };
  } catch (e) {
    console.error('technician after-video error:', e.message);
    if (isAjax) return res.status(500).json({ ok: false, msg: e.message });
    req.session.flash = { type: 'danger', msg: `فشل رفع الفيديو: ${e.message}` };
  }
  res.redirect(`/technician/${req.params.id}`);
});

module.exports = router;
