// Alumni Loyalty Program: halaman publik, cek referral, dashboard poin alumni,
// dan verifikasi admin. Aturan & data ada di utils/loyalty.js.
const { query, pool } = require('../config/database');
const loyalty = require('../utils/loyalty');
const { packagesForProgram } = require('../utils/priceList');
const { sendReferralApprovedEmail } = require('../utils/registrationEmail');

const appBaseUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const cleanText = (value, max) => String(value || '').trim().slice(0, max);
const rupiah = (value) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', minimumFractionDigits: 0,
}).format(Number(value) || 0);

const notify = (userId, title, message, type = 'info') => query(
  'INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)',
  [userId, title, message, type]
);

// Pesan asli hanya masuk log; halaman memberi pesan umum dengan status 500
// supaya kegagalan terlihat oleh monitoring, bukan tampil sebagai halaman sukses.
const renderError = (res, req, err) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Terjadi Kesalahan',
    message: 'Halaman Loyalty Program sedang bermasalah. Coba lagi sebentar lagi.',
    user: req.session.user,
  });
};

// ---------- Publik ----------

exports.showProgram = (req, res) => {
  const period = loyalty.pointPeriod();
  res.render('loyalty/program', {
    title: 'Alumni Loyalty Program',
    pointTable: loyalty.POINT_TABLE,
    rewardTiers: loyalty.REWARD_TIERS,
    referralDiscount: loyalty.REFERRAL_DISCOUNT,
    discountMinPrice: loyalty.DISCOUNT_MIN_PRICE,
    periodEnd: period.end,
  });
};

// Endpoint publik, jadi dibatasi per IP: pendaftar asli hanya mengecek satu dua
// kali, sedangkan penyisir daftar member butuh ratusan panggilan.
const CHECK_MAX = 20;
const CHECK_WINDOW_MS = 60 * 1000;
const checkHits = new Map();
const tooManyChecks = (ip) => {
  const now = Date.now();
  if (checkHits.size > 5000) {
    for (const [key, value] of checkHits) if (value.reset < now) checkHits.delete(key);
  }
  const entry = checkHits.get(ip);
  if (!entry || entry.reset < now) {
    checkHits.set(ip, { count: 1, reset: now + CHECK_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > CHECK_MAX;
};

// Dipakai form pendaftaran untuk memberi tahu apakah referral valid (dan diskon berlaku).
exports.checkReferral = async (req, res) => {
  const input = cleanText(req.query.q, 100);
  if (!input) return res.json({ valid: false });
  if (tooManyChecks(req.ip)) {
    return res.status(429).json({ valid: false, error: 'Terlalu banyak pengecekan. Tunggu sebentar lalu coba lagi.' });
  }
  try {
    await loyalty.ensureLoyaltyTables(query);
    const matches = await loyalty.findReferrers(query, input, cleanText(req.query.email, 255));
    // Cocok dengan lebih dari satu alumni berarti admin tidak bisa memutuskan
    // siapa yang berhak, jadi belum dihitung valid. Pendaftar diminta kodenya.
    res.json({
      valid: matches.length === 1,
      ambiguous: matches.length > 1,
      name: matches.length === 1 ? loyalty.maskName(matches[0].name) : '',
      discount: loyalty.REFERRAL_DISCOUNT,
      minPrice: loyalty.DISCOUNT_MIN_PRICE,
    });
  } catch (err) {
    console.error('Cek referral gagal:', err.message);
    res.status(500).json({ valid: false, error: 'Gagal memeriksa referral.' });
  }
};

// ---------- Member (alumni) ----------

exports.memberDashboard = async (req, res) => {
  try {
    await loyalty.ensureLoyaltyTables(query);
    const userId = req.session.user.id;
    const code = await loyalty.ensureLoyaltyCode(query, { id: userId, name: req.session.user.name });
    const period = loyalty.pointPeriod();
    const [profile, summary, referrals, claims] = await Promise.all([
      query('SELECT name, phone FROM users WHERE id = $1', [userId]),
      loyalty.getPointSummary(query, userId, period),
      query(`
        SELECT lr.id, lr.points, lr.status, lr.package_name, lr.created_at, lr.verified_at,
               u.name AS referred_name, r.selected_class
        FROM loyalty_referrals lr
        LEFT JOIN users u ON u.id = lr.referred_user_id
        LEFT JOIN member_registrations r ON r.id = lr.registration_id
        WHERE lr.referrer_id = $1
        ORDER BY lr.created_at DESC
      `, [userId]),
      query('SELECT * FROM loyalty_claims WHERE member_id = $1 ORDER BY created_at DESC', [userId]),
    ]);
    const nextTier = loyalty.REWARD_TIERS.find((t) => t.points > summary.balance) || null;
    res.render('member/loyalty', {
      title: 'Alumni Loyalty Program',
      user: req.session.user,
      profile: profile.rows[0] || {},
      code,
      referralDiscount: loyalty.REFERRAL_DISCOUNT,
      shareLink: `${appBaseUrl()}/register?ref=${encodeURIComponent(code)}`,
      period,
      summary,
      nextTier,
      rewardTiers: loyalty.REWARD_TIERS,
      referrals: referrals.rows,
      claims: claims.rows,
      referralStatusLabels: loyalty.REFERRAL_STATUS_LABELS,
      claimStatusLabels: loyalty.CLAIM_STATUS_LABELS,
    });
  } catch (err) {
    renderError(res, req, err);
  }
};

exports.memberClaim = async (req, res) => {
  const back = '/member/loyalty';
  const [pointsRaw, ...itemParts] = String(req.body.reward || '').split('|');
  const reward = loyalty.findRewardItem(pointsRaw, itemParts.join('|'));
  const recipientName = cleanText(req.body.recipient_name, 255);
  const phone = cleanText(req.body.phone, 30);
  const address = cleanText(req.body.address, 1000);
  const note = cleanText(req.body.note, 1000) || null;

  if (!reward) {
    req.flash('error', 'Pilih hadiah dari katalog.');
    return res.redirect(back);
  }
  if (!recipientName || !phone || address.length < 10) {
    req.flash('error', 'Lengkapi nama penerima, nomor WhatsApp, dan alamat lengkap untuk klaim hadiah.');
    return res.redirect(back);
  }

  const userId = req.session.user.id;
  let client;
  try {
    await loyalty.ensureLoyaltyTables(query);
    client = await pool.connect();
    await client.query('BEGIN');
    // Kunci baris user supaya dua klaim bersamaan tidak memakai poin yang sama.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const summary = await loyalty.getPointSummary((text, params) => client.query(text, params), userId);
    if (summary.balance < reward.points) {
      await client.query('ROLLBACK');
      req.flash('error', `Poin kamu belum cukup. Butuh ${reward.points} poin, saldo ${summary.balance} poin.`);
      return res.redirect(back);
    }
    await client.query(
      `INSERT INTO loyalty_claims (member_id, reward_item, reward_value, points, recipient_name, phone, address, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, reward.item, reward.value, reward.points, recipientName, phone, address, note]
    );
    await client.query('COMMIT');
    req.flash('success', `Klaim ${reward.item} terkirim. Admin akan memproses dan menghubungi kamu.`);
    res.redirect(`${back}#riwayat-klaim`);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    req.flash('error', 'Gagal mengirim klaim hadiah. Coba lagi.');
    res.redirect(back);
  } finally {
    if (client) client.release();
  }
};

// ---------- Admin ----------

// Potong diskon setelah referral disetujui. Syaratnya sama seperti dokumen
// klien: paket seharga VIP ke atas, dan pendaftaran belum dibayar. Harga per
// orang diambil dari katalog, bukan dari nominal yang dikirim form.
const applyReferralDiscount = async (referral) => {
  if (!referral.registration_id || referral.registration_status !== 'pending_payment') return 0;
  if (Number(referral.referral_discount) > 0) return 0;
  const catalogPkg = packagesForProgram(referral.selected_class)
    .find((p) => p.name === referral.reg_package_name);
  const discount = loyalty.referralDiscountFor(true, catalogPkg ? catalogPkg.price : 0);
  if (!discount) return 0;
  const updated = await query(`
    UPDATE member_registrations
    SET package_price = package_price - $1, referral_discount = $1
    WHERE id = $2 AND status = 'pending_payment' AND referral_discount = 0 AND package_price > $1
    RETURNING package_price
  `, [discount, referral.registration_id]);
  return updated.rowCount ? discount : 0;
};

const ADMIN_TABS = ['referrals', 'claims', 'points'];
const PAGE_SIZE = 50;

exports.adminIndex = async (req, res) => {
  try {
    await loyalty.ensureLoyaltyTables(query);
    const tab = ADMIN_TABS.includes(req.query.tab) ? req.query.tab : 'referrals';
    const period = loyalty.pointPeriod();
    const referralStatus = [...loyalty.REFERRAL_STATUSES, 'all'].includes(req.query.status) && tab === 'referrals'
      ? req.query.status : 'pending';
    const claimStatus = [...loyalty.CLAIM_STATUSES, 'open', 'all'].includes(req.query.status) && tab === 'claims'
      ? req.query.status : 'open';
    // Daftar dipecah per halaman: antrean verifikasi bisa lebih panjang dari
    // satu layar dan baris terlama justru yang paling perlu dikerjakan.
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    const [statsRes, countRes, referralsRes, claimsRes, pointsRes] = await Promise.all([
      query(`SELECT
               (SELECT COUNT(*) FROM loyalty_referrals WHERE status = 'pending') AS pending_referrals,
               (SELECT COALESCE(SUM(lr.points), 0) FROM loyalty_referrals lr
                 LEFT JOIN member_registrations r ON r.id = lr.registration_id
                 WHERE ${loyalty.EARNED_CONDITION} AND ${loyalty.wibDate('lr.verified_at')} BETWEEN $1::date AND $2::date) AS period_points,
               (SELECT COUNT(*) FROM loyalty_claims WHERE status NOT IN ('completed', 'rejected')) AS open_claims,
               (SELECT COUNT(*) FROM (
                  SELECT lr.referrer_id AS id FROM loyalty_referrals lr
                   LEFT JOIN member_registrations r ON r.id = lr.registration_id
                   WHERE lr.referrer_id IS NOT NULL
                     AND ((${loyalty.EARNED_CONDITION} AND ${loyalty.wibDate('lr.verified_at')} BETWEEN $1::date AND $2::date)
                          OR ${loyalty.PENDING_CONDITION})
                  UNION
                  SELECT member_id FROM loyalty_claims
                   WHERE member_id IS NOT NULL AND status <> 'rejected'
                     AND ${loyalty.wibDate('created_at')} BETWEEN $1::date AND $2::date
               ) a) AS active_alumni`,
      [period.start, period.end]),
      tab === 'referrals'
        ? query("SELECT COUNT(*) AS total FROM loyalty_referrals WHERE ($1 = 'all' OR status = $1)", [referralStatus])
        : (tab === 'claims'
          ? query(`SELECT COUNT(*) AS total FROM loyalty_claims
                   WHERE ($1 = 'all' OR ($1 = 'open' AND status NOT IN ('completed', 'rejected')) OR status = $1)`, [claimStatus])
          : { rows: [{ total: 0 }] }),
      tab !== 'referrals' ? { rows: [] } : query(`
        SELECT lr.*, r.registration_code, r.status AS registration_status, r.selected_class,
               n.name AS referred_name, n.email AS referred_email,
               ref.name AS referrer_name, ref.email AS referrer_email, ref.loyalty_code AS referrer_code,
               v.name AS verified_by_name
        FROM loyalty_referrals lr
        LEFT JOIN member_registrations r ON r.id = lr.registration_id
        LEFT JOIN users n ON n.id = lr.referred_user_id
        LEFT JOIN users ref ON ref.id = lr.referrer_id
        LEFT JOIN users v ON v.id = lr.verified_by
        WHERE ($1 = 'all' OR lr.status = $1)
        ORDER BY lr.created_at DESC
        LIMIT $2 OFFSET $3
      `, [referralStatus, PAGE_SIZE, offset]),
      tab !== 'claims' ? { rows: [] } : query(`
        SELECT c.*, u.name AS member_name, u.email AS member_email, u.loyalty_code
        FROM loyalty_claims c
        LEFT JOIN users u ON u.id = c.member_id
        WHERE ($1 = 'all' OR ($1 = 'open' AND c.status NOT IN ('completed', 'rejected')) OR c.status = $1)
        ORDER BY c.created_at DESC
        LIMIT $2 OFFSET $3
      `, [claimStatus, PAGE_SIZE, offset]),
      tab !== 'points' ? { rows: [] } : query(`
        SELECT u.id, u.name, u.email, u.loyalty_code,
               COALESCE(e.earned, 0) AS earned, COALESCE(e.referrals, 0) AS referrals,
               COALESCE(s.spent, 0) AS spent, COALESCE(p.pending, 0) AS pending
        FROM users u
        LEFT JOIN (SELECT lr.referrer_id, SUM(lr.points) AS earned, COUNT(*) AS referrals FROM loyalty_referrals lr
                   LEFT JOIN member_registrations r ON r.id = lr.registration_id
                   WHERE ${loyalty.EARNED_CONDITION} AND ${loyalty.wibDate('lr.verified_at')} BETWEEN $1::date AND $2::date
                   GROUP BY lr.referrer_id) e ON e.referrer_id = u.id
        LEFT JOIN (SELECT member_id, SUM(points) AS spent FROM loyalty_claims
                   WHERE status <> 'rejected' AND ${loyalty.wibDate('created_at')} BETWEEN $1::date AND $2::date
                   GROUP BY member_id) s ON s.member_id = u.id
        LEFT JOIN (SELECT lr.referrer_id, SUM(lr.points) AS pending FROM loyalty_referrals lr
                   LEFT JOIN member_registrations r ON r.id = lr.registration_id
                   WHERE ${loyalty.PENDING_CONDITION} GROUP BY lr.referrer_id) p ON p.referrer_id = u.id
        WHERE e.referrer_id IS NOT NULL OR s.member_id IS NOT NULL OR p.referrer_id IS NOT NULL
        ORDER BY COALESCE(e.earned, 0) - COALESCE(s.spent, 0) DESC, u.name
      `, [period.start, period.end]),
    ]);

    // Halaman di luar jangkauan dikembalikan ke halaman terakhir, supaya tidak
    // berhenti di layar kosong tanpa tombol kembali.
    const total = Number(countRes.rows[0].total);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totalPages && tab !== 'points') {
      const status = tab === 'referrals' ? referralStatus : claimStatus;
      return res.redirect(`/admin/loyalty?tab=${tab}&status=${encodeURIComponent(status)}&page=${totalPages}`);
    }

    res.render('admin/loyalty', {
      title: 'Loyalty Program',
      user: req.session.user,
      tab,
      referralStatus,
      claimStatus,
      period,
      stats: statsRes.rows[0],
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages,
      referrals: referralsRes.rows,
      claims: claimsRes.rows,
      alumni: pointsRes.rows.map((a) => ({ ...a, balance: Number(a.earned) - Number(a.spent) })),
      referralStatusLabels: loyalty.REFERRAL_STATUS_LABELS,
      claimStatusLabels: loyalty.CLAIM_STATUS_LABELS,
      claimStatuses: loyalty.CLAIM_STATUSES,
    });
  } catch (err) {
    renderError(res, req, err);
  }
};

exports.approveReferral = async (req, res) => {
  const back = '/admin/loyalty?tab=referrals';
  const id = Number(req.params.id);
  // parseInt memotong diam-diam ("5.5" jadi 5, "1e3" jadi 1), jadi bentuk angka
  // dicek dulu: hanya digit, tanpa desimal, tanpa notasi ilmiah.
  const pointsRaw = String(req.body.points ?? '').trim();
  const points = /^\d{1,4}$/.test(pointsRaw) ? Number(pointsRaw) : NaN;
  const referrerInput = cleanText(req.body.referrer, 255);
  try {
    await loyalty.ensureLoyaltyTables(query);
    const found = await query(`
      SELECT lr.*, r.status AS registration_status, r.registration_code, r.selected_class,
             r.package_name AS reg_package_name, r.package_price AS reg_package_price,
             r.referral_discount, r.name AS registrant_name, r.email AS registrant_email,
             n.email AS referred_email, n.name AS referred_name
      FROM loyalty_referrals lr
      LEFT JOIN member_registrations r ON r.id = lr.registration_id
      LEFT JOIN users n ON n.id = lr.referred_user_id
      WHERE lr.id = $1
    `, [id]);
    const referral = found.rows[0];
    if (!referral || referral.status !== 'pending') {
      req.flash('error', 'Referral tidak ditemukan atau sudah diverifikasi.');
      return res.redirect(back);
    }
    if (!Number.isInteger(points) || points < 1 || points > 1000) {
      req.flash('error', 'Poin harus bilangan bulat 1 sampai 1000, tanpa koma.');
      return res.redirect(back);
    }

    let referrerId = referral.referrer_id;
    // Kolom alumni hanya muncul di layar saat referral belum cocok. Kalau sudah
    // cocok, kiriman "referrer" diabaikan supaya poin tidak berpindah diam-diam.
    if (referrerInput && referral.referrer_id) {
      req.flash('error', 'Referral ini sudah cocok dengan satu alumni. Tolak dulu kalau alumninya salah.');
      return res.redirect(back);
    }
    if (referrerInput) {
      const matches = await loyalty.findReferrers(query, referrerInput, referral.referred_email);
      if (matches.length !== 1) {
        req.flash('error', matches.length
          ? 'Nama alumni kembar. Isi kode referral atau email alumni.'
          : 'Alumni tidak ditemukan. Isi kode referral, email, atau nama lengkap member aktif.');
        return res.redirect(back);
      }
      referrerId = matches[0].id;
    }
    if (!referrerId) {
      req.flash('error', 'Tetapkan alumni pemberi rekomendasi dulu (kode, email, atau nama lengkap).');
      return res.redirect(back);
    }
    if (referrerId === referral.referred_user_id) {
      req.flash('error', 'Member tidak bisa merekomendasikan dirinya sendiri.');
      return res.redirect(back);
    }

    const updated = await query(`
      UPDATE loyalty_referrals
      SET status = 'approved', referrer_id = $1, points = $2, verified_by = $3, verified_at = NOW()
      WHERE id = $4 AND status = 'pending'
      RETURNING id
    `, [referrerId, points, req.session.user.id, id]);
    if (!updated.rowCount) {
      req.flash('error', 'Referral sudah diverifikasi admin lain.');
      return res.redirect(back);
    }
    // Diskon baru dipotong di sini, setelah verifikasi, dan hanya selama member
    // baru belum membayar serta paketnya seharga VIP ke atas.
    const discount = await applyReferralDiscount(referral);
    const paid = referral.registration_status === 'confirmed';

    await notify(referrerId, paid ? 'Poin Loyalty Bertambah' : 'Referral Terverifikasi',
      paid
        ? `+${points} poin dari rekomendasi ${referral.referred_name || 'member baru'}. Cek di menu Loyalty Program.`
        : `Rekomendasi ${referral.referred_name || 'member baru'} sudah diverifikasi. ${points} poin masuk setelah mereka menyelesaikan pembayaran.`,
      paid ? 'success' : 'info');

    // Member baru diberi tahu lewat email, lengkap dengan link pendaftarannya.
    sendReferralApprovedEmail(
      {
        name: referral.registrant_name,
        email: referral.registrant_email,
        registration_code: referral.registration_code,
        package_name: referral.reg_package_name,
        selected_class: referral.selected_class,
      },
      { discount, newPrice: discount ? Number(referral.reg_package_price) - discount : Number(referral.reg_package_price), alreadyPaid: paid }
    ).catch((err) => console.error('Gagal mengirim email verifikasi referral:', err.message));

    req.flash('success', discount
      ? `Referral disetujui. Diskon ${rupiah(discount)} dipotong dan email berisi total terbaru dikirim ke member baru.`
      : `Referral disetujui. ${paid ? `${points} poin masuk ke alumni.` : `${points} poin masuk setelah member baru membayar.`}`);
    res.redirect(back);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menyetujui referral.');
    res.redirect(back);
  }
};

exports.rejectReferral = async (req, res) => {
  const back = '/admin/loyalty?tab=referrals';
  try {
    await loyalty.ensureLoyaltyTables(query);
    const updated = await query(`
      UPDATE loyalty_referrals
      SET status = 'rejected', admin_note = $1, verified_by = $2, verified_at = NOW()
      WHERE id = $3 AND status = 'pending'
      RETURNING registration_id
    `, [cleanText(req.body.admin_note, 1000) || null, req.session.user.id, Number(req.params.id)]);
    if (!updated.rowCount) {
      req.flash('error', 'Referral tidak ditemukan atau sudah diverifikasi.');
      return res.redirect(back);
    }
    // Diskon referral hanya dibatalkan selama pendaftaran belum dibayar. Yang
    // sudah transfer tetap memakai harga diskon, tidak ditagih lagi.
    const restored = await query(`
      UPDATE member_registrations
      SET package_price = COALESCE(package_price, 0) + referral_discount, referral_discount = 0
      WHERE id = $1 AND status = 'pending_payment' AND referral_discount > 0
      RETURNING package_price
    `, [updated.rows[0].registration_id]);
    req.flash('success', restored.rowCount
      ? `Referral ditolak. Diskon dibatalkan, tagihan member baru kembali ${rupiah(restored.rows[0].package_price)}.`
      : 'Referral ditolak.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menolak referral.');
  }
  res.redirect(back);
};

exports.updateClaim = async (req, res) => {
  const back = '/admin/loyalty?tab=claims';
  const status = String(req.body.status || '');
  if (!loyalty.CLAIM_STATUSES.includes(status) || status === 'pending') {
    req.flash('error', 'Status klaim tidak valid.');
    return res.redirect(back);
  }
  try {
    await loyalty.ensureLoyaltyTables(query);
    // Klaim yang selesai atau ditolak sudah final; ditolak = poin kembali ke saldo.
    const updated = await query(`
      UPDATE loyalty_claims
      SET status = $1, admin_note = $2, processed_by = $3, processed_at = NOW()
      WHERE id = $4 AND status NOT IN ('completed', 'rejected')
      RETURNING member_id, reward_item, points, ${loyalty.wibDate('created_at')} AS claim_date
    `, [status, cleanText(req.body.admin_note, 1000) || null, req.session.user.id, Number(req.params.id)]);
    if (!updated.rowCount) {
      req.flash('error', 'Klaim tidak ditemukan atau sudah final.');
      return res.redirect(back);
    }
    const claim = updated.rows[0];
    const label = loyalty.CLAIM_STATUS_LABELS[status];
    // Poin hanya kembali ke saldo kalau klaimnya masih di periode berjalan.
    // Klaim dari periode lama sudah ikut hangus saat reset, jadi jangan dijanjikan.
    const period = loyalty.pointPeriod();
    const claimDate = claim.claim_date instanceof Date
      ? claim.claim_date.toISOString().slice(0, 10) : String(claim.claim_date || '');
    const refunded = claimDate >= period.start && claimDate <= period.end;
    await notify(claim.member_id, `Klaim Hadiah ${label}`,
      status === 'rejected'
        ? (refunded
          ? `Klaim ${claim.reward_item} ditolak. ${claim.points} poin dikembalikan ke saldo kamu.`
          : `Klaim ${claim.reward_item} ditolak. Poinnya dari periode sebelumnya, jadi tidak kembali ke saldo periode ini.`)
        : `Klaim ${claim.reward_item} sekarang berstatus ${label}.`,
      status === 'rejected' ? 'warning' : 'info');
    req.flash('success', `Klaim ${claim.reward_item} diperbarui: ${label}.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperbarui klaim.');
  }
  res.redirect(back);
};
