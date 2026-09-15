// ══════════════════════════════════════════════════════════════════════════════
// «مراجعة بيانات البكس» — شاشة مستقلة عن مهام الصيانة
// ══════════════════════════════════════════════════════════════════════════════
// فنى إزالة الأعطال (tech فى Service-Flow) مالوش دعوة بمهام الصيانة بتاعت فنى
// الصيانة، لكنه **هو** اللى بيعرف أرقام البكس. فبدل ما نديله شاشة مهام الصيانة
// كلها (وده كان بيحصل لأنه كان بياخد نفس دور فنى الصيانة)، الشاشة دى بتفصل شغل
// مراجعة البيانات لوحده: بند data_review بس، من غير أى بنود صيانة.
//
// «كل فيما يخصه»: البكس بيتفلتر بكباين الفنى نفسه — من جدول Service-Flow
// public.cabinet_technicians (السنترال + رقم الكابينة → كود العامل)، وكود العامل
// بيتزامن على users.worker_code فى SSO. الأدمن بيشوف الكل.
const express = require('express');
const db = require('../database');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// بند «مراجعة بيانات البكس» لسه مفتوح (مش متعلّم مكتمل)
const REVIEW_OPEN = `(EXISTS (SELECT 1 FROM inspection_items ii
                               WHERE ii.inspection_id = i.id AND ii.item_key = 'data_review')
                      AND NOT EXISTS (SELECT 1 FROM maintenance_item_status ms
                                       WHERE ms.task_id = mt.id AND ms.item_key = 'data_review'
                                         AND ms.is_done = 1))`;

// توحيد السنترال/الكابينة — نفس منطق shared/cab-norm.ts، جوّه SQL عشان المطابقة
// تشتغل مهما اختلفت الكتابة («2/1» = «2-1»، «الجنادله» = «الجنادلة»).
const CENTRAL_N = (e) => `btrim(regexp_replace(regexp_replace(
  translate(lower(COALESCE(${e}, '')), 'أإآٱةى', 'ااااهي'), '\\s*-\\s*', '-', 'g'), '\\s+', ' ', 'g'))`;
const CAB_N = (e) => `btrim(regexp_replace(regexp_replace(
  translate(COALESCE(${e}, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'),
  '[\\\\/_‐‑‒–—―]', '-', 'g'), '\\s*-\\s*', '-', 'g'))`;

/**
 * نطاق الرؤية:
 *   • الأدمن + **الشئون الخارجية** (sf_role = external، ومنها مهندس الكوابل)
 *     → كل البكسيات اللى محتاجة مراجعة.
 *   • فنى إزالة الأعطال → كباينه هو بس.
 * ⚠️ الاتنين (الشئون الخارجية والفنى) بياخدوا نفس دور inspector فى الصيانة،
 * فالتفرقة بتتم بـ sf_role مش بدور الصيانة.
 */
// فنى الصيانة كمان بيشوف الكل: هو مش فنى منطقة ومالوش كباين فى cabinet_technicians،
// فلو فلترناه بكباينه كانت الشاشة هتطلعله فاضية دايماً — وهو أصلاً اللى بيقف على البكس.
const SEES_ALL_SF_ROLES = ['external', 'super_admin', 'admin', 'maintenance_tech'];
function ownScope(user) {
  if (user.role === 'admin' || user.role === 'technician'
      || SEES_ALL_SF_ROLES.includes(String(user.sf_role || ''))) {
    return { clause: '', params: [] };
  }
  const code = String(user.worker_code || '').trim();
  if (!code) return { clause: ' AND 1 = 0', params: [] };   // مالوش كود → مايشوفش حاجة
  return {
    clause: ` AND EXISTS (SELECT 1 FROM public.cabinet_technicians ct
                           WHERE btrim(ct.worker_code) = ?
                             AND ${CENTRAL_N('ct.central_name')} = ${CENTRAL_N('e.name')}
                             AND ${CAB_N('ct.cabin_number')} = ${CAB_N('c.number')})`,
    params: [code],
  };
}

router.get('/', requireLogin, async (req, res) => {
  try {
    const user = req.session.user;
    const scope = ownScope(user);
    const rows = await db.all(`
      SELECT mt.id AS task_id, i.id AS inspection_id, i.opened_by_name, i.general_notes,
             b.number AS box_number, c.number AS cabinet_number, e.name AS exchange_name,
             (SELECT COUNT(*) FROM box_line_numbers bl WHERE bl.inspection_id = i.id)::int AS phones_count
        FROM maintenance_tasks mt
        JOIN inspections i ON i.id = mt.inspection_id
        JOIN boxes b ON b.id = i.box_id
        JOIN cabinets c ON c.id = b.cabinet_id
        JOIN exchanges e ON e.id = c.exchange_id
       WHERE COALESCE(i.is_archived, 0) = 0 AND ${REVIEW_OPEN}${scope.clause}
       ORDER BY e.name, c.number,
                CASE WHEN b.number ~ '^[0-9]+$' THEN b.number::INTEGER ELSE 0 END, b.number`,
      scope.params);
    res.render('data_review/list', {
      title: 'مراجعة بيانات البكس', rows, seesAll: scope.clause === '' });
  } catch (e) {
    console.error('data-review list error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'تعذّر تحميل قائمة مراجعة البيانات.' });
  }
});

/** بيرجّع المهمة لو المستخدم ده مسموح له عليها، أو null. */
async function allowedTask(user, taskId) {
  const scope = ownScope(user);
  return db.get(`
    SELECT mt.id AS task_id, i.id AS inspection_id, i.general_notes, i.opened_by_name,
           b.number AS box_number, c.number AS cabinet_number, e.name AS exchange_name
      FROM maintenance_tasks mt
      JOIN inspections i ON i.id = mt.inspection_id
      JOIN boxes b ON b.id = i.box_id
      JOIN cabinets c ON c.id = b.cabinet_id
      JOIN exchanges e ON e.id = c.exchange_id
     WHERE mt.id = ? AND COALESCE(i.is_archived, 0) = 0${scope.clause}
     LIMIT 1`, [taskId, ...scope.params]);
}

router.get('/:id', requireLogin, async (req, res) => {
  try {
    const task = await allowedTask(req.session.user, req.params.id);
    if (!task) return res.redirect('/data-review');
    const phones = await db.all(
      'SELECT * FROM box_line_numbers WHERE inspection_id = ? ORDER BY id', [task.inspection_id]);
    const done = await db.get(
      "SELECT is_done FROM maintenance_item_status WHERE task_id = ? AND item_key = 'data_review'",
      [task.task_id]);
    res.render('data_review/detail', {
      title: `مراجعة بيانات — بوكس ${task.box_number}`,
      task, phones, isDone: !!(done && done.is_done),
    });
  } catch (e) {
    console.error('data-review detail error:', e.message);
    res.status(500).render('error', { title: 'خطأ', message: 'تعذّر تحميل البكس.' });
  }
});

router.post('/:id/phones', requireLogin, async (req, res) => {
  try {
    const task = await allowedTask(req.session.user, req.params.id);
    if (!task) return res.redirect('/data-review');
    const phone = String(req.body.phone || '').trim();
    const notes = String(req.body.notes || '').trim();
    if (phone) {
      const dup = await db.get('SELECT id FROM box_line_numbers WHERE inspection_id = ? AND phone = ?',
        [task.inspection_id, phone]);
      if (dup) req.session.flash = { type: 'warning', msg: 'الرقم ده موجود بالفعل فى القائمة.' };
      else await db.run(
        "INSERT INTO box_line_numbers (inspection_id, phone, notes, source) VALUES (?, ?, ?, 'technician')",
        [task.inspection_id, phone, notes]);
    }
  } catch (e) {
    console.error('data-review add phone error:', e.message);
    req.session.flash = { type: 'danger', msg: 'تعذّر إضافة الرقم.' };
  }
  res.redirect(`/data-review/${req.params.id}`);
});

router.post('/:id/phones/:phoneId', requireLogin, async (req, res) => {
  try {
    const task = await allowedTask(req.session.user, req.params.id);
    if (!task) return res.redirect('/data-review');
    const phone = String(req.body.phone || '').trim();
    const notes = String(req.body.notes || '').trim();
    if (phone) {
      await db.run('UPDATE box_line_numbers SET phone = ?, notes = ?, updated_at = now() WHERE id = ? AND inspection_id = ?',
        [phone, notes, req.params.phoneId, task.inspection_id]);
    }
  } catch (e) {
    console.error('data-review edit phone error:', e.message);
    req.session.flash = { type: 'danger', msg: 'تعذّر تعديل الرقم.' };
  }
  res.redirect(`/data-review/${req.params.id}`);
});

router.post('/:id/phones/:phoneId/delete', requireLogin, async (req, res) => {
  try {
    const task = await allowedTask(req.session.user, req.params.id);
    if (!task) return res.redirect('/data-review');
    await db.run('DELETE FROM box_line_numbers WHERE id = ? AND inspection_id = ?',
      [req.params.phoneId, task.inspection_id]);
  } catch (e) {
    console.error('data-review delete phone error:', e.message);
    req.session.flash = { type: 'danger', msg: 'تعذّر حذف الرقم.' };
  }
  res.redirect(`/data-review/${req.params.id}`);
});

/**
 * إنهاء بند «مراجعة بيانات البكس» — نفس العلامة اللى تقرير «بوكس مليان تمت
 * مراجعتها» بيقرا منها.
 *
 * وبيقفل المهمة على طول لو الفحص **اتفتح تلقائياً** (auto_created) — يعنى موجود
 * أصلاً عشان المراجعة دى بس. مافيش معنى إن مراجعة أرقام تعدّى بدورة الصيانة
 * الكاملة (بدء العمل ← صورة بعد الصيانة ← إكمال ← موافقة المراقب)، وكانت بتفضل
 * ظاهرة كمهمة صيانة مفتوحة بعد ما المراجعة تخلص.
 *
 * ⚠️ الفحص اللى عمله فاحص حقيقى **مايتقفلش**: البند بيتعلّم مكتمل وبس، وشغل
 * الصيانة بتاعه بيكمّل دورته عادى.
 */
async function finishDataReview(taskId, userId) {
  await db.run(`
    INSERT INTO maintenance_item_status (task_id, item_key, is_done, done_at, done_by)
    VALUES (?, 'data_review', 1, now(), ?)
    ON CONFLICT (task_id, item_key)
    DO UPDATE SET is_done = 1, done_at = now(), done_by = EXCLUDED.done_by`,
    [taskId, userId]);

  const insp = await db.get(`
    SELECT i.id, i.box_id, COALESCE(i.auto_created, 0) AS auto_created, mt.status
      FROM maintenance_tasks mt JOIN inspections i ON i.id = mt.inspection_id
     WHERE mt.id = ?`, [taskId]);
  if (!insp || !Number(insp.auto_created)) return { closed: false };
  // ⚠️ لو فنى الصيانة ضغط «بدء العمل» يبقى شغّال على البكس فعلاً — ساعتها البند
  // بيتعلّم وبس والمهمة **ماتتقفلش**. قفلها كان بيخفى زراير رفع الصور (ظاهرة وقت
  // in_progress بس)، فالفنى يبقى بيصوّر قبل/بعد الصيانة والصور مش بتتضاف.
  // القفل الفورى للمهمة اللى لسه ماحدش بدأها (pending) — وده وضع شاشة المراجعة.
  if (String(insp.status) !== 'pending') return { closed: false };

  // فيه بند تانى محتاج شغل ولسه مش متعلّم؟ ساعتها المهمة مش خلصانة
  const undone = await db.get(`
    SELECT COUNT(*)::int AS c FROM inspection_items ii
     WHERE ii.inspection_id = ? AND ii.value IN ('bad','yes') AND ii.item_key <> 'data_review'
       AND NOT EXISTS (SELECT 1 FROM maintenance_item_status ms
                        WHERE ms.task_id = ? AND ms.item_key = ii.item_key AND ms.is_done = 1)`,
    [insp.id, taskId]);
  if (undone && Number(undone.c) > 0) return { closed: false };

  await db.run("UPDATE maintenance_tasks SET status='completed', completed_at=now(), technician_id=COALESCE(technician_id, ?) WHERE id = ?",
    [userId, taskId]);
  // البكس اترفع لـ needs_maintenance وقت فتح الفحص التلقائى — نرجّعه زى ما كان
  // طالما مافيش فحص **حقيقى** مفتوح عليه (مش بتاعنا).
  const realOpen = await db.get(`
    SELECT COUNT(*)::int AS c FROM inspections i2
      JOIN maintenance_tasks t2 ON t2.inspection_id = i2.id
     WHERE i2.box_id = ? AND COALESCE(i2.auto_created, 0) = 0
       AND t2.status <> 'completed' AND COALESCE(i2.is_archived, 0) = 0`, [insp.box_id]);
  if (!realOpen || Number(realOpen.c) === 0) {
    await db.run("UPDATE boxes SET status='pending_inspection', updated_at=now() WHERE id = ? AND status = 'needs_maintenance'",
      [insp.box_id]);
  }
  return { closed: true };
}

router.post('/:id/done', requireLogin, async (req, res) => {
  try {
    const task = await allowedTask(req.session.user, req.params.id);
    if (!task) return res.redirect('/data-review');
    const r = await finishDataReview(task.task_id, req.session.user.id);
    req.session.flash = { type: 'success',
      msg: r.closed ? 'تمت مراجعة بيانات البكس وقفلت المهمة.' : 'تمت مراجعة بيانات البكس.' };
  } catch (e) {
    console.error('data-review done error:', e.message);
    req.session.flash = { type: 'danger', msg: 'تعذّر إنهاء المراجعة.' };
  }
  res.redirect('/data-review');
});

module.exports = router;
// بيتستخدم كمان من شاشة فنى الصيانة عشان البندين يتصرّفوا بنفس الطريقة
module.exports.finishDataReview = finishDataReview;
