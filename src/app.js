require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');

// Process-level safety nets: log async errors instead of letting them silently
// kill the server. PM2 still restarts on a hard exit, but this keeps the app
// alive for recoverable rejections and makes crashes diagnosable in the logs.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});

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
const metaPixel = require('./utils/metaPixel');
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flashSuccess = req.flash('success');
  res.locals.flashError = req.flash('error');
  // Meta Pixel: ID untuk base code + event yang menunggu ditembakkan di browser
  // (dititipkan lewat session agar tetap terbawa melewati redirect), lalu dihapus.
  res.locals.metaPixelId = metaPixel.pixelId();
  res.locals.pixelEvents = (req.session && req.session.pixelEvents) || [];
  if (req.session) req.session.pixelEvents = [];
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
// Kelas Semi Private dibuka 2 minggu sekali — dipakai form pendaftaran & renewal.
app.locals.isSemiPrivateStart = require('./utils/semiPrivate').isSemiPrivateStart;

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

// Safe render helper — never let the error page itself throw (e.g. missing view).
const renderError = (res, status, title, message, user) => {
  try {
    res.status(status).render('error', { title, message, user: user || null });
  } catch (e) {
    console.error('[error-view failed]', e && e.message);
    res.status(status).type('html').send(`<h1>${title}</h1><p>${message}</p>`);
  }
};

// 404
app.use((req, res) => {
  renderError(res, 404, 'Halaman Tidak Ditemukan', 'Halaman yang Anda cari tidak ditemukan.', req.session && req.session.user);
});

// Global error handler
app.use((err, req, res, next) => {
  const user = req.session && req.session.user;

  // Malformed / oversized request body -> 400 instead of a generic 500.
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large' || (err instanceof SyntaxError && 'body' in err))) {
    console.warn(`[400] Bad request body ${req.method} ${req.originalUrl}: ${err.message}`);
    return renderError(res, 400, 'Permintaan Tidak Valid', 'Data yang dikirim tidak valid. Silakan coba lagi.', user);
  }

  console.error(`[500] ${req.method} ${req.originalUrl}\n`, err && err.stack ? err.stack : err);

  // If the response already started streaming, defer to Express' default handler.
  if (res.headersSent) return next(err);

  renderError(res, 500, 'Terjadi Kesalahan', 'Terjadi kesalahan pada server. Silakan coba lagi.', user);
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
  const { ensureScheduleSyncSchema, startSchedulePoller } = require('./utils/scheduleSheetSync');
  ensureScheduleSyncSchema(query)
    .then(() => { console.log('Kolom sync jadwal siap.'); startSchedulePoller(); })
    .catch((err) => console.error('Gagal menyiapkan sync jadwal:', err.message));
});
