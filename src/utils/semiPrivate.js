// =============================================
// Kelas SEMI PRIVATE dibuka 2 MINGGU SEKALI, bukan tiap minggu seperti kelas lain.
// Periode yang boleh dipilih = Senin berjarak kelipatan 14 hari dari tanggal acuan.
// Acuan 13 Juli 2026 dipilih agar bulan Juli jatuh pada 13 & 27 (permintaan admin).
// =============================================

const { MONTHS_ID } = require('./availableTime');

const SEMI_PRIVATE_ANCHOR = '2026-07-13';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Terima 'YYYY-MM-DD' (atau Date) -> true bila tanggal itu jadwal buka semi private.
function isSemiPrivateStart(value, anchor = SEMI_PRIVATE_ANCHOR) {
  if (!value) return false;
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const a = Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7) - 1, +anchor.slice(8, 10));
  // Modulo yang aman untuk tanggal sebelum acuan (hasil negatif dinormalkan).
  return ((Math.round((d - a) / MS_PER_DAY) % 14) + 14) % 14 === 0;
}

// Form pendaftaran mengirim tanggal sebagai teks Indonesia ("13 Juli 2026"),
// bukan ISO. Terima keduanya supaya validasi bisa dipakai di kedua form.
function isSemiPrivateStartLabel(text, anchor = SEMI_PRIVATE_ANCHOR) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return isSemiPrivateStart(s, anchor);
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return false;
  const idx = MONTHS_ID.findIndex((n) => n.toLowerCase() === m[2].toLowerCase());
  if (idx < 0) return false;
  const iso = `${m[3]}-${String(idx + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return isSemiPrivateStart(iso, anchor);
}

// Saring daftar periode [{ value, label }] menjadi jadwal semi private saja.
function filterSemiPrivatePeriods(periods = []) {
  return periods.filter((p) => isSemiPrivateStart(p && p.value));
}

module.exports = {
  SEMI_PRIVATE_ANCHOR, isSemiPrivateStart, isSemiPrivateStartLabel, filterSemiPrivatePeriods,
};
