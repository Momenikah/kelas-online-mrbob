require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Method override for PUT/DELETE via forms
app.use(methodOverride('_method'));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'superseru_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 hours
}));

// Flash messages
app.use(flash());

// Global template locals
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flashSuccess = req.flash('success');
  res.locals.flashError = req.flash('error');
  next();
});

// Helper to format dates in views
app.locals.formatDate = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
};
app.locals.formatTime = (time) => {
  if (!time) return '-';
  return String(time).substring(0, 5);
};
app.locals.formatCurrency = (amount) => {
  if (!amount) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
};
app.locals.getInitials = (name) => {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
};

// Routes
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const role = req.session.user.role;
  if (role === 'admin') return res.redirect('/admin');
  if (role === 'tutor') return res.redirect('/tutor');
  return res.redirect('/member');
});

app.use('/', require('./routes/auth'));
app.use('/member', require('./routes/member'));
app.use('/tutor', require('./routes/tutor'));
app.use('/admin', require('./routes/admin'));

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Halaman Tidak Ditemukan',
    message: 'Halaman yang Anda cari tidak ditemukan.',
    user: req.session.user,
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'Terjadi Kesalahan',
    message: 'Terjadi kesalahan pada server. Silakan coba lagi.',
    user: req.session.user,
  });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  KELASONLINE - Super Seru`);
  console.log(`  Server berjalan di http://localhost:${PORT}`);
  console.log(`========================================\n`);

  // Keep the programs table aligned with the registration catalog.
  const { query } = require('./config/database');
  const { ensurePrograms } = require('./utils/catalog');
  const { seedPeriods } = require('./utils/periods');
  ensurePrograms(query)
    .then((n) => console.log(`Catalog: ${n} program tersinkron di tabel programs.`))
    .catch((err) => console.error('Gagal sinkronisasi katalog program:', err.message));
  seedPeriods(query)
    .then((n) => console.log(`Periode: ${n} periode tersedia.`))
    .catch((err) => console.error('Gagal menyiapkan periode:', err.message));
  const { ensureMemberPresenceTable } = require('./utils/memberPresence');
  ensureMemberPresenceTable(query)
    .then(() => console.log('Tabel member_presences siap.'))
    .catch((err) => console.error('Gagal menyiapkan tabel presensi member:', err.message));
  const { ensureClassProofTable } = require('./utils/classProofs');
  ensureClassProofTable(query)
    .then(() => console.log('Tabel class_proofs siap.'))
    .catch((err) => console.error('Gagal menyiapkan tabel foto kelas:', err.message));
  const { ensureMemberReportsTable } = require('./utils/memberReports');
  ensureMemberReportsTable(query)
    .then(() => console.log('Tabel member_reports siap.'))
    .catch((err) => console.error('Gagal menyiapkan tabel report member:', err.message));
  const { ensureCertificateDetailsColumn } = require('./utils/certificates');
  ensureCertificateDetailsColumn(query)
    .then(() => console.log('Kolom detail sertifikat siap.'))
    .catch((err) => console.error('Gagal menyiapkan detail sertifikat:', err.message));
  const { ensureSupportFeedbackTable } = require('./utils/supportFeedback');
  ensureSupportFeedbackTable(query)
    .then(() => console.log('Tabel support_feedback siap.'))
    .catch((err) => console.error('Gagal menyiapkan tabel support feedback:', err.message));
  const { ensureUserAccessColumns } = require('./utils/userAccess');
  ensureUserAccessColumns(query)
    .then(() => console.log('Kolom akses user siap.'))
    .catch((err) => console.error('Gagal menyiapkan akses user:', err.message));
});
