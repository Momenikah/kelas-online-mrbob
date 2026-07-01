// =============================================
// Google Spreadsheet sync (via Apps Script Web App)
// Posts data to a Google Apps Script web app URL that appends/updates rows.
// No credentials/JSON key needed — just the deployed web app URL.
//
//  - Registration / confirmation  -> tab "Pendaftaran" (SHEET_WEBHOOK_URL)
//  - Tutor available time          -> tab "AvailableTime"
//    (AVAILABLE_TIME_WEBHOOK_URL, falls back to SHEET_WEBHOOK_URL)
// =============================================

const { getPaymentTotal } = require('./registrationEmail');
const { query } = require('../config/database');
const at = require('./availableTime');

const appBaseUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

// Low-level POST with a timeout so a slow webhook never blocks for long.
async function postToWebhook(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Spreadsheet webhook merespons HTTP ${res.status}`);
    }
    return { sent: true };
  } finally {
    clearTimeout(timer);
  }
}

// Build the flat row payload for registration / confirmation events.
function buildPayload(event, registration, extra = {}) {
  return {
    event, // 'pendaftaran' | 'konfirmasi'
    timestamp: new Date().toISOString(),
    registration_code: registration.registration_code || '',
    name: registration.name || '',
    email: registration.email || '',
    phone: registration.phone || '',
    city: registration.city || '',
    age: registration.age || '',
    occupation: registration.occupation || '',
    education_level: registration.education_level || '',
    education_background: registration.education_background || '',
    instagram: registration.instagram || '',
    program_type: registration.program_type || '',
    selected_class: registration.selected_class || '',
    package_group: registration.package_group || '',
    package_name: registration.package_name || '',
    package_price: registration.package_price || '',
    duration: registration.duration || '',
    meeting_count: registration.meeting_count || '',
    study_time: registration.study_time || '',
    start_date: registration.start_date || '',
    preferred_tutor_id: registration.preferred_tutor_id || '',
    preferred_tutor: registration.preferred_tutor || '',
    friend_name: registration.friend_name || '',
    coupon_code: registration.coupon_code || '',
    referral_code: registration.referral_code || '',
    payment_total: getPaymentTotal(registration),
    status: registration.status || '',
    transfer_proof_url: extra.transferProofUrl || '',
  };
}

async function syncToSpreadsheet(event, registration, extra = {}) {
  const url = process.env.SHEET_WEBHOOK_URL;
  if (!url) {
    console.warn('SHEET_WEBHOOK_URL belum dikonfigurasi. Sinkronisasi spreadsheet dilewati.');
    return { skipped: true };
  }
  return postToWebhook(url, buildPayload(event, registration, extra));
}

// Convenience wrappers for the two registration events.
const syncRegistration = (registration) => syncToSpreadsheet('pendaftaran', registration);

const syncConfirmation = (registration, proofPath) =>
  syncToSpreadsheet('konfirmasi', registration, {
    transferProofUrl: proofPath ? `${appBaseUrl()}${proofPath}` : '',
  });

// Build the available-time snapshot payload for a tutor.
async function buildAvailableTimePayload(tutorId) {
  const [userResult, slotsResult] = await Promise.all([
    query('SELECT name, email FROM users WHERE id = $1', [tutorId]),
    query(
      `SELECT * FROM available_times WHERE tutor_id = $1
       ORDER BY period_start DESC NULLS LAST, start_time, day_category`,
      [tutorId]
    ),
  ]);
  const tutor = userResult.rows[0] || {};

  const slots = slotsResult.rows.map((row) => ({
    period_label: row.period_label
      || (row.period_start ? at.formatPeriodLabel(row.period_start) : 'Tanpa Periode'),
    period_start: row.period_start ? new Date(row.period_start).toISOString().slice(0, 10) : '',
    day_category: row.day_category || '',
    day_label: at.describeDays(row.day_category, row.custom_days),
    custom_days: row.custom_days || '',
    start_time: String(row.start_time || '').slice(0, 5),
    end_time: String(row.end_time || '').slice(0, 5),
    is_available: row.is_available,
  }));

  return {
    event: 'available_time',
    timestamp: new Date().toISOString(),
    tutor_id: tutorId,
    tutor_name: tutor.name || '',
    tutor_email: tutor.email || '',
    slots,
  };
}

// Push the tutor's FULL current available time as a snapshot. The Apps Script
// replaces all rows for this tutor_id, so the sheet always mirrors the DB
// (handles save, delete-slot, delete-period, and toggle the same way).
async function syncTutorAvailableTime(tutorId) {
  const url = process.env.AVAILABLE_TIME_WEBHOOK_URL || process.env.SHEET_WEBHOOK_URL;
  if (!url) {
    console.warn('Webhook spreadsheet belum dikonfigurasi. Sinkronisasi available time dilewati.');
    return { skipped: true };
  }
  const payload = await buildAvailableTimePayload(tutorId);
  return postToWebhook(url, payload);
}

// Local date formatter (avoids UTC shift on DATE columns).
const dateOnly = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Build a single schedule row payload (with tutor, program, and members).
async function buildSchedulePayload(scheduleId) {
  const res = await query(
    `SELECT s.*, p.name AS program_name, u.name AS tutor_name, u.email AS tutor_email,
            STRING_AGG(m.name, ', ' ORDER BY m.name) AS member_names,
            COUNT(sm.member_id) AS member_count
     FROM schedules s
     JOIN programs p ON s.program_id = p.id
     JOIN users u ON s.tutor_id = u.id
     LEFT JOIN schedule_members sm ON sm.schedule_id = s.id
     LEFT JOIN users m ON sm.member_id = m.id
     WHERE s.id = $1
     GROUP BY s.id, p.name, u.name, u.email`,
    [scheduleId]
  );
  const s = res.rows[0];
  if (!s) return null;
  return {
    event: 'jadwal',
    timestamp: new Date().toISOString(),
    schedule_id: s.id,
    date: dateOnly(s.date),
    start_time: String(s.start_time || '').slice(0, 5),
    end_time: String(s.end_time || '').slice(0, 5),
    title: s.title || '',
    program_name: s.program_name || '',
    tutor_name: s.tutor_name || '',
    tutor_email: s.tutor_email || '',
    location: s.location || '',
    meeting_link: s.meeting_link || '',
    status: s.status || '',
    member_count: Number(s.member_count) || 0,
    member_names: s.member_names || '',
  };
}

// Push (upsert) a single schedule to the spreadsheet "Jadwal" tab.
async function syncSchedule(scheduleId) {
  const url = process.env.SCHEDULE_WEBHOOK_URL || process.env.SHEET_WEBHOOK_URL;
  if (!url) {
    console.warn('Webhook spreadsheet belum dikonfigurasi. Sinkronisasi jadwal dilewati.');
    return { skipped: true };
  }
  const payload = await buildSchedulePayload(scheduleId);
  if (!payload) return { skipped: true };
  return postToWebhook(url, payload);
}

module.exports = {
  buildPayload,
  buildAvailableTimePayload,
  buildSchedulePayload,
  syncToSpreadsheet,
  syncRegistration,
  syncConfirmation,
  syncTutorAvailableTime,
  syncSchedule,
};
