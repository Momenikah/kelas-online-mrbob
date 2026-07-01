// =============================================
// Single source of truth for the learning catalog so the registration form,
// the programs table, available time, and schedule plotting all stay aligned.
//   - STUDY_TIME_SLOTS : "jam belajar" options (shared with available time / plot)
//   - PROGRAM_CATALOG  : program list shown on the registration form
//   - ensurePrograms() : make sure each catalog program exists in `programs`
// =============================================

const { HOUR_SLOTS } = require('./availableTime');

// Jam belajar — identical set used by the registration form AND tutor available time.
const STUDY_TIME_SLOTS = HOUR_SLOTS;

// Program list offered on the registration form (selected_class values).
const PROGRAM_CATALOG = {
  adult: {
    label: 'Kelas Online Adult',
    items: [
      'WALKY TALKY', 'SPEAK UP 1', 'SPEAK UP 2', 'SPEAK UP 3', 'SPEAK UP 100',
      'GRAND SPEAKING', 'SPEAKING FOR SPECIFIC PURPOSES', 'CAREER CLINIC',
      'GRAMMAR', 'TOEFL', 'IELTS',
    ],
  },
  kids: {
    label: 'Kelas Online Kids & Teen',
    items: ['SMART KIDS', 'SUPER KIDS', 'GENIUS TEEN'],
  },
};

const ALL_PROGRAMS = [...PROGRAM_CATALOG.adult.items, ...PROGRAM_CATALOG.kids.items];

// Idempotently ensure each catalog program exists in the `programs` table so
// enrollment + schedule plotting use the same programs members register for.
async function ensurePrograms(query) {
  for (const name of ALL_PROGRAMS) {
    await query(
      `INSERT INTO programs (name, is_active)
       SELECT $1::text, true WHERE NOT EXISTS (SELECT 1 FROM programs WHERE name = $1::text)`,
      [name]
    );
  }
  return ALL_PROGRAMS.length;
}

module.exports = {
  STUDY_TIME_SLOTS,
  PROGRAM_CATALOG,
  ALL_PROGRAMS,
  ensurePrograms,
};
