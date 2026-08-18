// =============================================
// Mesin Simulasi TOEFL (PBT): 3 section — Listening, Structure, Reading.
// - toefl_simulations : judul + durasi per-section
// - toefl_passages    : "wadah" — Listening Part A/B/C (punya audio) & Reading Passage
// - toefl_questions   : soal pilihan ganda A/B/C/D + kunci, opsional milik passage
// - toefl_results     : hasil + jawaban member (JSONB)
// Skor dikonversi ke skala TOEFL PBT (per section 31–68, total 310–677) — pendekatan
// linear (tabel konversi resmi berhak cipta, jadi ini estimasi yang wajar).
// =============================================

const SECTIONS = ['listening', 'structure', 'reading'];

async function ensureToeflTables(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS toefl_simulations (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      duration_minutes INTEGER DEFAULT 120,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Durasi per-section (Listening biasanya mengikuti audio; simpan sebagai cadangan).
  await query(`ALTER TABLE toefl_simulations ADD COLUMN IF NOT EXISTS listening_minutes INTEGER DEFAULT 35`);
  await query(`ALTER TABLE toefl_simulations ADD COLUMN IF NOT EXISTS structure_minutes INTEGER DEFAULT 25`);
  await query(`ALTER TABLE toefl_simulations ADD COLUMN IF NOT EXISTS reading_minutes INTEGER DEFAULT 55`);

  await query(`
    CREATE TABLE IF NOT EXISTS toefl_passages (
      id SERIAL PRIMARY KEY,
      simulation_id INTEGER REFERENCES toefl_simulations(id) ON DELETE CASCADE,
      section VARCHAR(20) NOT NULL,
      label VARCHAR(150),
      body TEXT,
      audio_url VARCHAR(500),
      order_number INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS toefl_questions (
      id SERIAL PRIMARY KEY,
      simulation_id INTEGER REFERENCES toefl_simulations(id) ON DELETE CASCADE,
      passage_id INTEGER REFERENCES toefl_passages(id) ON DELETE SET NULL,
      section VARCHAR(20) NOT NULL,
      number INTEGER,
      prompt TEXT,
      option_a TEXT, option_b TEXT, option_c TEXT, option_d TEXT,
      correct_option CHAR(1),
      order_number INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS toefl_results (
      id SERIAL PRIMARY KEY,
      simulation_id INTEGER REFERENCES toefl_simulations(id) ON DELETE CASCADE,
      member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      listening_score INTEGER DEFAULT 0,
      structure_score INTEGER DEFAULT 0,
      reading_score INTEGER DEFAULT 0,
      total_score INTEGER DEFAULT 0,
      taken_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE toefl_results ADD COLUMN IF NOT EXISTS listening_raw INTEGER DEFAULT 0`);
  await query(`ALTER TABLE toefl_results ADD COLUMN IF NOT EXISTS structure_raw INTEGER DEFAULT 0`);
  await query(`ALTER TABLE toefl_results ADD COLUMN IF NOT EXISTS reading_raw INTEGER DEFAULT 0`);
  await query(`ALTER TABLE toefl_results ADD COLUMN IF NOT EXISTS answers JSONB`);
  // Tabel lama (init.sql) memakai FK tanpa ON DELETE CASCADE -> menghapus simulasi
  // yang sudah punya hasil akan gagal. Pasang ulang dengan CASCADE.
  await query(`ALTER TABLE toefl_results DROP CONSTRAINT IF EXISTS toefl_results_simulation_id_fkey`);
  await query(`ALTER TABLE toefl_results ADD CONSTRAINT toefl_results_simulation_id_fkey
               FOREIGN KEY (simulation_id) REFERENCES toefl_simulations(id) ON DELETE CASCADE`);
}

// Tabel konversi resmi Practice Test 2 (raw benar -> skala section), indeks = jumlah
// benar. Baris 24 tidak ada di sumber -> diinterpolasi dari 23 & 25.
const CONVERSION = {
  listening: [24, 25, 26, 27, 28, 29, 30, 31, 32, 32, 33, 35, 37, 38, 39, 41, 41, 42, 43, 44, 45, 45, 46, 47, 48, 48, 48, 49, 49, 50, 51, 52, 52, 53, 53, 54, 54, 55, 56, 57, 57, 58, 59, 60, 61, 62, 63, 65, 66, 67, 68],
  structure: [19, 20, 21, 22, 23, 25, 26, 27, 29, 31, 33, 35, 36, 37, 38, 40, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 63, 65, 68, 68],
  reading: [21, 22, 23, 23, 25, 26, 27, 28, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 44, 45, 46, 46, 47, 48, 48, 49, 50, 51, 52, 52, 53, 54, 54, 55, 56, 57, 58, 59, 60, 61, 63, 65, 66, 67],
};

// Jumlah benar section -> skala TOEFL PBT via tabel konversi (di-clamp ke rentang tabel).
function toSectionScaled(raw, section) {
  const table = CONVERSION[section];
  if (!table) return 31;
  const r = Math.max(0, Math.min(Math.round(raw), table.length - 1));
  return table[r];
}

// Tiga skala section -> total TOEFL (310–677).
function toTotalScore(lScaled, sScaled, rScaled) {
  const total = Math.round(((lScaled + sScaled + rScaled) * 10) / 3);
  return Math.max(310, Math.min(677, total));
}

// Hitung skor lengkap dari jawaban member.
//   answers: { [questionId]: 'A'|'B'|'C'|'D' }
//   questions: baris toefl_questions (punya id, section, correct_option)
function scoreAttempt(questions, answers = {}) {
  const raw = { listening: 0, structure: 0, reading: 0 };
  const max = { listening: 0, structure: 0, reading: 0 };
  questions.forEach((q) => {
    if (!SECTIONS.includes(q.section)) return;
    max[q.section] += 1;
    const picked = String(answers[q.id] || '').toUpperCase();
    if (picked && q.correct_option && picked === String(q.correct_option).toUpperCase()) {
      raw[q.section] += 1;
    }
  });
  const scaled = {
    listening: toSectionScaled(raw.listening, 'listening'),
    structure: toSectionScaled(raw.structure, 'structure'),
    reading: toSectionScaled(raw.reading, 'reading'),
  };
  const total = toTotalScore(scaled.listening, scaled.structure, scaled.reading);
  return { raw, max, scaled, total };
}

module.exports = { SECTIONS, ensureToeflTables, toSectionScaled, toTotalScore, scoreAttempt };
