// Pengaman dasar tingkat aplikasi:
//  - sameOrigin : tolak POST/PUT/DELETE yang datang dari situs lain (anti CSRF)
//  - loginLimiter : rem percobaan login beruntun dari satu IP
//  - securityHeaders : header standar yang murah dan tidak mengubah tampilan
// Dipasang di src/app.js sebelum route.

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const hostOf = (value) => {
  if (!value) return '';
  try {
    return new URL(value).host.toLowerCase();
  } catch (err) {
    return '';
  }
};

// Host yang boleh mengirim form: host permintaan itu sendiri plus APP_URL
// (dipakai kalau aplikasi berada di belakang proxy dengan nama lain).
const allowedHosts = (req) => {
  const list = [String(req.headers.host || '').toLowerCase()];
  const appHost = hostOf(process.env.APP_URL);
  if (appHost) list.push(appHost);
  return list.filter(Boolean);
};

// Form dari halaman kita selalu membawa Origin atau Referer. Permintaan CSRF
// dari situs penyerang membawa Origin situs itu, jadi ketahuan di sini.
const sameOrigin = (req, res, next) => {
  if (!UNSAFE.has(req.method)) return next();

  const origin = hostOf(req.headers.origin);
  const referer = hostOf(req.headers.referer);
  const allowed = allowedHosts(req);

  if (origin && allowed.includes(origin)) return next();
  if (!origin && referer && allowed.includes(referer)) return next();

  console.warn(`[csrf] ${req.method} ${req.originalUrl} ditolak. origin="${req.headers.origin || ''}" referer="${req.headers.referer || ''}"`);
  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(403).json({ error: 'Permintaan ditolak. Muat ulang halaman lalu coba lagi.' });
  }
  return res.status(403).render('error', {
    title: 'Permintaan Ditolak',
    message: 'Permintaan ini tidak datang dari halaman Kelas Online. Muat ulang halaman lalu coba lagi.',
    user: (req.session && req.session.user) || null,
  });
};

// Rem login. Dihitung dua lapis karena satu kantor atau satu sekolah sering
// memakai satu IP bersama: per akun ketat (menahan tebak password), per IP
// longgar (menahan penyisiran banyak akun tanpa mengunci satu kantor).
const LOGIN_MAX_EMAIL = 8;
const LOGIN_MAX_IP = 40;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginHits = new Map();

const bump = (key, max, now) => {
  const entry = loginHits.get(key);
  if (!entry || entry.reset < now) {
    loginHits.set(key, { count: 1, reset: now + LOGIN_WINDOW_MS });
    return 0;
  }
  entry.count += 1;
  return entry.count > max ? entry.reset : 0;
};

const loginLimiter = (req, res, next) => {
  const now = Date.now();
  if (loginHits.size > 10000) {
    for (const [key, entry] of loginHits) if (entry.reset < now) loginHits.delete(key);
  }
  const email = String(req.body && req.body.email || '').trim().toLowerCase();
  const blockedUntil = Math.max(
    email ? bump(`email:${email}`, LOGIN_MAX_EMAIL, now) : 0,
    bump(`ip:${req.ip}`, LOGIN_MAX_IP, now)
  );
  if (blockedUntil) {
    const minutes = Math.max(1, Math.ceil((blockedUntil - now) / 60000));
    req.flash('error', `Terlalu banyak percobaan login. Coba lagi dalam ${minutes} menit.`);
    return res.redirect('/login');
  }
  return next();
};

// Login berhasil menghapus hitungan akun itu; hitungan IP dibiarkan supaya
// penyisiran banyak akun tetap terekam.
const clearLoginAttempts = (req) => {
  const email = String(req.body && req.body.email || '').trim().toLowerCase();
  if (email) loginHits.delete(`email:${email}`);
};

const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
};

module.exports = { sameOrigin, loginLimiter, clearLoginAttempts, securityHeaders };
