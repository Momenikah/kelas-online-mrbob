// =============================================
// Alumni Loyalty Program: alumni merekomendasikan teman, dapat poin setelah
// diverifikasi admin, lalu menukar poin dengan hadiah dari katalog.
// Sumber: proposal "ALUMNI LOYALTY PROGRAM" + tab "DRAFT KATALOG".
// Keputusan detail tercatat di docs/specs/0001-alumni-loyalty-program.md.
// =============================================

// Member baru dapat diskon ini kalau referral sudah diverifikasi admin dan
// harga paket per orang minimal Rp900.000. Di bawah itu alumni tetap dapat
// poin, tetapi member barunya tidak dapat potongan harga (revisi klien).
const REFERRAL_DISCOUNT = 100000;
const DISCOUNT_MIN_PRICE = 900000;

// Rincian poin per paket (tab DRAFT KATALOG), lengkap seperti dokumen klien.
// Di formulir, TOEFL dijual dengan nama paket VIP dan IELTS Luxury dengan nama
// LUXURY CLASS, jadi dua baris itu hanya untuk tampilan dan nilainya sama.
const POINT_TABLE = [
  { name: 'TOEFL', price: 980000, points: 10 },
  { name: 'IELTS LUXURY', price: 1650000, points: 15 },
  { name: 'SEMI - PRIVATE', price: 395000, points: 2 },
  { name: 'PRIVATE', price: 695000, points: 5 },
  { name: '2X - PRIVATE WEEKEND', price: 675000, points: 5 },
  { name: '2X - PRIVATE WEEKDAY', price: 575000, points: 5 },
  { name: 'BTS', price: 880000, points: 8 },
  { name: '3X - PRIVATE', price: 800000, points: 8 },
  { name: '2X - VIP WEEKEND', price: 950000, points: 8 },
  { name: '2X - VIP WEEKDAY', price: 850000, points: 8 },
  { name: 'VIP', price: 980000, points: 10 },
  { name: 'IELTS', price: 1100000, points: 10 },
  { name: '3X - VIP', price: 1150000, points: 10 },
  { name: '1 BULAN - PRIVATE', price: 1250000, points: 10 },
  { name: 'IELTS 2X WEEKDAY', price: 1200000, points: 10 },
  { name: 'IELTS 2X WEEKEND', price: 1300000, points: 13 },
  { name: 'VIP GOLD', price: 1450000, points: 13 },
  { name: 'LUXURY CLASS', price: 1500000, points: 15 },
  { name: '1 BULAN - BTS', price: 1660000, points: 15 },
  { name: 'VIP PLATINUM', price: 1750000, points: 17 },
  { name: 'IELTS 3X', price: 1700000, points: 17 },
  { name: '1 BULAN - VIP', price: 1800000, points: 18 },
  { name: 'IELTS 1 BULAN', price: 2750000, points: 20 },
  { name: '2 BULAN - PRIVATE', price: 2400000, points: 20 },
  { name: '2 BULAN - VIP', price: 3500000, points: 30 },
  { name: 'IELTS 2 BULAN', price: 4750000, points: 40 },
  { name: 'IELTS 3 BULAN', price: 6750000, points: 60 },
];
const POINTS_BY_NAME = Object.fromEntries(POINT_TABLE.map((p) => [p.name, p.points]));

// Katalog hadiah (tab DRAFT KATALOG, "KONSEP HADIAH").
const REWARD_TIERS = [
  { points: 20, value: 200000, items: ['E-money', 'Voucher belanja', 'Diskon belajar'] },
  { points: 30, value: 300000, items: ['Headphone', 'Webcam', 'TWS', 'Tas laptop', 'Tripod + ring light', 'Power bank'] },
  { points: 50, value: 500000, items: ['Smart watch Huawei Band 10', 'Tas', 'Tumbler Stanley'] },
  { points: 100, value: 1000000, items: ['Mesin kopi', 'Microwave'] },
  { points: 300, value: 3000000, items: ['Tablet', 'Smart TV', 'Vacuum robot Bardi'] },
  { points: 500, value: 5000000, items: ['MacBook', 'Logam mulia 2 gr', 'Kamera Sony', 'Dyson Purifier Cool'] },
];

const REFERRAL_STATUSES = ['pending', 'approved', 'rejected'];
const CLAIM_STATUSES = ['pending', 'processing', 'shipped', 'completed', 'rejected'];
const CLAIM_STATUS_LABELS = {
  pending: 'Menunggu',
  processing: 'Diproses',
  shipped: 'Dikirim',
  completed: 'Selesai',
  rejected: 'Ditolak',
};
const REFERRAL_STATUS_LABELS = {
  pending: 'Menunggu verifikasi',
  approved: 'Disetujui',
  rejected: 'Ditolak',
};

const pointsForPackage = (packageName) => POINTS_BY_NAME[String(packageName || '').trim().toUpperCase()] || 0;

const referralDiscountFor = (hasReferrer, perPersonPrice) => (
  hasReferrer && Number(perPersonPrice) >= DISCOUNT_MIN_PRICE ? REFERRAL_DISCOUNT : 0
);

const findRewardItem = (points, item) => {
  const tier = REWARD_TIERS.find((t) => t.points === Number(points));
  if (!tier || !tier.items.includes(item)) return null;
  return { ...tier, item };
};

// ---- Periode poin ----
// Poin berlaku sampai 31 Desember 2026, direset 1 Januari 2027, lalu setiap
// 180 hari. Tanggal dihitung dalam WIB.
const FIRST_PERIOD_END = '2026-12-31';
const RESET_START = '2027-01-01';
const PERIOD_DAYS = 180;

const todayJakarta = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (fromIso, toIso) => Math.round(
  (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000
);

// Tanggal WIB dari kolom TIMESTAMPTZ. Karena kolomnya menyimpan titik waktu
// yang pasti, batas periode tidak ikut bergeser kalau zona waktu server diubah.
const wibDate = (column) => `(${column} AT TIME ZONE 'Asia/Jakarta')::date`;

const pointPeriod = (date = new Date()) => {
  const today = todayJakarta(date);
  if (today <= FIRST_PERIOD_END) return { start: '2000-01-01', end: FIRST_PERIOD_END };
  const index = Math.floor(daysBetween(RESET_START, today) / PERIOD_DAYS);
  const start = addDays(RESET_START, index * PERIOD_DAYS);
  return { start, end: addDays(start, PERIOD_DAYS - 1) };
};

// ---- Kode & pencocokan pemberi rekomendasi ----

const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const loyaltyCodeFor = (user) => {
  const first = String(user.name || '').trim().split(/\s+/)[0] || '';
  const letters = first.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'ALUMNI';
  return `${letters}${user.id}`;
};

// "Budi Santoso Putra" -> "Budi S. P." supaya pengecekan publik tidak membocorkan nama lengkap.
const maskName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return [parts[0], ...parts.slice(1).map((p) => `${p[0].toUpperCase()}.`)].join(' ');
};

// Cari alumni dari isian kolom referral: kode pribadi, email, lalu nama lengkap.
// Nama bisa kembar, jadi hasilnya daftar; hanya satu hasil yang bisa diverifikasi.
const findReferrers = async (query, input, excludeEmail = '') => {
  const raw = String(input || '').trim();
  if (!raw) return [];
  const exclude = String(excludeEmail || '').trim().toLowerCase();
  const base = "SELECT id, name, email FROM users WHERE role = 'member' AND is_active = true";
  let rows = (await query(`${base} AND loyalty_code = $1`, [raw.replace(/\s+/g, '').toUpperCase()])).rows;
  if (!rows.length && raw.includes('@')) {
    rows = (await query(`${base} AND LOWER(TRIM(email)) = $1`, [raw.toLowerCase()])).rows;
  }
  if (!rows.length) {
    rows = (await query(
      `${base} AND LOWER(REGEXP_REPLACE(TRIM(name), '\\s+', ' ', 'g')) = $1`,
      [normalizeName(raw)]
    )).rows;
  }
  return rows.filter((r) => String(r.email || '').trim().toLowerCase() !== exclude);
};

// ---- Tabel ----

let tablesReady = null;
const createTables = async (query) => {
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_code VARCHAR(20)');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS users_loyalty_code_key ON users (loyalty_code)');
  await query('ALTER TABLE member_registrations ADD COLUMN IF NOT EXISTS referral_discount INTEGER DEFAULT 0');
  await query(`
    CREATE TABLE IF NOT EXISTS loyalty_referrals (
      id SERIAL PRIMARY KEY,
      registration_id INTEGER UNIQUE REFERENCES member_registrations(id) ON DELETE CASCADE,
      referrer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      referred_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      referral_input VARCHAR(255) NOT NULL,
      package_name VARCHAR(255),
      package_price INTEGER,
      points INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      admin_note TEXT,
      verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS loyalty_referrals_referrer_idx ON loyalty_referrals (referrer_id, status)');
  await query(`
    CREATE TABLE IF NOT EXISTS loyalty_claims (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      reward_item VARCHAR(255) NOT NULL,
      reward_value INTEGER,
      points INTEGER NOT NULL,
      recipient_name VARCHAR(255) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      address TEXT NOT NULL,
      note TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      admin_note TEXT,
      processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS loyalty_claims_member_idx ON loyalty_claims (member_id, status)');

  // Tabel yang dibuat versi awal memakai TIMESTAMP polos. Diubah sekali ke
  // TIMESTAMPTZ, dibaca memakai zona server saat ini (sama seperti saat ditulis).
  const timeColumns = [
    ['loyalty_referrals', 'created_at'],
    ['loyalty_referrals', 'verified_at'],
    ['loyalty_claims', 'created_at'],
    ['loyalty_claims', 'processed_at'],
  ];
  for (const [table, column] of timeColumns) {
    const info = await query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column]
    );
    if (info.rows[0] && info.rows[0].data_type === 'timestamp without time zone') {
      await query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE TIMESTAMPTZ
                   USING ${column} AT TIME ZONE current_setting('TimeZone')`);
    }
  }
};

// Sekali per proses; kalau gagal (mis. member_registrations belum ada saat boot) dicoba lagi nanti.
const ensureLoyaltyTables = (query) => {
  if (!tablesReady) tablesReady = createTables(query).catch((err) => { tablesReady = null; throw err; });
  return tablesReady;
};

const ensureLoyaltyCode = async (query, user) => {
  const result = await query(
    'UPDATE users SET loyalty_code = COALESCE(loyalty_code, $1) WHERE id = $2 RETURNING loyalty_code',
    [loyaltyCodeFor(user), user.id]
  );
  return result.rows[0] ? result.rows[0].loyalty_code : null;
};

// Poin masuk hanya kalau referral disetujui admin DAN member baru sudah bayar.
// Disetujui tapi belum bayar tetap dihitung menunggu, sama seperti yang belum
// diverifikasi, karena keduanya belum jadi poin.
const EARNED_CONDITION = "lr.status = 'approved' AND r.status = 'confirmed'";
const PENDING_CONDITION = "(lr.status = 'pending' OR (lr.status = 'approved' AND COALESCE(r.status, '') <> 'confirmed'))";

// Saldo poin satu alumni di periode berjalan.
const getPointSummary = async (query, userId, period = pointPeriod()) => {
  const result = await query(`
    SELECT
      (SELECT COALESCE(SUM(lr.points), 0) FROM loyalty_referrals lr
        LEFT JOIN member_registrations r ON r.id = lr.registration_id
        WHERE lr.referrer_id = $1 AND ${EARNED_CONDITION}
          AND ${wibDate('lr.verified_at')} BETWEEN $2::date AND $3::date) AS earned,
      (SELECT COALESCE(SUM(points), 0) FROM loyalty_claims
        WHERE member_id = $1 AND status <> 'rejected' AND ${wibDate('created_at')} BETWEEN $2::date AND $3::date) AS spent,
      (SELECT COALESCE(SUM(lr.points), 0) FROM loyalty_referrals lr
        LEFT JOIN member_registrations r ON r.id = lr.registration_id
        WHERE lr.referrer_id = $1 AND ${PENDING_CONDITION}) AS pending,
      (SELECT COUNT(*) FROM loyalty_referrals lr
        LEFT JOIN member_registrations r ON r.id = lr.registration_id
        WHERE lr.referrer_id = $1 AND ${EARNED_CONDITION}
          AND ${wibDate('lr.verified_at')} BETWEEN $2::date AND $3::date) AS approved_count
  `, [userId, period.start, period.end]);
  const row = result.rows[0];
  const earned = Number(row.earned);
  const spent = Number(row.spent);
  return {
    earned,
    spent,
    balance: earned - spent,
    pending: Number(row.pending),
    approvedCount: Number(row.approved_count),
  };
};

module.exports = {
  REFERRAL_DISCOUNT,
  DISCOUNT_MIN_PRICE,
  POINT_TABLE,
  REWARD_TIERS,
  REFERRAL_STATUSES,
  CLAIM_STATUSES,
  CLAIM_STATUS_LABELS,
  REFERRAL_STATUS_LABELS,
  pointsForPackage,
  referralDiscountFor,
  findRewardItem,
  pointPeriod,
  wibDate,
  EARNED_CONDITION,
  PENDING_CONDITION,
  todayJakarta,
  maskName,
  loyaltyCodeFor,
  findReferrers,
  ensureLoyaltyTables,
  ensureLoyaltyCode,
  getPointSummary,
};
