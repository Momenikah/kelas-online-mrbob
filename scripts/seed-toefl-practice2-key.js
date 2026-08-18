// =============================================
// Bank kunci jawaban "TOEFL Practice Test 2" sebagai 140 record soal (nomor +
// kunci A/B/C/D). Teks soal & opsi diisi belakangan lewat panel Admin (Edit).
// Listening dikelompokkan default: Part A=1-30, Part B=31-38, Part C=39-50.
// Simulasi di-set NONAKTIF supaya siswa tidak melihat soal kosong dulu.
// Idempoten: berhenti bila simulasi sudah punya soal.
//   node -r dotenv/config scripts/seed-toefl-practice2-key.js
// =============================================

const { pool, query } = require('../src/config/database');
const { ensureToeflTables } = require('../src/utils/toefl');

const TITLE = 'TOEFL Practice Test 2';

// Kunci jawaban (huruf saja) — data faktual dari kunci resmi.
const KEY = {
  listening: 'C C A D C C A B D B D A C B A B C D A C D B B B C C D C C A B C A D D A B A C C B A B C B D B A D C'.split(' '),
  structure: 'A B A D C D A B C A B C B C D A D C C D A C B D C A D C C B C A C A D D C B A B'.split(' '),
  reading: 'D A C B D A A B C D B A A D B C A B A B C A D C B D C A C D B C A D B D C A B B C D A B C C B C A C'.split(' '),
};

(async () => {
  await ensureToeflTables(query);
  const sim = (await query('SELECT id FROM toefl_simulations WHERE title = $1', [TITLE])).rows[0];
  if (!sim) { console.error(`Simulasi "${TITLE}" belum ada. Jalankan seed-toefl-practice2-shell.js dulu.`); await pool.end(); process.exit(1); }

  const existing = Number((await query('SELECT COUNT(*) c FROM toefl_questions WHERE simulation_id = $1', [sim.id])).rows[0].c);
  if (existing > 0) { console.log(`Simulasi id ${sim.id} sudah punya ${existing} soal — tidak menambah (idempoten).`); await pool.end(); process.exit(0); }

  // Part listening (dibuat oleh shell seed).
  const parts = (await query("SELECT id, label FROM toefl_passages WHERE simulation_id = $1 AND section='listening'", [sim.id])).rows;
  const partByLabel = {};
  parts.forEach((p) => { partByLabel[p.label] = p.id; });
  const listeningPart = (n) => (n <= 30 ? partByLabel['Part A'] : n <= 38 ? partByLabel['Part B'] : partByLabel['Part C']) || null;

  let n = 0;
  const addSection = async (section, keys, passageFn) => {
    for (let i = 0; i < keys.length; i += 1) {
      const num = i + 1;
      await query(
        `INSERT INTO toefl_questions (simulation_id, passage_id, section, number, correct_option, order_number)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [sim.id, passageFn ? passageFn(num) : null, section, num, keys[i], num]
      );
      n += 1;
    }
  };
  await addSection('listening', KEY.listening, listeningPart);
  await addSection('structure', KEY.structure, null);
  await addSection('reading', KEY.reading, null);

  await query('UPDATE toefl_simulations SET is_active = false WHERE id = $1', [sim.id]);
  console.log(`Selesai. ${n} soal (kunci) dibuat untuk sim id ${sim.id}. Simulasi di-NONAKTIFKAN.`);
  console.log('Isi teks soal & opsi lewat /admin/toefl/' + sim.id + ' (tombol Edit), lalu aktifkan.');
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
