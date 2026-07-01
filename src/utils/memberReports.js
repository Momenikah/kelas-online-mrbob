const emptyReportDays = () => {
  const days = {};
  for (let i = 1; i <= 15; i += 1) days[`day_${i}`] = '';
  return days;
};

const normalizeReportDays = (input = {}) => {
  const days = emptyReportDays();
  Object.keys(days).forEach((key) => {
    days[key] = String(input[key] || '').trim();
  });
  return days;
};

const ensureMemberReportsTable = async (query) => {
  await query(`
    CREATE TABLE IF NOT EXISTS member_reports (
      id SERIAL PRIMARY KEY,
      member_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tutor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      package_name VARCHAR(255),
      days JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(member_id, tutor_id, program_id, period_start)
    )
  `);
};

module.exports = {
  emptyReportDays,
  normalizeReportDays,
  ensureMemberReportsTable,
};
