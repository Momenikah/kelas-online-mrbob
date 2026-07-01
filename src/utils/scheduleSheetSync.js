// =============================================
// Schedule sync FROM Google Sheet (Sheet = master source of truth).
// The app pulls rows from an Apps Script Web App (doGet -> JSON) and reconciles
// the `schedules` table: new rows are added, changed rows updated, and rows that
// disappeared from the sheet are CANCELLED (history kept). Only schedules with
// source='sheet' are managed here — Plot-created schedules are never touched.
//
// Sheet "Master Jadwal" columns (header row, case-insensitive):
//   id, tutor_email, program_name, title, date (YYYY-MM-DD),
//   start_time (HH:mm), end_time (HH:mm), location, meeting_link, notes,
//   member_emails (optional, comma-separated)
// =============================================

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
  const summary = { ok: false, added: 0, updated: 0, cancelled: 0, errorCount: 0, totalRows: 0, errors: [], message: '' };
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
    query("SELECT id, email, role FROM users WHERE is_active = true"),
    query('SELECT id, name FROM programs WHERE is_active = true'),
  ]);
  const tutorByEmail = new Map();
  const memberByEmail = new Map();
  usersRes.rows.forEach((u) => {
    if (u.role === 'tutor') tutorByEmail.set(normEmail(u.email), u.id);
    if (u.role === 'member') memberByEmail.set(normEmail(u.email), u.id);
  });
  const programByName = new Map();
  programsRes.rows.forEach((p) => programByName.set(normKey(p.name), p.id));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seenIds = [];

    for (const row of rows) {
      const id = String(row.id || '').trim();
      const rowErrors = [];
      if (!id) { summary.errorCount += 1; summary.errors.push('Baris tanpa kolom ID dilewati.'); continue; }

      const tutorEmail = normEmail(row.tutor_email);
      const programName = String(row.program_name || '').trim();
      const title = String(row.title || '').trim();
      const date = normDate(row.date);
      const start = normTime(row.start_time);
      const end = normTime(row.end_time);
      const location = String(row.location || '').trim() || null;
      const meetingLink = String(row.meeting_link || '').trim() || null;
      const notes = String(row.notes || '').trim() || null;

      const tutorId = tutorByEmail.get(tutorEmail);
      const programId = programByName.get(normKey(programName));
      if (!tutorId) rowErrors.push(`tutor ${tutorEmail || '(kosong)'} tidak ditemukan`);
      if (!programId) rowErrors.push(`program "${programName}" tidak ditemukan`);
      if (!title) rowErrors.push('title kosong');
      if (!isValidDate(date)) rowErrors.push('date harus YYYY-MM-DD');
      if (!start) rowErrors.push('start_time harus HH:mm');
      if (!end) rowErrors.push('end_time harus HH:mm');
      if (start && end && toMinutes(end) <= toMinutes(start)) rowErrors.push('end_time <= start_time');

      if (rowErrors.length) {
        summary.errorCount += 1;
        summary.errors.push(`ID ${id}: ${rowErrors.join(', ')}`);
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

      // Additive member attach (never auto-removes, to preserve attendance).
      const memberEmails = String(row.member_emails || '')
        .split(/[,;]+/).map(normEmail).filter(Boolean);
      for (const em of memberEmails) {
        const mid = memberByEmail.get(em);
        if (!mid) { summary.errors.push(`ID ${id}: member ${em} tidak ditemukan (dilewati)`); continue; }
        await client.query(
          `INSERT INTO schedule_members (schedule_id, member_id) VALUES ($1,$2)
           ON CONFLICT (schedule_id, member_id) DO NOTHING`, [scheduleId, mid]
        );
        await client.query(
          `INSERT INTO presences (schedule_id, member_id, status, source) VALUES ($1,$2,'absent','sheet')
           ON CONFLICT (schedule_id, member_id) DO NOTHING`, [scheduleId, mid]
        );
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
