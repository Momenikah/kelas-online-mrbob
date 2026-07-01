const nodemailer = require('nodemailer');
const { query } = require('../config/database');

const appBaseUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

const getTransportConfig = () => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const dateOnly = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const timeOnly = (value) => String(value || '').slice(0, 5);

const firstName = (name) => String(name || '').trim().split(/\s+/).filter(Boolean)[0] || name || '';

const scheduleRows = (schedule) => ([
  ['Judul Sesi', schedule.title],
  ['Program', schedule.program_name],
  ['Tanggal', dateOnly(schedule.date)],
  ['Waktu', `${timeOnly(schedule.start_time)} - ${timeOnly(schedule.end_time)}`],
  ['Tutor', schedule.tutor_name],
  ['Lokasi', schedule.location || 'Online'],
  ['Link Meeting', schedule.meeting_link],
  ['Catatan', schedule.description],
]).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');

const detailTable = (rows) => `
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0 8px;margin:18px 0;">
    ${rows.map(([label, value]) => `
      <tr>
        <td style="width:150px;padding:10px 12px;background:#F5F3FF;color:#6D28D9;font-weight:700;border-radius:8px 0 0 8px;font-size:13px;">${escapeHtml(label)}</td>
        <td style="padding:10px 12px;background:#FFFFFF;color:#111827;border:1px solid #E5E7EB;border-left:0;border-radius:0 8px 8px 0;font-size:14px;">${escapeHtml(value)}</td>
      </tr>
    `).join('')}
  </table>
`;

const buttonHtml = (href, label) => href ? `
  <p style="text-align:center;margin:24px 0;">
    <a href="${escapeHtml(href)}" style="display:inline-block;background:#7E22CE;color:white;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:800;">${escapeHtml(label)}</a>
  </p>
` : '';

const shell = (content) => `
  <div style="font-family:Arial,sans-serif;background:#F8F7FC;padding:24px;color:#111827;line-height:1.55;">
    <div style="max-width:680px;margin:0 auto;background:#FFFFFF;border:1px solid #E9D5FF;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#A855F7,#6D28D9);padding:24px;color:white;">
        <h1 style="margin:0;font-size:22px;">Kelas Online Mr.BOB</h1>
        <p style="margin:6px 0 0;font-size:14px;opacity:.92;">Notifikasi jadwal belajar</p>
      </div>
      <div style="padding:24px;">
        ${content}
      </div>
    </div>
  </div>
`;

function buildMemberScheduleEmail(schedule, member) {
  const loginUrl = `${appBaseUrl()}/member/schedule`;
  const content = `
    <h2 style="margin:0 0 10px;color:#111827;">Halo Kak ${escapeHtml(firstName(member.name))}, jadwal belajar kamu sudah dibuat.</h2>
    <p style="margin:0 0 16px;color:#4B5563;font-size:15px;">
      Berikut detail sesi belajar kamu bersama tutor Kelas Online Mr.BOB. Simpan jadwal ini dan pastikan hadir tepat waktu ya.
    </p>
    ${detailTable(scheduleRows(schedule))}
    ${buttonHtml(schedule.meeting_link, 'Buka Link Kelas')}
    ${buttonHtml(loginUrl, 'Lihat Jadwal di Member Area')}
    <div style="background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;border-radius:12px;padding:14px;margin-top:18px;font-size:13px;">
      <strong>Catatan:</strong> mohon masuk kelas 5-10 menit lebih awal. Jika ada kendala jadwal atau link meeting, segera hubungi admin.
    </div>
  `;
  return shell(content);
}

function buildTutorScheduleEmail(schedule, members) {
  const tutorUrl = `${appBaseUrl()}/tutor/schedule`;
  const memberList = members.length
    ? `<ul style="padding-left:18px;margin:8px 0 0;color:#374151;">${members.map((m) => `<li>${escapeHtml(m.name)}${m.email ? ` &lt;${escapeHtml(m.email)}&gt;` : ''}</li>`).join('')}</ul>`
    : '<p style="color:#6B7280;">Belum ada peserta terdaftar.</p>';
  const content = `
    <h2 style="margin:0 0 10px;color:#111827;">Halo Kak ${escapeHtml(firstName(schedule.tutor_name))}, ada jadwal mengajar baru.</h2>
    <p style="margin:0 0 16px;color:#4B5563;font-size:15px;">
      Berikut detail sesi yang perlu disiapkan. Silakan cek peserta dan lakukan follow-up jika diperlukan.
    </p>
    ${detailTable(scheduleRows(schedule))}
    <h3 style="margin:18px 0 8px;color:#111827;font-size:16px;">Peserta (${members.length})</h3>
    ${memberList}
    ${buttonHtml(schedule.meeting_link, 'Buka Link Kelas')}
    ${buttonHtml(tutorUrl, 'Lihat Jadwal di Tutor Area')}
    <div style="background:#ECFDF5;color:#065F46;border:1px solid #BBF7D0;border-radius:12px;padding:14px;margin-top:18px;font-size:13px;">
      <strong>Reminder tutor:</strong> cek materi, presensi, dan link meeting sebelum kelas dimulai.
    </div>
  `;
  return shell(content);
}

async function getScheduleEmailPayload(scheduleId) {
  const scheduleRes = await query(`
    SELECT s.*, p.name AS program_name, t.name AS tutor_name, t.email AS tutor_email
    FROM schedules s
    JOIN programs p ON p.id = s.program_id
    JOIN users t ON t.id = s.tutor_id
    WHERE s.id = $1
  `, [scheduleId]);
  const schedule = scheduleRes.rows[0];
  if (!schedule) return null;

  const membersRes = await query(`
    SELECT u.id, u.name, u.email, u.phone
    FROM schedule_members sm
    JOIN users u ON u.id = sm.member_id
    WHERE sm.schedule_id = $1
    ORDER BY u.name
  `, [scheduleId]);

  return {
    schedule,
    members: membersRes.rows,
  };
}

async function sendScheduleNotificationEmails(scheduleId, options = {}) {
  const transportConfig = getTransportConfig();
  if (!transportConfig) {
    console.warn('SMTP belum dikonfigurasi. Email notifikasi jadwal dilewati.');
    return { skipped: true };
  }

  const payload = await getScheduleEmailPayload(scheduleId);
  if (!payload) return { skipped: true };

  const transporter = nodemailer.createTransport(transportConfig);
  const { schedule, members } = payload;
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const prefix = options.subjectPrefix || 'Jadwal Belajar';
  const dateLabel = dateOnly(schedule.date);
  const timeLabel = `${timeOnly(schedule.start_time)}-${timeOnly(schedule.end_time)}`;
  const tasks = [];

  if (schedule.tutor_email) {
    tasks.push(transporter.sendMail({
      from,
      to: schedule.tutor_email,
      subject: `[${prefix}] ${schedule.title} - ${dateLabel} ${timeLabel}`,
      html: buildTutorScheduleEmail(schedule, members),
    }));
  }

  members
    .filter((member) => member.email)
    .forEach((member) => {
      tasks.push(transporter.sendMail({
        from,
        to: member.email,
        subject: `[${prefix}] ${schedule.title} - ${dateLabel} ${timeLabel}`,
        html: buildMemberScheduleEmail(schedule, member),
      }));
    });

  const results = await Promise.allSettled(tasks);
  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.error('Gagal mengirim email notifikasi jadwal:', result.reason && result.reason.message);
    }
  });

  return {
    sent: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
  };
}

module.exports = {
  buildMemberScheduleEmail,
  buildTutorScheduleEmail,
  getScheduleEmailPayload,
  sendScheduleNotificationEmails,
};
