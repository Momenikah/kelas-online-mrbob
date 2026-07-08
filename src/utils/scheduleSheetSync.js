// =============================================
// Schedule sync FROM Google Sheet (Sheet = master source of truth).
// The app pulls rows from an Apps Script Web App (doGet -> JSON) and reconciles
// the `schedules` table: new rows are added, changed rows updated, and rows that
// disappeared from the sheet are CANCELLED (history kept). Only schedules with
// source='sheet' are managed here — Plot-created schedules are never touched.
//
// Sheet "Master Jadwal" = 1 baris booking member -> 1 jadwal kelas.
// Kolom (header row, case-insensitive, boleh Bahasa Indonesia):
//   NAMA LENGKAP -> peserta (dicocokkan ke member terdaftar by nama; fallback EMAIL)
//   EMAIL      -> fallback peserta bila nama tak cocok
//   PROGRAM    -> nama program (harus cocok dgn tabel programs)
//   PAKET      -> dipakai untuk judul jadwal (opsional)
//   PERIODE    -> tanggal, mis. "13 Juli 2026" atau "2026-07-13"
//   JAM BELAJAR-> rentang, mis. "16.00 WIB - 17.00 WIB"
//   TUTOR      -> sel bebas, mis. "Sist Nani - 13 Ju..."; app mencari tutor yang
//                 NAMANYA terkandung (include) di dalam teks ini (match terpanjang)
// =============================================

const crypto = require('crypto');
const { pool, query } = require('../config/database');

const sourceUrl = () => process.env.SCHEDULE_SOURCE_URL || '';
const isConfigured = () => Boolean(sourceUrl());

// ---- schema ----------------------------------------------------------------
async function ensureScheduleSyncSchema(q = query) {
  await q(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS source VARCHAR(20)`);
  await q(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS external_id VARCHAR(120)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS ux_schedules_external
           ON schedules(external_id) WHERE external_id IS NOT NULL`);
  await q(`
    CREATE TABLE IF NOT EXISTS schedule_sync_runs (
      id SERIAL PRIMARY KEY,
      ok BOOLEAN DEFAULT true,
      added INTEGER DEFAULT 0,
      updated INTEGER DEFAULT 0,
      cancelled INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      total_rows INTEGER DEFAULT 0,
      message TEXT,
      triggered_by VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

// ---- helpers ---------------------------------------------------------------
const normKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '_');
const normEmail = (s) => String(s || '').trim().toLowerCase();
// Untuk pencocokan tutor "include": lowercase + rapikan spasi (pertahankan kata).
const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function normDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function normTime(v) {
  if (v === undefined || v === null || v === '') return '';
  const m = String(v).match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return '';
  const h = Number(m[1]); const mn = Number(m[2]);
  if (h > 23 || mn > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
}
const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());

// Parse an Indonesian date like "13 Juli 2026" (falls back to ISO/Date).
const ID_MONTHS = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7,
  agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};
function normDateID(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mon = ID_MONTHS[m[2].toLowerCase()];
    if (mon) return `${m[3]}-${String(mon).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  return normDate(s);
}
// "16.00 WIB - 17.00 WIB" -> ['16:00', '17:00']
function parseJamRange(v) {
  const parts = String(v || '').split(/\s*[-–—]\s*/);
  return [normTime(parts[0] || ''), normTime(parts[1] || '')];
}

// ---- fetch -----------------------------------------------------------------
async function fetchSheetRows() {
  const url = sourceUrl();
  if (!url) throw new Error('SCHEDULE_SOURCE_URL belum dikonfigurasi.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!res.ok) throw new Error(`Sumber sheet merespons HTTP ${res.status}`);
    const data = await res.json();
    const rows = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : []);
    // normalise every row's keys to snake_case lowercase
    return rows.map((r) => {
      const o = {};
      Object.keys(r || {}).forEach((k) => { o[normKey(k)] = r[k]; });
      return o;
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---- reconcile -------------------------------------------------------------
async function syncSchedulesFromSheet({ triggeredBy = 'manual' } = {}) {
  const summary = { ok: false, added: 0, updated: 0, cancelled: 0, skipped: 0, errorCount: 0, totalRows: 0, errors: [], message: '' };
  if (!isConfigured()) {
    summary.message = 'SCHEDULE_SOURCE_URL belum dikonfigurasi.';
    return summary;
  }

  let rows;
  try {
    rows = await fetchSheetRows();
  } catch (err) {
    summary.message = `Gagal mengambil data sheet: ${err.message}`;
    await logRun(summary, triggeredBy);
    return summary;
  }
  summary.totalRows = rows.length;

  // Preload lookup maps
  const [usersRes, programsRes] = await Promise.all([
    query("SELECT id, name, email, role FROM users WHERE is_active = true"),
    query('SELECT id, name FROM programs WHERE is_active = true'),
  ]);
  const tutorByEmail = new Map();
  const tutors = []; // { id, name } — dipakai untuk pencocokan "include"
  const memberByEmail = new Map();
  const memberByName = new Map(); // nama_lengkap -> member id
  usersRes.rows.forEach((u) => {
    if (u.role === 'tutor') {
      tutorByEmail.set(normEmail(u.email), u.id);
      const nm = normName(u.name);
      if (nm) tutors.push({ id: u.id, name: nm });
    }
    if (u.role === 'member') {
      memberByEmail.set(normEmail(u.email), u.id);
      const nm = normName(u.name);
      if (nm) memberByName.set(nm, u.id);
    }
  });
  // Cari tutor yang NAMANYA terkandung di sel TUTOR sheet; pilih nama terpanjang
  // (paling spesifik) untuk menghindari salah kena nama pendek.
  const findTutorByInclude = (rawTutor) => {
    const hay = normName(rawTutor);
    if (!hay) return null;
    let best = null;
    for (const t of tutors) {
      if (hay.includes(t.name) && (!best || t.name.length > best.name.length)) best = t;
    }
    return best ? best.id : null;
  };
  const programByName = new Map();
  programsRes.rows.forEach((p) => programByName.set(normKey(p.name), p.id));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seenIds = [];

    for (const row of rows) {
      const rowErrors = [];
      // Hanya proses baris berstatus "booked" (kolom STATUS BOOKED). Sisanya
      // dilewati — jika sebelumnya pernah tersinkron, jadwalnya ikut dibatalkan
      // lewat logika "vanished" di bawah (karena tidak masuk seenIds).
      if (normName(row.status_booked) !== 'booked') { summary.skipped += 1; continue; }

      const email = normEmail(row.email);
      const memberName = String(row.nama_lengkap || '').trim();
      const programName = String(row.program || '').trim();
      const paket = String(row.paket || '').trim();
      const periode = String(row.periode || '').trim();
      const jam = String(row.jam_belajar || '').trim();
      const tutorRaw = String(row.tutor || '').trim();

      const date = normDateID(periode);
      const [start, end] = parseJamRange(jam);
      // Cocokkan tutor secara "include": nama tutor terkandung di sel TUTOR sheet.
      const tutorId = findTutorByInclude(tutorRaw);
      const programId = programByName.get(normKey(programName));
      const title = paket ? `${programName} — ${paket}` : programName;
      const location = null;
      const meetingLink = null;
      const notes = null;

      if (!email) rowErrors.push('EMAIL kosong');
      if (!programId) rowErrors.push(`PROGRAM "${programName}" tidak ditemukan`);
      if (!tutorId) rowErrors.push(`TUTOR "${tutorRaw || '(kosong)'}" tidak cocok dgn tutor terdaftar`);
      if (!isValidDate(date)) rowErrors.push(`PERIODE "${periode}" tidak valid (mis. 13 Juli 2026)`);
      if (!start) rowErrors.push(`JAM BELAJAR "${jam}" tidak valid`);
      if (!end) rowErrors.push('jam akhir tidak valid');
      if (start && end && toMinutes(end) <= toMinutes(start)) rowErrors.push('jam akhir <= jam mulai');

      // Sheet punya kolom id? tidak — buat id stabil dari identitas booking.
      const id = 'bk-' + crypto.createHash('sha1')
        .update([email, normKey(programName), date, start].join('|')).digest('hex').slice(0, 24);

      if (rowErrors.length) {
        summary.errorCount += 1;
        summary.errors.push(`${email || '(baris)'}: ${rowErrors.join(', ')}`);
        continue;
      }

      seenIds.push(id);

      const existing = await client.query(
        `SELECT id, status FROM schedules WHERE source = 'sheet' AND external_id = $1`, [id]
      );
      let scheduleId;
      if (existing.rows.length) {
        scheduleId = existing.rows[0].id;
        const reactivate = existing.rows[0].status === 'cancelled';
        await client.query(
          `UPDATE schedules SET
             tutor_id=$1, program_id=$2, title=$3, description=$4, date=$5,
             start_time=$6, end_time=$7, location=$8, meeting_link=$9
             ${reactivate ? ", status='upcoming'" : ''}
           WHERE id=$10`,
          [tutorId, programId, title, notes, date, start, end, location, meetingLink, scheduleId]
        );
        summary.updated += 1;
      } else {
        const ins = await client.query(
          `INSERT INTO schedules
             (tutor_id, program_id, title, description, date, start_time, end_time,
              location, meeting_link, status, source, external_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'upcoming','sheet',$10)
           RETURNING id`,
          [tutorId, programId, title, notes, date, start, end, location, meetingLink, id]
        );
        scheduleId = ins.rows[0].id;
        summary.added += 1;
      }

      // Peserta diambil dari kolom NAMA LENGKAP (cocokkan ke member terdaftar by
      // nama), fallback ke EMAIL. Additive (tidak pernah auto-hapus, agar presensi
      // terjaga). Jadwal tetap dibuat meski peserta belum terdaftar di app.
      const mid = memberByName.get(normName(memberName)) || memberByEmail.get(email) || null;
      if (mid) {
        await client.query(
          `INSERT INTO schedule_members (schedule_id, member_id) VALUES ($1,$2)
           ON CONFLICT (schedule_id, member_id) DO NOTHING`, [scheduleId, mid]
        );
        await client.query(
          `INSERT INTO presences (schedule_id, member_id, status, source) VALUES ($1,$2,'absent','sheet')
           ON CONFLICT (schedule_id, member_id) DO NOTHING`, [scheduleId, mid]
        );
      } else {
        summary.errors.push(`${memberName || email || '(baris)'}: peserta belum terdaftar (jadwal dibuat tanpa peserta)`);
      }
    }

    // Cancel sheet-sourced schedules that vanished from the sheet.
    // Safety: never mass-cancel when the sheet returned zero usable rows.
    if (seenIds.length > 0) {
      const cancelled = await client.query(
        `UPDATE schedules SET status='cancelled'
         WHERE source='sheet' AND status <> 'cancelled' AND NOT (external_id = ANY($1))`,
        [seenIds]
      );
      summary.cancelled = cancelled.rowCount || 0;
    } else if (summary.totalRows === 0) {
      summary.errors.push('Sheet kosong / tidak ada baris valid — pembatalan dilewati demi keamanan.');
    }

    await client.query('COMMIT');
    summary.ok = true;
    summary.message = `+${summary.added} baru · ${summary.updated} update · ${summary.cancelled} dibatalkan`
      + (summary.skipped ? ` · ${summary.skipped} non-booked dilewati` : '')
      + (summary.errorCount ? ` · ${summary.errorCount} error` : '');
  } catch (err) {
    await client.query('ROLLBACK');
    summary.message = `Gagal sinkronisasi: ${err.message}`;
    summary.ok = false;
  } finally {
    client.release();
  }

  await logRun(summary, triggeredBy);
  return summary;
}

async function logRun(summary, triggeredBy) {
  try {
    await query(
      `INSERT INTO schedule_sync_runs (ok, added, updated, cancelled, error_count, total_rows, message, triggered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [summary.ok, summary.added, summary.updated, summary.cancelled, summary.errorCount, summary.totalRows,
       summary.message + (summary.errors.length ? ' | ' + summary.errors.slice(0, 8).join(' ; ') : ''), triggeredBy]
    );
  } catch (e) { /* logging must never break the sync */ }
}

async function getLastSyncRun() {
  try {
    const r = await query('SELECT * FROM schedule_sync_runs ORDER BY id DESC LIMIT 1');
    return r.rows[0] || null;
  } catch (e) { return null; }
}

// ---- auto poller -----------------------------------------------------------
let pollTimer = null;
function startSchedulePoller() {
  if (!isConfigured()) {
    console.log('Sync Jadwal: SCHEDULE_SOURCE_URL kosong — auto-sync nonaktif.');
    return;
  }
  const minutes = Number(process.env.SCHEDULE_SYNC_INTERVAL_MINUTES);
  const interval = Number.isFinite(minutes) && minutes > 0 ? minutes : 10;
  if (pollTimer) clearInterval(pollTimer);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const s = await syncSchedulesFromSheet({ triggeredBy: 'auto' });
      if (s.added || s.updated || s.cancelled || !s.ok) {
        console.log(`Sync Jadwal (auto): ${s.message}`);
      }
    } catch (e) {
      console.error('Sync Jadwal (auto) gagal:', e.message);
    } finally {
      running = false;
    }
  };
  pollTimer = setInterval(tick, interval * 60 * 1000);
  console.log(`Sync Jadwal: auto-sync tiap ${interval} menit aktif.`);
  setTimeout(tick, 8000); // first run shortly after boot
}

module.exports = {
  ensureScheduleSyncSchema,
  syncSchedulesFromSheet,
  getLastSyncRun,
  startSchedulePoller,
  isScheduleSyncConfigured: isConfigured,
};
