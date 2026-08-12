// =============================================
// Backfill: kirim SEMUA questionnaire response yang sudah ada ke spreadsheet
// (tab "Questionnaire"). Aman diulang — Apps Script meng-upsert per response_id.
//
// Jalankan:
//   node -r dotenv/config scripts/sync-all-questionnaires.js
//
// Butuh QUESTIONNAIRE_WEBHOOK_URL (atau fallback SHEET_WEBHOOK_URL) terkonfigurasi,
// dan Apps Script sudah di-deploy ulang dengan handler event 'questionnaire'.
// =============================================

const { pool, query } = require('../src/config/database');
const { syncQuestionnaire } = require('../src/utils/spreadsheetSync');

const hasWebhook = Boolean(process.env.QUESTIONNAIRE_WEBHOOK_URL || process.env.SHEET_WEBHOOK_URL);

(async () => {
  if (!hasWebhook) {
    console.error('QUESTIONNAIRE_WEBHOOK_URL / SHEET_WEBHOOK_URL belum diset. Batal.');
    process.exit(1);
  }
  const res = await query('SELECT id FROM questionnaire_responses ORDER BY submitted_at ASC, id ASC');
  const ids = res.rows.map((r) => r.id);
  console.log(`Total questionnaire response: ${ids.length}`);

  let ok = 0;
  let failed = 0;
  // Berurutan (bukan paralel) supaya lock Apps Script tidak tabrakan.
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    try {
      const r = await syncQuestionnaire(id);
      if (r && r.skipped) { failed += 1; console.warn(`  #${id} dilewati (payload kosong)`); }
      else { ok += 1; }
    } catch (e) {
      failed += 1;
      console.error(`  #${id} GAGAL: ${e.message}`);
    }
    if ((i + 1) % 25 === 0) console.log(`  ...progres ${i + 1}/${ids.length}`);
  }

  console.log(`Selesai. Terkirim: ${ok} | Gagal: ${failed} | Total: ${ids.length}`);
  await pool.end();
  process.exit(failed && !ok ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
