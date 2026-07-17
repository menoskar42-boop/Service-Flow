const express = require('express');
const db = require('../database');
const { requireRole } = require('../middleware/auth');
const { memUpload, compressToBuffer, memVideoUpload, compressVideoToDisk } = require('../utils/photo');

const router = express.Router();
const inspectorOrAdmin = requireRole('admin', 'inspector');
const adminOnly = requireRole('admin');

const CHECKLIST = [
  { key: 'connector_fix',       label: 'تثبيت الخوصة',      type: 'good_bad' },
  { key: 'box_fix',             label: 'تثبيت البوكس',       type: 'good_bad' },
  { key: 'box_cover',           label: 'غطاء البوكس',        type: 'good_bad' },
  { key: 'box_numbering',       label: 'ترقيم البوكس',       type: 'good_bad' },
  { key: 'box_height',          label: 'ارتفاع البوكس',      type: 'good_bad' },
  { key: 'branch_path',         label: 'الفرعات على الترمنال', type: 'good_bad' },
  { key: 'wire_path',           label: 'مسار السلك',          type: 'good_bad' },
  { key: 'electricity_conflict',label: 'تعارض كهرباء',       type: 'yes_no'   },
  { key: 'air_conflict',        label: 'تعارض هواء',         type: 'yes_no'   },
  { key: 'overlap',             label: 'تخاطي',              type: 'yes_no'   },
];

// Items excluded from the preliminary confirmation (handled separately by the technician)
const PRELIM_EXCLUDED = ['electricity_conflict', 'air_conflict', 'overlap'];

router.get('/', inspectorOrAdmin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';
    const { exchange_id, cabinet_id, box_q, from, to } = req.query;

    let sql = `SELECT i.*, b.number as box_number, b.id as box_id, c.number as cabinet_number,
      e.name as exchange_name, u.full_name as inspector_name
      FROM inspections i JOIN boxes b ON b.id = i.box_id
      JOIN cabinets c ON c.id = b.cabinet_id JOIN exchanges e ON e.id = c.exchange_id
      JOIN users u ON u.id = i.inspector_id WHERE 1=1`;

    const params = [];
    if (!isAdmin) { sql += ` AND i.inspector_id = ?`; params.push(userId); }
    if (exchange_id) { sql += ` AND e.id = ?`; params.push(exchange_id); }
    if (cabinet_id)  { sql += ` AND b.cabinet_id = ?`; params.push(cabinet_id); }
    if (box_q)       { sql += ` AND b.number LIKE ?`; params.push(`%${box_q}%`); }
    if (from)        { sql += ` AND i.date >= ?`; params.push(from); }
    if (to)          { sql += ` AND i.date <= ?`; params.push(to); }
    sql += ' ORDER BY i.id DESC';

    const inspections = await db.all(sql, params);
    const exchanges = await db.all('SELECT id, name FROM exchanges ORDER BY name');
    const cabinets = exchange_id
      ? await db.all('SELECT id, number FROM cabinets WHERE exchange_id = ? ORDER BY number', [exchange_id])
      : [];
    res.render('inspector/list', { title: 'الفحوصات', inspections, exchanges, cabinets, query: req.query });
  } catch (e) {
    console.error('inspector list error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل الفحوصات. حاول مرة أخرى.' });
  }
});

router.get('/create/:boxId', inspectorOrAdmin, async (req, res) => {
  try {
    const box = await db.get(`SELECT b.*, c.number as cabinet_number, e.name as exchange_name
      FROM boxes b JOIN cabinets c ON c.id = b.cabinet_id JOIN exchanges e ON e.id = c.exchange_id
      WHERE b.id = ?`, [req.params.boxId]);
    if (!box) return res.redirect('/boxes');
    res.render('inspector/form', { title: `فحص بوكس ${box.number}`, box, checklist: CHECKLIST, errors: [] });
  } catch (e) {
    console.error('inspector create form error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ. حاول مرة أخرى.' });
  }
});

router.post('/create/:boxId', inspectorOrAdmin, async (req, res) => {
  try {
    const box = await db.get('SELECT * FROM boxes WHERE id = ?', [req.params.boxId]);
    if (!box) return res.redirect('/boxes');

    const { general_notes } = req.body;
    const errors = [];

    for (const item of CHECKLIST) {
      if (!req.body[`item_${item.key}`]) errors.push(`يرجى تحديد حالة: ${item.label}`);
      // For تخاطي / تعارض هواء marked "yes", نوع الكابل / البكس is mandatory
      if ((item.key === 'overlap' || item.key === 'air_conflict')
          && req.body[`item_${item.key}`] === 'yes'
          && !(req.body[`extra_type_${item.key}`] || '').trim()) {
        errors.push(`يرجى تحديد نوع الكابل / البكس لبند: ${item.label}`);
      }
    }
    if (errors.length) {
      const fullBox = await db.get(`SELECT b.*, c.number as cabinet_number, e.name as exchange_name FROM boxes b JOIN cabinets c ON c.id = b.cabinet_id JOIN exchanges e ON e.id = c.exchange_id WHERE b.id = ?`, [box.id]);
      return res.render('inspector/form', { title: `فحص بوكس ${box.number}`, box: fullBox, checklist: CHECKLIST, errors });
    }

    let inspId, requiresMaintenance;

    await db.transaction(async (q) => {
      const prevCoords = await q(
        `SELECT latitude, longitude FROM inspections
         WHERE box_id = $1 AND (is_archived = 1 OR is_archived IS NULL)
         AND (latitude IS NOT NULL OR longitude IS NOT NULL)
         ORDER BY id DESC LIMIT 1`, [box.id]
      );
      const inheritedLat = prevCoords.rows[0]?.latitude || null;
      const inheritedLng = prevCoords.rows[0]?.longitude || null;

      await q('UPDATE inspections SET is_archived = 1 WHERE box_id = $1 AND (is_archived IS NULL OR is_archived = 0)', [box.id]);

      const inspRes = await q(
        'INSERT INTO inspections (box_id, inspector_id, general_notes, date, latitude, longitude) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5) RETURNING id',
        [box.id, req.session.user.id, general_notes || '', inheritedLat, inheritedLng]
      );
      inspId = inspRes.rows[0].id;

      let needsMaintenance = false;
      for (const item of CHECKLIST) {
        const value = req.body[`item_${item.key}`];
        const notes = req.body[`notes_${item.key}`] || '';
        const extraType = (value === 'yes' && req.body[`extra_type_${item.key}`]) ? req.body[`extra_type_${item.key}`] : null;
        const extraDist = (value === 'yes' && req.body[`extra_distance_${item.key}`]) ? parseFloat(req.body[`extra_distance_${item.key}`]) || null : null;
        await q('INSERT INTO inspection_items (inspection_id, item_key, item_type, value, notes, extra_type, extra_distance) VALUES ($1,$2,$3,$4,$5,$6,$7)', [inspId, item.key, item.type, value, notes, extraType, extraDist]);
        if ((item.type === 'good_bad' && value === 'bad') || (item.type === 'yes_no' && value === 'yes')) needsMaintenance = true;
      }

      let newStatus = 'inspected';
      if (needsMaintenance) {
        newStatus = 'needs_maintenance';
        await q('INSERT INTO maintenance_tasks (inspection_id, status) VALUES ($1, $2)', [inspId, 'pending']);
      }
      await q("UPDATE boxes SET status = $1, updated_at = NOW() WHERE id = $2", [newStatus, box.id]);
      requiresMaintenance = needsMaintenance;
    });

    req.session.flash = { type: 'success', msg: requiresMaintenance ? 'تم الفحص. البوكس يحتاج صيانة وتم تحويله تلقائياً.' : 'تم الفحص بنجاح.' };
    res.redirect(`/inspector/${inspId}`);
  } catch (e) {
    console.error('inspector create post error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء حفظ الفحص. حاول مرة أخرى.' });
  }
});

router.get('/:id', inspectorOrAdmin, async (req, res) => {
  try {
    const inspection = await db.get(`SELECT i.*, b.number as box_number, b.id as box_id, b.status as box_status,
      b.latitude as box_latitude, b.longitude as box_longitude,
      c.id as cabinet_id, c.number as cabinet_number,
      e.id as exchange_id, e.name as exchange_name, u.full_name as inspector_name
      FROM inspections i JOIN boxes b ON b.id = i.box_id JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id JOIN users u ON u.id = i.inspector_id WHERE i.id = ?`, [req.params.id]);
    if (!inspection) return res.redirect('/inspector');

    const items = await db.all('SELECT * FROM inspection_items WHERE inspection_id = ?', [req.params.id]);
    const MEDIA_COLS = 'p.id, p.box_id, p.inspection_id, p.photo_type, p.media_type, p.filename, p.uploaded_by, p.taken_at, p.latitude, p.longitude, p.uploaded_at';
    const photos = await db.all(
      `SELECT ${MEDIA_COLS}, u.full_name as uploader FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.inspection_id = ? AND p.photo_type = 'before' AND COALESCE(p.media_type,'photo')='photo' ORDER BY p.uploaded_at`, [req.params.id]);
    const afterPhotos = await db.all(
      `SELECT ${MEDIA_COLS}, u.full_name as uploader FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.inspection_id = ? AND p.photo_type = 'after' AND COALESCE(p.media_type,'photo')='photo' ORDER BY p.uploaded_at`, [req.params.id]);
    const beforeVideos = await db.all(
      `SELECT ${MEDIA_COLS}, u.full_name as uploader FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.inspection_id = ? AND p.photo_type = 'before' AND p.media_type='video' ORDER BY p.uploaded_at`, [req.params.id]);
    const afterVideos = await db.all(
      `SELECT ${MEDIA_COLS}, u.full_name as uploader FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       WHERE p.inspection_id = ? AND p.photo_type = 'after' AND p.media_type='video' ORDER BY p.uploaded_at`, [req.params.id]);
    const task = await db.get('SELECT * FROM maintenance_tasks WHERE inspection_id = ?', [req.params.id]);
    const itemStatusMap = {};
    if (task) {
      const statuses = await db.all('SELECT * FROM maintenance_item_status WHERE task_id = ?', [task.id]);
      statuses.forEach(s => { itemStatusMap[s.item_key] = s; });
    }

    // Preliminary-confirmation eligibility: every relevant note (bad/yes) outside the
    // excluded set (تعارض الكهرباء/الهواء + التخاطى) has been fixed by the technician.
    const relevant = items.filter(it =>
      ['bad', 'yes'].includes(it.value) && !PRELIM_EXCLUDED.includes(it.item_key));
    const prelimReady = !!task && relevant.length > 0 &&
      relevant.every(it => itemStatusMap[it.item_key] && itemStatusMap[it.item_key].is_done);

    res.render('inspector/detail', { title: `تفاصيل الفحص #${req.params.id}`, inspection, items, photos, afterPhotos, beforeVideos, afterVideos, checklist: CHECKLIST, itemStatusMap, task, prelimReady });
  } catch (e) {
    console.error('inspector detail error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'حدث خطأ أثناء تحميل تفاصيل الفحص. حاول مرة أخرى.' });
  }
});

router.post('/:id/save-location', inspectorOrAdmin, async (req, res) => {
  try {
    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    if (!lat || !lng || isNaN(lat) || isNaN(lng))
      return res.status(400).json({ ok: false, msg: 'لا توجد إحداثيات صالحة.' });
    const exists = await db.get('SELECT id FROM inspections WHERE id = ?', [req.params.id]);
    if (!exists) return res.status(404).json({ ok: false, msg: 'الفحص غير موجود.' });
    await db.run('UPDATE inspections SET latitude=?, longitude=? WHERE id=?', [lat, lng, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ ok: false, msg: 'خطأ في الخادم: ' + e.message });
  }
});

router.post('/:id/photos', inspectorOrAdmin, (req, res, next) => {
  db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]).then(inspection => {
    if (!inspection) {
      const isAjax = (req.headers.accept || '').includes('application/json');
      if (isAjax) return res.status(404).json({ ok: false, msg: 'الفحص غير موجود.' });
      return res.redirect('/inspector');
    }
    next();
  }).catch(next);
}, memUpload.single('photo'), async (req, res) => {
  const isAjax = (req.headers.accept || '').includes('application/json');
  const inspection = await db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
  if (!req.file) {
    if (isAjax) return res.status(400).json({ ok: false, msg: 'يرجى اختيار صورة.' });
    req.session.flash = { type: 'danger', msg: 'يرجى اختيار صورة.' };
    return res.redirect(`/inspector/${req.params.id}`);
  }
  try {
    const { filename, data } = await compressToBuffer(req.file.buffer, `before_${inspection.box_id}`);
    const takenAt = req.body.taken_at || null;
    const lat = req.body.lat ? parseFloat(req.body.lat) : null;
    const lng = req.body.lng ? parseFloat(req.body.lng) : null;
    await db.run("INSERT INTO photos (box_id, inspection_id, photo_type, media_type, filename, data, uploaded_by, taken_at, latitude, longitude) VALUES (?, ?, 'before', 'photo', ?, ?, ?, ?, ?, ?)",
      [inspection.box_id, inspection.id, filename, data, req.session.user.id, takenAt, lat, lng]);
    if (isAjax) return res.json({ ok: true, filename });
    req.session.flash = { type: 'success', msg: 'تم رفع الصورة وضغطها.' };
  } catch (e) {
    if (isAjax) return res.status(500).json({ ok: false, msg: e.message });
    req.session.flash = { type: 'danger', msg: `فشل رفع الصورة: ${e.message}` };
  }
  res.redirect(`/inspector/${req.params.id}`);
});

router.post('/:id/after-photos', inspectorOrAdmin, (req, res, next) => {
  db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]).then(inspection => {
    if (!inspection) {
      const isAjax = (req.headers.accept || '').includes('application/json');
      if (isAjax) return res.status(404).json({ ok: false, msg: 'الفحص غير موجود.' });
      return res.redirect('/inspector');
    }
    next();
  }).catch(next);
}, memUpload.single('photo'), async (req, res) => {
  const isAjax = (req.headers.accept || '').includes('application/json');
  const inspection = await db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
  if (!req.file) {
    if (isAjax) return res.status(400).json({ ok: false, msg: 'يرجى اختيار صورة.' });
    req.session.flash = { type: 'danger', msg: 'يرجى اختيار صورة.' };
    return res.redirect(`/inspector/${req.params.id}`);
  }
  try {
    const { filename, data } = await compressToBuffer(req.file.buffer, `after_${inspection.box_id}`);
    const takenAt = req.body.taken_at || null;
    const lat = req.body.lat ? parseFloat(req.body.lat) : null;
    const lng = req.body.lng ? parseFloat(req.body.lng) : null;
    await db.run("INSERT INTO photos (box_id, inspection_id, photo_type, media_type, filename, data, uploaded_by, taken_at, latitude, longitude) VALUES (?, ?, 'after', 'photo', ?, ?, ?, ?, ?, ?)",
      [inspection.box_id, inspection.id, filename, data, req.session.user.id, takenAt, lat, lng]);
    if (isAjax) return res.json({ ok: true, filename });
    req.session.flash = { type: 'success', msg: 'تم رفع صورة بعد الصيانة.' };
  } catch (e) {
    if (isAjax) return res.status(500).json({ ok: false, msg: e.message });
    req.session.flash = { type: 'danger', msg: `فشل رفع الصورة: ${e.message}` };
  }
  res.redirect(`/inspector/${req.params.id}`);
});

// ── Video upload routes ──────────────────────────────────────────────────────────────

router.post('/:id/videos', inspectorOrAdmin, memVideoUpload.single('video'), async (req, res) => {
  const isAjax = (req.headers.accept || '').includes('application/json');
  try {
    const inspection = await db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) {
      if (isAjax) return res.status(404).json({ ok: false, msg: 'الفحص غير موجود.' });
      return res.redirect('/inspector');
    }
    if (!req.file) {
      if (isAjax) return res.status(400).json({ ok: false, msg: 'يرجى اختيار فيديو.' });
      req.session.flash = { type: 'danger', msg: 'يرجى اختيار فيديو.' };
      return res.redirect(`/inspector/${req.params.id}`);
    }
    const { filename } = await compressVideoToDisk(req.file.buffer, `bvid_${inspection.box_id}`);
    await db.run(
      "INSERT INTO photos (box_id, inspection_id, photo_type, media_type, filename, uploaded_by) VALUES (?, ?, 'before', 'video', ?, ?)",
      [inspection.box_id, inspection.id, filename, req.session.user.id]
    );
    if (isAjax) return res.json({ ok: true, filename });
    req.session.flash = { type: 'success', msg: 'تم رفع الفيديو وضغطه.' };
  } catch (e) {
    console.error('inspector before-video error:', e.message);
    if (isAjax) return res.status(500).json({ ok: false, msg: e.message });
    req.session.flash = { type: 'danger', msg: `فشل رفع الفيديو: ${e.message}` };
  }
  res.redirect(`/inspector/${req.params.id}`);
});

router.post('/:id/after-videos', inspectorOrAdmin, memVideoUpload.single('video'), async (req, res) => {
  const isAjax = (req.headers.accept || '').includes('application/json');
  try {
    const inspection = await db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
    if (!inspection) {
      if (isAjax) return res.status(404).json({ ok: false, msg: 'الفحص غير موجود.' });
      return res.redirect('/inspector');
    }
    if (!req.file) {
      if (isAjax) return res.status(400).json({ ok: false, msg: 'يرجى اختيار فيديو.' });
      req.session.flash = { type: 'danger', msg: 'يرجى اختيار فيديو.' };
      return res.redirect(`/inspector/${req.params.id}`);
    }
    const { filename } = await compressVideoToDisk(req.file.buffer, `avid_${inspection.box_id}`);
    await db.run(
      "INSERT INTO photos (box_id, inspection_id, photo_type, media_type, filename, uploaded_by) VALUES (?, ?, 'after', 'video', ?, ?)",
      [inspection.box_id, inspection.id, filename, req.session.user.id]
    );
    if (isAjax) return res.json({ ok: true, filename });
    req.session.flash = { type: 'success', msg: 'تم رفع فيديو بعد الصيانة.' };
  } catch (e) {
    console.error('inspector after-video error:', e.message);
    if (isAjax) return res.status(500).json({ ok: false, msg: e.message });
    req.session.flash = { type: 'danger', msg: `فشل رفع الفيديو: ${e.message}` };
  }
  res.redirect(`/inspector/${req.params.id}`);
});

const adminOrOwner = async (req, res, next) => {
  try {
    const insp = await db.get(
      `SELECT i.inspector_id FROM inspections i
       JOIN maintenance_tasks mt ON mt.inspection_id = i.id
       WHERE mt.id = ?`, [req.params.taskId]);
    if (!insp) return res.status(404).render('error', { title: 'خطأ', message: 'المهمة غير موجودة.' });
    if (req.session.user.role === 'admin' || insp.inspector_id === req.session.user.id) return next();
    req.session.flash = { type: 'danger', msg: 'هذه المهمة ليست من فحوصاتك.' };
    res.redirect('/inspector');
  } catch (e) { next(e); }
};

router.post('/tasks/:taskId/approve', inspectorOrAdmin, adminOrOwner, async (req, res) => {
  const task = await db.get('SELECT * FROM maintenance_tasks WHERE id = ?', [req.params.taskId]);
  if (!task || task.status !== 'pending_approval') {
    req.session.flash = { type: 'danger', msg: 'لا يمكن تأكيد هذه المهمة.' };
    return res.redirect(task ? `/inspector/${task.inspection_id}` : '/inspector');
  }
  await db.transaction(async (q) => {
    await q(`UPDATE maintenance_tasks SET status='completed', completed_at=NOW() WHERE id=$1`, [req.params.taskId]);
    await q(`UPDATE boxes SET status='completed', updated_at=NOW() WHERE id=(SELECT box_id FROM inspections WHERE id=$1)`, [task.inspection_id]);
  });
  req.session.flash = { type: 'success', msg: 'تم تأكيد إكمال المهمة.' };
  res.redirect(`/inspector/${task.inspection_id}`);
});

// Preliminary confirmation: external affairs confirm the non-excluded notes are fixed,
// without waiting for the technician to mark the whole task done.
router.post('/tasks/:taskId/prelim-confirm', inspectorOrAdmin, adminOrOwner, async (req, res) => {
  const task = await db.get('SELECT * FROM maintenance_tasks WHERE id = ?', [req.params.taskId]);
  if (!task) {
    req.session.flash = { type: 'danger', msg: 'المهمة غير موجودة.' };
    return res.redirect('/inspector');
  }
  if (task.prelim_confirmed_at) {
    req.session.flash = { type: 'info', msg: 'سبق تأكيد هذه المهمة مبدئياً.' };
    return res.redirect(`/inspector/${task.inspection_id}`);
  }
  // Verify all relevant (bad/yes) notes outside the excluded set are fixed.
  const blocking = await db.get(`
    SELECT 1 FROM inspection_items ii
    WHERE ii.inspection_id = $1
      AND ii.value IN ('bad','yes')
      AND ii.item_key NOT IN ('electricity_conflict','air_conflict','overlap')
      AND NOT EXISTS (
        SELECT 1 FROM maintenance_item_status mis
        WHERE mis.task_id = $2 AND mis.item_key = ii.item_key AND mis.is_done = 1
      ) LIMIT 1`, [task.inspection_id, req.params.taskId]);
  if (blocking) {
    req.session.flash = { type: 'danger', msg: 'لا يمكن التأكيد المبدئى — توجد ملاحظات لم يتم إصلاحها بعد.' };
    return res.redirect(`/inspector/${task.inspection_id}`);
  }
  await db.run(
    `UPDATE maintenance_tasks SET prelim_confirmed_at = NOW(), prelim_confirmed_by = ? WHERE id = ?`,
    [req.session.user.id, req.params.taskId]);
  req.session.flash = { type: 'success', msg: 'تم التأكيد المبدئى على إزالة الملاحظات.' };
  res.redirect(`/inspector/${task.inspection_id}`);
});

router.post('/tasks/:taskId/reject', inspectorOrAdmin, adminOrOwner, async (req, res) => {
  const task = await db.get('SELECT * FROM maintenance_tasks WHERE id = ?', [req.params.taskId]);
  if (!task || task.status !== 'pending_approval') {
    req.session.flash = { type: 'danger', msg: 'لا يمكن رفض هذه المهمة.' };
    return res.redirect(task ? `/inspector/${task.inspection_id}` : '/inspector');
  }
  const reason = (req.body.reason || '').trim() || null;
  await db.transaction(async (q) => {
    await q(`DELETE FROM maintenance_item_status WHERE task_id = $1`, [req.params.taskId]);
    await q(`UPDATE maintenance_tasks SET status='in_progress', completed_at=NULL, rejection_reason=$2 WHERE id=$1`,
            [req.params.taskId, reason]);
    await q(`UPDATE boxes SET status='in_progress', updated_at=NOW() WHERE id=(SELECT box_id FROM inspections WHERE id=$1)`,
            [task.inspection_id]);
  });
  req.session.flash = { type: 'success', msg: 'تم رفض الإكمال وإعادة المهمة إلى الفني.' };
  res.redirect(`/inspector/${task.inspection_id}`);
});

router.post('/tasks/:taskId/revert', adminOnly, async (req, res) => {
  const task = await db.get('SELECT * FROM maintenance_tasks WHERE id = ?', [req.params.taskId]);
  if (!task || task.status !== 'completed') {
    req.session.flash = { type: 'danger', msg: 'لا يمكن إرجاع هذه المهمة (ليست مكتملة).' };
    return res.redirect(task ? `/inspector/${task.inspection_id}` : '/inspector');
  }
  const reason = (req.body.reason || '').trim() || null;
  await db.transaction(async (q) => {
    await q(`DELETE FROM maintenance_item_status WHERE task_id = $1`, [req.params.taskId]);
    await q(`UPDATE maintenance_tasks SET status='in_progress', completed_at=NULL, rejection_reason=$2 WHERE id=$1`,
            [req.params.taskId, reason]);
    await q(`UPDATE boxes SET status='in_progress', updated_at=NOW() WHERE id=(SELECT box_id FROM inspections WHERE id=$1)`,
            [task.inspection_id]);
  });
  req.session.flash = { type: 'success', msg: 'تم إرجاع المهمة إلى الفني.' };
  res.redirect(`/inspector/${task.inspection_id}`);
});

router.post('/:id/delete', adminOnly, async (req, res) => {
  const inspection = await db.get('SELECT * FROM inspections WHERE id = ?', [req.params.id]);
  if (!inspection) {
    req.session.flash = { type: 'danger', msg: 'الفحص غير موجود.' };
    return res.redirect('/inspector');
  }
  const boxId = inspection.box_id;
  try {
    await db.transaction(async (q) => {
      await q(`DELETE FROM maintenance_item_status WHERE task_id IN (SELECT id FROM maintenance_tasks WHERE inspection_id = $1)`, [req.params.id]);
      await q('DELETE FROM maintenance_tasks WHERE inspection_id = $1', [req.params.id]);
      await q('DELETE FROM inspection_items WHERE inspection_id = $1', [req.params.id]);
      await q('DELETE FROM photos WHERE inspection_id = $1', [req.params.id]);
      await q('DELETE FROM inspections WHERE id = $1', [req.params.id]);
    });

    const remaining = await db.get('SELECT id FROM inspections WHERE box_id = ? ORDER BY id DESC LIMIT 1', [boxId]);
    let newStatus = 'pending_inspection';
    if (remaining) {
      const task = await db.get('SELECT status FROM maintenance_tasks WHERE inspection_id = ?', [remaining.id]);
      if (task) {
        if (task.status === 'completed') newStatus = 'completed';
        else if (task.status === 'in_progress') newStatus = 'in_progress';
        else newStatus = 'needs_maintenance';
      } else { newStatus = 'inspected'; }
    }
    await db.run("UPDATE boxes SET status = ?, updated_at = NOW() WHERE id = ?", [newStatus, boxId]);
    req.session.flash = { type: 'success', msg: 'تم حذف الفحص بنجاح.' };
  } catch (e) {
    req.session.flash = { type: 'danger', msg: 'فشل الحذف: ' + e.message };
  }
  res.redirect('/inspector');
});

module.exports = router;
