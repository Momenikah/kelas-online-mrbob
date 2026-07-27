// =============================================
// Meta Pixel + Conversions API (CAPI).
// Dua jalur mengirim event yang sama ke Meta:
//   1. Browser Pixel (fbq) — dipasang di partials/head.ejs.
//   2. Conversions API — dari server (file ini), lebih tahan ad-blocker.
// Keduanya memakai event_id yang sama agar Meta men-deduplikasi (tidak dihitung 2x).
//
// Konfigurasi (.env, TIDAK di-commit):
//   META_PIXEL_ID    = 437257375443216
//   META_CAPI_TOKEN  = <access token Conversions API>
//   META_TEST_EVENT_CODE = TESTxxxxx (opsional; hanya untuk uji di Events Manager)
// =============================================

const crypto = require('crypto');

const GRAPH_VERSION = 'v19.0';

const pixelId = () => String(process.env.META_PIXEL_ID || '').trim();
const capiToken = () => String(process.env.META_CAPI_TOKEN || '').trim();
const testEventCode = () => String(process.env.META_TEST_EVENT_CODE || '').trim();

// Pixel dianggap aktif bila ID ada (browser Pixel bisa jalan tanpa token).
const isPixelEnabled = () => Boolean(pixelId());
// CAPI butuh ID + token.
const isCapiEnabled = () => Boolean(pixelId() && capiToken());

// SHA-256 (hex) dari nilai yang sudah dinormalkan; Meta mensyaratkan PII di-hash.
function hashField(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  return crypto.createHash('sha256').update(v).digest('hex');
}

// Nomor telepon -> hanya digit, awalan 0 diganti 62 (format Indonesia/E.164).
function normalizePhone(phone) {
  let p = String(phone || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('0')) p = `62${p.slice(1)}`;
  else if (p.startsWith('8')) p = `62${p}`;
  return p;
}

// Ambil cookie _fbp / _fbc yang ditanam browser Pixel — memperkuat pencocokan.
function readFbCookies(req) {
  const raw = (req && req.headers && req.headers.cookie) || '';
  const out = {};
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    if (k === '_fbp' || k === '_fbc') out[k] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function clientIp(req) {
  if (!req) return undefined;
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.ip || (req.socket && req.socket.remoteAddress) || undefined;
}

// Susun user_data untuk CAPI dari data yang kita punya + sinyal dari request.
function buildUserData(req, { email, phone } = {}) {
  const ud = {};
  const em = hashField(email);
  if (em) ud.em = [em];
  const ph = hashField(normalizePhone(phone));
  if (ph) ud.ph = [ph];
  const cookies = readFbCookies(req);
  if (cookies._fbp) ud.fbp = cookies._fbp;
  if (cookies._fbc) ud.fbc = cookies._fbc;
  const ip = clientIp(req);
  if (ip) ud.client_ip_address = ip;
  const ua = req && req.headers && req.headers['user-agent'];
  if (ua) ud.client_user_agent = ua;
  return ud;
}

// Titipkan event agar browser Pixel menembakkannya di halaman berikutnya (setelah
// redirect). Dirender & dibersihkan di partials/head.ejs. event_id dibagi dgn CAPI.
function queueBrowserEvent(req, event) {
  if (!isPixelEnabled() || !req || !req.session) return;
  if (!Array.isArray(req.session.pixelEvents)) req.session.pixelEvents = [];
  req.session.pixelEvents.push(event);
}

// Kirim satu event lewat Conversions API. Fire-and-forget: error hanya dicatat,
// tidak pernah menggagalkan alur pengguna (pendaftaran/konfirmasi tetap jalan).
async function sendServerEvent({
  eventName, eventId, eventSourceUrl, actionSource = 'website',
  userData = {}, customData = {},
} = {}) {
  if (!isCapiEnabled()) return { skipped: true };
  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: actionSource,
      ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
      user_data: userData,
      custom_data: customData,
    }],
  };
  if (testEventCode()) payload.test_event_code = testEventCode();

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId()}/events?access_token=${encodeURIComponent(capiToken())}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body && body.error ? body.error.message : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return { ok: true, body };
  } finally {
    clearTimeout(timer);
  }
}

function fullUrl(req) {
  try {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
    return `${proto}://${req.get('host')}${req.originalUrl}`;
  } catch (_) {
    return undefined;
  }
}

module.exports = {
  isPixelEnabled,
  isCapiEnabled,
  pixelId,
  buildUserData,
  queueBrowserEvent,
  sendServerEvent,
  fullUrl,
  newEventId: () => crypto.randomUUID(),
};
