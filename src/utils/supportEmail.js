const nodemailer = require('nodemailer');

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'kelasonline.mrbob@gmail.com';

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

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

const buildFeedbackHtml = ({ user, roleLabel, category, priority, subject, message, pageUrl, contactEmail }) => `
  <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.55;">
    <h2 style="margin:0 0 8px;color:#6D28D9;">Feedback & Support Kelas Online</h2>
    <p style="margin:0 0 18px;color:#4B5563;">Pesan baru dikirim dari halaman Help & Support.</p>
    <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;font-size:14px;">
      ${[
    ['Role', roleLabel],
    ['Nama', user.name],
    ['Email akun', user.email],
    ['Email balasan', contactEmail || user.email],
    ['Kategori', category],
    ['Prioritas', priority],
    ['Subjek', subject],
    ['Halaman terkait', pageUrl || '-'],
  ].map(([label, value]) => `
        <tr>
          <td style="width:160px;border:1px solid #E5E7EB;background:#F9FAFB;"><strong>${escapeHtml(label)}</strong></td>
          <td style="border:1px solid #E5E7EB;">${escapeHtml(value)}</td>
        </tr>
      `).join('')}
    </table>
    <h3 style="margin:22px 0 8px;">Pesan</h3>
    <div style="white-space:pre-wrap;border:1px solid #E5E7EB;background:#FAF5FF;border-radius:10px;padding:14px;">${escapeHtml(message)}</div>
  </div>
`;

const sendSupportFeedback = async (payload) => {
  const transportConfig = getTransportConfig();
  if (!transportConfig) {
    console.warn('SMTP belum dikonfigurasi. Feedback support tidak dikirim.');
    return { skipped: true };
  }

  const transporter = nodemailer.createTransport(transportConfig);
  const subject = `[${payload.roleLabel}] ${payload.category}: ${payload.subject}`;
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: SUPPORT_EMAIL,
    replyTo: payload.contactEmail || payload.user.email || undefined,
    subject,
    html: buildFeedbackHtml(payload),
  });
  return { sent: true };
};

module.exports = {
  SUPPORT_EMAIL,
  sendSupportFeedback,
};
