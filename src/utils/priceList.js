// =============================================
// Package price catalog per program/class.
// Single source of truth for package prices, shared by the renewal form (and
// available for the registration form). Keyed by class name; each package has
// { name, price, duration, meetings, note? }.
// =============================================

const vipPackages = [
  { name: 'VIP', price: 980000, duration: '2 MINGGU', meetings: 10 },
  { name: 'VIP GOLD', price: 1450000, duration: '2 MINGGU', meetings: 10, note: 'DURASI WAKTU PER KELAS 90 MENIT' },
  { name: 'VIP PLATINUM', price: 1750000, duration: '2 MINGGU', meetings: 10, note: 'DURASI WAKTU PER KELAS 120 MENIT' },
  { name: '1 BULAN - VIP', price: 1800000, duration: '1 BULAN', meetings: 20 },
  { name: '2 BULAN - VIP', price: 3500000, duration: '2 BULAN', meetings: 40 },
  { name: '3X - VIP', price: 1150000, duration: '1 BULAN', meetings: 12 },
  { name: '2X - VIP WEEKEND', price: 950000, duration: '1 BULAN', meetings: 8 },
  { name: '2X - VIP WEEKDAY', price: 850000, duration: '1 BULAN', meetings: 8 },
];

const luxuryPackage = {
  name: 'LUXURY CLASS', price: 1500000, duration: '2 MINGGU', meetings: 10,
  note: 'Benefit: pilih tutor grade A, Video Premium, dan Test TOEFL gratis.',
};

const privatePackages = [
  { name: 'PRIVATE', price: 695000, duration: '2 MINGGU', meetings: 10 },
  { name: '3X - PRIVATE', price: 800000, duration: '1 BULAN', meetings: 12, note: 'HARUS MENDAFTAR DENGAN TEMAN (2-3 ORANG)' },
  { name: '2X - PRIVATE WEEKEND', price: 675000, duration: '1 BULAN', meetings: 8, note: 'HARUS MENDAFTAR DENGAN TEMAN (2-3 ORANG)' },
  { name: '2X - PRIVATE WEEKDAY', price: 575000, duration: '1 BULAN', meetings: 8, note: 'HARUS MENDAFTAR DENGAN TEMAN (2-3 ORANG)' },
  { name: 'BTS', price: 880000, duration: '2 MINGGU', meetings: 10, note: 'HARUS MENDAFTAR 2 ORANG' },
  { name: '1 BULAN - BTS', price: 1660000, duration: '1 BULAN', meetings: 20, note: 'HARUS MENDAFTAR 2 ORANG' },
];

const fullPrivatePackages = [
  { name: 'PRIVATE', price: 695000, duration: '2 MINGGU', meetings: 10 },
  { name: '1 BULAN - PRIVATE', price: 1250000, duration: '1 BULAN', meetings: 20 },
  ...privatePackages.slice(1),
];

// BTS + group-private options offered by every adult program except TOEFL/IELTS.
// Same jam belajar as VIP; excludes the standalone 2-minggu PRIVATE package.
const btsPrivatePackages = privatePackages.slice(1);

const kidsPackages = [
  ...vipPackages,
  { name: 'PRIVATE', price: 695000, duration: '2 MINGGU', meetings: 10, note: 'HANYA LEVEL 1-2' },
  { name: '1 BULAN - PRIVATE', price: 1250000, duration: '1 BULAN', meetings: 20, note: 'HANYA LEVEL 1-2' },
  { name: '3X - PRIVATE', price: 800000, duration: '1 BULAN', meetings: 12, note: 'HARUS MENDAFTAR DENGAN TEMAN (2-3 ORANG)' },
  { name: '2X - PRIVATE WEEKEND', price: 675000, duration: '1 BULAN', meetings: 8, note: 'HARUS MENDAFTAR DENGAN TEMAN (2-3 ORANG)' },
  { name: '2X - PRIVATE WEEKDAY', price: 575000, duration: '1 BULAN', meetings: 8, note: 'HARUS MENDAFTAR DENGAN TEMAN (2-3 ORANG)' },
  { name: 'BTS', price: 880000, duration: '2 MINGGU', meetings: 10, note: 'HARUS MENDAFTAR 2 ORANG' },
  { name: '1 BULAN - BTS', price: 1660000, duration: '1 BULAN', meetings: 20, note: 'HARUS MENDAFTAR 2 ORANG' },
];

// For TOEFL/IELTS the shorter packages (2 minggu, 2X, 3X) only cover one test
// section, so they carry this note. Appended to any existing note.
const BIDANG_UJI_NOTE = 'Hanya bisa memilih salah satu bidang uji';
const addUjiNote = (pkgs, names) => pkgs.map((p) => (
  names.includes(p.name)
    ? { ...p, note: p.note ? `${p.note}. ${BIDANG_UJI_NOTE}` : BIDANG_UJI_NOTE }
    : p
));
const TOEFL_UJI = ['VIP', 'VIP GOLD', 'VIP PLATINUM', '3X - VIP', '2X - VIP WEEKEND', '2X - VIP WEEKDAY'];
const IELTS_UJI = ['IELTS', 'IELTS 3X', 'IELTS 2X WEEKDAY', 'IELTS 2X WEEKEND'];

// IELTS carries a higher-priced Luxury Class than the standard programs.
const ieltsLuxuryPackage = { ...luxuryPackage, price: 1650000 };

const ieltsPackages = [
  { name: 'IELTS', price: 1100000, duration: '2 MINGGU', meetings: 10 },
  { name: 'IELTS 3X', price: 1700000, duration: '1 BULAN', meetings: 12 },
  { name: 'IELTS 2X WEEKDAY', price: 1200000, duration: '1 BULAN', meetings: 8 },
  { name: 'IELTS 2X WEEKEND', price: 1300000, duration: '1 BULAN', meetings: 8 },
  { name: 'IELTS 1 BULAN', price: 2750000, duration: '1 BULAN', meetings: 20 },
  { name: 'IELTS 2 BULAN', price: 4750000, duration: '2 BULAN', meetings: 40 },
  { name: 'IELTS 3 BULAN', price: 6750000, duration: '3 BULAN', meetings: 60 },
];

const PRICE_LIST = {
  'WALKY TALKY': [luxuryPackage, ...vipPackages, ...btsPrivatePackages],
  'SPEAK UP 1': [luxuryPackage, ...vipPackages, ...fullPrivatePackages, { name: 'SEMI - PRIVATE', price: 395000, duration: '2 MINGGU', meetings: 10, note: 'HANYA JAM 19.00 WIB' }],
  'SPEAK UP 2': [luxuryPackage, ...vipPackages, ...privatePackages],
  'SPEAK UP 3': [luxuryPackage, ...vipPackages, ...btsPrivatePackages],
  'SPEAK UP 100': [luxuryPackage, ...vipPackages, ...btsPrivatePackages],
  'GRAND SPEAKING': [luxuryPackage, ...vipPackages, ...btsPrivatePackages],
  'SPEAKING FOR SPECIFIC PURPOSES': [luxuryPackage, ...vipPackages, ...btsPrivatePackages],
  'CAREER CLINIC': [luxuryPackage, ...vipPackages, ...btsPrivatePackages],
  'GRAMMAR': [luxuryPackage, ...vipPackages, ...privatePackages],
  'TOEFL': [luxuryPackage, ...addUjiNote(vipPackages, TOEFL_UJI)],
  'IELTS': [ieltsLuxuryPackage, ...addUjiNote(ieltsPackages, IELTS_UJI)],
  'SMART KIDS': [luxuryPackage, ...kidsPackages],
  'SUPER KIDS': [luxuryPackage, ...kidsPackages],
  'GENIUS TEEN': [luxuryPackage, ...kidsPackages],
};

// DB program-name variants that map onto a catalog key.
const PROGRAM_ALIASES = {
  'toefl preparation': 'TOEFL',
  'ielts mastery': 'IELTS',
  'english conversation': 'WALKY TALKY',
};

// Resolve the package list for a given programs-table name.
const packagesForProgram = (programName) => {
  const raw = String(programName || '').trim();
  if (!raw) return [];
  if (PRICE_LIST[raw]) return PRICE_LIST[raw];
  const key = raw.toLowerCase();
  const ci = Object.keys(PRICE_LIST).find((k) => k.toLowerCase() === key);
  if (ci) return PRICE_LIST[ci];
  if (PROGRAM_ALIASES[key]) return PRICE_LIST[PROGRAM_ALIASES[key]];
  // Sensible default so a total can always be shown.
  return [luxuryPackage, ...vipPackages];
};

// BTS / group-private packages are priced PER PERSON and require registering with
// friends. Returns the allowed headcount { min, max } from the package note, or
// null when the package is not a group package.
//   "HARUS MENDAFTAR 2 ORANG"            -> exactly 2 (BTS)
//   "HARUS MENDAFTAR DENGAN TEMAN (2-3 ORANG)" -> 2 or 3 (Private)
const groupSizeBounds = (note) => {
  const n = String(note || '');
  if (!n.includes('HARUS MENDAFTAR')) return null;
  return n.includes('2-3') ? { min: 2, max: 3 } : { min: 2, max: 2 };
};

module.exports = { PRICE_LIST, packagesForProgram, groupSizeBounds };
