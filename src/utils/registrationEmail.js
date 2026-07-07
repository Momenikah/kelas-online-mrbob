const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const QRIS_PATH = path.join(__dirname, '../../public/img/qriskelasonline.jpeg');
const QRIS_CID = 'qriskelasonline';

const appBaseUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

// Per-registration confirmation link used in the email CTA.
const getConfirmationUrl = (registration) =>
  `${appBaseUrl()}/konfirmasi-transfer/${encodeURIComponent(registration.registration_code)}`;

// Normalise an Indonesian phone number for wa.me (0xxxx -> 62xxxx).
const toWhatsAppNumber = (phone) => {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return digits;
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const formatCurrency = (amount) => {
  const number = Number(amount) || 0;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(number);
};

const splitName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    restName: parts.slice(1).join(' '),
  };
};

const getUniqueCode = (registration) => {
  const code = String(registration.phone_last_three || '').trim();
  return /^\d{3}$/.test(code) ? code : registration.registration_code;
};

const getPaymentTotal = (registration) => {
  const base = Number(registration.package_price) || 0;
  const code = String(registration.phone_last_three || '').trim();
  return base + (/^\d{3}$/.test(code) ? Number(code) : 0);
};

const getLearnerType = (registration) => {
  if (registration.program_type === 'adult') return 'Adult';
  if (registration.program_type === 'kids') return 'Kids';
  return registration.program_type || '-';
};

// ---- Shared, email-client-safe UI components (tables + inline styles only) ----

const EMAIL_BRAND = '#7c3aed';
const EMAIL_BRAND_DARK = '#5b21b6';

// Full branded wrapper: header band, accent rule, body card, footer.
function emailShell({ heading, subheading = '', bodyHtml, accent = EMAIL_BRAND, accentDark = EMAIL_BRAND_DARK }) {
  return `
<div style="margin:0;padding:0;background-color:#f3f4f6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f6;">${escapeHtml(subheading || heading)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 22px rgba(17,24,39,0.08);">
        <tr><td style="background-color:${accent};background-image:linear-gradient(135deg,${accent} 0%,${accentDark} 100%);padding:28px 34px;">
          <div style="color:#ffffff;font-size:22px;font-weight:800;">Mr.BOB Kampung Inggris</div>
          <div style="color:#ede9fe;font-size:12px;font-weight:700;margin-top:5px;letter-spacing:2px;text-transform:uppercase;">Kelas Online</div>
        </td></tr>
        <tr><td style="height:5px;background-color:#fbbf24;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:32px 34px 8px;color:#374151;font-size:15px;line-height:1.7;">
          <h1 style="margin:0 0 ${subheading ? '6px' : '18px'};font-size:21px;color:#111827;font-weight:800;">${heading}</h1>
          ${subheading ? `<p style="margin:0 0 20px;color:#6b7280;font-size:14px;">${subheading}</p>` : ''}
          ${bodyHtml}
        </td></tr>
        <tr><td style="background-color:#faf5ff;padding:22px 34px;text-align:center;border-top:1px solid #f0e7fb;">
          <div style="color:#7c3aed;font-size:14px;font-weight:800;">#MrBobSuperSeru</div>
          <div style="color:#9ca3af;font-size:12px;margin-top:6px;line-height:1.6;">Kelas Online Mr.BOB Kampung Inggris</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;
}

const emailParagraph = (html) => `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7;">${html}</p>`;

const emailHeading = (text, accent = EMAIL_BRAND) =>
  `<h3 style="margin:26px 0 12px;font-size:16px;color:${accent};font-weight:800;border-left:4px solid ${accent};padding-left:11px;">${text}</h3>`;

const emailButton = (href, label, color = EMAIL_BRAND) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px auto 4px;"><tr>
    <td style="border-radius:10px;background-color:${color};">
      <a href="${href}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:10px;">${label}</a>
    </td>
  </tr></table>`;

// Label/value detail table with zebra rows and rounded border.
function keyValueTable(rows) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;width:100%;border:1px solid #ececf1;border-radius:12px;overflow:hidden;font-size:14px;">
      ${rows.map(([label, value], i) => {
        const border = i === rows.length - 1 ? '0' : '1px solid #f1f0f5';
        return `
        <tr style="background-color:${i % 2 ? '#faf9fc' : '#ffffff'};">
          <td style="padding:11px 16px;color:#6b7280;font-weight:600;width:42%;border-bottom:${border};vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:11px 16px;color:#111827;font-weight:600;border-bottom:${border};">${escapeHtml(value)}</td>
        </tr>`;
      }).join('')}
    </table>`;
}

const emailTotalBox = (label, amount, sub = '') => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border-radius:12px;background-color:#f5f3ff;border:1px solid #ddd6fe;">
    <tr><td style="padding:18px 22px;">
      <div style="color:#7c3aed;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">${label}</div>
      <div style="color:#111827;font-size:27px;font-weight:800;margin-top:4px;">${amount}</div>
      ${sub ? `<div style="color:#6b7280;font-size:13px;margin-top:8px;line-height:1.6;">${sub}</div>` : ''}
    </td></tr>
  </table>`;

const emailNoteBox = (title, items) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-radius:12px;background-color:#fef2f2;border:1px solid #fecaca;">
    <tr><td style="padding:16px 20px;color:#991b1b;font-size:14px;line-height:1.7;">
      <strong style="display:block;margin-bottom:8px;color:#b91c1c;font-size:14px;">${title}</strong>
      <ol style="margin:0;padding-left:18px;">${items.map((i) => `<li style="margin-bottom:6px;">${i}</li>`).join('')}</ol>
    </td></tr>
  </table>`;

const emailInfoBox = (html, bg = '#f5f3ff', border = '#ddd6fe') => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;border-radius:12px;background-color:${bg};border:1px solid ${border};">
    <tr><td style="padding:16px 20px;color:#374151;font-size:14px;line-height:1.7;">${html}</td></tr>
  </table>`;

const buildPaymentSummary = (registration) => {
  const rows = [
    ['Program', registration.selected_class],
    ['Paket', registration.package_name],
    ['Tipe Paket', registration.package_group],
    ['Durasi', registration.duration],
    ['Jumlah Pertemuan', registration.meeting_count],
    ['Jam Belajar', registration.study_time],
    ['Mulai Belajar', registration.start_date],
    ['Tutor Pilihan', registration.preferred_tutor],
  ].filter(([, value]) => value);

  return keyValueTable(rows);
};

function buildRegistrationEmailHtml(registration) {
  const { firstName, restName } = splitName(registration.name);
  const displayName = escapeHtml(firstName || registration.name);
  const restDisplayName = escapeHtml(restName);
  const program = escapeHtml(registration.selected_class || registration.package_name || '-');
  const packageName = escapeHtml(registration.package_name || '-');
  const learnerType = escapeHtml(getLearnerType(registration));
  const duration = escapeHtml(registration.duration || '-');
  const startDate = escapeHtml(registration.start_date || '-');
  const studyTime = escapeHtml(registration.study_time || '-');
  const uniqueCode = escapeHtml(getUniqueCode(registration));
  const paymentTotal = escapeHtml(formatCurrency(getPaymentTotal(registration)));
  const paymentSummary = buildPaymentSummary(registration);
  const confirmationUrl = getConfirmationUrl(registration);

  const body = `
    ${emailParagraph(`Terimakasih sudah mendaftar <strong>Kelas Online di Mr.BOB Kampung Inggris</strong>. Jadwal belajar pilihanmu: <strong>Hari Senin, ${startDate}, jam ${studyTime}</strong>.`)}
    ${emailParagraph(`Program <strong>${program}</strong> (${learnerType} — ${duration}). Silakan selesaikan pembayaran sesuai rincian berikut:`)}
    ${emailTotalBox('Total Transfer', paymentTotal, `Kode unik kamu: <strong>${uniqueCode}</strong>. Transfer tepat sampai 3 digit terakhir (jangan dibulatkan) supaya pembayaran mudah kami verifikasi.`)}
    ${emailHeading('Rincian Program')}
    ${paymentSummary}
    ${emailHeading('Metode Pembayaran')}
    ${emailParagraph('Transfer ke rekening BRI berikut:')}
    ${emailInfoBox(`
      <div style="text-align:center;">
        <img src="https://app.kelasonlinemrbob.com/wp-content/uploads/2024/12/BRI-Kelas-online-mrbob-1024x683.png" alt="BRI Kelas Online Mr.BOB" width="420" style="width:100%;max-width:420px;height:auto;border-radius:10px;" />
        <div style="margin-top:12px;font-size:17px;font-weight:800;color:#111827;letter-spacing:0.5px;">BRI &nbsp;055501001605561</div>
        <div style="font-size:13px;color:#6b7280;margin-top:3px;">a.n. LKBI MR BOB QQ ONLINE</div>
      </div>
    `)}
    ${emailParagraph('<strong>Atau</strong> scan QRIS berikut (menerima semua e-wallet &amp; m-banking):')}
    <p style="text-align:center;margin:0 0 16px;"><img src="cid:${QRIS_CID}" alt="QRIS Kelas Online Mr.BOB" width="300" style="width:100%;max-width:300px;height:auto;border-radius:10px;border:1px solid #eeeeee;" /></p>
    ${emailHeading('Contoh Transfer')}
    <p style="text-align:center;margin:0 0 8px;"><img src="https://app.kelasonlinemrbob.com/wp-content/uploads/2024/12/Screenshot_20241207_155306_BRImo-473x1024.jpg" alt="Contoh bukti transfer" width="220" style="width:100%;max-width:220px;height:auto;border-radius:10px;border:1px solid #eeeeee;" /></p>
    ${emailHeading('Konfirmasi Pembayaran')}
    ${emailParagraph('Setelah transfer, mohon segera unggah foto bukti transfer melalui tombol di bawah ini:')}
    ${emailButton(confirmationUrl, 'Konfirmasi Bukti Transfer')}
    <p style="text-align:center;margin:6px 0 0;font-size:13px;color:#6b7280;">atau buka tautan berikut:<br><a href="${confirmationUrl}" style="color:#7c3aed;word-break:break-all;">${confirmationUrl}</a></p>
    ${emailNoteBox('PENTING — mohon dibaca ya ^_^', [
      'Jika dalam 1×24 jam tidak ada konfirmasi, pendaftaran kami anggap <strong>BATAL</strong>. Di Mr.BOB tidak ada sistem booking — yang sudah FIX transfer yang resmi tercatat sebagai member. Siapa cepat dia dapat ^_^',
      'Data pendaftaranmu diproses otomatis masuk database kami <strong>setelah</strong> melakukan konfirmasi FIX transfer.',
      'Pembayaran bersifat <strong>NON-REFUNDABLE</strong> (biaya yang sudah dibayarkan tidak bisa ditarik kembali).',
    ])}
  `;
  return emailShell({
    heading: `Halo Kak ${displayName} ${restDisplayName} 👋`,
    subheading: 'Pendaftaran kamu sudah kami terima — tinggal satu langkah pembayaran lagi.',
    bodyHtml: body,
  });
}

function getTransportConfig() {
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
}

// ---- Admin notification email ----

function buildAdminSubject(registration) {
  const program = registration.selected_class || registration.package_group || '-';
  const fullName = [registration.name, registration.friend_name].filter(Boolean).join(' ');
  const learner = getLearnerType(registration);
  const city = registration.city || '-';
  const phone = registration.phone || '-';
  return `NON FIX/WEB Kelas Online ${program} # ${city} # ${fullName} # Pilihan Program ${learner} # ${phone}`;
}

// Full registration data as label/value rows (shared by admin emails).
function registrationDetailRows(registration) {
  return [
    ['ID Pendaftaran', registration.registration_code],
    ['Nama', registration.name],
    ['Nama Teman', registration.friend_name],
    ['Email', registration.email],
    ['WhatsApp', registration.phone],
    ['Kota', registration.city],
    ['Usia', registration.age],
    ['Pekerjaan', registration.occupation],
    ['Pendidikan', registration.education_level],
    ['Latar Pendidikan', registration.education_background],
    ['Instagram', registration.instagram],
    ['Tipe Peserta', getLearnerType(registration)],
    ['Program', registration.selected_class],
    ['Tipe Paket', registration.package_group],
    ['Paket', registration.package_name],
    ['Durasi', registration.duration],
    ['Jumlah Pertemuan', registration.meeting_count],
    ['Jam Belajar', registration.study_time],
    ['Mulai Belajar', registration.start_date],
    ['Tutor Pilihan', registration.preferred_tutor],
    ['Harga Paket', formatCurrency(registration.package_price)],
    ['Kode Unik', getUniqueCode(registration)],
    ['Total Transfer', formatCurrency(getPaymentTotal(registration))],
    ['Kupon', registration.coupon_code],
    ['Referral', registration.referral_code],
    ['Status', registration.status],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');
}

function detailRowsTable(rows) {
  return keyValueTable(rows);
}

function waButtonHtml(registration) {
  const waNumber = toWhatsAppNumber(registration.phone);
  const { firstName } = splitName(registration.name);
  const waMessage = encodeURIComponent(
    `Halo Kak ${firstName || registration.name} ^_^\n\n`
    + `Kami dari Mr.BOB Kampung Inggris ingin follow up pendaftaran KELAS ONLINE kakak `
    + `(ID: ${registration.registration_code}).`
  );
  return waNumber
    ? `<p style="text-align:center;margin:24px 0;">
         <a href="https://wa.me/${waNumber}?text=${waMessage}" style="display:inline-block;background-color:#25D366;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:12px 26px;border-radius:8px;">Follow Up via WhatsApp</a>
       </p>`
    : '<p style="text-align:center;color:#b91c1c;">Nomor WhatsApp tidak tersedia untuk follow up.</p>';
}

function buildAdminEmailHtml(registration) {
  const body = `
    ${emailParagraph('Member baru mendaftar melalui web dan menunggu konfirmasi pembayaran.')}
    ${detailRowsTable(registrationDetailRows(registration))}
    ${waButtonHtml(registration)}
  `;
  return emailShell({
    heading: 'Pendaftaran Baru (NON FIX)',
    subheading: 'Menunggu konfirmasi pembayaran dari member.',
    bodyHtml: body,
    accent: '#d97706',
    accentDark: '#b45309',
  });
}

// ---- Payment confirmed (after transfer proof upload) ----

const ZOOM_ANDROID_URL = 'https://play.google.com/store/apps/details?id=us.zoom.videomeetings';
const ZOOM_IOS_URL = 'https://apps.apple.com/app/zoom-cloud-meetings/id546505307';

// Admin contact link for "KLIK DISINI" — prefer a WhatsApp number, fall back to member login.
const adminChatUrl = () => {
  const wa = toWhatsAppNumber(process.env.ADMIN_WHATSAPP);
  if (wa) return `https://wa.me/${wa}`;
  return process.env.ADMIN_CHAT_URL || `${appBaseUrl()}/login`;
};
const mapsUrl = () => process.env.MAPS_URL
  || 'https://www.google.com/maps/search/?api=1&query=Mr.BOB+Kampung+Inggris+Pare';

function buildPaymentConfirmedEmailHtml(registration, options = {}) {
  const { firstName } = splitName(registration.name);
  const displayName = escapeHtml(firstName || registration.name);
  const program = escapeHtml(registration.selected_class || '-');
  const programClass = escapeHtml(registration.package_group || '-');
  const paketBelajar = escapeHtml(registration.package_name || '-');
  const lamaBelajar = escapeHtml(registration.duration || '-');
  const jam = escapeHtml(registration.study_time || '-');
  const email = escapeHtml(registration.email || '-');
  const password = escapeHtml(options.password || '(password yang kamu buat saat konfirmasi)');
  const loginUrl = `${appBaseUrl()}/login`;
  const chatUrl = escapeHtml(adminChatUrl());
  const maps = escapeHtml(mapsUrl());

  const body = `
    ${emailParagraph(`Terimakasih sudah melakukan transfer untuk pendaftaran <strong>${program} ${programClass}</strong> — Kelas Online untuk <strong>${paketBelajar}</strong>. 🎉`)}
    ${emailInfoBox('<strong style="color:#7c3aed;font-size:16px;">Welcome to Kelas Online Mr.BOB Kampung Inggris!</strong>')}
    ${emailHeading('Rincian Kelas')}
    ${emailParagraph(`Kelas Online Mr.BOB selama <strong>${lamaBelajar}</strong>, mulai jam <strong>${jam}</strong>. Penentuan tutor akan kami acak dan sesuaikan dengan program yang kamu pilih ^_^`)}
    ${emailHeading('Login Member Area')}
    ${emailInfoBox(`
      <div style="margin-bottom:7px;">Email: &nbsp;<strong style="color:#111827;">${email}</strong></div>
      <div>Password: &nbsp;<strong style="color:#111827;">${password}</strong></div>
    `, '#fffbeb', '#fde68a')}
    ${emailButton(loginUrl, 'Masuk Member Area')}
    ${emailParagraph(`Ada yang kurang jelas atau kendala? <a href="${chatUrl}" style="color:#7c3aed;font-weight:700;">Hubungi admin di sini</a> — fast response kak ^_^`)}
    ${emailHeading('Sebelum Kelas Dimulai')}
    ${emailParagraph(`Pastikan kak ${displayName} sudah menginstall aplikasi Zoom (untuk video call):`)}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr>
      <td style="padding:0 8px 8px 0;"><a href="${ZOOM_ANDROID_URL}" style="display:inline-block;padding:10px 18px;background-color:#eef2ff;color:#4338ca;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Zoom Android</a></td>
      <td style="padding:0 0 8px 0;"><a href="${ZOOM_IOS_URL}" style="display:inline-block;padding:10px 18px;background-color:#eef2ff;color:#4338ca;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Zoom iOS</a></td>
    </tr></table>
    ${emailNoteBox('NOTE', ['Pembayaran bersifat <strong>non-refundable</strong> (biaya yang sudah dibayarkan tidak bisa ditarik kembali).'])}
    ${emailHeading('Lokasi Mr.BOB Kampung Inggris')}
    ${emailParagraph('Berikut peta lokasi Mr.BOB Kampung Inggris via Google Maps:')}
    ${emailButton(maps, 'Buka Lokasi di Google Maps', '#2563eb')}
  `;
  return emailShell({
    heading: `Halo Kak ${displayName} 🎉`,
    subheading: 'Pembayaranmu sudah kami terima — selamat bergabung!',
    bodyHtml: body,
  });
}

function buildAdminFixSubject(registration) {
  const program = registration.selected_class || registration.package_group || '-';
  const programClass = registration.package_group || registration.package_name || '-';
  return `FIX - ${registration.name} - ${program} - ${programClass}`;
}

function buildAdminFixEmailHtml(registration) {
  const body = `
    ${emailParagraph('Member telah mengunggah bukti transfer dan sudah dikonfirmasi. Bukti transfer terlampir pada email ini.')}
    ${detailRowsTable(registrationDetailRows(registration))}
    ${waButtonHtml(registration)}
  `;
  return emailShell({
    heading: 'Pembayaran FIX ✅',
    subheading: 'Pembayaran member terkonfirmasi.',
    bodyHtml: body,
    accent: '#059669',
    accentDark: '#047857',
  });
}

async function sendRegistrationEmail(registration) {
  const transportConfig = getTransportConfig();
  if (!transportConfig) {
    console.warn('SMTP belum dikonfigurasi. Email pendaftaran dilewati.');
    return { skipped: true };
  }

  const transporter = nodemailer.createTransport(transportConfig);
  const attachments = [];
  if (fs.existsSync(QRIS_PATH)) {
    attachments.push({ filename: 'qris-kelasonline.jpeg', path: QRIS_PATH, cid: QRIS_CID });
  }
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: registration.email,
    subject: 'Pendaftaran Kelas Online Mr.BOB Kampung Inggris',
    html: buildRegistrationEmailHtml(registration),
    attachments,
  });
  return { sent: true };
}

async function sendAdminNotificationEmail(registration) {
  const transportConfig = getTransportConfig();
  if (!transportConfig) {
    console.warn('SMTP belum dikonfigurasi. Email notifikasi admin dilewati.');
    return { skipped: true };
  }
  const adminEmail = process.env.ADMIN_EMAIL || process.env.MAIL_FROM || process.env.SMTP_USER;
  if (!adminEmail) {
    console.warn('ADMIN_EMAIL belum dikonfigurasi. Email notifikasi admin dilewati.');
    return { skipped: true };
  }

  const transporter = nodemailer.createTransport(transportConfig);
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: adminEmail,
    replyTo: registration.email || undefined,
    subject: buildAdminSubject(registration),
    html: buildAdminEmailHtml(registration),
  });
  return { sent: true };
}

// User email sent after the member uploads the transfer proof (login credentials, etc.).
async function sendPaymentConfirmedEmail(registration, options = {}) {
  const transportConfig = getTransportConfig();
  if (!transportConfig) {
    console.warn('SMTP belum dikonfigurasi. Email konfirmasi pembayaran (user) dilewati.');
    return { skipped: true };
  }

  const transporter = nodemailer.createTransport(transportConfig);
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: registration.email,
    subject: 'Konfirmasi Pendaftaran Kelas Online Mr.BOB Kampung Inggris',
    html: buildPaymentConfirmedEmailHtml(registration, options),
  });
  return { sent: true };
}

// Admin "FIX" email with the transfer proof attached.
async function sendAdminPaymentConfirmedEmail(registration, options = {}) {
  const transportConfig = getTransportConfig();
  if (!transportConfig) {
    console.warn('SMTP belum dikonfigurasi. Email konfirmasi pembayaran (admin) dilewati.');
    return { skipped: true };
  }
  const adminEmail = process.env.ADMIN_EMAIL || process.env.MAIL_FROM || process.env.SMTP_USER;
  if (!adminEmail) {
    console.warn('ADMIN_EMAIL belum dikonfigurasi. Email konfirmasi pembayaran (admin) dilewati.');
    return { skipped: true };
  }

  const transporter = nodemailer.createTransport(transportConfig);
  const attachments = [];
  if (options.proofPath && fs.existsSync(options.proofPath)) {
    const ext = path.extname(options.proofPath) || '.jpg';
    attachments.push({
      filename: `bukti-transfer-${registration.registration_code}${ext}`,
      path: options.proofPath,
    });
  }
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: adminEmail,
    replyTo: registration.email || undefined,
    subject: buildAdminFixSubject(registration),
    html: buildAdminFixEmailHtml(registration),
    attachments,
  });
  return { sent: true };
}

// ---- Renewal emails ----

const formatDateID = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
};

function renewalDetailRows(renewal) {
  return [
    ['Nama', renewal.member_name],
    ['Email', renewal.member_email],
    ['WhatsApp', renewal.phone],
    ['Program', renewal.program_name],
    ['Pilihan Kelas', renewal.selected_class],
    ['Paket', renewal.package_name],
    ['Mulai Belajar', formatDateID(renewal.preferred_start_date)],
    ['Jam Belajar', renewal.study_time],
    ['Diskon Renewal', renewal.discount ? `- ${formatCurrency(renewal.discount)}` : null],
    ['Total Renewal', formatCurrency(renewal.package_price)],
    ['Catatan', renewal.notes],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');
}

function buildRenewalMemberHtml(renewal) {
  const { firstName } = splitName(renewal.member_name);
  const body = `
    ${emailParagraph(`Halo ${escapeHtml(firstName || renewal.member_name)}, form perpanjangan (renewal) kamu sudah kami terima. Tim admin akan mengecek pembayaran dan memperbarui masa aktif programmu.`)}
    ${emailInfoBox('<strong style="color:#7c3aed;">🎁 Kamu mendapat potongan renewal Rp100.000.</strong>')}
    ${detailRowsTable(renewalDetailRows(renewal))}
    ${emailParagraph('<span style="color:#6b7280;font-size:13px;">Terima kasih sudah melanjutkan belajar bersama Mr.BOB Kampung Inggris.</span>')}
  `;
  return emailShell({
    heading: 'Renewal Diterima ✅',
    subheading: 'Perpanjangan programmu sudah kami terima.',
    bodyHtml: body,
  });
}

function buildRenewalAdminHtml(renewal) {
  const body = `
    ${emailParagraph('Ada pengajuan renewal dari member. Berikut detailnya:')}
    ${detailRowsTable(renewalDetailRows(renewal))}
  `;
  return emailShell({
    heading: 'Pengajuan Renewal Baru',
    subheading: 'Kelas Online Mr.BOB Kampung Inggris.',
    bodyHtml: body,
    accent: '#d97706',
    accentDark: '#b45309',
  });
}

async function sendRenewalEmail(renewal) {
  const transportConfig = getTransportConfig();
  if (!transportConfig) {
    console.warn('SMTP belum dikonfigurasi. Email renewal (member) dilewati.');
    return { skipped: true };
  }
  if (!renewal.member_email) return { skipped: true };
  const transporter = nodemailer.createTransport(transportConfig);
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: renewal.member_email,
    subject: 'Renewal Kelas Online Mr.BOB Kampung Inggris',
    html: buildRenewalMemberHtml(renewal),
  });
  return { sent: true };
}

async function sendRenewalAdminEmail(renewal) {
  const transportConfig = getTransportConfig();
  if (!transportConfig) {
    console.warn('SMTP belum dikonfigurasi. Email renewal (admin) dilewati.');
    return { skipped: true };
  }
  const adminEmail = process.env.ADMIN_EMAIL || process.env.MAIL_FROM || process.env.SMTP_USER;
  if (!adminEmail) return { skipped: true };
  const transporter = nodemailer.createTransport(transportConfig);
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: adminEmail,
    replyTo: renewal.member_email || undefined,
    subject: `RENEWAL Kelas Online # ${renewal.member_name || '-'} # ${renewal.program_name || '-'}`,
    html: buildRenewalAdminHtml(renewal),
  });
  return { sent: true };
}

module.exports = {
  buildRegistrationEmailHtml,
  buildAdminSubject,
  buildAdminEmailHtml,
  buildPaymentConfirmedEmailHtml,
  buildAdminFixSubject,
  buildAdminFixEmailHtml,
  sendRegistrationEmail,
  sendAdminNotificationEmail,
  sendPaymentConfirmedEmail,
  sendAdminPaymentConfirmedEmail,
  sendRenewalEmail,
  sendRenewalAdminEmail,
  getPaymentTotal,
};
