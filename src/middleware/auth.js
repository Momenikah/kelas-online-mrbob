function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Silakan login terlebih dahulu.');
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.flash('error', 'Silakan login terlebih dahulu.');
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        message: 'Anda tidak memiliki akses ke halaman ini.',
        user: req.session.user,
      });
    }
    next();
  };
}

function requireVip(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  if (!req.session.user.is_vip && req.session.user.role !== 'admin') {
    req.flash('error', 'Fitur ini hanya tersedia untuk member VIP.');
    return res.redirect('/member');
  }
  next();
}

function redirectIfLoggedIn(req, res, next) {
  if (req.session.user) {
    const role = req.session.user.role;
    if (role === 'admin') return res.redirect('/admin');
    if (role === 'tutor') return res.redirect('/tutor');
    return res.redirect('/member');
  }
  next();
}

module.exports = { requireLogin, requireRole, requireVip, redirectIfLoggedIn };
