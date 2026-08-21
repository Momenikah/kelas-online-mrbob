// =============================================
// Member self-reported attendance (presensi) — member submits proof per meeting;
// tutor & admin view only.
// =============================================

// Skema saja — aman & cepat, boleh dipanggil per-request (semua IF NOT EXISTS).
async function ensureMemberPresenceTable(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS member_presences (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      tutor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
      period_start DATE,
      program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
      meeting_number INTEGER,
      screenshot VARCHAR(500),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE member_presences ADD COLUMN IF NOT EXISTS schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL`);
  // Unik per (member, schedule, MEETING) — bukan per (member, schedule) — supaya
  // tiap pertemuan BERTAMBAH (bukan menimpa). Satu jadwal (paket) berisi banyak
  // pertemuan; re-submit pertemuan yang SAMA memperbarui buktinya, pertemuan baru
  // menambah baris.
  await query(`DROP INDEX IF EXISTS member_presences_member_schedule_idx`);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS member_presences_member_schedule_meeting_idx
    ON member_presences (member_id, schedule_id, meeting_number)
  `);
}

// Backfill SEKALI JALAN (dipanggil saat boot, BUKAN per-request). Menautkan baris
// presensi lama (schedule_id NULL) ke jadwal yang cocok, lalu menandai kehadirannya.
// Kalau dijalankan tiap request, UPDATE-nya bisa balapan dengan submit/refresh member
// lain dan memicu "duplicate key ... member_presences_member_schedule_idx".
async function backfillMemberPresenceSchedules(query) {
  await query(`
    WITH ranked_sessions AS (
      SELECT
        sm.member_id,
        s.id AS schedule_id,
        s.tutor_id,
        s.program_id,
        date_trunc('week', s.date)::date AS period_start,
        ROW_NUMBER() OVER (
          PARTITION BY sm.member_id, s.tutor_id, s.program_id, date_trunc('week', s.date)::date
          ORDER BY s.date, s.start_time, s.id
        ) AS meeting_number
      FROM schedule_members sm
      JOIN schedules s ON s.id = sm.schedule_id
      WHERE s.status <> 'cancelled'
    ),
    matches AS (
      SELECT
        mp.id,
        rs.schedule_id,
        ROW_NUMBER() OVER (
          PARTITION BY mp.member_id, rs.schedule_id
          ORDER BY mp.created_at DESC, mp.id DESC
        ) AS pick_order
      FROM member_presences mp
      JOIN ranked_sessions rs
        ON rs.member_id = mp.member_id
       AND rs.tutor_id = mp.tutor_id
       AND rs.program_id = mp.program_id
       AND rs.period_start = mp.period_start
       AND rs.meeting_number = mp.meeting_number
      WHERE mp.schedule_id IS NULL
        -- Jangan backfill bila sudah ada baris lain yang memakai (member, schedule)
        -- ini — kalau tidak, UPDATE-nya melanggar unique index member_schedule_idx.
        AND NOT EXISTS (
          SELECT 1 FROM member_presences ex
          WHERE ex.member_id = mp.member_id
            AND ex.schedule_id = rs.schedule_id
        )
    )
    UPDATE member_presences mp
    SET schedule_id = matches.schedule_id
    FROM matches
    WHERE mp.id = matches.id
      AND matches.pick_order = 1
  `);
  await query(`
    INSERT INTO presences (schedule_id, member_id, status, check_in_time, updated_by, updated_at, source)
    SELECT mp.schedule_id, mp.member_id, 'present', COALESCE(mp.created_at, NOW()), mp.member_id, NOW(), 'self-report'
    FROM member_presences mp
    WHERE mp.schedule_id IS NOT NULL
    ON CONFLICT (schedule_id, member_id)
    DO UPDATE SET status = 'present',
                  check_in_time = COALESCE(presences.check_in_time, EXCLUDED.check_in_time),
                  updated_by = EXCLUDED.updated_by,
                  updated_at = NOW(),
                  source = 'self-report'
    WHERE presences.status NOT IN ('present', 'late')
  `);
}

module.exports = { ensureMemberPresenceTable, backfillMemberPresenceSchedules };
