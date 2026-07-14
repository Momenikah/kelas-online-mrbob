const ensureCertificateDetailsColumn = async (query) => {
  await query(`ALTER TABLE certificates ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb`);
};

const certificateCategoryAllowsPersonalReport = (category = '') => {
  const value = String(category).toLowerCase();
  return value.includes('speaking') || value.includes('holiday');
};

const normalizeCertificateDetails = (body = {}) => {
  const category = String(body.category || '').trim();
  const details = {
    category,
    member_email: String(body.member_email || '').trim(),
    tutor_name: String(body.tutor_name || '').trim(),
    period_label: String(body.period_label || '').trim(),
    program_label: String(body.program_label || '').trim(),
    grade: String(body.grade || '').trim(),
    scores: {},
    notes: {},
    improvement: {},
  };

  // Per-section notes filled by the tutor (shown in the Personal Report "Notes" column).
  ['speaking', 'vocabulary', 'grammar', 'pronunciation', 'understanding'].forEach((key) => {
    const v = body[`${key}_note`];
    if (v !== undefined && String(v).trim() !== '') details.notes[key] = String(v).trim();
  });

  [
    'speaking_score',
    'pronunciation_score',
    'vocabulary_score',
    'grammar_score',
    'understanding_score',
    'cefr_score',
    'listening_score',
    'structure_score',
    'reading_score',
    'writing_score',
    'total_score',
  ].forEach((key) => {
    if (body[key] !== undefined && String(body[key]).trim() !== '') details.scores[key] = String(body[key]).trim();
  });

  if (certificateCategoryAllowsPersonalReport(category)) {
    details.improvement.before = String(body.before || '').trim();
    details.improvement.after = String(body.after || '').trim();
  }

  return details;
};

module.exports = {
  ensureCertificateDetailsColumn,
  normalizeCertificateDetails,
  certificateCategoryAllowsPersonalReport,
};
