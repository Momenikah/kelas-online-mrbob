// =============================================
// Available Time helpers (FluentForm "Available Time" parity)
// Mirrors the Fluent Forms tutor form: Periode + repeater of
// Jam Belajar (1-hour slot) + Hari (Weekdays/Weekend/Custom) + Custom days.
// Also expands category -> day_of_week so data stays compatible with the
// schedule CSV flow (see docs/schedule-available-time-flow.md).
// =============================================

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// 0 = Sunday ... 6 = Saturday (matches available_times.day_of_week convention)
const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// Hour slots exactly as defined in the Fluent Forms "Jam Belajar" dropdown.
const HOUR_SLOTS = [
  '07.00 WIB - 08.00 WIB', '08.00 WIB - 09.00 WIB', '09.00 WIB - 10.00 WIB',
  '10.00 WIB - 11.00 WIB', '11.00 WIB - 12.00 WIB', '12.00 WIB - 13.00 WIB',
  '13.00 WIB - 14.00 WIB', '14.00 WIB - 15.00 WIB', '15.00 WIB - 16.00 WIB',
  '16.00 WIB - 17.00 WIB', '17.00 WIB - 18.00 WIB', '18.00 WIB - 19.00 WIB',
  '19.00 WIB - 20.00 WIB', '20.00 WIB - 21.00 WIB', '21.00 WIB - 22.00 WIB',
];

const DAY_CATEGORIES = [
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekend', label: 'Weekend' },
  { value: 'custom', label: 'Custom' },
];

// Map both Indonesian and English day names to day_of_week index.
const DAY_LOOKUP = {
  minggu: 0, ahad: 0, sunday: 0, sun: 0,
  senin: 1, monday: 1, mon: 1,
  selasa: 2, tuesday: 2, tue: 2,
  rabu: 3, wednesday: 3, wed: 3,
  kamis: 4, thursday: 4, thu: 4,
  jumat: 5, "jum'at": 5, friday: 5, fri: 5,
  sabtu: 6, saturday: 6, sat: 6,
};

// "07.00 WIB - 08.00 WIB" -> { start_time: '07:00', end_time: '08:00' }
function parseSlot(jamBelajar) {
  if (!jamBelajar || typeof jamBelajar !== 'string') return null;
  const parts = jamBelajar.split('-').map((p) => p.trim());
  if (parts.length !== 2) return null;
  const toTime = (chunk) => {
    const m = chunk.match(/(\d{1,2})[.:](\d{2})/);
    if (!m) return null;
    return `${m[1].padStart(2, '0')}:${m[2]}`;
  };
  const start = toTime(parts[0]);
  const end = toTime(parts[1]);
  if (!start || !end) return null;
  return { start_time: start, end_time: end };
}

// '07:00' + '08:00' -> '07.00 WIB - 08.00 WIB' (rebuild the slot label for the UI)
function formatSlotLabel(start, end) {
  const fmt = (t) => String(t).substring(0, 5).replace(':', '.');
  return `${fmt(start)} WIB - ${fmt(end)} WIB`;
}

// Parse free-text custom day list ("Senin, Rabu, Jumat") -> sorted day_of_week ints.
function parseCustomDays(text) {
  if (!text) return [];
  const found = new Set();
  text
    .split(/[,;/]+|\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .forEach((token) => {
      if (token in DAY_LOOKUP) found.add(DAY_LOOKUP[token]);
    });
  return [...found].sort((a, b) => a - b);
}

// Category -> day_of_week list (used by CSV export & schedule validation).
function expandDays(category, customDays) {
  if (category === 'weekend') return [6, 0];
  if (category === 'custom') return parseCustomDays(customDays);
  return [1, 2, 3, 4, 5]; // weekdays (default)
}

// Human-readable day description for the UI.
function describeDays(category, customDays) {
  if (category === 'weekend') return 'Sabtu & Minggu';
  if (category === 'custom') {
    const days = parseCustomDays(customDays);
    if (days.length) return days.map((d) => DAY_NAMES_ID[d]).join(', ');
    return (customDays || '').trim() || '-';
  }
  return 'Senin - Jumat';
}

function categoryLabel(category) {
  const found = DAY_CATEGORIES.find((c) => c.value === category);
  return found ? found.label : 'Weekdays';
}

// Generate the weekly "Periode" options (every Monday) for a given year,
// matching the Fluent Forms dropdown that lists each week's start date.
function generatePeriods(year) {
  const periods = [];
  const cursor = new Date(year, 0, 1);
  // Advance to the first Monday of the year.
  while (cursor.getDay() !== 1) cursor.setDate(cursor.getDate() + 1);
  while (cursor.getFullYear() === year) {
    const dd = String(cursor.getDate()).padStart(2, '0');
    const mm = String(cursor.getMonth() + 1).padStart(2, '0');
    const iso = `${cursor.getFullYear()}-${mm}-${dd}`;
    const label = `${dd} ${MONTHS_ID[cursor.getMonth()]} ${cursor.getFullYear()}`;
    periods.push({ value: iso, label });
    cursor.setDate(cursor.getDate() + 7);
  }
  return periods;
}

// ISO date (YYYY-MM-DD) of the Monday that starts the current week — used to
// preselect the running period in the form.
function currentPeriodValue(today = new Date()) {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = monday.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);
  const dd = String(monday.getDate()).padStart(2, '0');
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  return `${monday.getFullYear()}-${mm}-${dd}`;
}

// Any date-ish value -> 'YYYY-MM-DD' using local components (no UTC shift).
function toISODate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Snap any date to the Monday that starts its week (periods are weekly).
function mondayOf(value) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}

// ISO date -> Indonesian "DD MMMM YYYY" label (for displaying stored periods).
function formatPeriodLabel(isoDate) {
  if (!isoDate) return '-';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return String(isoDate);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
}

// ISO date (Monday) -> weekly range label, e.g. "06–12 Juli 2026" or
// "29 Juni – 05 Juli 2026". Periods are weekly (Mon–Sun) so this reads clearer
// than a single date in filter dropdowns.
function formatPeriodRange(isoDate) {
  if (!isoDate) return '-';
  const start = new Date(isoDate);
  if (Number.isNaN(start.getTime())) return String(isoDate);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const dd = (d) => String(d.getDate()).padStart(2, '0');
  if (start.getMonth() === end.getMonth()) {
    return `${dd(start)}–${dd(end)} ${MONTHS_ID[start.getMonth()]} ${start.getFullYear()}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  const left = `${dd(start)} ${MONTHS_ID[start.getMonth()]}${sameYear ? '' : ` ${start.getFullYear()}`}`;
  const right = `${dd(end)} ${MONTHS_ID[end.getMonth()]} ${end.getFullYear()}`;
  return `${left} – ${right}`;
}

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ISO date -> American English "Month D, YYYY" label (untuk sertifikat & personal report).
function formatPeriodLabelEN(isoDate) {
  if (!isoDate) return '-';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return String(isoDate);
  return `${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Daftar Senin mulai dari minggu berjalan hingga `months` bulan ke depan —
// dipakai form pendaftaran agar pilihan tanggal selalu bergulir otomatis (tiap
// Senin, tiap bulan) tanpa perlu di-hardcode. Hasil: [{ value:ISO, label:'DD MMMM YYYY' }].
function upcomingMondays(months = 6, today = new Date()) {
  const start = new Date(currentPeriodValue(today)); // Senin minggu ini
  const limit = new Date(start);
  limit.setMonth(limit.getMonth() + months);
  const out = [];
  const cursor = new Date(start);
  while (cursor <= limit) {
    const iso = toISODate(cursor);
    out.push({ value: iso, label: formatPeriodLabel(iso) });
    cursor.setDate(cursor.getDate() + 7);
  }
  return out;
}

module.exports = {
  MONTHS_ID,
  DAY_NAMES_ID,
  HOUR_SLOTS,
  DAY_CATEGORIES,
  parseSlot,
  formatSlotLabel,
  parseCustomDays,
  expandDays,
  describeDays,
  categoryLabel,
  generatePeriods,
  currentPeriodValue,
  formatPeriodLabel,
  formatPeriodRange,
  formatPeriodLabelEN,
  toISODate,
  mondayOf,
  upcomingMondays,
};
