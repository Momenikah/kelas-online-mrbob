// =============================================
// Seed modul Luxury per-program (bukan bonus umum). Tiap item = 1 baris di tabel
// `modules` dgn program_id diisi + is_premium true -> muncul di section "Module
// Premium" HANYA untuk member Luxury yang enroll program itu.
//
// Idempoten: dilewati bila file_url sudah ada. Aman diulang.
//   node -r dotenv/config scripts/seed-luxury-program-modules.js
// =============================================

const { pool, query } = require('../src/config/database');

// program_id: WALKY TALKY=4, SPEAK UP 1=5, TOEFL=13 (dipetakan dari nama program).
const ITEMS = [
  { program_id: 4, title: 'Modul Luxury Walky Talky', fileId: '1pDrjEH1uxz3JM0N6OsfEsN012yTTykBl' },
  { program_id: 5, title: 'Modul Luxury Speak Up 1', fileId: '1LDmzSHL84fFrFm2xanKocpHZ2iHLH4Um' },
  { program_id: 13, title: 'Modul Luxury TOEFL', fileId: '1HKUNSRSeHeIQ2Ns7c9crif1IbykeKpJD' },
];

(async () => {
  let added = 0;
  let skipped = 0;
  for (const it of ITEMS) {
    const fileUrl = `https://drive.google.com/file/d/${it.fileId}/view`;
    // Pastikan program-nya ada.
    const prog = await query('SELECT name FROM programs WHERE id = $1', [it.program_id]);
    if (!prog.rows.length) { console.warn(`  ! program ${it.program_id} tidak ada, lewati: ${it.title}`); continue; }

    const exists = await query('SELECT 1 FROM modules WHERE file_url = $1', [fileUrl]);
    if (exists.rows.length) { skipped += 1; console.log(`  = sudah ada: ${it.title}`); continue; }

    await query(
      `INSERT INTO modules (program_id, title, description, file_url, is_premium, is_active, order_number)
       VALUES ($1, $2, NULL, $3, true, true, 1)`,
      [it.program_id, it.title, fileUrl]
    );
    added += 1;
    console.log(`  + ${it.title}  (program: ${prog.rows[0].name})`);
  }
  console.log(`Selesai. Ditambah: ${added} | Dilewati: ${skipped} | Total: ${ITEMS.length}`);
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
