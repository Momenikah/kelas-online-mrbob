// =============================================
// Hapus simulasi TOEFL duplikat yang kosong.
//
// Seed lama di migrations/migrate.js memakai "ON CONFLICT DO NOTHING" padahal
// kolom title tidak punya unique constraint, sehingga klausa itu tidak pernah
// menahan apa pun: tiap kali "npm run migrate" dijalankan, satu baris berjudul
// sama bertambah lagi. Di lokal sempat menumpuk jadi 5 simulasi kosong.
//
// migrate.js sudah diperbaiki, tapi menjalankan migrate di PRODUKSI tidak aman
// (ikut menyeed akun demo admin/tutor/member). Script ini melakukan pembersihan
// yang sama TANPA menyentuh apa pun selain toefl_simulations.
//
// Aman & idempoten: hanya menghapus duplikat yang benar-benar tidak terpakai —
// tidak punya satu pun soal DAN tidak punya satu pun hasil pengerjaan member.
// Baris dengan id terkecil selalu dipertahankan.
//   node -r dotenv/config scripts/cleanup-duplicate-toefl-simulations.js
// =============================================

const { pool, query } = require('../src/config/database');

(async () => {
  const before = await query(
    'SELECT ts.id, ts.title, ts.is_active,'
    + ' (SELECT COUNT(*)::int FROM toefl_questions q WHERE q.simulation_id = ts.id) AS soal,'
    + ' (SELECT COUNT(*)::int FROM toefl_results r WHERE r.simulation_id = ts.id) AS hasil'
    + ' FROM toefl_simulations ts ORDER BY ts.id'
  );
  console.log('SEBELUM (' + before.rows.length + ' simulasi):');
  before.rows.forEach((r) => console.log('  #' + r.id + ' | ' + r.title + ' | aktif=' + r.is_active + ' | soal=' + r.soal + ' | hasil=' + r.hasil));

  const del = await query(
    'DELETE FROM toefl_simulations ts'
    + ' WHERE EXISTS (SELECT 1 FROM toefl_simulations t2 WHERE t2.title = ts.title AND t2.id < ts.id)'
    + '   AND NOT EXISTS (SELECT 1 FROM toefl_questions q WHERE q.simulation_id = ts.id)'
    + '   AND NOT EXISTS (SELECT 1 FROM toefl_results r WHERE r.simulation_id = ts.id)'
  );
  console.log('\nDuplikat kosong dihapus: ' + del.rowCount);

  // Simulasi tanpa soal hanya tampil sebagai kartu mati "Soal belum tersedia"
  // di halaman member, jadi disembunyikan saja.
  const off = await query(
    'UPDATE toefl_simulations SET is_active = false'
    + ' WHERE is_active = true'
    + '   AND NOT EXISTS (SELECT 1 FROM toefl_questions q WHERE q.simulation_id = toefl_simulations.id)'
  );
  console.log('Simulasi tanpa soal dinonaktifkan: ' + off.rowCount);

  const after = await query(
    'SELECT ts.id, ts.title, ts.is_active,'
    + ' (SELECT COUNT(*)::int FROM toefl_questions q WHERE q.simulation_id = ts.id) AS soal'
    + ' FROM toefl_simulations ts ORDER BY ts.id'
  );
  console.log('\nSESUDAH (' + after.rows.length + ' simulasi):');
  after.rows.forEach((r) => console.log('  #' + r.id + ' | ' + r.title + ' | aktif=' + r.is_active + ' | soal=' + r.soal));

  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
