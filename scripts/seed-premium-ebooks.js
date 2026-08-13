// =============================================
// Seed "Module Premium" (e-book) dari folder Google Drive (share: anyone with link).
// Tiap file jadi 1 baris di tabel `modules` sebagai modul premium tanpa program
// (program_id NULL, is_premium true) -> tampil di menu Module, section "Module
// Premium", hanya untuk member Luxury.
//
// Link e-book: https://drive.google.com/file/d/<FILE_ID>/view (buka viewer Drive).
//
// Idempoten: baris dilewati bila file_url-nya sudah ada. Aman diulang.
//   node -r dotenv/config scripts/seed-premium-ebooks.js
// =============================================

const { pool, query } = require('../src/config/database');

const FOLDER_ID = process.env.PREMIUM_EBOOK_FOLDER_ID || '15H3I-SYlwnE8mbV34UU1C6BLItX7HCUI';

const decodeEntities = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

// "E-BOOK IELTS ALL.pdf" -> { title, description }
function cleanName(raw) {
  let s = decodeEntities(raw);
  s = s.replace(/\.(pdf|epub|docx?|mobi)$/i, '');   // buang ekstensi
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^e-?book\b/i, 'E-Book');           // seragamkan awalan E-Book
  const m = s.match(/^(.+?)\s*\((.+)\)\s*$/);        // subjudul dalam kurung -> deskripsi
  if (m) return { title: m[1].trim(), description: m[2].trim() };
  return { title: s, description: '' };
}

async function fetchFolderFiles(folderId) {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}#list`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Drive folder HTTP ${res.status}`);
  const html = await res.text();
  const ids = [...html.matchAll(/id=.entry-([A-Za-z0-9_-]+)./g)].map((m) => m[1]);
  const names = [...html.matchAll(/flip-entry-title[^>]*>([^<]+)/g)].map((m) => m[1]);
  return ids.map((id, i) => ({ id, rawName: names[i] || '' }));
}

(async () => {
  const files = await fetchFolderFiles(FOLDER_ID);
  console.log(`File di folder Drive: ${files.length}`);
  if (!files.length) { console.error('Tidak ada file terbaca. Pastikan folder di-share "anyone with link".'); await pool.end(); process.exit(1); }

  let added = 0;
  let skipped = 0;
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    const { title, description } = cleanName(f.rawName);
    const fileUrl = `https://drive.google.com/file/d/${f.id}/view`;

    const exists = await query('SELECT 1 FROM modules WHERE file_url = $1', [fileUrl]);
    if (exists.rows.length) { skipped += 1; console.log(`  = sudah ada: ${title}`); continue; }

    await query(
      `INSERT INTO modules (program_id, title, description, file_url, is_premium, is_active, order_number)
       VALUES (NULL, $1, $2, $3, true, true, $4)`,
      [title, description || null, fileUrl, i + 1]
    );
    added += 1;
    console.log(`  + ${title}`);
  }

  console.log(`Selesai. Ditambah: ${added} | Dilewati (sudah ada): ${skipped} | Total file: ${files.length}`);
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
