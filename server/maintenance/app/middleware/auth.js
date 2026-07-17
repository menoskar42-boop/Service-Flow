function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
}

function requireRole(...roles) {
  return [requireLogin, (req, res, next) => {
    if (roles.includes(req.session.user.role)) return next();
    req.session.flash = { type: 'danger', msg: 'ليس لديك صلاحية للوصول إلى هذه الصفحة.' };
    return res.redirect('/');
  }];
}

// Admin or inspector
function requireStaff(req, res, next) {
  return requireRole('admin', 'inspector')(req, res, next);
}

module.exports = { requireLogin, requireRole, requireStaff };
