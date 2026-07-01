const { query } = require('../config/database');
const { ensureUserAccessColumns } = require('../utils/userAccess');

async function refreshSessionAccess(req) {
  if (!req.session.user || !req.session.user.id) return;
  await ensureUserAccessColumns(query);
  const result = await query(
    'SELECT name, email, role, photo, is_vip, is_luxury, tutor_grade FROM users WHERE id = $1 AND is_active = true',
    [req.session.user.id]
  );
  const user = result.rows[0];
  if (!user) {
    req.session.user = null;
    return;
  }
  req.session.user = {
    ...req.session.user,
    name: user.name,
    email: user.email,
    role: user.role,
    photo: user.photo,
    is_vip: user.is_vip,
    is_luxury: user.is_luxury,
    tutor_grade: user.tutor_grade,
  };
}

async function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Silakan login terlebih dahulu.');
    return res.redirect('/login');
  }
  try {
    await refreshSessionAccess(req);
    if (!req.session.user) {
      req.flash('error', 'Silakan login terlebih dahulu.');
      return res.redirect('/login');
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.session.user) {
      req.flash('error', 'Silakan login terlebih dahulu.');
      return res.redirect('/login');
    }
    try {
      await refreshSessionAccess(req);
    } catch (err) {
      return next(err);
    }
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

async function requireVip(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  try {
    await refreshSessionAccess(req);
  } catch (err) {
    return next(err);
  }
  if (!req.session.user) {
    return res.redirect('/login');
  }
  if (!req.session.user.is_vip && req.session.user.role !== 'admin') {
    req.flash('error', 'Fitur ini hanya tersedia untuk member VIP.');
    return res.redirect('/member');
  }
  next();
}

async function requireLuxury(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  try {
    await refreshSessionAccess(req);
  } catch (err) {
    return next(err);
  }
  if (!req.session.user) {
    return res.redirect('/login');
  }
  if (!req.session.user.is_luxury && req.session.user.role !== 'admin') {
    req.flash('error', 'Fitur ini hanya tersedia untuk member Luxury Class.');
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

module.exports = { requireLogin, requireRole, requireVip, requireLuxury, redirectIfLoggedIn };
