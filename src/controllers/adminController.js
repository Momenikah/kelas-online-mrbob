const { query, pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const at = require('../utils/availableTime');
const { parseCsv, rowsToObjects, toCsv } = require('../utils/csv');
const { syncSchedule, syncCertificate, syncRenewal } = require('../utils/spreadsheetSync');
const {
  syncSchedulesFromSheet,
  getLastSyncRun,
  isScheduleSyncConfigured,
} = require('../utils/scheduleSheetSync');
const { sendScheduleNotificationEmails } = require('../utils/scheduleEmail');
const { normalizeReportDays, ensureMemberReportsTable } = require('../utils/memberReports');
const { ensureCertificateDetailsColumn } = require('../utils/certificates');
const { ensureSupportFeedbackTable } = require('../utils/supportFeedback');
const { ensureRenewalRequestsTable, renewalStatuses } = require('../utils/renewalRequests');
const { ensureUserAccessColumns } = require('../utils/userAccess');
const {
  isTeachingQuestionnaire,
  isTeachingMode,
  teachingRatings,
  teachingEssays,
  ratingLabels,
} = require('../utils/questionnaireTemplate');

const scheduleSheetUrl = 'https://docs.google.com/spreadsheets/d/1zAWu_GzYPlz-6mVLgLPC04_Z54P9PC8xe3sfaUC9UfU/edit?usp=sharing';

const scheduleHeaders = [
  'member_email',
  'member_name',
  'tutor_email',
  'tutor_name',
  'program_name',
  'title',
  'date',
  'start_time',
  'end_time',
  'meeting_link',
  'location',
  'notes',
];

const requiredScheduleHeaders = [
  'member_email',
  'tutor_email',
  'program_name',
  'title',
  'date',
  'start_time',
  'end_time',
];

const presenceHeaders = [
  'schedule_id',
  'date',
  'start_time',
  'end_time',
  'program_name',
  'tutor_email',
  'tutor_name',
  'member_email',
  'member_name',
  'status',
  'check_in_time',
  'updated_by',
  'source',
  'notes',
];

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeKey = (value) => String(value || '').trim().toLowerCase();
const normalizeTime = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};
const minutes = (time) => {
  const [hour, minute] = String(time).slice(0, 5).split(':').map(Number);
  return hour * 60 + minute;
};
const isValidDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};
const dateFromIso = (value) => {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day);
};
const dayOfWeek = (value) => dateFromIso(value).getDay();
const weekStart = (value) => {
  const date = dateFromIso(value);
  const diff = date.getDay() === 0 ? -6 : 1 - date.getDay();
  date.setDate(date.getDate() + diff);
  return dateOnly(date);
};
const dateOnly = (value) => {
  if (!value) return '';
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
const importHashFor = (row) => crypto
  .createHash('sha256')
  .update([
    normalizeEmail(row.member_email),
    normalizeEmail(row.tutor_email),
    normalizeKey(row.program_name),
    row.date,
    normalizeTime(row.start_time),
    normalizeTime(row.end_time),
  ].join('|'))
  .digest('hex');

async function validateScheduleRows(records) {
  const usersByEmail = new Map();
  const programsByName = new Map();
  const pendingTutorSlots = new Map();
  const pendingMemberSlots = new Map();

  const users = await query("SELECT id, name, email, role FROM users WHERE role IN ('member', 'tutor') AND is_active = true");
  users.rows.forEach((user) => usersByEmail.set(normalizeEmail(user.email), user));

  const programs = await query('SELECT id, name FROM programs WHERE is_active = true');
  programs.rows.forEach((program) => programsByName.set(normalizeKey(program.name), program));

  const validated = [];
  for (const record of records) {
    const row = { ...record };
    const errors = [];
    const warnings = [];

    row.member_email = normalizeEmail(row.member_email);
    row.tutor_email = normalizeEmail(row.tutor_email);
    row.program_name = String(row.program_name || '').trim();
    row.title = String(row.title || '').trim();
    row.date = String(row.date || '').trim();
    row.start_time = normalizeTime(row.start_time);
    row.end_time = normalizeTime(row.end_time);
    row.member = usersByEmail.get(row.member_email);
    row.tutor = usersByEmail.get(row.tutor_email);
    row.program = programsByName.get(normalizeKey(row.program_name));
    row.import_hash = importHashFor(row);

    requiredScheduleHeaders.forEach((header) => {
      if (!String(record[header] || '').trim()) errors.push(`Kolom ${header} wajib diisi.`);
    });
    if (row.member_email && !row.member) errors.push(`Member ${row.member_email} tidak ditemukan atau tidak aktif.`);
    if (row.member && row.member.role !== 'member') errors.push(`Email ${row.member_email} bukan role member.`);
    if (row.tutor_email && !row.tutor) errors.push(`Tutor ${row.tutor_email} tidak ditemukan atau tidak aktif.`);
    if (row.tutor && row.tutor.role !== 'tutor') errors.push(`Email ${row.tutor_email} bukan role tutor.`);
    if (row.program_name && !row.program) errors.push(`Program ${row.program_name} tidak ditemukan.`);
    if (!isValidDate(row.date)) errors.push('Format date harus YYYY-MM-DD.');
    if (!row.start_time) errors.push('Format start_time harus HH:mm.');
    if (!row.end_time) errors.push('Format end_time harus HH:mm.');
    if (row.start_time && row.end_time && minutes(row.end_time) <= minutes(row.start_time)) {
      errors.push('end_time harus lebih besar dari start_time.');
    }

    const duplicate = await query('SELECT id FROM schedule_members WHERE import_hash = $1', [row.import_hash]);
    row.is_duplicate = duplicate.rows.length > 0;
    if (row.is_duplicate) warnings.push('Baris ini sudah pernah diimport, akan dilewati.');

    if (errors.length === 0 && !row.is_duplicate) {
      const tutorConflict = await query(
        `SELECT id, title FROM schedules
         WHERE tutor_id = $1 AND date = $2 AND status <> 'cancelled'
           AND start_time < $4::time AND end_time > $3::time
         LIMIT 1`,
        [row.tutor.id, row.date, row.start_time, row.end_time]
      );
      if (tutorConflict.rows.length) errors.push(`Tutor bentrok dengan jadwal "${tutorConflict.rows[0].title}".`);

      const memberConflict = await query(
        `SELECT s.id, s.title FROM schedule_members sm
         JOIN schedules s ON sm.schedule_id = s.id
         WHERE sm.member_id = $1 AND s.date = $2 AND s.status <> 'cancelled'
           AND s.start_time < $4::time AND s.end_time > $3::time
         LIMIT 1`,
        [row.member.id, row.date, row.start_time, row.end_time]
      );
      if (memberConflict.rows.length) errors.push(`Member bentrok dengan jadwal "${memberConflict.rows[0].title}".`);

      if (errors.length === 0) {
        const key = `${row.tutor.id}:${row.date}`;
        const pendingTutor = pendingTutorSlots.get(key) || [];
        if (pendingTutor.some((slot) => minutes(slot.start) < minutes(row.end_time) && minutes(slot.end) > minutes(row.start_time))) {
          errors.push('Tutor bentrok dengan baris lain di CSV ini.');
        }
        if (errors.length === 0) {
          pendingTutor.push({ start: row.start_time, end: row.end_time });
          pendingTutorSlots.set(key, pendingTutor);
        }
      }

      if (errors.length === 0) {
        const memberKey = `${row.member.id}:${row.date}`;
        const pendingMember = pendingMemberSlots.get(memberKey) || [];
        if (pendingMember.some((slot) => minutes(slot.start) < minutes(row.end_time) && minutes(slot.end) > minutes(row.start_time))) {
          errors.push('Member bentrok dengan baris lain di CSV ini.');
        }
        if (errors.length === 0) {
          pendingMember.push({ start: row.start_time, end: row.end_time });
          pendingMemberSlots.set(memberKey, pendingMember);
        }
      }

      const available = await query(
        `SELECT * FROM available_times
         WHERE tutor_id = $1 AND is_available = true
           AND start_time <= $2::time AND end_time >= $3::time
           AND (period_start IS NULL OR period_start = $4::date)`,
        [row.tutor.id, row.start_time, row.end_time, weekStart(row.date)]
      );
      const day = dayOfWeek(row.date);
      const insideAvailableTime = available.rows.some((slot) => at.expandDays(slot.day_category, slot.custom_days).includes(day));
      if (!insideAvailableTime) warnings.push('Jadwal di luar available time tutor.');
    }

    validated.push({ row, errors, warnings });
  }

  return validated;
}

exports.dashboard = async (req, res) => {
  try {
    await ensureSupportFeedbackTable(query);
    const [statsRes, recentUsers, pendingRegs, upcoming] = await Promise.all([
      query(`SELECT
                (SELECT COUNT(*) FROM users) AS total_users,
                (SELECT COUNT(*) FROM users WHERE role = 'member') AS members,
                (SELECT COUNT(*) FROM users WHERE role = 'tutor') AS tutors,
                (SELECT COUNT(*) FROM enrollments WHERE status = 'active') AS active_enrollments,
                (SELECT COUNT(*) FROM schedules) AS schedules,
                (SELECT COUNT(*) FROM programs WHERE is_active = true) AS programs,
                (SELECT COUNT(*) FROM member_registrations WHERE status = 'pending_payment') AS pending_payments,
                (SELECT COUNT(*) FROM support_feedback WHERE status IN ('new','in_progress')) AS pending_feedback,
                (SELECT COUNT(*) FROM schedules WHERE date >= CURRENT_DATE AND status <> 'cancelled') AS upcoming_schedules`),
      query('SELECT * FROM users ORDER BY created_at DESC LIMIT 8'),
      query(`SELECT user_id, registration_code, name, email, selected_class, package_name, package_price, created_at
             FROM member_registrations WHERE status = 'pending_payment'
             ORDER BY created_at DESC LIMIT 6`),
      query(`SELECT s.id, s.title, s.date, s.start_time, s.end_time,
                    p.name AS program_name, u.name AS tutor_name,
                    COUNT(sm.member_id) AS member_count
             FROM schedules s
             JOIN programs p ON s.program_id = p.id
             JOIN users u ON s.tutor_id = u.id
             LEFT JOIN schedule_members sm ON sm.schedule_id = s.id
             WHERE s.date >= CURRENT_DATE AND s.status <> 'cancelled'
             GROUP BY s.id, p.name, u.name
             ORDER BY s.date, s.start_time LIMIT 6`),
    ]);
    const s = statsRes.rows[0];
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      user: req.session.user,
      stats: {
        totalUsers: s.total_users,
        totalMembers: s.members,
        totalTutors: s.tutors,
        activeEnrollments: s.active_enrollments,
        totalSchedules: s.schedules,
        totalPrograms: s.programs,
        pendingPayments: Number(s.pending_payments),
        pendingFeedback: Number(s.pending_feedback),
        upcomingSchedules: s.upcoming_schedules,
      },
      recentUsers: recentUsers.rows,
      pendingRegistrations: pendingRegs.rows,
      upcomingSchedules: upcoming.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

// Build the WHERE clause + params shared by the user list and CSV export.
const buildUserFilter = ({ role, search, status }) => {
  const where = ['1=1'];
  const params = [];
  if (role) { params.push(role); where.push(`role = $${params.length}`); }
  if (status === 'active') where.push('is_active = true');
  if (status === 'inactive') where.push('is_active = false');
  if (search) {
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`);
  }
  return { whereSql: where.join(' AND '), params };
};

exports.users = async (req, res) => {
  try {
    await ensureUserAccessColumns(query);
    // Each role is its own tab/page; default to the Member tab.
    const role = ['member', 'tutor', 'admin'].includes(req.query.role) ? req.query.role : 'member';
    const search = (req.query.search || '').trim();
    const status = req.query.status || '';
    const perPage = 15;
    const page = Math.max(1, Number(req.query.page) || 1);

    const { whereSql, params } = buildUserFilter({ role, search, status });

    const [countRes, statsRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM users WHERE ${whereSql}`, params),
      query(`SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE role = 'member') AS members,
                COUNT(*) FILTER (WHERE role = 'tutor') AS tutors,
                COUNT(*) FILTER (WHERE role = 'admin') AS admins,
                COUNT(*) FILTER (WHERE is_active = true) AS active,
                COUNT(*) FILTER (WHERE is_vip = true) AS vip,
                COUNT(*) FILTER (WHERE is_luxury = true) AS luxury
              FROM users`),
    ]);

    const total = Number(countRes.rows[0].count);
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * perPage;

    const listParams = [...params, perPage, offset];
    const result = await query(
      `SELECT * FROM users WHERE ${whereSql}
       ORDER BY created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    res.render('admin/users', {
      title: 'Kelola Pengguna',
      user: req.session.user,
      users: result.rows,
      filters: { role, search, status },
      stats: statsRes.rows[0],
      pagination: { page: currentPage, totalPages, total, perPage },
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.exportUsersCsv = async (req, res) => {
  try {
    await ensureUserAccessColumns(query);
    const { whereSql, params } = buildUserFilter({
      role: req.query.role || '',
      search: (req.query.search || '').trim(),
      status: req.query.status || '',
    });
    const result = await query(
      `SELECT id, name, email, phone, role, is_vip, is_luxury, tutor_grade, is_active, bio, created_at
       FROM users WHERE ${whereSql} ORDER BY created_at DESC`,
      params
    );
    const rows = result.rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone || '',
      role: u.role,
      is_vip: u.is_vip,
      is_luxury: u.is_luxury,
      tutor_grade: u.tutor_grade || '',
      is_active: u.is_active,
      bio: u.bio || '',
      created_at: u.created_at ? new Date(u.created_at).toISOString() : '',
    }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.send(toCsv(['id', 'name', 'email', 'phone', 'role', 'is_vip', 'is_luxury', 'tutor_grade', 'is_active', 'bio', 'created_at'], rows));
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal export pengguna.');
    res.redirect('/admin/users');
  }
};

const USER_ROLES = ['member', 'tutor', 'admin'];
const TUTOR_GRADES = ['A', 'B', 'C'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isChecked = (value) => value === 'on' || value === 'true' || value === true;
const normalizeTutorGrade = (value) => {
  const grade = String(value || 'B').trim().toUpperCase();
  return TUTOR_GRADES.includes(grade) ? grade : 'B';
};

exports.createUser = async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = String(req.body.role || 'member');
  const phone = String(req.body.phone || '').trim() || null;
  const bio = String(req.body.bio || '').trim() || null;
  // VIP is a member-only concept.
  const isVip = role === 'member' && isChecked(req.body.is_vip);
  const isLuxury = role === 'member' && isChecked(req.body.is_luxury);
  const tutorGrade = role === 'tutor' ? normalizeTutorGrade(req.body.tutor_grade) : null;

  try {
    await ensureUserAccessColumns(query);
    if (!name || !email || !password) {
      req.flash('error', 'Nama, email, dan password wajib diisi.');
      return res.redirect('/admin/users');
    }
    if (!EMAIL_RE.test(email)) {
      req.flash('error', 'Format email tidak valid.');
      return res.redirect('/admin/users');
    }
    if (password.length < 6) {
      req.flash('error', 'Password minimal 6 karakter.');
      return res.redirect('/admin/users');
    }
    if (!USER_ROLES.includes(role)) {
      req.flash('error', 'Role tidak valid.');
      return res.redirect('/admin/users');
    }

    const dupe = await query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (dupe.rows.length) {
      req.flash('error', `Email ${email} sudah terdaftar.`);
      return res.redirect('/admin/users');
    }

    const hashed = await bcrypt.hash(password, 10);
    await query(
      'INSERT INTO users (name, email, password, role, phone, is_vip, is_luxury, luxury_since, tutor_grade, is_active, bio) VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7 THEN NOW() ELSE NULL END,$8,true,$9)',
      [name, email, hashed, role, phone, isVip, isLuxury, tutorGrade, bio]
    );
    req.flash('success', `${role === 'tutor' ? 'Tutor' : 'Pengguna'} ${name} berhasil ditambahkan.`);
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menambahkan pengguna.');
    res.redirect('/admin/users');
  }
};

exports.updateUser = async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = String(req.body.role || 'member');
  const phone = String(req.body.phone || '').trim() || null;
  const bio = String(req.body.bio || '').trim() || null;
  const newPassword = String(req.body.password || '');
  const isVip = role === 'member' && isChecked(req.body.is_vip);
  const isLuxury = role === 'member' && isChecked(req.body.is_luxury);
  const tutorGrade = role === 'tutor' ? normalizeTutorGrade(req.body.tutor_grade) : null;
  const isActive = isChecked(req.body.is_active);
  const isSelf = id === req.session.user.id;
  // Return to the detail page when the edit was submitted from there.
  const back = req.body.redirect_to === 'detail' ? `/admin/users/${id}` : '/admin/users';

  try {
    await ensureUserAccessColumns(query);
    if (!name || !email) {
      req.flash('error', 'Nama dan email wajib diisi.');
      return res.redirect(back);
    }
    if (!EMAIL_RE.test(email)) {
      req.flash('error', 'Format email tidak valid.');
      return res.redirect(back);
    }
    if (!USER_ROLES.includes(role)) {
      req.flash('error', 'Role tidak valid.');
      return res.redirect(back);
    }
    if (newPassword && newPassword.length < 6) {
      req.flash('error', 'Password baru minimal 6 karakter.');
      return res.redirect(back);
    }

    const existing = await query('SELECT id FROM users WHERE id = $1', [id]);
    if (!existing.rows.length) {
      req.flash('error', 'Pengguna tidak ditemukan.');
      return res.redirect('/admin/users');
    }

    // Prevent an admin from locking themselves out.
    if (isSelf && (role !== 'admin' || !isActive)) {
      req.flash('error', 'Tidak bisa menurunkan role atau menonaktifkan akun Anda sendiri.');
      return res.redirect(back);
    }

    const dupe = await query('SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2', [email, id]);
    if (dupe.rows.length) {
      req.flash('error', `Email ${email} sudah dipakai pengguna lain.`);
      return res.redirect(back);
    }

    await query(
      `UPDATE users
       SET name=$1, email=$2, role=$3, phone=$4, is_vip=$5, is_luxury=$6,
           luxury_since = CASE WHEN $6 THEN COALESCE(luxury_since, NOW()) ELSE NULL END,
           tutor_grade=$7, is_active=$8, bio=$9, updated_at=NOW()
       WHERE id=$10`,
      [name, email, role, phone, isVip, isLuxury, tutorGrade, isActive, bio, id]
    );
    if (newPassword) {
      const hashed = await bcrypt.hash(newPassword, 10);
      await query('UPDATE users SET password=$1, updated_at=NOW() WHERE id=$2', [hashed, id]);
    }

    // Keep the session in sync if the admin edited their own account.
    if (isSelf) {
      req.session.user.name = name;
      req.session.user.email = email;
      req.session.user.is_vip = isVip;
      req.session.user.is_luxury = isLuxury;
    }

    req.flash('success', `Pengguna ${name} berhasil diperbarui.`);
    res.redirect(back);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperbarui pengguna.');
    res.redirect(back);
  }
};

exports.userDetail = async (req, res) => {
  try {
    await ensureUserAccessColumns(query);
    const id = Number(req.params.id);
    const userResult = await query('SELECT * FROM users WHERE id = $1', [id]);
    if (!userResult.rows.length) {
      req.flash('error', 'Pengguna tidak ditemukan.');
      return res.redirect('/admin/users');
    }

    const [regResult, enrollResult] = await Promise.all([
      query('SELECT * FROM member_registrations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [id]),
      query(
        `SELECT e.*, p.name AS program_name
         FROM enrollments e JOIN programs p ON e.program_id = p.id
         WHERE e.member_id = $1 ORDER BY e.created_at DESC`,
        [id]
      ),
    ]);

    res.render('admin/user-detail', {
      title: 'Detail Pengguna',
      user: req.session.user,
      profile: userResult.rows[0],
      registration: regResult.rows[0] || null,
      enrollments: enrollResult.rows,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

// Admin edits a member's registration/profile data (the fields captured at signup).
// Payment status, confirmation timestamp, and transfer proof stay owned by the
// payment-confirmation flow and are intentionally not editable here.
exports.updateRegistration = async (req, res) => {
  const userId = Number(req.params.id);
  const regId = Number(req.body.registration_id);
  const back = `/admin/users/${userId}`;
  const clean = (val) => {
    const s = String(val ?? '').trim();
    return s === '' ? null : s;
  };
  const toInt = (val) => {
    const n = parseInt(String(val ?? '').replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };

  try {
    if (!regId) {
      req.flash('error', 'Data pendaftaran tidak ditemukan.');
      return res.redirect(back);
    }
    const existing = await query(
      'SELECT id FROM member_registrations WHERE id = $1 AND user_id = $2',
      [regId, userId]
    );
    if (!existing.rows.length) {
      req.flash('error', 'Data pendaftaran tidak ditemukan.');
      return res.redirect(back);
    }

    const phoneLastThree = String(req.body.phone_last_three ?? '').replace(/\D/g, '').slice(0, 3) || null;

    await query(
      `UPDATE member_registrations SET
         city=$1, education_background=$2, education_level=$3, occupation=$4, age=$5,
         instagram=$6, friend_name=$7, program_type=$8, selected_class=$9, package_group=$10,
         package_name=$11, package_price=$12, duration=$13, meeting_count=$14, study_time=$15,
         start_date=$16, preferred_tutor=$17, phone_last_three=$18, coupon_code=$19, referral_code=$20
       WHERE id=$21`,
      [
        clean(req.body.city), clean(req.body.education_background), clean(req.body.education_level),
        clean(req.body.occupation), toInt(req.body.age), clean(req.body.instagram),
        clean(req.body.friend_name), clean(req.body.program_type), clean(req.body.selected_class),
        clean(req.body.package_group), clean(req.body.package_name), toInt(req.body.package_price),
        clean(req.body.duration), clean(req.body.meeting_count), clean(req.body.study_time),
        clean(req.body.start_date), clean(req.body.preferred_tutor), phoneLastThree,
        clean(req.body.coupon_code), clean(req.body.referral_code), regId,
      ]
    );

    req.flash('success', 'Data pendaftaran member berhasil diperbarui.');
    res.redirect(back);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperbarui data pendaftaran.');
    res.redirect(back);
  }
};

exports.deleteUser = async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (id === req.session.user.id) {
      req.flash('error', 'Tidak bisa menghapus akun Anda sendiri.');
      return res.redirect('/admin/users');
    }
    const result = await query('DELETE FROM users WHERE id = $1 RETURNING name', [id]);
    if (!result.rows.length) {
      req.flash('error', 'Pengguna tidak ditemukan.');
    } else {
      req.flash('success', `Pengguna ${result.rows[0].name} berhasil dihapus.`);
    }
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    if (err.code === '23503') {
      req.flash('error', 'Pengguna tidak bisa dihapus karena masih memiliki data terkait (enrollment/jadwal/presensi). Nonaktifkan saja.');
    } else {
      req.flash('error', 'Gagal menghapus pengguna.');
    }
    res.redirect('/admin/users');
  }
};

exports.toggleUserStatus = async (req, res) => {
  try {
    if (Number(req.params.id) === req.session.user.id) {
      req.flash('error', 'Tidak bisa menonaktifkan akun Anda sendiri.');
      return res.redirect('/admin/users');
    }
    await query('UPDATE users SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1', [req.params.id]);
    req.flash('success', 'Status pengguna diperbarui.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengubah status.');
    res.redirect('/admin/users');
  }
};

exports.toggleVip = async (req, res) => {
  try {
    await query("UPDATE users SET is_vip = CASE WHEN role = 'member' THEN NOT is_vip ELSE false END, updated_at = NOW() WHERE id = $1", [req.params.id]);
    req.flash('success', 'Status VIP diperbarui.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengubah status VIP.');
    res.redirect('/admin/users');
  }
};

exports.toggleLuxury = async (req, res) => {
  try {
    await ensureUserAccessColumns(query);
    await query(
      `UPDATE users
       SET is_luxury = CASE WHEN role = 'member' THEN NOT COALESCE(is_luxury, false) ELSE false END,
           luxury_since = CASE
             WHEN role = 'member' AND COALESCE(is_luxury, false) = false THEN NOW()
             ELSE NULL
           END,
           updated_at = NOW()
       WHERE id = $1`,
      [req.params.id]
    );
    req.flash('success', 'Status Luxury Class diperbarui.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengubah status Luxury.');
    res.redirect('/admin/users');
  }
};

const ENROLLMENT_STATUSES = ['active', 'expired', 'suspended'];

exports.enrollments = async (req, res) => {
  try {
    await ensureRenewalRequestsTable(query);
    // Keep the system consistent: auto-expire active enrollments past their end date.
    await query("UPDATE enrollments SET status = 'expired' WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE");
    const search = (req.query.search || '').trim();
    const programId = req.query.program_id || '';
    const status = req.query.status || '';

    const where = ['1=1'];
    const params = [];
    if (programId) { params.push(Number(programId)); where.push(`e.program_id = $${params.length}`); }
    if (ENROLLMENT_STATUSES.includes(status)) { params.push(status); where.push(`e.status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }

    const [enrollResult, membersResult, programsResult, statsResult, renewalRequestsResult] = await Promise.all([
      query(
        `SELECT e.*, u.name as member_name, u.email, p.name as program_name
         FROM enrollments e JOIN users u ON e.member_id = u.id JOIN programs p ON e.program_id = p.id
         WHERE ${where.join(' AND ')}
         ORDER BY e.created_at DESC`,
        params
      ),
      query("SELECT id, name, email FROM users WHERE role = 'member' AND is_active = true ORDER BY name"),
      query("SELECT id, name, duration_months FROM programs WHERE is_active = true ORDER BY name"),
      query(`SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'active') AS active,
                COUNT(*) FILTER (WHERE status = 'expired') AS expired,
                COUNT(*) FILTER (WHERE status = 'suspended') AS suspended,
                COUNT(*) FILTER (WHERE status = 'active' AND end_date IS NOT NULL AND end_date >= CURRENT_DATE AND end_date <= CURRENT_DATE + INTERVAL '14 days') AS expiring,
                COUNT(DISTINCT member_id) AS members
              FROM enrollments`),
      query(`SELECT rr.*, u.name AS member_name, u.email, p.name AS program_name, p.duration_months
             FROM renewal_requests rr
             JOIN users u ON u.id = rr.member_id
             JOIN programs p ON p.id = rr.program_id
             WHERE rr.status IN ('pending', 'approved')
             ORDER BY CASE rr.status WHEN 'pending' THEN 0 ELSE 1 END, rr.created_at DESC
             LIMIT 12`),
    ]);
    // Annotate each enrollment with days-left + an urgency level for the UI.
    const nowTs = Date.now();
    const enrollments = enrollResult.rows.map((e) => {
      const end = e.end_date ? new Date(e.end_date) : null;
      const daysLeft = end ? Math.ceil((end.getTime() - nowTs) / 86400000) : null;
      let urgency = 'safe';
      if (e.status === 'expired' || (daysLeft !== null && daysLeft < 0)) urgency = 'expired';
      else if (e.status === 'suspended') urgency = 'suspended';
      else if (daysLeft !== null && daysLeft <= 7) urgency = 'danger';
      else if (daysLeft !== null && daysLeft <= 14) urgency = 'warning';
      return { ...e, days_left: daysLeft, urgency };
    });

    res.render('admin/enrollments', {
      title: 'Kelola Enrollment',
      user: req.session.user,
      enrollments,
      members: membersResult.rows,
      programs: programsResult.rows,
      renewalRequests: renewalRequestsResult.rows,
      filters: { search, programId, status },
      stats: statsResult.rows[0],
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

const validateEnrollmentDates = (start, end) => {
  if (!start || !end) return 'Tanggal mulai dan berakhir wajib diisi.';
  if (end < start) return 'Tanggal berakhir tidak boleh sebelum tanggal mulai.';
  return null;
};

const addMonthsIso = (startDate, months = 1) => {
  const date = dateFromIso(startDate);
  date.setMonth(date.getMonth() + Number(months || 1));
  date.setDate(date.getDate() - 1);
  return dateOnly(date);
};

exports.createEnrollment = async (req, res) => {
  try {
    const memberId = Number(req.body.member_id);
    const programId = Number(req.body.program_id);
    const startDate = req.body.start_date;
    const endDate = req.body.end_date;
    const status = ENROLLMENT_STATUSES.includes(req.body.status) ? req.body.status : 'active';

    if (!memberId || !programId) {
      req.flash('error', 'Pilih member dan program.');
      return res.redirect('/admin/enrollments');
    }
    const dateErr = validateEnrollmentDates(startDate, endDate);
    if (dateErr) { req.flash('error', dateErr); return res.redirect('/admin/enrollments'); }

    const existing = await query('SELECT id FROM enrollments WHERE member_id = $1 AND program_id = $2', [memberId, programId]);
    await query(
      `INSERT INTO enrollments (member_id, program_id, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (member_id, program_id) DO UPDATE SET start_date=$3, end_date=$4, status=$5`,
      [memberId, programId, startDate, endDate, status]
    );
    req.flash('success', existing.rows.length
      ? 'Enrollment yang sudah ada berhasil diperbarui.'
      : 'Enrollment berhasil ditambahkan.');
    res.redirect('/admin/enrollments');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menyimpan enrollment.');
    res.redirect('/admin/enrollments');
  }
};

exports.updateRenewalRequest = async (req, res) => {
  try {
    await ensureRenewalRequestsTable(query);
    const id = Number(req.params.id);
    const action = String(req.body.action || '').trim();
    const adminNotes = String(req.body.admin_notes || '').trim();

    const requestResult = await query(`
      SELECT rr.*, p.duration_months, p.name AS program_name
      FROM renewal_requests rr
      JOIN programs p ON p.id = rr.program_id
      WHERE rr.id = $1
    `, [id]);
    const request = requestResult.rows[0];
    if (!request) {
      req.flash('error', 'Request renewal tidak ditemukan.');
      return res.redirect('/admin/enrollments');
    }

    if (action === 'approve') {
      const startDate = req.body.start_date || dateOnly(request.preferred_start_date) || dateOnly(new Date());
      const endDate = req.body.end_date || addMonthsIso(startDate, request.duration_months || 1);
      const dateErr = validateEnrollmentDates(startDate, endDate);
      if (dateErr) {
        req.flash('error', dateErr);
        return res.redirect('/admin/enrollments');
      }

      await query(`
        INSERT INTO enrollments (member_id, program_id, start_date, end_date, status)
        VALUES ($1,$2,$3,$4,'active')
        ON CONFLICT (member_id, program_id)
        DO UPDATE SET start_date=$3, end_date=$4, status='active'
      `, [request.member_id, request.program_id, startDate, endDate]);

      await query(`
        UPDATE renewal_requests
        SET status='approved', admin_notes=$1, processed_at=NOW(), updated_at=NOW()
        WHERE id=$2
      `, [adminNotes || null, id]);
      // Push the new status to the spreadsheet (upsert by renewal_id).
      syncRenewal(id).catch((e) => console.error('Gagal sinkronisasi renewal ke spreadsheet:', e.message));
      req.flash('success', `Request renewal ${request.program_name} disetujui dan enrollment diperbarui.`);
      return res.redirect('/admin/enrollments');
    }

    const nextStatus = renewalStatuses.includes(action) ? action : 'rejected';
    await query(`
      UPDATE renewal_requests
      SET status=$1, admin_notes=$2, processed_at=NOW(), updated_at=NOW()
      WHERE id=$3
    `, [nextStatus, adminNotes || null, id]);
    syncRenewal(id).catch((e) => console.error('Gagal sinkronisasi renewal ke spreadsheet:', e.message));
    req.flash('success', `Request renewal berhasil diubah menjadi ${nextStatus}.`);
    return res.redirect('/admin/enrollments');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memproses request renewal.');
    return res.redirect('/admin/enrollments');
  }
};

exports.updateEnrollment = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const startDate = req.body.start_date;
    const endDate = req.body.end_date;
    const status = ENROLLMENT_STATUSES.includes(req.body.status) ? req.body.status : 'active';

    const dateErr = validateEnrollmentDates(startDate, endDate);
    if (dateErr) { req.flash('error', dateErr); return res.redirect('/admin/enrollments'); }

    const result = await query(
      'UPDATE enrollments SET start_date=$1, end_date=$2, status=$3 WHERE id=$4 RETURNING id',
      [startDate, endDate, status, id]
    );
    if (!result.rows.length) req.flash('error', 'Enrollment tidak ditemukan.');
    else req.flash('success', 'Enrollment berhasil diperbarui.');
    res.redirect('/admin/enrollments');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperbarui enrollment.');
    res.redirect('/admin/enrollments');
  }
};

exports.deleteEnrollment = async (req, res) => {
  try {
    const result = await query('DELETE FROM enrollments WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) req.flash('error', 'Enrollment tidak ditemukan.');
    else req.flash('success', 'Enrollment berhasil dihapus.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menghapus enrollment.');
  }
  res.redirect('/admin/enrollments');
};

// One-click extend: push end_date forward N months and reactivate. Extends from
// the current end date if still in the future, otherwise from today.
exports.extendEnrollment = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const months = Math.min(12, Math.max(1, Number(req.body.months) || 1));
    const result = await query('SELECT id, end_date FROM enrollments WHERE id = $1', [id]);
    const enrollment = result.rows[0];
    if (!enrollment) {
      req.flash('error', 'Enrollment tidak ditemukan.');
      return res.redirect('/admin/enrollments');
    }
    const todayIso = dateOnly(new Date());
    const endIso = enrollment.end_date ? dateOnly(enrollment.end_date) : todayIso;
    const baseIso = endIso > todayIso ? endIso : todayIso;
    const d = dateFromIso(baseIso);
    d.setMonth(d.getMonth() + months);
    const newEnd = dateOnly(d);
    await query("UPDATE enrollments SET end_date = $1, status = 'active' WHERE id = $2", [newEnd, id]);
    req.flash('success', `Enrollment diperpanjang ${months} bulan (berakhir ${newEnd}).`);
    res.redirect('/admin/enrollments');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperpanjang enrollment.');
    res.redirect('/admin/enrollments');
  }
};

const getScheduleStats = async () => {
  const r = await query(`SELECT
    (SELECT COUNT(*) FROM schedules) AS total,
    (SELECT COUNT(*) FROM schedules WHERE date >= CURRENT_DATE AND status <> 'cancelled') AS upcoming,
    (SELECT COUNT(*) FROM schedule_imports) AS imports`);
  return r.rows[0];
};

exports.scheduleImport = async (req, res) => {
  try {
    const period = /^\d{4}-\d{2}-\d{2}$/.test(req.query.period || '') ? req.query.period : '';
    const scheduleParams = [];
    let periodFilter = '';
    if (period) { scheduleParams.push(period); periodFilter = ` WHERE date_trunc('week', s.date)::date = $${scheduleParams.length}::date`; }

    const [imports, schedules, stats, periodsResult] = await Promise.all([
      query(
        `SELECT si.*, u.name as created_by_name
         FROM schedule_imports si
         LEFT JOIN users u ON si.created_by = u.id
         ORDER BY si.created_at DESC LIMIT 10`
      ),
      query(`
        SELECT s.*, p.name as program_name, tutor.name as tutor_name,
               STRING_AGG(member.name, ', ' ORDER BY member.name) as member_names,
               COUNT(sm.member_id) as member_count
        FROM schedules s
        JOIN programs p ON s.program_id = p.id
        JOIN users tutor ON s.tutor_id = tutor.id
        LEFT JOIN schedule_members sm ON sm.schedule_id = s.id
        LEFT JOIN users member ON sm.member_id = member.id${periodFilter}
        GROUP BY s.id, p.name, tutor.name
        ORDER BY s.date DESC, s.start_time DESC
        LIMIT 30
      `, scheduleParams),
      getScheduleStats(),
      query(`
        SELECT DISTINCT date_trunc('week', s.date)::date AS period_start
        FROM schedules s
        ORDER BY period_start DESC
      `),
    ]);
    const periods = periodsResult.rows.map((r) => ({
      value: at.toISODate(r.period_start),
      label: at.formatPeriodRange(at.toISODate(r.period_start)),
    }));
    const lastSync = await getLastSyncRun();
    res.render('admin/schedule-import', {
      title: 'Sync Jadwal',
      user: req.session.user,
      sheetUrl: scheduleSheetUrl,
      expectedHeaders: scheduleHeaders,
      imports: imports.rows,
      schedules: schedules.rows,
      periods,
      filters: { period },
      stats,
      syncConfigured: isScheduleSyncConfigured(),
      lastSync,
      previewRows: [],
      result: null,
      errorReportId: null,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

// Manual "Sync Sekarang" — pull the master sheet and reconcile schedules.
exports.scheduleSyncNow = async (req, res) => {
  try {
    if (!isScheduleSyncConfigured()) {
      req.flash('error', 'Sumber Google Sheet belum dikonfigurasi (SCHEDULE_SOURCE_URL kosong).');
      return res.redirect('/admin/schedule-import');
    }
    const s = await syncSchedulesFromSheet({ triggeredBy: `admin:${req.session.user.id}` });
    if (s.ok) {
      req.flash('success', `Sync jadwal selesai — ${s.message}.`);
    } else {
      req.flash('error', `Sync jadwal gagal: ${s.message}`);
    }
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menjalankan sync jadwal.');
  }
  return res.redirect('/admin/schedule-import');
};

exports.importScheduleCsv = async (req, res) => {
  let result = {
    totalRows: 0,
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    details: [],
  };
  let previewRows = [];
  let errorReportId = null;

  try {
    if (!req.file) {
      req.flash('error', 'Pilih file CSV schedule terlebih dahulu.');
      return res.redirect('/admin/schedule-import');
    }

    const text = req.file.buffer.toString('utf8');
    const parsed = rowsToObjects(parseCsv(text));
    const normalizedHeaders = parsed.headers.map((header) => normalizeKey(header));
    const missing = requiredScheduleHeaders.filter((header) => !normalizedHeaders.includes(header));

    if (missing.length) {
      const errorReportCsv = toCsv(['row_number', 'errors', 'warnings'], [{
        row_number: 1,
        errors: `Header wajib tidak ditemukan: ${missing.join(', ')}`,
        warnings: '',
      }]);
      const saved = await query(
        `INSERT INTO schedule_imports
           (filename, status, total_rows, success_count, error_count, error_report_csv, created_by)
         VALUES ($1, 'failed', 0, 0, 1, $2, $3) RETURNING id`,
        [req.file.originalname, errorReportCsv, req.session.user.id]
      );
      req.flash('error', `Header CSV belum sesuai. Missing: ${missing.join(', ')}`);
      return res.redirect(`/admin/schedule-import?report=${saved.rows[0].id}`);
    }

    const canonicalRecords = parsed.records.map((record) => {
      const mapped = {};
      parsed.headers.forEach((header) => {
        mapped[normalizeKey(header)] = record[header];
      });
      mapped.__rowNumber = record.__rowNumber;
      return mapped;
    });

    result.totalRows = canonicalRecords.length;
    previewRows = canonicalRecords.slice(0, 10);
    const validated = await validateScheduleRows(canonicalRecords);
    result.details = validated.map((item) => ({
      rowNumber: item.row.__rowNumber,
      title: item.row.title,
      member_email: item.row.member_email,
      tutor_email: item.row.tutor_email,
      date: item.row.date,
      start_time: item.row.start_time,
      end_time: item.row.end_time,
      errors: item.errors,
      warnings: item.warnings,
    }));

    const notifyScheduleIds = new Set();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of validated) {
        if (item.errors.length) continue;
        if (item.row.is_duplicate) {
          result.skippedCount += 1;
          continue;
        }

        const existingSchedule = await client.query(
          `SELECT id FROM schedules
           WHERE tutor_id = $1 AND program_id = $2 AND title = $3 AND date = $4
             AND start_time = $5::time AND end_time = $6::time
           LIMIT 1`,
          [
            item.row.tutor.id,
            item.row.program.id,
            item.row.title,
            item.row.date,
            item.row.start_time,
            item.row.end_time,
          ]
        );

        let scheduleId = existingSchedule.rows[0] && existingSchedule.rows[0].id;
        if (!scheduleId) {
          const inserted = await client.query(
            `INSERT INTO schedules
               (tutor_id, program_id, title, description, date, start_time, end_time, location, meeting_link, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'upcoming')
             RETURNING id`,
            [
              item.row.tutor.id,
              item.row.program.id,
              item.row.title,
              item.row.notes || null,
              item.row.date,
              item.row.start_time,
              item.row.end_time,
              item.row.location || null,
              item.row.meeting_link || null,
            ]
          );
          scheduleId = inserted.rows[0].id;
        }

        await client.query(
          `INSERT INTO schedule_members (schedule_id, member_id, import_hash)
           VALUES ($1,$2,$3)
           ON CONFLICT (schedule_id, member_id) DO UPDATE SET import_hash = COALESCE(schedule_members.import_hash, EXCLUDED.import_hash)`,
          [scheduleId, item.row.member.id, item.row.import_hash]
        );
        const presenceInsert = await client.query(
          `INSERT INTO presences (schedule_id, member_id, status, notes, updated_by, updated_at, source)
           VALUES ($1,$2,'absent',$3,$4,NOW(),'import')
           ON CONFLICT (schedule_id, member_id) DO NOTHING
           RETURNING id`,
          [scheduleId, item.row.member.id, item.row.notes || null, req.session.user.id]
        );
        // Only notify when the member is newly attached to this session (avoid
        // re-notifying on re-imports of an existing schedule/member pair).
        if (presenceInsert.rows.length) {
          const tutorName = (item.row.tutor && item.row.tutor.name) || 'Tutor';
          await client.query(
            `INSERT INTO notifications (user_id, title, message, type)
             VALUES ($1, 'Jadwal Baru', $2, 'info')`,
            [item.row.member.id, `Sesi "${item.row.title}" dijadwalkan ${item.row.date} jam ${item.row.start_time}-${item.row.end_time} bersama ${tutorName}.`]
          );
        }
        notifyScheduleIds.add(scheduleId);
        result.successCount += 1;
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    result.errorCount = validated.filter((item) => item.errors.length).length;
    // Integration: push each imported schedule to the spreadsheet + email members,
    // matching the plot flow so both entry points stay fully in sync.
    notifyScheduleIds.forEach((sid) => {
      syncSchedule(sid).catch((e) => console.error('Gagal sinkronisasi jadwal ke spreadsheet:', e.message));
      sendScheduleNotificationEmails(sid, { subjectPrefix: 'Jadwal Belajar Baru' })
        .catch((e) => console.error('Gagal mengirim email jadwal:', e.message));
    });
    const status = result.successCount > 0 && result.errorCount > 0
      ? 'partial'
      : result.successCount > 0 || result.skippedCount > 0
        ? 'imported'
        : 'failed';
    const errorRows = validated
      .filter((item) => item.errors.length || item.warnings.length)
      .map((item) => ({
        row_number: item.row.__rowNumber,
        member_email: item.row.member_email,
        tutor_email: item.row.tutor_email,
        title: item.row.title,
        date: item.row.date,
        start_time: item.row.start_time,
        end_time: item.row.end_time,
        errors: item.errors.join(' | '),
        warnings: item.warnings.join(' | '),
      }));
    const errorReportCsv = toCsv(
      ['row_number', 'member_email', 'tutor_email', 'title', 'date', 'start_time', 'end_time', 'errors', 'warnings'],
      errorRows
    );
    const saved = await query(
      `INSERT INTO schedule_imports
         (filename, status, total_rows, success_count, error_count, error_report_csv, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.file.originalname, status, result.totalRows, result.successCount + result.skippedCount, result.errorCount, errorReportCsv, req.session.user.id]
    );
    errorReportId = saved.rows[0].id;

    const imports = await query(
      `SELECT si.*, u.name as created_by_name
       FROM schedule_imports si
       LEFT JOIN users u ON si.created_by = u.id
       ORDER BY si.created_at DESC LIMIT 10`
    );
    const schedules = await query(`
      SELECT s.*, p.name as program_name, tutor.name as tutor_name,
             STRING_AGG(member.name, ', ' ORDER BY member.name) as member_names,
             COUNT(sm.member_id) as member_count
      FROM schedules s
      JOIN programs p ON s.program_id = p.id
      JOIN users tutor ON s.tutor_id = tutor.id
      LEFT JOIN schedule_members sm ON sm.schedule_id = s.id
      LEFT JOIN users member ON sm.member_id = member.id
      GROUP BY s.id, p.name, tutor.name
      ORDER BY s.date DESC, s.start_time DESC
      LIMIT 30
    `);
    const periodsResult = await query(`
      SELECT DISTINCT date_trunc('week', s.date)::date AS period_start
      FROM schedules s
      ORDER BY period_start DESC
    `);
    const periods = periodsResult.rows.map((r) => ({
      value: at.toISODate(r.period_start),
      label: at.formatPeriodRange(at.toISODate(r.period_start)),
    }));
    res.render('admin/schedule-import', {
      title: 'Import Schedule CSV',
      user: req.session.user,
      sheetUrl: scheduleSheetUrl,
      expectedHeaders: scheduleHeaders,
      imports: imports.rows,
      schedules: schedules.rows,
      periods,
      filters: { period: '' },
      stats: await getScheduleStats(),
      previewRows,
      result,
      errorReportId,
      error: [],
      success: [`Import selesai: ${result.successCount} baris masuk, ${result.skippedCount} duplikat dilewati, ${result.errorCount} gagal.`],
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memproses CSV schedule.');
    res.redirect('/admin/schedule-import');
  }
};

exports.downloadScheduleTemplate = (req, res) => {
  const example = {
    member_email: 'member@kelasonline.com',
    member_name: 'Abd Lathif Fatahillah',
    tutor_email: 'tutor@kelasonline.com',
    tutor_name: 'Abror',
    program_name: 'WALKY TALKY',
    title: 'Sesi 1 - Speaking',
    date: '2026-07-01',
    start_time: '09:00',
    end_time: '10:00',
    meeting_link: 'https://zoom.us/j/123456789',
    location: 'Online via Zoom',
    notes: 'Catatan opsional',
  };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="schedule-template.csv"');
  res.send(toCsv(scheduleHeaders, [example]));
};

exports.deleteSchedule = async (req, res) => {
  const back = req.body.back || '/admin/schedule-import';
  try {
    const result = await query('DELETE FROM schedules WHERE id = $1 RETURNING title', [req.params.id]);
    if (!result.rows.length) req.flash('error', 'Jadwal tidak ditemukan.');
    else req.flash('success', `Jadwal "${result.rows[0].title}" berhasil dihapus.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menghapus jadwal.');
  }
  res.redirect(back);
};

// ===== Kelola Jadwal (admin schedule list with per-session edit/delete) =====

exports.scheduleManage = async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const programId = req.query.program_id ? Number(req.query.program_id) : '';
    const tutorId = req.query.tutor_id ? Number(req.query.tutor_id) : '';
    const status = ['upcoming', 'completed', 'cancelled'].includes(req.query.status) ? req.query.status : '';
    const period = /^\d{4}-\d{2}-\d{2}$/.test(req.query.period || '') ? req.query.period : '';
    const perPage = 15;
    const page = Math.max(1, Number(req.query.page) || 1);

    const conds = [];
    const params = [];
    if (search) { params.push(`%${search}%`); conds.push(`s.title ILIKE $${params.length}`); }
    if (programId) { params.push(programId); conds.push(`s.program_id = $${params.length}`); }
    if (tutorId) { params.push(tutorId); conds.push(`s.tutor_id = $${params.length}`); }
    if (status) { params.push(status); conds.push(`s.status = $${params.length}`); }
    if (period) { params.push(period); conds.push(`date_trunc('week', s.date)::date = $${params.length}::date`); }
    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [countRes, statsRes, programsRes, tutorsRes, periodsRes] = await Promise.all([
      query(`SELECT COUNT(*) FROM schedules s ${whereSql}`, params),
      query(`SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status <> 'cancelled' AND date >= CURRENT_DATE) AS upcoming,
                COUNT(*) FILTER (WHERE status <> 'cancelled' AND date < CURRENT_DATE) AS completed,
                COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
              FROM schedules`),
      query('SELECT id, name FROM programs WHERE is_active = true ORDER BY name'),
      query("SELECT id, name FROM users WHERE role = 'tutor' AND is_active = true ORDER BY name"),
      query(`SELECT DISTINCT date_trunc('week', date)::date AS period_start FROM schedules ORDER BY period_start DESC`),
    ]);

    const total = Number(countRes.rows[0].count);
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * perPage;

    const listParams = [...params, perPage, offset];
    const result = await query(
      `SELECT s.*, p.name AS program_name, t.name AS tutor_name,
              (SELECT COUNT(*) FROM schedule_members sm WHERE sm.schedule_id = s.id) AS member_count
       FROM schedules s
       JOIN programs p ON s.program_id = p.id
       JOIN users t ON s.tutor_id = t.id
       ${whereSql}
       ORDER BY s.date DESC, s.start_time DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const schedules = result.rows.map((s) => ({
      ...s,
      date_iso: dateOnly(s.date),
      start_hm: String(s.start_time || '').slice(0, 5),
      end_hm: String(s.end_time || '').slice(0, 5),
    }));
    const periods = periodsRes.rows.map((r) => ({
      value: at.toISODate(r.period_start),
      label: at.formatPeriodRange(at.toISODate(r.period_start)),
    }));

    res.render('admin/schedule', {
      title: 'Kelola Jadwal',
      user: req.session.user,
      schedules,
      programs: programsRes.rows,
      tutors: tutorsRes.rows,
      periods,
      stats: statsRes.rows[0],
      filters: { search, programId, tutorId, status, period },
      pagination: { page: currentPage, totalPages, total, perPage },
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.updateSchedule = async (req, res) => {
  const id = Number(req.params.id);
  const back = req.body.back || '/admin/schedule';
  try {
    const programId = Number(req.body.program_id);
    const tutorId = Number(req.body.tutor_id);
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim() || null;
    const date = String(req.body.date || '').trim();
    const startTime = normalizeTime(req.body.start_time);
    const endTime = normalizeTime(req.body.end_time);
    const location = String(req.body.location || '').trim() || null;
    const meetingLink = String(req.body.meeting_link || '').trim() || null;
    const status = ['upcoming', 'completed', 'cancelled'].includes(req.body.status) ? req.body.status : 'upcoming';

    if (!programId || !tutorId || !title || !isValidDate(date) || !startTime || !endTime) {
      req.flash('error', 'Data tidak lengkap atau format tanggal/jam salah.');
      return res.redirect(back);
    }
    if (minutes(endTime) <= minutes(startTime)) {
      req.flash('error', 'Jam selesai harus lebih besar dari jam mulai.');
      return res.redirect(back);
    }

    const currentRes = await query('SELECT tutor_id, date, start_time, end_time FROM schedules WHERE id = $1', [id]);
    if (!currentRes.rows.length) {
      req.flash('error', 'Jadwal tidak ditemukan.');
      return res.redirect(back);
    }
    const cur = currentRes.rows[0];
    const slotChanged = Number(cur.tutor_id) !== tutorId
      || dateOnly(cur.date) !== date
      || String(cur.start_time).slice(0, 5) !== startTime
      || String(cur.end_time).slice(0, 5) !== endTime;

    // Only guard against overlaps when the tutor or the time slot actually moves —
    // editing just the title/location/link shouldn't trip on existing sessions.
    if (slotChanged) {
      const conflict = await query(
        `SELECT id, title FROM schedules
         WHERE tutor_id = $1 AND date = $2 AND status <> 'cancelled' AND id <> $3
           AND start_time < $5::time AND end_time > $4::time LIMIT 1`,
        [tutorId, date, id, startTime, endTime]
      );
      if (conflict.rows.length) {
        req.flash('error', `Bentrok dengan jadwal tutor "${conflict.rows[0].title}" di tanggal & jam tersebut.`);
        return res.redirect(back);
      }
    }

    const updated = await query(
      `UPDATE schedules
       SET program_id=$1, tutor_id=$2, title=$3, description=$4, date=$5,
           start_time=$6, end_time=$7, location=$8, meeting_link=$9, status=$10
       WHERE id=$11 RETURNING id`,
      [programId, tutorId, title, description, date, startTime, endTime, location, meetingLink, status, id]
    );
    if (!updated.rows.length) {
      req.flash('error', 'Jadwal tidak ditemukan.');
      return res.redirect(back);
    }
    syncSchedule(id).catch((e) => console.error('Gagal sinkronisasi jadwal ke spreadsheet:', e.message));
    req.flash('success', `Jadwal "${title}" berhasil diperbarui.`);
    return res.redirect(back);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperbarui jadwal.');
    return res.redirect(back);
  }
};

exports.downloadScheduleImportErrors = async (req, res) => {
  try {
    const result = await query('SELECT * FROM schedule_imports WHERE id = $1', [req.params.id]);
    if (!result.rows.length) {
      req.flash('error', 'Error report tidak ditemukan.');
      return res.redirect('/admin/schedule-import');
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="schedule-import-errors-${req.params.id}.csv"`);
    return res.send(result.rows[0].error_report_csv || 'row_number,errors,warnings\n');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal download error report.');
    return res.redirect('/admin/schedule-import');
  }
};

exports.exportAvailableTimesCsv = async (req, res) => {
  try {
    const result = await query(`
      SELECT atime.*, u.name as tutor_name, u.email as tutor_email
      FROM available_times atime
      JOIN users u ON atime.tutor_id = u.id
      ORDER BY u.name, atime.period_start DESC NULLS LAST, atime.start_time
    `);
    const rows = [];
    result.rows.forEach((slot) => {
      at.expandDays(slot.day_category, slot.custom_days).forEach((day) => {
        rows.push({
          tutor_id: slot.tutor_id,
          tutor_name: slot.tutor_name,
          tutor_email: slot.tutor_email,
          day_of_week: day,
          day_name: at.DAY_NAMES_ID[day],
          start_time: String(slot.start_time).slice(0, 5),
          end_time: String(slot.end_time).slice(0, 5),
          is_available: slot.is_available,
          notes: slot.notes || '',
        });
      });
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="available-times.csv"');
    res.send(toCsv(['tutor_id', 'tutor_name', 'tutor_email', 'day_of_week', 'day_name', 'start_time', 'end_time', 'is_available', 'notes'], rows));
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal export available time.');
    res.redirect('/admin/schedule-import');
  }
};

exports.exportPresencesCsv = async (req, res) => {
  try {
    const result = await query(`
      SELECT s.id as schedule_id, s.date, s.start_time, s.end_time,
             p.name as program_name,
             tutor.email as tutor_email, tutor.name as tutor_name,
             member.email as member_email, member.name as member_name,
             COALESCE(pr.status, 'absent') as status,
             pr.check_in_time, updater.name as updated_by,
             COALESCE(pr.source, 'system') as source,
             pr.notes
      FROM schedule_members sm
      JOIN schedules s ON sm.schedule_id = s.id
      JOIN programs p ON s.program_id = p.id
      JOIN users tutor ON s.tutor_id = tutor.id
      JOIN users member ON sm.member_id = member.id
      LEFT JOIN presences pr ON pr.schedule_id = s.id AND pr.member_id = sm.member_id
      LEFT JOIN users updater ON pr.updated_by = updater.id
      ORDER BY s.date DESC, s.start_time DESC, member.name
    `);
    const rows = result.rows.map((row) => ({
      ...row,
      date: dateOnly(row.date),
      start_time: String(row.start_time || '').slice(0, 5),
      end_time: String(row.end_time || '').slice(0, 5),
      check_in_time: row.check_in_time ? new Date(row.check_in_time).toISOString() : '',
      notes: row.notes || '',
    }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="presences.csv"');
    res.send(toCsv(presenceHeaders, rows));
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal export presensi.');
    res.redirect('/admin/schedule-import');
  }
};

// Concrete date in a week (Monday = period) for a given day_of_week (0=Sun..6=Sat).
const dateForDayInWeek = (periodIso, dow) => {
  const base = dateFromIso(periodIso);
  const offset = dow === 0 ? 6 : dow - 1;
  base.setDate(base.getDate() + offset);
  return dateOnly(base);
};

// GET: plot schedules from a tutor's available time.
exports.schedulePlot = async (req, res) => {
  try {
    const tutorId = req.query.tutor_id ? Number(req.query.tutor_id) : null;
    const period = req.query.period || '';

    const [tutorsRes, programsRes, membersRes] = await Promise.all([
      query("SELECT id, name, email FROM users WHERE role = 'tutor' AND is_active = true ORDER BY name"),
      query('SELECT id, name FROM programs WHERE is_active = true ORDER BY name'),
      query("SELECT id, name, email FROM users WHERE role = 'member' AND is_active = true ORDER BY name"),
    ]);

    let tutorPeriods = [];
    let selectedTutor = null;
    let candidates = [];

    if (tutorId) {
      selectedTutor = tutorsRes.rows.find((t) => t.id === tutorId) || null;
      const periodsRes = await query(
        `SELECT DISTINCT period_start FROM available_times
         WHERE tutor_id = $1 AND period_start IS NOT NULL AND is_available = true
         ORDER BY period_start DESC`,
        [tutorId]
      );
      tutorPeriods = periodsRes.rows.map((r) => {
        const iso = dateOnly(r.period_start);
        return { value: iso, label: at.formatPeriodLabel(iso) };
      });

      if (period) {
        const slotsRes = await query(
          `SELECT * FROM available_times
           WHERE tutor_id = $1 AND is_available = true AND period_start = $2::date
           ORDER BY start_time`,
          [tutorId, period]
        );
        slotsRes.rows.forEach((slot) => {
          const start = String(slot.start_time).slice(0, 5);
          const end = String(slot.end_time).slice(0, 5);
          at.expandDays(slot.day_category, slot.custom_days).forEach((dow) => {
            const date = dateForDayInWeek(period, dow);
            candidates.push({
              value: `${date}|${start}|${end}`,
              date,
              dayName: at.DAY_NAMES_ID[dow],
              start_time: start,
              end_time: end,
              category: slot.day_category,
            });
          });
        });
        candidates.sort((a, b) => (a.date === b.date
          ? minutes(a.start_time) - minutes(b.start_time)
          : (a.date < b.date ? -1 : 1)));

        // Mark candidates that already have a schedule (avoid duplicates).
        const existingRes = await query(
          `SELECT date, start_time, end_time FROM schedules
           WHERE tutor_id = $1 AND status <> 'cancelled'
             AND date >= $2::date AND date < ($2::date + INTERVAL '7 days')`,
          [tutorId, period]
        );
        const existingSet = new Set(existingRes.rows.map((r) =>
          `${dateOnly(r.date)}|${String(r.start_time).slice(0, 5)}|${String(r.end_time).slice(0, 5)}`));
        candidates.forEach((c) => { c.exists = existingSet.has(c.value); });
      }
    }

    res.render('admin/schedule-plot', {
      title: 'Plot Jadwal',
      user: req.session.user,
      tutors: tutorsRes.rows,
      programs: programsRes.rows,
      members: membersRes.rows,
      tutorPeriods,
      selectedTutorId: tutorId,
      selectedTutor,
      period,
      candidates,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

// POST: create schedules + members + presence rows from the selected slots.
exports.generateSchedulePlot = async (req, res) => {
  const tutorId = Number(req.body.tutor_id);
  const programId = Number(req.body.program_id);
  const titlePrefix = String(req.body.title_prefix || '').trim();
  const location = String(req.body.location || '').trim() || null;
  const meetingLink = String(req.body.meeting_link || '').trim() || null;
  const toArr = (v) => (Array.isArray(v) ? v : (v === undefined ? [] : [v]));
  const candidates = toArr(req.body.candidates);
  const memberIds = [...new Set(toArr(req.body.member_ids).map(Number).filter(Boolean))];
  const period = String(req.body.period || '');
  const backTo = `/admin/schedule-plot?tutor_id=${tutorId || ''}&period=${encodeURIComponent(period)}`;

  try {
    if (!tutorId || !programId) {
      req.flash('error', 'Pilih tutor dan program terlebih dahulu.');
      return res.redirect(backTo);
    }
    if (!candidates.length) {
      req.flash('error', 'Pilih minimal satu slot untuk dijadikan sesi.');
      return res.redirect(backTo);
    }

    const [programRes, tutorRes] = await Promise.all([
      query('SELECT name FROM programs WHERE id = $1', [programId]),
      query('SELECT name FROM users WHERE id = $1', [tutorId]),
    ]);
    const programName = programRes.rows[0] ? programRes.rows[0].name : 'Sesi';
    const tutorName = tutorRes.rows[0] ? tutorRes.rows[0].name : 'Tutor';

    let created = 0;
    const skipped = [];
    const createdIds = [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const raw of candidates) {
        const [date, start, end] = String(raw).split('|');
        if (!isValidDate(date) || !normalizeTime(start) || !normalizeTime(end) || minutes(end) <= minutes(start)) {
          skipped.push(`${raw} (format tidak valid)`);
          continue;
        }

        const tutorConflict = await client.query(
          `SELECT id FROM schedules
           WHERE tutor_id = $1 AND date = $2 AND status <> 'cancelled'
             AND start_time < $4::time AND end_time > $3::time LIMIT 1`,
          [tutorId, date, start, end]
        );
        if (tutorConflict.rows.length) {
          skipped.push(`${date} ${start} (tutor sudah ada jadwal)`);
          continue;
        }

        let memberConflict = false;
        for (const mid of memberIds) {
          const conf = await client.query(
            `SELECT s.id FROM schedule_members sm JOIN schedules s ON sm.schedule_id = s.id
             WHERE sm.member_id = $1 AND s.date = $2 AND s.status <> 'cancelled'
               AND s.start_time < $4::time AND s.end_time > $3::time LIMIT 1`,
            [mid, date, start, end]
          );
          if (conf.rows.length) { memberConflict = true; break; }
        }
        if (memberConflict) {
          skipped.push(`${date} ${start} (peserta bentrok jadwal lain)`);
          continue;
        }

        const title = titlePrefix || `${programName} - ${date}`;
        const inserted = await client.query(
          `INSERT INTO schedules (tutor_id, program_id, title, date, start_time, end_time, location, meeting_link, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'upcoming') RETURNING id`,
          [tutorId, programId, title, date, start, end, location, meetingLink]
        );
        const scheduleId = inserted.rows[0].id;

        for (const mid of memberIds) {
          await client.query(
            `INSERT INTO schedule_members (schedule_id, member_id) VALUES ($1,$2)
             ON CONFLICT (schedule_id, member_id) DO NOTHING`,
            [scheduleId, mid]
          );
          await client.query(
            `INSERT INTO presences (schedule_id, member_id, status, source) VALUES ($1,$2,'absent','plot')
             ON CONFLICT (schedule_id, member_id) DO NOTHING`,
            [scheduleId, mid]
          );
          // Notify the member about their new session.
          await client.query(
            `INSERT INTO notifications (user_id, title, message, type)
             VALUES ($1, 'Jadwal Baru', $2, 'info')`,
            [mid, `Sesi "${title}" dijadwalkan ${date} jam ${start}-${end} bersama ${tutorName}.`]
          );
        }
        createdIds.push(scheduleId);
        created += 1;
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Integration: push created schedules to the spreadsheet (fire-and-forget).
    createdIds.forEach((sid) => {
      syncSchedule(sid).catch((e) => console.error('Gagal sinkronisasi jadwal ke spreadsheet:', e.message));
      sendScheduleNotificationEmails(sid, { subjectPrefix: 'Jadwal Belajar Baru' })
        .catch((e) => console.error('Gagal mengirim email jadwal:', e.message));
    });

    req.flash('success', `${created} sesi berhasil dibuat${memberIds.length ? ` untuk ${memberIds.length} peserta` : ''}.`);
    if (skipped.length) {
      req.flash('error', `${skipped.length} slot dilewati: ${skipped.slice(0, 6).join('; ')}${skipped.length > 6 ? '…' : ''}`);
    }
    res.redirect(backTo);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal membuat jadwal.');
    res.redirect(backTo);
  }
};

// ===== Kelola Periode =====

exports.periods = async (req, res) => {
  try {
    const [listRes, statsRes] = await Promise.all([
      query(`
        SELECT pe.*,
               (SELECT COUNT(DISTINCT a.tutor_id) FROM available_times a WHERE a.period_start = pe.period_start) AS tutor_count,
               (SELECT COUNT(*) FROM available_times a WHERE a.period_start = pe.period_start) AS slot_count,
               (SELECT COUNT(*) FROM schedules s WHERE s.date >= pe.period_start AND s.date < (pe.period_start + INTERVAL '7 days')) AS session_count
        FROM periods pe
        ORDER BY pe.period_start DESC
      `),
      query(`SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE is_open) AS open,
                COUNT(*) FILTER (WHERE period_start >= CURRENT_DATE) AS upcoming
              FROM periods`),
    ]);
    const periods = listRes.rows.map((p) => ({
      ...p,
      iso: at.toISODate(p.period_start),
      label: p.label || at.formatPeriodLabel(p.period_start),
    }));
    res.render('admin/periods', {
      title: 'Kelola Periode',
      user: req.session.user,
      periods,
      stats: statsRes.rows[0],
      defaultStart: at.currentPeriodValue(),
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.createPeriod = async (req, res) => {
  try {
    const monday = at.mondayOf(req.body.period_start);
    if (!monday) {
      req.flash('error', 'Tanggal periode tidak valid.');
      return res.redirect('/admin/periods');
    }
    const label = String(req.body.label || '').trim() || at.formatPeriodLabel(monday);
    const isOpen = req.body.is_open === 'on' || req.body.is_open === 'true';

    const dupe = await query('SELECT id FROM periods WHERE period_start = $1', [monday]);
    if (dupe.rows.length) {
      req.flash('error', `Periode ${at.formatPeriodLabel(monday)} sudah ada.`);
      return res.redirect('/admin/periods');
    }
    await query('INSERT INTO periods (period_start, label, is_open) VALUES ($1,$2,$3)', [monday, label, isOpen]);
    req.flash('success', `Periode ${at.formatPeriodLabel(monday)} berhasil ditambahkan.`);
    res.redirect('/admin/periods');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menambahkan periode.');
    res.redirect('/admin/periods');
  }
};

exports.togglePeriod = async (req, res) => {
  try {
    await query('UPDATE periods SET is_open = NOT is_open WHERE id = $1', [req.params.id]);
    req.flash('success', 'Status periode diperbarui.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengubah status periode.');
  }
  res.redirect('/admin/periods');
};

exports.deletePeriod = async (req, res) => {
  try {
    const result = await query('DELETE FROM periods WHERE id = $1 RETURNING period_start', [req.params.id]);
    if (!result.rows.length) req.flash('error', 'Periode tidak ditemukan.');
    else req.flash('success', `Periode ${at.formatPeriodLabel(result.rows[0].period_start)} berhasil dihapus.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menghapus periode.');
  }
  res.redirect('/admin/periods');
};

// ===== Presensi Member (read-only, semua) =====

exports.memberPresence = async (req, res) => {
  try {
    const tutorId = req.query.tutor_id || '';
    const programId = req.query.program_id || '';
    const where = ['1=1'];
    const params = [];
    if (tutorId) { params.push(Number(tutorId)); where.push(`mp.tutor_id = $${params.length}`); }
    if (programId) { params.push(Number(programId)); where.push(`mp.program_id = $${params.length}`); }

    const [listRes, tutorsRes, programsRes, statsRes] = await Promise.all([
      query(`
        SELECT mp.*, m.name as member_name, m.photo as member_photo,
               t.name as tutor_name, p.name as program_name
        FROM member_presences mp
        JOIN users m ON mp.member_id = m.id
        LEFT JOIN users t ON mp.tutor_id = t.id
        LEFT JOIN programs p ON mp.program_id = p.id
        WHERE ${where.join(' AND ')}
        ORDER BY mp.created_at DESC
      `, params),
      query("SELECT id, name FROM users WHERE role = 'tutor' AND is_active = true ORDER BY name"),
      query('SELECT id, name FROM programs WHERE is_active = true ORDER BY name'),
      query(`SELECT COUNT(*) AS total, COUNT(DISTINCT member_id) AS members FROM member_presences`),
    ]);
    const submissions = listRes.rows.map((s) => ({
      ...s,
      period_label: s.period_start ? at.formatPeriodLabel(s.period_start) : '-',
    }));
    res.render('admin/member-presence', {
      title: 'Presensi Member',
      user: req.session.user,
      submissions,
      tutors: tutorsRes.rows,
      programs: programsRes.rows,
      filters: { tutorId, programId },
      stats: statsRes.rows[0],
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

// ===== Questionnaire (admin read-only) =====

exports.questionnaire = async (req, res) => {
  try {
    const programId = req.query.program_id || '';
    const tutor = (req.query.tutor || '').trim();
    const period = (req.query.period || '').trim();

    // Tutor & period live inside each response's answers (teaching questionnaires
    // capture tutor_name and study_period). Filtering by them keeps only
    // questionnaires that have a matching response, and response_count follows suit.
    const params = [];
    const qrConds = ['q.id = qr.questionnaire_id'];
    if (tutor) { params.push(tutor); qrConds.push(`qr.answers->>'tutor_name' = $${params.length}`); }
    if (period) { params.push(period); qrConds.push(`qr.answers->>'study_period' = $${params.length}`); }

    const where = ['1=1'];
    if (programId) { params.push(Number(programId)); where.push(`q.program_id = $${params.length}`); }
    const having = (tutor || period) ? 'HAVING COUNT(DISTINCT qr.id) > 0' : '';

    const [listRes, programsRes, statsRes, tutorOptsRes, periodOptsRes] = await Promise.all([
      query(`
        SELECT q.*, p.name as program_name, u.name as creator_name,
               COUNT(DISTINCT qq.id) as question_count,
               COUNT(DISTINCT qr.id) as response_count
        FROM questionnaires q
        JOIN programs p ON q.program_id = p.id
        LEFT JOIN users u ON q.created_by = u.id
        LEFT JOIN questions qq ON q.id = qq.questionnaire_id
        LEFT JOIN questionnaire_responses qr ON ${qrConds.join(' AND ')}
        WHERE ${where.join(' AND ')}
        GROUP BY q.id, p.name, u.name
        ${having}
        ORDER BY q.created_at DESC
      `, params),
      query('SELECT id, name FROM programs WHERE is_active = true ORDER BY name'),
      query(`
        SELECT
          (SELECT COUNT(*) FROM questionnaires) AS total,
          (SELECT COUNT(*) FROM questions) AS questions,
          (SELECT COUNT(*) FROM questionnaire_responses) AS responses,
          (SELECT COUNT(DISTINCT member_id) FROM questionnaire_responses) AS respondents
      `),
      query(`SELECT DISTINCT answers->>'tutor_name' AS name FROM questionnaire_responses
             WHERE COALESCE(answers->>'tutor_name', '') <> '' ORDER BY name`),
      query(`SELECT DISTINCT answers->>'study_period' AS label FROM questionnaire_responses
             WHERE COALESCE(answers->>'study_period', '') <> '' ORDER BY label`),
    ]);

    res.render('admin/questionnaire', {
      title: 'Questionnaire',
      user: req.session.user,
      questionnaires: listRes.rows,
      programs: programsRes.rows,
      filters: { programId, tutor, period },
      tutorOptions: tutorOptsRes.rows.map((r) => r.name),
      periodOptions: periodOptsRes.rows.map((r) => r.label),
      stats: statsRes.rows[0],
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.questionnaireDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const [qResult, questionsResult, responsesResult] = await Promise.all([
      query(`
        SELECT q.*, p.name as program_name, u.name as creator_name
        FROM questionnaires q
        JOIN programs p ON q.program_id = p.id
        LEFT JOIN users u ON q.created_by = u.id
        WHERE q.id = $1
      `, [id]),
      query('SELECT * FROM questions WHERE questionnaire_id = $1 ORDER BY order_number', [id]),
      query(`
        SELECT qr.*, u.name as respondent_name, u.role as respondent_role, u.email as respondent_email
        FROM questionnaire_responses qr
        JOIN users u ON qr.member_id = u.id
        WHERE qr.questionnaire_id = $1
        ORDER BY qr.submitted_at DESC
      `, [id]),
    ]);
    const questionnaire = qResult.rows[0];
    if (!questionnaire) {
      req.flash('error', 'Questionnaire tidak ditemukan.');
      return res.redirect('/admin/questionnaire');
    }
    const questions = questionsResult.rows;
    const responses = responsesResult.rows.map((response) => ({
      ...response,
      answer_map: typeof response.answers === 'string' ? JSON.parse(response.answers || '{}') : (response.answers || {}),
    }));
    res.render('admin/questionnaire-detail', {
      title: questionnaire.title,
      user: req.session.user,
      questionnaire,
      questions,
      responses,
      isTeachingQuestionnaire: isTeachingMode(questionnaire, questions.length),
      teachingRatings,
      teachingEssays,
      ratingLabels,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.createQuestionnaire = async (req, res) => {
  try {
    const { title, description, program_id, due_date, duration_minutes } = req.body;
    if (!title || !title.trim() || !program_id) {
      req.flash('error', 'Judul dan program wajib diisi.');
      return res.redirect('/admin/questionnaire');
    }
    const result = await query(
      `INSERT INTO questionnaires (title, description, program_id, created_by, due_date, duration_minutes, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
      [
        title.trim(),
        description && description.trim() ? description.trim() : null,
        Number(program_id),
        req.session.user.id,
        due_date || null,
        duration_minutes ? Number(duration_minutes) : 30,
      ]
    );
    req.flash('success', 'Questionnaire dibuat. Tambahkan soal untuk melengkapinya.');
    res.redirect(`/admin/questionnaire/${result.rows[0].id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal membuat questionnaire.');
    res.redirect('/admin/questionnaire');
  }
};

// Normalise a question's type-specific payload (options/correct_answer/points/text).
const parseQuestionPayload = (body) => {
  let questionType = body.question_type;
  let options = null;
  let correctAnswer = null;
  let points = body.points ? Number(body.points) : 1;

  if (questionType === 'yes_no') {
    questionType = 'multiple_choice';
    options = ['YA', 'TIDAK'];
    correctAnswer = body.correct_answer && ['YA', 'TIDAK'].includes(body.correct_answer) ? body.correct_answer : null;
  } else if (questionType === 'multiple_choice') {
    const raw = Array.isArray(body.options) ? body.options : [body.options];
    options = raw.map((o) => String(o || '').trim()).filter(Boolean);
    correctAnswer = body.correct_answer && options.includes(body.correct_answer) ? body.correct_answer : null;
  } else if (questionType === 'rating') {
    points = 5;
  }

  return {
    questionText: String(body.question_text || '').trim(),
    questionType,
    options,
    correctAnswer,
    points: points > 0 ? points : 1,
  };
};

exports.addQuestion = async (req, res) => {
  const { id } = req.params;
  try {
    const payload = parseQuestionPayload(req.body);
    if (!payload.questionText || !['multiple_choice', 'essay', 'rating'].includes(payload.questionType)) {
      req.flash('error', 'Teks pertanyaan dan tipe soal wajib diisi.');
      return res.redirect(`/admin/questionnaire/${id}`);
    }
    if (payload.questionType === 'multiple_choice' && (!payload.options || payload.options.length < 2)) {
      req.flash('error', 'Pilihan ganda membutuhkan minimal 2 opsi.');
      return res.redirect(`/admin/questionnaire/${id}`);
    }
    const orderResult = await query(
      'SELECT COALESCE(MAX(order_number), 0) + 1 AS next FROM questions WHERE questionnaire_id = $1',
      [id]
    );
    await query(
      `INSERT INTO questions (questionnaire_id, question_text, question_type, options, correct_answer, points, order_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        payload.questionText,
        payload.questionType,
        payload.options ? JSON.stringify(payload.options) : null,
        payload.correctAnswer,
        payload.points,
        orderResult.rows[0].next,
      ]
    );
    req.flash('success', 'Soal ditambahkan.');
    res.redirect(`/admin/questionnaire/${id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menambahkan soal.');
    res.redirect(`/admin/questionnaire/${id}`);
  }
};

exports.updateQuestion = async (req, res) => {
  const { id, questionId } = req.params;
  try {
    const payload = parseQuestionPayload(req.body);
    if (!payload.questionText || !['multiple_choice', 'essay', 'rating'].includes(payload.questionType)) {
      req.flash('error', 'Teks pertanyaan dan tipe soal wajib diisi.');
      return res.redirect(`/admin/questionnaire/${id}`);
    }
    if (payload.questionType === 'multiple_choice' && (!payload.options || payload.options.length < 2)) {
      req.flash('error', 'Pilihan ganda membutuhkan minimal 2 opsi.');
      return res.redirect(`/admin/questionnaire/${id}`);
    }
    await query(
      `UPDATE questions
       SET question_text = $1, question_type = $2, options = $3, correct_answer = $4, points = $5
       WHERE id = $6 AND questionnaire_id = $7`,
      [
        payload.questionText,
        payload.questionType,
        payload.options ? JSON.stringify(payload.options) : null,
        payload.correctAnswer,
        payload.points,
        questionId,
        id,
      ]
    );
    req.flash('success', 'Soal diperbarui.');
    res.redirect(`/admin/questionnaire/${id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperbarui soal.');
    res.redirect(`/admin/questionnaire/${id}`);
  }
};

exports.deleteQuestion = async (req, res) => {
  const { id, questionId } = req.params;
  try {
    await query('DELETE FROM questions WHERE id = $1 AND questionnaire_id = $2', [questionId, id]);
    req.flash('success', 'Soal dihapus.');
    res.redirect(`/admin/questionnaire/${id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menghapus soal.');
    res.redirect(`/admin/questionnaire/${id}`);
  }
};

exports.deleteQuestionnaire = async (req, res) => {
  const { id } = req.params;
  try {
    await query('DELETE FROM questionnaire_responses WHERE questionnaire_id = $1', [id]);
    await query('DELETE FROM questions WHERE questionnaire_id = $1', [id]);
    await query('DELETE FROM questionnaires WHERE id = $1', [id]);
    req.flash('success', 'Questionnaire dihapus.');
    res.redirect('/admin/questionnaire');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menghapus questionnaire.');
    res.redirect(`/admin/questionnaire/${id}`);
  }
};

// ===== Member Report (admin read-only) =====

exports.report = async (req, res) => {
  try {
    await ensureMemberReportsTable(query);
    const tutorId = req.query.tutor_id || '';
    const programId = req.query.program_id || '';
    const period = req.query.period || '';
    const where = ['1=1'];
    const params = [];
    if (tutorId) { params.push(Number(tutorId)); where.push(`mr.tutor_id = $${params.length}`); }
    if (programId) { params.push(Number(programId)); where.push(`mr.program_id = $${params.length}`); }
    if (period) { params.push(period); where.push(`mr.period_start = $${params.length}`); }

    const [reportsRes, tutorsRes, programsRes, periodsRes, statsRes] = await Promise.all([
      query(`
        SELECT mr.*, m.name as member_name, t.name as tutor_name, p.name as program_name
        FROM member_reports mr
        JOIN users m ON m.id = mr.member_id
        JOIN users t ON t.id = mr.tutor_id
        JOIN programs p ON p.id = mr.program_id
        WHERE ${where.join(' AND ')}
        ORDER BY mr.updated_at DESC
      `, params),
      query("SELECT id, name FROM users WHERE role = 'tutor' AND is_active = true ORDER BY name"),
      query('SELECT id, name FROM programs WHERE is_active = true ORDER BY name'),
      query('SELECT DISTINCT period_start FROM member_reports WHERE period_start IS NOT NULL ORDER BY period_start DESC'),
      query(`SELECT COUNT(*) AS total, COUNT(DISTINCT member_id) AS members FROM member_reports`),
    ]);

    const periods = periodsRes.rows.map((r) => {
      const iso = at.toISODate(r.period_start);
      return { value: iso, label: at.formatPeriodLabel(iso) };
    });

    res.render('admin/report', {
      title: 'Member Report',
      user: req.session.user,
      reports: reportsRes.rows,
      tutors: tutorsRes.rows,
      programs: programsRes.rows,
      periods,
      filters: { tutorId, programId, period },
      stats: statsRes.rows[0],
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.reportDetail = async (req, res) => {
  try {
    await ensureMemberReportsTable(query);
    const result = await query(`
      SELECT mr.*, m.name as member_name, m.photo as member_photo,
             t.name as tutor_name, p.name as program_name
      FROM member_reports mr
      JOIN users m ON m.id = mr.member_id
      JOIN users t ON t.id = mr.tutor_id
      JOIN programs p ON p.id = mr.program_id
      WHERE mr.id = $1
    `, [req.params.id]);
    const report = result.rows[0];
    if (!report) return res.redirect('/admin/report');
    const days = normalizeReportDays(report.days);
    res.render('shared/member-report-detail', {
      title: 'Detail Member Report',
      user: req.session.user,
      activeNav: 'admin',
      backHref: '/admin/report',
      canEdit: false,
      report,
      reportDays: Array.from({ length: 15 }, (_, idx) => ({
        number: idx + 1,
        key: `day_${idx + 1}`,
        text: days[`day_${idx + 1}`],
      })),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

// ===== Certificates (admin read-only) =====

exports.certificate = async (req, res) => {
  try {
    await ensureCertificateDetailsColumn(query);
    const search = (req.query.search || '').trim();
    const tutor = (req.query.tutor || '').trim();
    const period = (req.query.period || '').trim();
    const params = [];
    const conds = [];
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      conds.push(`(u.name ILIKE $${i} OR c.certificate_number ILIKE $${i} OR p.name ILIKE $${i} OR c.details->>'tutor_name' ILIKE $${i})`);
    }
    if (tutor) {
      params.push(tutor);
      conds.push(`c.details->>'tutor_name' = $${params.length}`);
    }
    if (period) {
      params.push(period);
      conds.push(`c.details->>'period_label' = $${params.length}`);
    }
    const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [certsResult, statsRes, tutorOptsRes, periodOptsRes] = await Promise.all([
      query(`
        SELECT c.*, u.name as member_name, p.name as program_name,
               c.details->>'tutor_name' AS tutor_name,
               c.details->>'period_label' AS period_label
        FROM certificates c
        JOIN users u ON c.member_id = u.id
        JOIN programs p ON c.program_id = p.id
        ${whereClause}
        ORDER BY c.issued_date DESC
      `, params),
      query('SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_active = true) AS active FROM certificates'),
      query(`SELECT DISTINCT details->>'tutor_name' AS name FROM certificates
             WHERE COALESCE(details->>'tutor_name', '') <> '' ORDER BY name`),
      query(`SELECT DISTINCT details->>'period_label' AS label FROM certificates
             WHERE COALESCE(details->>'period_label', '') <> '' ORDER BY label`),
    ]);
    res.render('admin/certificate', {
      title: 'Sertifikat',
      user: req.session.user,
      certificates: certsResult.rows,
      filters: { search, tutor, period },
      tutorOptions: tutorOptsRes.rows.map((r) => r.name),
      periodOptions: periodOptsRes.rows.map((r) => r.label),
      stats: statsRes.rows[0],
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.certificatePrint = async (req, res) => {
  try {
    await ensureCertificateDetailsColumn(query);
    const result = await query(`
      SELECT c.*, u.name as member_name, p.name as program_name
      FROM certificates c
      JOIN users u ON c.member_id = u.id
      JOIN programs p ON c.program_id = p.id
      WHERE c.id = $1
    `, [req.params.id]);
    const cert = result.rows[0];
    if (!cert) {
      req.flash('error', 'Sertifikat tidak ditemukan.');
      return res.redirect('/admin/certificate');
    }
    res.render('member/certificate-print', {
      title: 'Sertifikat',
      user: req.session.user,
      cert,
      autoPrint: false,
      backHref: '/admin/certificate',
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.certificateSync = async (req, res) => {
  try {
    const result = await syncCertificate(req.params.id);
    if (result.skipped) {
      req.flash('error', 'Webhook spreadsheet belum dikonfigurasi (SHEET_WEBHOOK_URL / CERTIFICATE_WEBHOOK_URL).');
    } else {
      req.flash('success', 'Sertifikat & personal report berhasil disinkronkan ke spreadsheet.');
    }
  } catch (err) {
    console.error('Gagal sinkronisasi sertifikat ke spreadsheet:', err.message);
    req.flash('error', 'Gagal sinkronisasi sertifikat ke spreadsheet.');
  }
  res.redirect('/admin/certificate');
};

// ===== Support Feedback Inbox =====

exports.supportFeedback = async (req, res) => {
  try {
    await ensureSupportFeedbackTable(query);
    const status = ['new', 'in_progress', 'done', 'archived'].includes(req.query.status) ? req.query.status : '';
    const search = String(req.query.search || '').trim();
    const where = [];
    const params = [];
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length} OR subject ILIKE $${params.length} OR message ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [feedbackRes, statsRes] = await Promise.all([
      query(`
        SELECT *
        FROM support_feedback
        ${whereSql}
        ORDER BY
          CASE status WHEN 'new' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
          created_at DESC
      `, params),
      query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status = 'new') AS new_count,
               COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
               COUNT(*) FILTER (WHERE status = 'done') AS done,
               COUNT(*) FILTER (WHERE email_status = 'failed') AS email_failed
        FROM support_feedback
      `),
    ]);

    res.render('admin/support-feedback', {
      title: 'Feedback Inbox',
      user: req.session.user,
      feedback: feedbackRes.rows,
      stats: statsRes.rows[0],
      filters: { status, search },
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.updateSupportFeedbackStatus = async (req, res) => {
  try {
    await ensureSupportFeedbackTable(query);
    const status = ['new', 'in_progress', 'done', 'archived'].includes(req.body.status)
      ? req.body.status
      : 'new';
    await query(
      'UPDATE support_feedback SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, req.params.id]
    );
    req.flash('success', 'Status feedback berhasil diperbarui.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperbarui status feedback.');
  }
  res.redirect('/admin/support-feedback');
};
