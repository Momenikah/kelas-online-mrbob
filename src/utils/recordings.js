// Recording kelas: video rekaman yang diunggah admin, khusus member Luxury Class.
// Tabel dibuat saat boot (pola yang sama dengan util lain), jadi tidak perlu migrasi manual.

const ensureRecordingsTable = async (query) => {
  await query(`
    CREATE TABLE IF NOT EXISTS recordings (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      video_url VARCHAR(500) NOT NULL,
      recorded_date DATE,
      duration VARCHAR(20),
      program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
      order_number INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
};

// Admin biasanya menempel link YouTube/Drive/Vimeo apa adanya dari address bar.
// Link seperti itu tidak bisa dipakai di <iframe>, jadi diubah ke bentuk embed dulu.
const toEmbedUrl = (rawUrl) => {
  const url = String(rawUrl || '').trim();
  if (!url) return '';

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return url; // bukan URL utuh — biarkan, validasi di controller yang menolak
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

  // YouTube: watch?v=ID, youtu.be/ID, /live/ID, /shorts/ID
  if (host === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return id ? withStart(`https://www.youtube.com/embed/${id}`, parsed) : url;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname.startsWith('/embed/')) return url;
    const vParam = parsed.searchParams.get('v');
    if (vParam) return withStart(`https://www.youtube.com/embed/${vParam}`, parsed);
    const match = parsed.pathname.match(/^\/(?:live|shorts|v)\/([^/]+)/);
    if (match) return withStart(`https://www.youtube.com/embed/${match[1]}`, parsed);
    return url;
  }

  // Google Drive: /file/d/ID/view -> /file/d/ID/preview
  if (host === 'drive.google.com') {
    const match = parsed.pathname.match(/^\/file\/d\/([^/]+)/);
    if (match) return `https://drive.google.com/file/d/${match[1]}/preview`;
    return url;
  }

  // Vimeo: vimeo.com/ID -> player.vimeo.com/video/ID
  if (host === 'vimeo.com') {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    return url;
  }

  return url;
};

// Pertahankan detik mulai (?t=90 / ?start=90) supaya link "mulai dari menit X" tetap jalan.
const withStart = (embedUrl, parsed) => {
  const raw = parsed.searchParams.get('start') || parsed.searchParams.get('t');
  if (!raw) return embedUrl;
  const seconds = parseTimeParam(raw);
  return seconds ? `${embedUrl}?start=${seconds}` : embedUrl;
};

const parseTimeParam = (raw) => {
  const value = String(raw).trim();
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match || !match.slice(1).some(Boolean)) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
};

const isSupportedUrl = (rawUrl) => {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (err) {
    return false;
  }
};

module.exports = { ensureRecordingsTable, toEmbedUrl, isSupportedUrl };
