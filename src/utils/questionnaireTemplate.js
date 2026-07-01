const isTeachingQuestionnaire = (questionnaire = {}) => (
  /questionnaire|questioner|kuesioner/i.test(String(questionnaire.title || ''))
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

const ensureTeachingQuestionnaires = async (query) => {
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
      30,
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
  teachingQuestionnaireFilter,
  teachingRatings,
  teachingEssays,
  ratingLabels,
  buildTeachingQuestionnaireAnswer,
  ensureTeachingQuestionnaires,
};
