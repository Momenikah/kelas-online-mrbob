const bcrypt = require('bcryptjs');
const { query } = require('../config/database');

exports.showLogin = (req, res) => {
  res.render('auth/login', { title: 'Login', error: req.flash('error'), success: req.flash('success') });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    const user = result.rows[0];
    if (!user) {
      req.flash('error', 'Email atau password salah.');
      return res.redirect('/login');
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      req.flash('error', 'Email atau password salah.');
      return res.redirect('/login');
    }
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      photo: user.photo,
      is_vip: user.is_vip,
    };
    if (user.role === 'admin') return res.redirect('/admin');
    if (user.role === 'tutor') return res.redirect('/tutor');
    return res.redirect('/member');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Terjadi kesalahan. Coba lagi.');
    res.redirect('/login');
  }
};

exports.showRegister = (req, res) => {
  res.render('auth/register', { title: 'Daftar Akun', error: req.flash('error') });
};

exports.register = async (req, res) => {
  const { name, email, password, confirm_password, phone } = req.body;
  if (password !== confirm_password) {
    req.flash('error', 'Password tidak cocok.');
    return res.redirect('/register');
  }
  if (password.length < 6) {
    req.flash('error', 'Password minimal 6 karakter.');
    return res.redirect('/register');
  }
  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      req.flash('error', 'Email sudah terdaftar.');
      return res.redirect('/register');
    }
    const hashed = await bcrypt.hash(password, 10);
    await query(
      'INSERT INTO users (name, email, password, phone, role) VALUES ($1, $2, $3, $4, $5)',
      [name, email, hashed, phone || null, 'member']
    );
    req.flash('success', 'Akun berhasil dibuat! Silakan login.');
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Terjadi kesalahan. Coba lagi.');
    res.redirect('/register');
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
};
