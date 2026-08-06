const isTeachingQuestionnaire = (questionnaire = {}) => (
  /questionnaire|questioner|kuesioner/i.test(String(questionnaire.title || ''))
);

// A questionnaire uses the hardcoded teaching template only when its title matches
// the teaching keywords AND it has no custom questions. Once an admin adds questions
// it becomes a custom questionnaire rendered generically.
const isTeachingMode = (questionnaire = {}, questionCount = 0) => (
  isTeachingQuestionnaire(questionnaire) && Number(questionCount || 0) === 0
);

const teachingQuestionnaireFilter = (alias = 'q') => (
  `(${alias}.title ILIKE '%questionnaire%' OR ${alias}.title ILIKE '%questioner%' OR ${alias}.title ILIKE '%kuesioner%')`
);

const teachingRatings = [
  ['overall_rating', 'Penilaian terhadap keseluruhan kelas yang diikuti'],
  ['material_quality', 'Kualitas materi yang disampaikan'],
  ['material_relevance', 'Kesesuaian materi dengan kebutuhan'],
  ['tutor_mastery', 'Penguasaan materi oleh tutor'],
  ['tutor_performance', 'Penampilan tutor saat mengajar'],
];

const teachingEssays = [
  ['change_after_meetings', 'Apa perubahan yang anda rasakan setelah mengikuti 10x pertemuan?'],
  ['testimonial', 'Berikan Testimoni positif anda tentang Kelas Online Mr.Bob'],
  ['suggestion', 'Berikan saran perbaikan untuk Kelas Online Mr.Bob'],
];

const ratingLabels = {
  5: 'Sangat baik',
  4: 'Baik',
  3: 'Cukup',
  2: 'Kurang',
  1: 'Sangat kurang',
};

const buildTeachingQuestionnaireAnswer = (body = {}) => {
  const answers = {
    tutor_id: body.tutor_id || '',
    tutor_name: body.tutor_name || '',
    study_program_id: body.study_program_id || '',
    study_program_name: body.study_program_name || '',
    study_period: body.study_period || '',
    ratings: {},
    essays: {},
    self_study_reference: body.self_study_reference || '',
  };

  let score = 0;
  teachingRatings.forEach(([key]) => {
    const value = Number(body[key] || 0);
    answers.ratings[key] = value || '';
    score += value || 0;
  });
  teachingEssays.forEach(([key]) => {
    answers.essays[key] = String(body[key] || '').trim();
  });

  return {
    answers,
    score,
    maxScore: teachingRatings.length * 5,
  };
};

const ensureQuestionnaireResponseScope = async (query) => {
  await query(`ALTER TABLE questionnaire_responses ADD COLUMN IF NOT EXISTS tutor_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE questionnaire_responses ADD COLUMN IF NOT EXISTS study_program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE questionnaire_responses ADD COLUMN IF NOT EXISTS study_period VARCHAR(100)`);
  await query(`
    UPDATE questionnaire_responses qr
    SET tutor_id = NULLIF(qr.answers->>'tutor_id', '')::int
    WHERE qr.tutor_id IS NULL
      AND qr.answers ? 'tutor_id'
      AND (qr.answers->>'tutor_id') ~ '^[0-9]+$'
  `);
  await query(`
    UPDATE questionnaire_responses qr
    SET study_program_id = NULLIF(qr.answers->>'study_program_id', '')::int
    WHERE qr.study_program_id IS NULL
      AND qr.answers ? 'study_program_id'
      AND (qr.answers->>'study_program_id') ~ '^[0-9]+$'
  `);
  await query(`
    UPDATE questionnaire_responses qr
    SET study_period = NULLIF(qr.answers->>'study_period', '')
    WHERE qr.study_period IS NULL
      AND qr.answers ? 'study_period'
  `);
  await query(`ALTER TABLE questionnaire_responses DROP CONSTRAINT IF EXISTS questionnaire_responses_questionnaire_id_member_id_key`);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS questionnaire_responses_teaching_scope_idx
    ON questionnaire_responses (questionnaire_id, member_id, tutor_id)
    WHERE tutor_id IS NOT NULL
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS questionnaire_responses_default_scope_idx
    ON questionnaire_responses (questionnaire_id, member_id)
    WHERE tutor_id IS NULL
  `);
};

const ensureTeachingQuestionnaires = async (query) => {
  await ensureQuestionnaireResponseScope(query);
  const creatorResult = await query(`
    SELECT id
    FROM users
    WHERE role IN ('admin', 'tutor')
    ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id
    LIMIT 1
  `);
  const creator = creatorResult.rows[0];
  if (!creator) return 0;

  const result = await query(`
    INSERT INTO questionnaires (title, description, program_id, created_by, due_date, duration_minutes, is_active)
    SELECT
      'Questionnaire Evaluasi Tutor',
      'Kegiatan Ajar Mengajar Oleh Tutor',
      p.id,
      $1,
      NULL,
      NULL,
      true
    FROM programs p
    WHERE p.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM questionnaires q
        WHERE q.program_id = p.id
          AND q.is_active = true
          AND ${teachingQuestionnaireFilter('q')}
      )
    RETURNING id
  `, [creator.id]);

  return result.rowCount || 0;
};

module.exports = {
  isTeachingQuestionnaire,
  isTeachingMode,
  teachingQuestionnaireFilter,
  teachingRatings,
  teachingEssays,
  ratingLabels,
  buildTeachingQuestionnaireAnswer,
  ensureQuestionnaireResponseScope,
  ensureTeachingQuestionnaires,
};
