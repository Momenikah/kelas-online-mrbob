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

// Kolom `timestamp` di sheet memakai waktu lokal Indonesia (WIB), bukan ISO/UTC.
// Format "DD/MM/YYYY HH:mm:ss" — sesuai locale Indonesia dan tetap dikenali
// Google Sheets sebagai tanggal-waktu. hourCycle h23 supaya 00:xx bukan 24:xx.
const TS_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});
function nowWIB(date = new Date()) {
  const p = TS_FMT.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

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
    timestamp: nowWIB(),
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
    timestamp: nowWIB(),
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
    timestamp: nowWIB(),
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

// Build a single certificate row payload (includes the personal-report fields
// stored in certificates.details: scores + before/after improvement).
async function buildCertificatePayload(certificateId) {
  const res = await query(
    `SELECT c.*, u.name AS member_name, u.email AS member_email, p.name AS program_name
     FROM certificates c
     JOIN users u ON c.member_id = u.id
     JOIN programs p ON c.program_id = p.id
     WHERE c.id = $1`,
    [certificateId]
  );
  const c = res.rows[0];
  if (!c) return null;

  const details = (c.details && typeof c.details === 'object') ? c.details : {};
  const scores = details.scores || {};
  const improvement = details.improvement || {};

  return {
    event: 'sertifikat',
    timestamp: nowWIB(),
    certificate_id: c.id,
    certificate_number: c.certificate_number || '',
    issued_date: dateOnly(c.issued_date),
    title: c.title || '',
    member_name: c.member_name || '',
    member_email: details.member_email || c.member_email || '',
    program_name: c.program_name || '',
    program_label: details.program_label || c.program_name || '',
    tutor_name: details.tutor_name || '',
    period_label: details.period_label || '',
    category: details.category || '',
    grade: details.grade || '',
    status: c.is_active ? 'Aktif' : 'Nonaktif',
    // Personal report / test-score fields
    speaking_score: scores.speaking_score || '',
    pronunciation_score: scores.pronunciation_score || '',
    vocabulary_score: scores.vocabulary_score || '',
    grammar_score: scores.grammar_score || '',
    understanding_score: scores.understanding_score || '',
    cefr_score: scores.cefr_score || '',
    listening_score: scores.listening_score || '',
    structure_score: scores.structure_score || '',
    reading_score: scores.reading_score || '',
    writing_score: scores.writing_score || '',
    total_score: scores.total_score || '',
    improvement_before: improvement.before || '',
    improvement_after: improvement.after || '',
    print_url: `${appBaseUrl()}/admin/certificate/${c.id}/print`,
  };
}

// Push (upsert) a single certificate + its personal report to the
// spreadsheet "Sertifikat" tab.
async function syncCertificate(certificateId) {
  const url = process.env.CERTIFICATE_WEBHOOK_URL || process.env.SHEET_WEBHOOK_URL;
  if (!url) {
    console.warn('Webhook spreadsheet belum dikonfigurasi. Sinkronisasi sertifikat dilewati.');
    return { skipped: true };
  }
  const payload = await buildCertificatePayload(certificateId);
  if (!payload) return { skipped: true };
  return postToWebhook(url, payload);
}

// Build a single renewal-request row payload for the spreadsheet "Renewal" tab.
async function buildRenewalPayload(renewalId) {
  const res = await query(
    `SELECT rr.*, p.name AS program_name
     FROM renewal_requests rr
     LEFT JOIN programs p ON p.id = rr.program_id
     WHERE rr.id = $1`,
    [renewalId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    event: 'renewal',
    timestamp: nowWIB(),
    renewal_id: r.id,
    request_type: r.request_type || 'renewal',
    member_name: r.member_name || '',
    member_email: r.member_email || '',
    phone: r.phone || '',
    program_name: r.program_name || '',
    selected_class: r.selected_class || '',
    package_name: r.package_name || '',
    package_price: r.package_price || '',
    preferred_start_date: dateOnly(r.preferred_start_date),
    study_time: r.study_time || '',
    status: r.status || '',
    notes: r.notes || '',
    transfer_proof_url: r.transfer_proof ? `${appBaseUrl()}${r.transfer_proof}` : '',
  };
}

// Push (upsert) a single renewal request to the spreadsheet "Renewal" tab.
async function syncRenewal(renewalId) {
  const url = process.env.RENEWAL_WEBHOOK_URL || process.env.SHEET_WEBHOOK_URL;
  if (!url) {
    console.warn('Webhook spreadsheet belum dikonfigurasi. Sinkronisasi renewal dilewati.');
    return { skipped: true };
  }
  const payload = await buildRenewalPayload(renewalId);
  if (!payload) return { skipped: true };
  return postToWebhook(url, payload);
}

// Build a single questionnaire-response row for the spreadsheet "Questionnaire" tab.
// Meratakan template evaluasi tutor (ratings + essays); answers_json menyimpan
// jawaban mentah agar kuesioner custom pun tidak ada yang hilang.
async function buildQuestionnairePayload(responseId) {
  const res = await query(
    `SELECT qr.*, q.title AS questionnaire_title,
            m.name AS member_name, m.email AS member_email,
            t.name AS tutor_name_join, p.name AS program_name_join
     FROM questionnaire_responses qr
     JOIN questionnaires q ON q.id = qr.questionnaire_id
     JOIN users m ON m.id = qr.member_id
     LEFT JOIN users t ON t.id = qr.tutor_id
     LEFT JOIN programs p ON p.id = qr.study_program_id
     WHERE qr.id = $1`,
    [responseId]
  );
  const r = res.rows[0];
  if (!r) return null;

  const answers = (r.answers && typeof r.answers === 'object') ? r.answers : {};
  const ratings = answers.ratings || {};
  const essays = answers.essays || {};

  return {
    event: 'questionnaire',
    timestamp: nowWIB(r.submitted_at ? new Date(r.submitted_at) : new Date()),
    response_id: r.id,
    questionnaire_id: r.questionnaire_id,
    questionnaire_title: r.questionnaire_title || '',
    member_name: r.member_name || '',
    member_email: r.member_email || '',
    tutor_name: answers.tutor_name || r.tutor_name_join || '',
    program_name: answers.study_program_name || r.program_name_join || '',
    study_period: r.study_period || answers.study_period || '',
    overall_rating: ratings.overall_rating || '',
    material_quality: ratings.material_quality || '',
    material_relevance: ratings.material_relevance || '',
    tutor_mastery: ratings.tutor_mastery || '',
    tutor_performance: ratings.tutor_performance || '',
    score: r.score != null ? r.score : '',
    max_score: r.max_score != null ? r.max_score : '',
    change_after_meetings: essays.change_after_meetings || '',
    testimonial: essays.testimonial || '',
    suggestion: essays.suggestion || '',
    self_study_reference: answers.self_study_reference || '',
    submitted_at: dateOnly(r.submitted_at),
    answers_json: JSON.stringify(answers),
  };
}

// Push (upsert) a single questionnaire response to the "Questionnaire" tab.
async function syncQuestionnaire(responseId) {
  const url = process.env.QUESTIONNAIRE_WEBHOOK_URL || process.env.SHEET_WEBHOOK_URL;
  if (!url) {
    console.warn('Webhook spreadsheet belum dikonfigurasi. Sinkronisasi questionnaire dilewati.');
    return { skipped: true };
  }
  const payload = await buildQuestionnairePayload(responseId);
  if (!payload) return { skipped: true };
  return postToWebhook(url, payload);
}

module.exports = {
  buildPayload,
  buildAvailableTimePayload,
  buildSchedulePayload,
  buildCertificatePayload,
  buildRenewalPayload,
  buildQuestionnairePayload,
  syncToSpreadsheet,
  syncRegistration,
  syncConfirmation,
  syncTutorAvailableTime,
  syncSchedule,
  syncCertificate,
  syncRenewal,
  syncQuestionnaire,
};
