// =============================================
// Shell "TOEFL Practice Test 2": buat simulasi + 3 Part Listening (audio sudah
// diupload ke /uploads/toefl). Soal diisi lewat panel Admin. Idempoten.
//   node -r dotenv/config scripts/seed-toefl-practice2-shell.js
// =============================================

const { pool, query } = require('../src/config/database');
const { ensureToeflTables } = require('../src/utils/toefl');

const TITLE = 'TOEFL Practice Test 2';
const PARTS = [
  ['Part A', '/uploads/toefl/CD1-Track04.mp3', 1],
  ['Part B', '/uploads/toefl/CD1-Track05.mp3', 2],
  ['Part C', '/uploads/toefl/CD1-Track06.mp3', 3],
];

(async () => {
  await ensureToeflTables(query);
  let sim = (await query('SELECT id FROM toefl_simulations WHERE title = $1', [TITLE])).rows[0];
  if (!sim) {
    sim = (await query(
      `INSERT INTO toefl_simulations (title, description, listening_minutes, structure_minutes, reading_minutes, is_active)
       VALUES ($1, $2, 35, 25, 55, true) RETURNING id`,
      [TITLE, 'Simulasi TOEFL PBT lengkap (Listening, Structure, Reading)']
    )).rows[0];
    console.log('Simulasi dibuat, id', sim.id);
  } else {
    console.log('Simulasi sudah ada, id', sim.id);
  }

  for (const [label, audio, ord] of PARTS) {
    const ex = (await query(
      "SELECT id FROM toefl_passages WHERE simulation_id = $1 AND section = 'listening' AND label = $2",
      [sim.id, label]
    )).rows[0];
    if (ex) { console.log('  = ' + label + ' sudah ada'); continue; }
    await query(
      "INSERT INTO toefl_passages (simulation_id, section, label, audio_url, order_number) VALUES ($1,'listening',$2,$3,$4)",
      [sim.id, label, audio, ord]
    );
    console.log('  + ' + label + ' -> ' + audio);
  }
  console.log('SELESAI. Kelola soal di /admin/toefl/' + sim.id);
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
