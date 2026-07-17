const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../database');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/login', { title: 'تسجيل الدخول', error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('auth/login', { title: 'تسجيل الدخول', error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
  }
  try {
    const user = await db.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username.trim()]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.render('auth/login', { title: 'تسجيل الدخول', error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }
    req.session.user = { id: user.id, username: user.username, role: user.role, full_name: user.full_name };
    if (user.role === 'technician') return res.redirect('/technician');
    return res.redirect('/boxes');
  } catch (e) {
    return res.render('auth/login', { title: 'تسجيل الدخول', error: 'حدث خطأ. حاول مرة أخرى.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

module.exports = router;
