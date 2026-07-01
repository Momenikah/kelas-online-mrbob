// =============================================
// Period management: a `periods` table the admin curates. Tutors may only fill
// available time for periods that are OPEN. Periods are weekly (Monday start).
// =============================================

const at = require('./availableTime');

async function ensurePeriodsTable(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS periods (
      id SERIAL PRIMARY KEY,
      period_start DATE UNIQUE NOT NULL,
      label VARCHAR(100),
      is_open BOOLEAN DEFAULT true,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

// Seed the current week + next 12 weeks as open, and backfill any periods that
// tutors already have available time for (closed if in the past).
async function seedPeriods(query) {
  await ensurePeriodsTable(query);

  const base = new Date(at.currentPeriodValue());
  for (let i = 0; i < 13; i += 1) {
    const d = new Date(base);
    d.setDate(base.getDate() + i * 7);
    const iso = at.toISODate(d);
    await query(
      `INSERT INTO periods (period_start, label, is_open)
       SELECT $1::date, $2, true
       WHERE NOT EXISTS (SELECT 1 FROM periods WHERE period_start = $1::date)`,
      [iso, at.formatPeriodLabel(iso)]
    );
  }

  // Backfill periods already used by available_times so they appear in the list.
  await query(`
    INSERT INTO periods (period_start, is_open)
    SELECT DISTINCT a.period_start, (a.period_start >= CURRENT_DATE)
    FROM available_times a
    WHERE a.period_start IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM periods p WHERE p.period_start = a.period_start)
  `);

  const count = await query('SELECT COUNT(*) FROM periods');
  return Number(count.rows[0].count);
}

module.exports = { ensurePeriodsTable, seedPeriods };
