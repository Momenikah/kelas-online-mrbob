// =============================================
// Seed "Video Premium" dari sebuah folder Google Drive (share: anyone with link).
// Tiap file video jadi 1 baris di tabel `videos` sebagai BONUS UMUM (program_id NULL,
// is_premium true) -> tampil ke semua member Luxury.
//
// URL embed video: https://drive.google.com/file/d/<FILE_ID>/preview (dipakai iframe
// pemutar yang sudah ada di member/video.ejs).
//
// Idempoten: baris dilewati bila video_url-nya sudah ada. Aman diulang.
//   node -r dotenv/config scripts/seed-premium-videos.js
// =============================================

const { pool, query } = require('../src/config/database');

const FOLDER_ID = process.env.PREMIUM_VIDEO_FOLDER_ID || '1j4c3AOlONPbiAycShmBShSmg7hnWPq-E';

const decodeEntities = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

// "Judul (Subjudul) - Mr. Bob Online Class (720p).mp4" -> { title, description }
function cleanName(raw) {
  let s = decodeEntities(raw);
  s = s.replace(/\.mp4$/i, '');
  s = s.replace(/\s*\(\d+p\)\s*$/i, '');       // resolusi di akhir, mis. (720p)
  s = s.replace(/\s*-\s*Mr\.?\s*Bob\s+Online\s+Class\s*$/i, '');
  s = s.trim();
  const m = s.match(/^(.+?)\s*\((.+)\)\s*$/);   // subjudul dalam kurung -> deskripsi
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
    const videoUrl = `https://drive.google.com/file/d/${f.id}/preview`;

    const exists = await query('SELECT 1 FROM videos WHERE video_url = $1', [videoUrl]);
    if (exists.rows.length) { skipped += 1; console.log(`  = sudah ada: ${title}`); continue; }

    await query(
      `INSERT INTO videos (title, description, video_url, is_premium, program_id, order_number)
       VALUES ($1, $2, $3, true, NULL, $4)`,
      [title, description || null, videoUrl, i + 1]
    );
    added += 1;
    console.log(`  + ${title}${description ? '  ('+ description + ')' : ''}`);
  }

  console.log(`Selesai. Ditambah: ${added} | Dilewati (sudah ada): ${skipped} | Total file: ${files.length}`);
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
