const express = require('express');
// bcryptjs: نسخة JS خالصة، نفس الـ API ونفس هاشات $2b$ — من غير native build
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');
const multer = require('multer');
const db = require('../database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const adminOnly = requireRole('admin');
const upload = multer({ storage: multer.memoryStorage() });

// ── User Management ──────────────────────────────────────────────────────────

router.get('/users', adminOnly, async (req, res) => {
  const users = await db.all('SELECT * FROM users ORDER BY role, username');
  res.render('admin/users', { title: 'إدارة المستخدمين', users });
});

router.get('/users/create', adminOnly, (req, res) => {
  res.render('admin/user_form', { title: 'إضافة مستخدم', user: null, errors: [] });
});

router.post('/users/create', adminOnly, async (req, res) => {
  const { username, password, role, full_name, email } = req.body;
  const errors = [];
  if (!username) errors.push('اسم المستخدم مطلوب.');
  if (!password || password.length < 4) errors.push('كلمة المرور يجب أن تكون 4 أحرف على الأقل.');
  if (!['admin','inspector','technician'].includes(role)) errors.push('الدور غير صالح.');
  if (errors.length) return res.render('admin/user_form', { title: 'إضافة مستخدم', user: req.body, errors });
  try {
    const hash = bcrypt.hashSync(password, 10);
    await db.run('INSERT INTO users (username, password, role, full_name, email) VALUES (?, ?, ?, ?, ?)',
      [username.trim(), hash, role, full_name || '', email || '']);
    req.session.flash = { type: 'success', msg: 'تم إنشاء المستخدم بنجاح.' };
  } catch {
    return res.render('admin/user_form', { title: 'إضافة مستخدم', user: req.body, errors: ['اسم المستخدم مستخدم بالفعل.'] });
  }
  res.redirect('/admin/users');
});

router.get('/users/:id/edit', adminOnly, async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.redirect('/admin/users');
  res.render('admin/user_form', { title: 'تعديل مستخدم', user, errors: [] });
});

router.post('/users/:id/edit', adminOnly, async (req, res) => {
  const { full_name, email, role, is_active } = req.body;
  await db.run('UPDATE users SET full_name=?, email=?, role=?, is_active=? WHERE id=?',
    [full_name || '', email || '', role, is_active ? 1 : 0, req.params.id]);
  req.session.flash = { type: 'success', msg: 'تم تحديث بيانات المستخدم.' };
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', adminOnly, async (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) {
    req.session.flash = { type: 'danger', msg: 'لا يمكنك حذف حسابك الخاص.' };
    return res.redirect('/admin/users');
  }
  const inspRow = await db.get('SELECT COUNT(*) as c FROM inspections WHERE inspector_id = ?', [req.params.id]);
  if (parseInt(inspRow.c) > 0) {
    req.session.flash = { type: 'danger', msg: `لا يمكن حذف هذا المستخدم لأن له ${inspRow.c} فحص مسجل. يمكنك تعطيل الحساب بدلاً من الحذف.` };
    return res.redirect('/admin/users');
  }
  try {
    await db.transaction(async (q) => {
      await q('UPDATE photos SET uploaded_by = NULL WHERE uploaded_by = $1', [req.params.id]);
      await q('UPDATE maintenance_tasks SET technician_id = NULL WHERE technician_id = $1', [req.params.id]);
      await q('UPDATE maintenance_item_status SET done_by = NULL WHERE done_by = $1', [req.params.id]);
      await q('DELETE FROM users WHERE id = $1', [req.params.id]);
    });
    req.session.flash = { type: 'success', msg: 'تم حذف المستخدم.' };
  } catch (e) {
    req.session.flash = { type: 'danger', msg: 'فشل الحذف: ' + e.message };
  }
  res.redirect('/admin/users');
});

// ── Excel Import ─────────────────────────────────────────────────────────────

router.get('/import', adminOnly, (req, res) => {
  res.render('admin/import', { title: 'استيراد بوكسات من Excel', result: null });
});

router.get('/import/template', adminOnly, (req, res) => {
  const wb = xlsx.utils.book_new();
  const data = [
    ['اسم السنترال', 'رقم الكابينة', 'رقم البوكس'],
    ['سنترال 1', '1', '101'],
    ['سنترال 1', '1', '102'],
  ];
  const ws = xlsx.utils.aoa_to_sheet(data);
  const range = xlsx.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const addr = xlsx.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) continue;
      ws[addr].t = 's'; ws[addr].z = '@';
      if (ws[addr].v !== undefined) ws[addr].w = String(ws[addr].v);
    }
  }
  ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }];
  xlsx.utils.book_append_sheet(wb, ws, 'البوكسات');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=boxes_template.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.post('/import', adminOnly, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.render('admin/import', { title: 'استيراد بوكسات من Excel', result: { error: 'يرجى اختيار ملف Excel.' } });
  }
  const result = { created: 0, skipped: 0, errors: [] };
  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const dataRows = rows.slice(1).filter(r => r.some(c => String(c).trim()));

    // 1) Parse & validate all rows first
    const valid = [];
    dataRows.forEach((row, idx) => {
      const exName = String(row[0] || '').trim();
      const cabNum = String(row[1] || '').trim();
      const boxNum = String(row[2] || '').trim();
      if (!exName || !cabNum || !boxNum) {
        result.errors.push(`صف ${idx + 2}: بيانات ناقصة، تم التخطي.`);
      } else {
        valid.push({ exName, cabNum, boxNum });
      }
    });

    if (!valid.length) {
      return res.render('admin/import', { title: 'استيراد بوكسات من Excel', result });
    }

    await db.transaction(async (q) => {
      // 2) Bulk-upsert exchanges in one query
      const uniqueExNames = [...new Set(valid.map(r => r.exName))];
      const exVals = uniqueExNames.map((n, i) => `($${i + 1})`).join(',');
      await q(`INSERT INTO exchanges (name) VALUES ${exVals} ON CONFLICT (name) DO NOTHING`, uniqueExNames);

      const exRows = (await q(`SELECT id, name FROM exchanges WHERE name = ANY($1)`, [uniqueExNames])).rows;
      const exMap = Object.fromEntries(exRows.map(r => [r.name, r.id]));

      // 3) Bulk-upsert cabinets in one query
      const uniqueCabs = [...new Map(valid.map(r => [`${r.exName}|${r.cabNum}`, r])).values()];
      const cabArgs = [];
      const cabVals = uniqueCabs.map(r => {
        const base = cabArgs.length;
        cabArgs.push(exMap[r.exName], r.cabNum);
        return `($${base + 1},$${base + 2})`;
      }).join(',');
      await q(`INSERT INTO cabinets (exchange_id, number) VALUES ${cabVals} ON CONFLICT (exchange_id, number) DO NOTHING`, cabArgs);

      const cabRows = (await q(`SELECT id, exchange_id, number FROM cabinets WHERE exchange_id = ANY($1)`, [uniqueExNames.map(n => exMap[n])])).rows;
      const cabMap = Object.fromEntries(cabRows.map(r => [`${r.exchange_id}|${r.number}`, r.id]));

      // 4) Bulk-insert boxes in batches of 500 to stay within pg parameter limits
      const BATCH = 500;
      for (let start = 0; start < valid.length; start += BATCH) {
        const chunk = valid.slice(start, start + BATCH);
        const boxArgs = [];
        const boxVals = chunk.map(r => {
          const cabId = cabMap[`${exMap[r.exName]}|${r.cabNum}`];
          const base = boxArgs.length;
          boxArgs.push(cabId, r.boxNum);
          return `($${base + 1},$${base + 2})`;
        }).join(',');
        const r = await q(
          `INSERT INTO boxes (cabinet_id, number) VALUES ${boxVals} ON CONFLICT (cabinet_id, number) DO NOTHING`,
          boxArgs
        );
        result.created += r.rowCount;
        result.skipped += chunk.length - r.rowCount;
      }
    });
  } catch (e) {
    result.error = `خطأ في قراءة الملف: ${e.message}`;
  }
  res.render('admin/import', { title: 'استيراد بوكسات من Excel', result });
});

router.post('/inspections/:id/delete', adminOnly, async (req, res) => {
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
