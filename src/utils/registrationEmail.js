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

  return `
    <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:16px;color:#000000;">
      ${rows.map(([label, value]) => `
        <tr>
          <td style="border:1px solid #dddddd;"><strong>${escapeHtml(label)}</strong></td>
          <td style="border:1px solid #dddddd;">${escapeHtml(value)}</td>
        </tr>
      `).join('')}
    </table>
  `;
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

  return `
    <h2><span style="color: #000000;">Halo Kak ${displayName} ${restDisplayName} ^_^ ...</span></h2>
    <p style="font-size: 20px;"><span style="color: #000000;">Terimakasih sudah mendaftar&nbsp;<strong>KELAS ONLINE&nbsp;di Mr.BOB Kampung Inggris</strong>&nbsp;Untuk pilihan Belajar pada&nbsp;<strong>Hari Senin, ${startDate}, Jam ${studyTime}.&nbsp;</strong></span></p>
    <p style="font-size: 20px;"><span style="color: #000000;">Selanjutnya, silahkan kak ${displayName} - ${restDisplayName}&nbsp;melakukan pembayaran :</span></p>
    <h2><span style="color: #000000; padding: 5px; background-color: yellow;">Program ${program} ( ${learnerType} - ${duration}) , Sebesar <span style="color: #ff0000;">${paymentTotal}</span>&nbsp;</span></h2>
    <p>${paymentSummary}</p>
    <p style="font-size: 20px;"><br /><span style="color: #000000;">(<strong>${uniqueCode}</strong>&nbsp;adalah&nbsp;kode daftar kamu, transfer nya jangan dibulatkan ya).&nbsp;</span></p>
    <p style="font-size: 20px;"><span style="color: #000000;">.....</span></p>
    <p style="font-size: 20px;"><span style="color: #000000;">Pembayaran bisa kak ${displayName} lakukan via transfer ke salah satu nomer rekening berikut ini : &nbsp;</span></p>
    <p>&nbsp;</p>
    <p><img class="aligncenter wp-image-10808 size-large" src="https://app.kelasonlinemrbob.com/wp-content/uploads/2024/12/BRI-Kelas-online-mrbob-1024x683.png" alt="BRI KELAS ONLINE : 055501001605561 (LKBI MR BOB QQ ONLINE)" width="1024" height="683" /></p>
    <p style="font-size: 20px; text-align: center;"><strong><span style="color: #000000;">BRI KELAS ONLINE : 055501001605561 (LKBI MR BOB QQ ONLINE)</span></strong></p>
    <p>&nbsp;</p>
    <p style="font-size: 20px; text-align: center;"><strong><span style="color: #000000;">atau scan QRIS berikut ini ^_^</span></strong></p>
    <p style="text-align: center;"><img src="cid:${QRIS_CID}" alt="QRIS Kelas Online Mr.BOB" width="320" style="max-width:320px;width:100%;height:auto;" /></p>
    <p style="font-size: 14px; text-align: center;"><span style="color: #555555;">QRIS menerima semua e-wallet &amp; m-banking</span></p>
    <p><span style="color: #000000;">.....</span></p>
    <p style="font-size: 20px;"><span style="color: #000000;">Kayak begini nih contoh transfer nya ^_^</span></p>
    <p><img class="aligncenter wp-image-10193 size-large" src="https://app.kelasonlinemrbob.com/wp-content/uploads/2024/12/Screenshot_20241207_155306_BRImo-473x1024.jpg" alt="" width="473" height="1024" /></p>
    <p><br /><span style="color: #000000;">.....</span></p>
    <p style="font-size: 20px;"><br /><span style="color: #000000;">Setelah&nbsp;transfer, mohon segera melakukan <strong>KONFIRMASI PEMBAYARAN</strong>, dengan mengirimkan foto bukti transfer ${displayName} dengan KLIK link berikut ini ^_^</span></p>
    <p>&nbsp;</p>
    <p style="text-align: center;"><a style="color: #ffffff; background-color: #0072ff; font-size: 20px; border-radius: 7px; text-decoration: none; font-weight: normal; font-style: normal; padding: 0.8rem 1rem; border-color: #0072ff;" href="${confirmationUrl}">Konfirmasi Bukti Transfer</a></p>
    <p>&nbsp;</p>
    <p style="font-size: 20px;"><span style="color: #000000;">atau dengan KLIK link berikut ini ==&gt; <a href="${confirmationUrl}"><span style="color: #0000ff;"><strong>${confirmationUrl}</strong></span></a></span></p>
    <p>&nbsp;</p>
    <p style="font-size: 20px;"><br /><span style="color: #ff0000;">NOTE :&nbsp;</span></p>
    <p style="font-size: 20px;"><span style="color: #ff0000;">1. Jika 1x24 jam tidak ada konfirmasi, kami anggap&nbsp;BATAL.&nbsp;Di Mr.BOB tidak ada sistem booking. Mereka yg sudah melakukan FIX transfer-lah yg akan RESMI tercatat sebagai member di Mr.BOB. Siapa cepat dia dapat.&nbsp;^_^</span></p>
    <p style="font-size: 20px;"><span style="color: #ff0000;">2. Data Pendaftaran Kamu akan kami PROSES secara otomatis masuk ke DataBase Kami SETELAH MELAKUKAN KONFIRMASI FIX TRANSFER ^_^</span></p>
    <p style="font-size: 20px;"><span style="color: #ff0000;">3. Pembayaran bersifat NON-REFUNDABLE&nbsp;(biaya yang sudah dibayarkan tidak bisa ditarik kembali).</span></p>
    <p style="font-size: 20px;"><br /><span style="color: #000000;">.......&nbsp;</span></p>
    <p>&nbsp;</p>
    <p>&nbsp;</p>
    <p>&nbsp;</p>
  `;
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
  return `
    <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#111827;width:100%;max-width:640px;">
      ${rows.map(([label, value], i) => `
        <tr style="background-color:${i % 2 ? '#f9fafb' : '#ffffff'};">
          <td style="border:1px solid #e5e7eb;width:200px;vertical-align:top;"><strong>${escapeHtml(label)}</strong></td>
          <td style="border:1px solid #e5e7eb;">${escapeHtml(value)}</td>
        </tr>`).join('')}
    </table>
  `;
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
  return `
    <h2 style="color:#111827;">Pendaftaran Baru (NON FIX) — Kelas Online Mr.BOB</h2>
    <p style="color:#374151;font-size:14px;">Member baru mendaftar melalui web dan menunggu konfirmasi pembayaran.</p>
    ${detailRowsTable(registrationDetailRows(registration))}
    ${waButtonHtml(registration)}
  `;
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

  return `
    <h2><span style="color: #000000;">Halo kak ${displayName} ..^_^..</span></h2>
    <p style="font-size: 20px;"><span style="color: #000000;">Terimakasih sudah melakukan transfer untuk pendaftaran <strong>${program} ${programClass}</strong> Kelas Online untuk <strong>${paketBelajar}</strong> ^_^..</span></p>
    <h2><span style="color: #000000;">Welcome to Kelas Online Mr.BOB Kampung Inggris ...</span></h2>
    <p style="font-size: 20px;"><span style="color: #000000;">Berikut Rincian Kelas Kamu :</span></p>
    <p style="font-size: 20px;"><span style="color: #000000;">Kelas Online Mrbob Selama <strong>${lamaBelajar}</strong> dari jam <strong>${jam}</strong>, untuk penentuan tutor akan kami acak dan sesuaikan sesuai dengan program yang kamu pilih ^_^.</span></p>
    <h2><span style="color: #000000; padding: 5px; background-color: yellow;">LOGIN MEMBER AREA</span></h2>
    <p style="font-size: 20px;"><span style="color: #000000;">Email : <strong>${email}</strong></span></p>
    <p style="font-size: 20px;"><span style="color: #000000;">Password : <strong>${password}</strong></span></p>
    <p style="text-align: center; margin: 18px 0;"><a href="${loginUrl}" style="display:inline-block;background-color:#7E22CE;color:#ffffff;font-size:18px;text-decoration:none;padding:12px 26px;border-radius:8px;">Masuk Member Area</a></p>
    <p style="font-size: 20px;"><span style="color: #000000;">Jika ada yang kurang jelas atau ada kendala dll jangan ragu untuk bertanya silahkan <a href="${chatUrl}"><strong>KLIK DISINI</strong></a>, untuk komunikasi dengan admin Fast respon kak ^_^</span></p>
    <p style="font-size: 20px;"><span style="color: #000000;">*Sebelum kelas online di mulai pastikan kak ${displayName}, Sudah menginstall Aplikasi Zoom ( Sebagai Video Call ) :</span></p>
    <ul style="font-size: 20px; color: #000000;">
      <li>Untuk Android : <a href="${ZOOM_ANDROID_URL}">Download Aplikasi Zoom</a></li>
      <li>Untuk IOS : <a href="${ZOOM_IOS_URL}">Download Aplikasi Zoom</a></li>
    </ul>
    <p><span style="color: #000000;">....</span></p>
    <p style="font-size: 20px;"><span style="color: #ff0000;">NOTE :</span></p>
    <p style="font-size: 20px;"><span style="color: #ff0000;">1. Pembayaran bersifat non-refundable (biaya yang sudah dibayarkan tidak bisa ditarik kembali).</span></p>
    <p><span style="color: #000000;">......</span></p>
    <p style="font-size: 20px;"><span style="color: #000000;">Berikut Peta Lokasi Mr.BOB Kampung Inggris via Google Maps, silahkan KLIK link di bawah ini ^_^</span></p>
    <p style="text-align: center; margin: 14px 0;"><a href="${maps}" style="display:inline-block;background-color:#0072ff;color:#ffffff;font-size:18px;text-decoration:none;padding:10px 22px;border-radius:8px;">Buka Lokasi di Google Maps</a></p>
    <p style="font-size: 20px;"><span style="color: #000000;">#MrBobSuperSeru</span></p>
    <p><span style="color: #000000;">....</span></p>
  `;
}

function buildAdminFixSubject(registration) {
  const program = registration.selected_class || registration.package_group || '-';
  const programClass = registration.package_group || registration.package_name || '-';
  return `FIX - ${registration.name} - ${program} - ${programClass}`;
}

function buildAdminFixEmailHtml(registration) {
  return `
    <h2 style="color:#065F46;">Pembayaran FIX — Kelas Online Mr.BOB</h2>
    <p style="color:#374151;font-size:14px;">Member telah mengunggah bukti transfer dan dikonfirmasi. Bukti transfer terlampir pada email ini.</p>
    ${detailRowsTable(registrationDetailRows(registration))}
    ${waButtonHtml(registration)}
  `;
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
  getPaymentTotal,
};
