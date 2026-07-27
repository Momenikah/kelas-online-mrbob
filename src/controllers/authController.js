const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { query } = require('../config/database');
const {
  sendRegistrationEmail,
  sendAdminNotificationEmail,
  sendPaymentConfirmedEmail,
  sendAdminPaymentConfirmedEmail,
} = require('../utils/registrationEmail');
const { syncRegistration, syncConfirmation } = require('../utils/spreadsheetSync');
const { STUDY_TIME_SLOTS, PROGRAM_CATALOG } = require('../utils/catalog');
const { isSemiPrivateStartLabel } = require('../utils/semiPrivate');
const metaPixel = require('../utils/metaPixel');
const at = require('../utils/availableTime');
const { PRICE_LIST, packagesForProgram, groupSizeBounds } = require('../utils/priceList');
const { ensureUserAccessColumns, isLuxuryPackage, getAccessFromRegistration } = require('../utils/userAccess');

const ensureRegistrationTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS member_registrations (
      id SERIAL PRIMARY KEY,
      registration_code VARCHAR(40) UNIQUE NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(30),
      city VARCHAR(100),
      education_background VARCHAR(255),
      education_level VARCHAR(100),
      occupation VARCHAR(255),
      age INTEGER,
      instagram VARCHAR(150),
      phone_last_three VARCHAR(3),
      program_type VARCHAR(50),
      selected_class VARCHAR(255),
      package_group VARCHAR(100),
      package_name VARCHAR(255),
      package_price INTEGER,
      package_note TEXT,
      duration VARCHAR(100),
      meeting_count VARCHAR(100),
      study_time VARCHAR(100),
      start_date VARCHAR(100),
      preferred_tutor_id INTEGER REFERENCES users(id),
      preferred_tutor VARCHAR(255),
      friend_name VARCHAR(255),
      coupon_code VARCHAR(100),
      referral_code VARCHAR(100),
      transfer_proof VARCHAR(500),
      status VARCHAR(50) DEFAULT 'pending_payment',
      created_at TIMESTAMP DEFAULT NOW(),
      confirmed_at TIMESTAMP
    )
  `);
  await query('ALTER TABLE member_registrations ADD COLUMN IF NOT EXISTS preferred_tutor VARCHAR(255)');
  await query('ALTER TABLE member_registrations ADD COLUMN IF NOT EXISTS preferred_tutor_id INTEGER REFERENCES users(id)');
};

const getGradeATutors = () => query(
  `SELECT id, name, photo, bio, tutor_grade
   FROM users
   WHERE role = 'tutor' AND is_active = true AND tutor_grade = 'A'
   ORDER BY name`
);

const createRegistrationCode = () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `REG-${stamp}-${random}`;
};

const findRegistrationByCode = async (code) => {
  await ensureRegistrationTable();
  const result = await query(
    `SELECT r.*, u.is_active
     FROM member_registrations r
     JOIN users u ON u.id = r.user_id
     WHERE r.registration_code = $1`,
    [code]
  );
  return result.rows[0];
};

const removeUploadedFile = (file) => {
  if (!file) return;
  fs.unlink(path.join(__dirname, '../../public/uploads', file.filename), () => {});
};

exports.showLogin = (req, res) => {
  res.render('auth/login', { title: 'Login', error: req.flash('error'), success: req.flash('success') });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    await ensureUserAccessColumns(query);
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
      is_luxury: user.is_luxury,
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

exports.showRegister = async (req, res) => {
  try {
    await ensureUserAccessColumns(query);
    const tutors = await getGradeATutors();
    res.render('auth/register', {
      title: 'Daftar Akun',
      error: req.flash('error'),
      studyTimeSlots: STUDY_TIME_SLOTS,
      programCatalog: PROGRAM_CATALOG,
      priceList: PRICE_LIST,
      gradeATutors: tutors.rows,
      startDateOptions: at.upcomingMondays(),
    });
  } catch (err) {
    console.error(err);
    res.render('auth/register', {
      title: 'Daftar Akun',
      error: req.flash('error'),
      studyTimeSlots: STUDY_TIME_SLOTS,
      programCatalog: PROGRAM_CATALOG,
      priceList: PRICE_LIST,
      gradeATutors: [],
      startDateOptions: at.upcomingMondays(),
    });
  }
};

exports.register = async (req, res) => {
  const {
    name, email, phone, city, education_background, education_level, occupation,
    age, instagram, phone_last_three, program_type, selected_class, package_group,
    package_name, package_price, package_note, duration, meeting_count, study_time,
    start_date, preferred_tutor_id, friend_name, coupon_code, referral_code
  } = req.body;

  const friendList = (Array.isArray(friend_name) ? friend_name : [friend_name])
    .map((value) => (value || '').trim())
    .filter(Boolean);
  const friendNames = friendList.join(', ');

  // Group packages (BTS/Private) are priced per person. Recompute the amount
  // authoritatively from the catalog × headcount (1 + friends, clamped to the
  // package's allowed group size) so the invoice can't be under/over-charged.
  const catalogPkg = packagesForProgram(selected_class).find((p) => p.name === package_name);
  const perPersonPrice = catalogPkg ? Number(catalogPkg.price) : (package_price ? Number(package_price) : 0);
  const groupBounds = groupSizeBounds(catalogPkg ? catalogPkg.note : package_note);
  const headcount = groupBounds
    ? Math.min(groupBounds.max, Math.max(groupBounds.min, 1 + friendList.length))
    : 1;
  const finalPackagePrice = perPersonPrice * headcount;

  try {
    await ensureRegistrationTable();
    await ensureUserAccessColumns(query);
    const pendingRegistration = {
      package_group,
      package_name,
    };
    const isLuxury = isLuxuryPackage(pendingRegistration);
    let preferredTutorId = null;
    let preferredTutorName = null;
    if (isLuxury) {
      const tutors = await getGradeATutors();
      const selectedTutor = tutors.rows.find((tutor) => String(tutor.id) === String(preferred_tutor_id || ''));
      if (tutors.rows.length > 0 && !selectedTutor) {
        req.flash('error', 'Pilih tutor Grade A yang tersedia untuk paket Luxury Class.');
        return res.redirect('/register');
      }
      if (selectedTutor) {
        preferredTutorId = selectedTutor.id;
        preferredTutorName = selectedTutor.name;
      }
    }
    // Kelas Semi Private hanya dibuka 2 minggu sekali.
    if (/semi/i.test(package_name || '') && !isSemiPrivateStartLabel(start_date)) {
      req.flash('error', 'Kelas Semi Private dibuka 2 minggu sekali. Pilih tanggal mulai yang tersedia.');
      return res.redirect('/register');
    }
    const activeUser = await query('SELECT id FROM users WHERE email = $1 AND is_active = true', [email]);
    if (activeUser.rows.length > 0) {
      req.flash('error', 'Email sudah terdaftar.');
      return res.redirect('/register');
    }

    const pending = await query(
      `SELECT r.registration_code
       FROM member_registrations r
       JOIN users u ON u.id = r.user_id
       WHERE r.email = $1 AND u.is_active = false
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [email]
    );
    if (pending.rows.length > 0) {
      return res.redirect(`/pendaftaran/${pending.rows[0].registration_code}`);
    }

    const tempPassword = await bcrypt.hash(createRegistrationCode(), 10);
    const userResult = await query(
      'INSERT INTO users (name, email, password, phone, role, is_active) VALUES ($1, $2, $3, $4, $5, false) RETURNING id',
      [name, email, tempPassword, phone || null, 'member']
    );

    const registrationCode = createRegistrationCode();
    await query(
      `INSERT INTO member_registrations (
        registration_code, user_id, name, email, phone, city, education_background,
        education_level, occupation, age, instagram, phone_last_three, program_type,
        selected_class, package_group, package_name, package_price, package_note,
        duration, meeting_count, study_time, start_date, preferred_tutor_id,
        preferred_tutor, friend_name, coupon_code, referral_code
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24,
        $25, $26, $27
      )`,
      [
        registrationCode,
        userResult.rows[0].id,
        name,
        email,
        phone || null,
        city || null,
        education_background || null,
        education_level || null,
        occupation || null,
        age ? Number(age) : null,
        instagram || null,
        phone_last_three || null,
        program_type || null,
        selected_class || null,
        package_group || null,
        package_name || null,
        finalPackagePrice > 0 ? finalPackagePrice : null,
        package_note || null,
        duration || null,
        meeting_count || null,
        study_time || null,
        start_date || null,
        preferredTutorId,
        preferredTutorName,
        friendNames || null,
        coupon_code || null,
        referral_code || null,
      ]
    );

    try {
      const registration = await findRegistrationByCode(registrationCode);
      const tasks = [
        ['email pendaftaran', sendRegistrationEmail(registration)],
        ['notifikasi admin', sendAdminNotificationEmail(registration)],
        ['sinkronisasi spreadsheet', syncRegistration(registration)],
      ];
      const results = await Promise.allSettled(tasks.map(([, p]) => p));
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`Gagal ${tasks[i][0]}:`, r.reason && r.reason.message);
        }
      });
    } catch (mailErr) {
      console.error('Gagal mengirim email pendaftaran:', mailErr.message);
    }

    // Meta Pixel: CompleteRegistration (browser + CAPI, event_id sama utk dedup).
    const regEventId = metaPixel.newEventId();
    const regValue = finalPackagePrice > 0 ? finalPackagePrice : 0;
    metaPixel.queueBrowserEvent(req, {
      eventName: 'CompleteRegistration',
      eventId: regEventId,
      params: { value: regValue, currency: 'IDR', content_name: package_name || selected_class || '' },
    });
    metaPixel.sendServerEvent({
      eventName: 'CompleteRegistration',
      eventId: regEventId,
      eventSourceUrl: metaPixel.fullUrl(req),
      userData: metaPixel.buildUserData(req, { email, phone }),
      customData: { value: regValue, currency: 'IDR', content_name: package_name || selected_class || '' },
    }).catch((e) => console.error('Meta CAPI CompleteRegistration gagal:', e.message));

    res.redirect(`/pendaftaran/${registrationCode}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Terjadi kesalahan. Coba lagi.');
    res.redirect('/register');
  }
};

exports.showRegistrationThanks = async (req, res) => {
  try {
    const registration = await findRegistrationByCode(req.params.code);
    if (!registration) {
      return res.status(404).render('error', {
        title: 'Pendaftaran Tidak Ditemukan',
        message: 'ID pendaftaran yang Anda buka tidak ditemukan.',
        user: req.session.user,
      });
    }
    res.render('auth/register-thanks', {
      title: 'Detail Pendaftaran',
      registration,
      success: req.flash('success'),
      error: req.flash('error'),
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Terjadi kesalahan. Coba lagi.');
    res.redirect('/register');
  }
};

exports.showTransferConfirmation = async (req, res) => {
  try {
    const registration = await findRegistrationByCode(req.params.code);
    if (!registration) {
      return res.status(404).render('error', {
        title: 'Pendaftaran Tidak Ditemukan',
        message: 'ID pendaftaran yang Anda buka tidak ditemukan.',
        user: req.session.user,
      });
    }
    if (registration.status === 'confirmed') {
      req.flash('success', 'Bukti transfer untuk ID ini sudah dikirim.');
      return res.redirect(`/pendaftaran/${registration.registration_code}`);
    }
    res.render('auth/confirm-transfer', {
      title: 'Konfirmasi Bukti Transfer',
      registration,
      error: req.flash('error'),
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Terjadi kesalahan. Coba lagi.');
    res.redirect(`/pendaftaran/${req.params.code}`);
  }
};

exports.showTransferLookup = (req, res) => {
  res.render('auth/confirm-transfer-lookup', {
    title: 'Cari Pendaftaran',
    error: req.flash('error'),
  });
};

exports.lookupTransferRegistration = async (req, res) => {
  const code = String(req.body.registration_code || '').trim().toUpperCase();
  if (!code) {
    req.flash('error', 'ID pendaftaran wajib diisi.');
    return res.redirect('/konfirmasi-transfer');
  }

  try {
    await ensureUserAccessColumns(query);
    const registration = await findRegistrationByCode(code);
    if (!registration) {
      req.flash('error', 'ID pendaftaran tidak ditemukan.');
      return res.redirect('/konfirmasi-transfer');
    }
    res.redirect(`/konfirmasi-transfer/${registration.registration_code}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Terjadi kesalahan. Coba lagi.');
    res.redirect('/konfirmasi-transfer');
  }
};

exports.confirmTransfer = async (req, res) => {
  const { password } = req.body;
  const code = req.params.code;

  if (!password || password.length < 6) {
    removeUploadedFile(req.file);
    req.flash('error', 'Password minimal 6 karakter.');
    return res.redirect(`/konfirmasi-transfer/${code}`);
  }
  if (!req.file) {
    req.flash('error', 'Bukti transfer wajib diupload.');
    return res.redirect(`/konfirmasi-transfer/${code}`);
  }

  try {
    const registration = await findRegistrationByCode(code);
    if (!registration) {
      removeUploadedFile(req.file);
      req.flash('error', 'ID pendaftaran tidak ditemukan.');
      return res.redirect('/register');
    }
    if (registration.status === 'confirmed') {
      removeUploadedFile(req.file);
      req.flash('success', 'Bukti transfer untuk ID ini sudah dikirim.');
      return res.redirect(`/pendaftaran/${registration.registration_code}`);
    }

    const hashed = await bcrypt.hash(password, 10);
    const proofPath = `/uploads/${req.file.filename}`;

    await ensureUserAccessColumns(query);
    const access = getAccessFromRegistration(registration);
    await query(
      `UPDATE users
       SET password = $1,
           is_active = true,
           is_vip = $2,
           is_luxury = $3,
           luxury_since = CASE WHEN $3 THEN COALESCE(luxury_since, NOW()) ELSE NULL END,
           updated_at = NOW()
       WHERE id = $4`,
      [hashed, access.isVip, access.isLuxury, registration.user_id]
    );
    await query(
      `UPDATE member_registrations
       SET transfer_proof = $1, status = 'confirmed', confirmed_at = NOW()
       WHERE registration_code = $2`,
      [proofPath, code]
    );

    req.session.user = {
      id: registration.user_id,
      name: registration.name,
      email: registration.email,
      role: 'member',
      photo: null,
      is_vip: access.isVip,
      is_luxury: access.isLuxury,
    };

    try {
      const confirmed = { ...registration, status: 'confirmed', transfer_proof: proofPath };
      const proofAbsPath = path.join(__dirname, '../../public/uploads', req.file.filename);
      const tasks = [
        ['email konfirmasi user', sendPaymentConfirmedEmail(confirmed, { password })],
        ['email konfirmasi admin', sendAdminPaymentConfirmedEmail(confirmed, { proofPath: proofAbsPath })],
        ['sinkronisasi spreadsheet', syncConfirmation(confirmed, proofPath)],
      ];
      const results = await Promise.allSettled(tasks.map(([, p]) => p));
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`Gagal ${tasks[i][0]}:`, r.reason && r.reason.message);
        }
      });
    } catch (mailErr) {
      console.error('Gagal mengirim email konfirmasi pembayaran:', mailErr.message);
    }

    // Meta Pixel: Purchase saat bukti transfer dikirim (browser + CAPI, dedup).
    const buyEventId = metaPixel.newEventId();
    const buyValue = Number(registration.package_price) || 0;
    metaPixel.queueBrowserEvent(req, {
      eventName: 'Purchase',
      eventId: buyEventId,
      params: { value: buyValue, currency: 'IDR', content_name: registration.package_name || '' },
    });
    metaPixel.sendServerEvent({
      eventName: 'Purchase',
      eventId: buyEventId,
      eventSourceUrl: metaPixel.fullUrl(req),
      userData: metaPixel.buildUserData(req, { email: registration.email, phone: registration.phone }),
      customData: { value: buyValue, currency: 'IDR', content_name: registration.package_name || '' },
    }).catch((e) => console.error('Meta CAPI Purchase gagal:', e.message));

    req.flash('success', 'Bukti transfer berhasil dikirim. Selamat datang di Member Area!');
    res.redirect('/member');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Terjadi kesalahan. Coba lagi.');
    res.redirect(`/konfirmasi-transfer/${code}`);
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
};
