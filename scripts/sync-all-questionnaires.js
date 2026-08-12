// =============================================
// Backfill: kirim SEMUA questionnaire response yang sudah ada ke spreadsheet
// (tab "Questionnaire"). Aman diulang — Apps Script meng-upsert per response_id.
//
// Jalankan:
//   node -r dotenv/config scripts/sync-all-questionnaires.js
//
// Berbeda dgn sync live (submit tunggal, timeout 10s), backfill mengirim ratusan
// baris berturut-turut ke satu Apps Script yang men-serialize lewat LockService.
// Karena itu di sini: timeout lebih longgar (30s), ada jeda antar-request, dan retry
// — supaya tidak terjadi penumpukan lock yang bikin request beruntun ke-abort.
// =============================================

const { pool, query } = require('../src/config/database');
const { buildQuestionnairePayload } = require('../src/utils/spreadsheetSync');

const WEBHOOK_URL = process.env.QUESTIONNAIRE_WEBHOOK_URL || process.env.SHEET_WEBHOOK_URL;
// Apps Script memakai LockService.waitLock(30000). Kalau client ABORT sebelum 30s,
// eksekusi server tetap jalan & MENAHAN lock -> call berikutnya nunggu lock lalu
// ikut time out (cascade). Maka timeout client dibuat > 30s supaya tidak pernah
// meninggalkan lock "zombie". Jeda kecil cukup karena tiap call sudah berurutan.
const REQUEST_TIMEOUT_MS = 40000;
const DELAY_BETWEEN_MS = 1500;
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postOnce(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  if (!WEBHOOK_URL) {
    console.error('QUESTIONNAIRE_WEBHOOK_URL / SHEET_WEBHOOK_URL belum diset. Batal.');
    process.exit(1);
  }
  const res = await query('SELECT id FROM questionnaire_responses ORDER BY submitted_at ASC, id ASC');
  const ids = res.rows.map((r) => r.id);
  console.log(`Total questionnaire response: ${ids.length}`);

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const payload = await buildQuestionnairePayload(id);
    if (!payload) { failed += 1; console.warn(`  #${id} dilewati (payload kosong)`); continue; }

    let done = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt += 1) {
      try {
        await postOnce(payload);
        done = true;
        ok += 1;
      } catch (e) {
        if (attempt === MAX_ATTEMPTS) {
          failed += 1;
          console.error(`  #${id} GAGAL (${attempt}x): ${e.message}`);
        } else {
          // Tunggu > lock server (30s) agar eksekusi yang mungkin masih menahan
          // lock benar-benar lepas sebelum coba lagi.
          await sleep(32000);
        }
      }
    }
    if ((i + 1) % 25 === 0) console.log(`  ...progres ${i + 1}/${ids.length} (ok ${ok}, gagal ${failed})`);
    await sleep(DELAY_BETWEEN_MS); // beri jeda agar lock Apps Script lepas
  }

  console.log(`Selesai. Terkirim: ${ok} | Gagal: ${failed} | Total: ${ids.length}`);
  await pool.end();
  process.exit(failed && !ok ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
