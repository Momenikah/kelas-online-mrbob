// =============================================
// Member self-reported attendance (presensi) — member submits proof per meeting;
// tutor & admin view only.
// =============================================

async function ensureMemberPresenceTable(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS member_presences (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      tutor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      period_start DATE,
      program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
      meeting_number INTEGER,
      screenshot VARCHAR(500),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

module.exports = { ensureMemberPresenceTable };
