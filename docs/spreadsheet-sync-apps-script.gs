/**
 * Kelas Online Mr.BOB — Spreadsheet sync endpoint (Google Apps Script).
 *
 * Cara pasang:
 *   1. Buka Google Spreadsheet tujuan.
 *   2. Menu Extensions > Apps Script.
 *   3. Hapus isi default, tempel SELURUH kode di file ini, lalu Save.
 *   4. Klik Deploy > New deployment > pilih "Web app".
 *        - Execute as  : Me
 *        - Who has access : Anyone
 *   5. Deploy, izinkan akses, lalu SALIN "Web app URL" (berakhiran /exec).
 *   6. Tempel URL itu ke file .env aplikasi:  SHEET_WEBHOOK_URL=...
 *
 *   CATATAN: setiap kali kode ini diubah, lakukan Deploy ulang
 *   (Manage deployments > Edit > Version: New version).
 *
 * Menangani tiga jenis data (otomatis berdasarkan field "event"):
 *   - Pendaftaran / konfirmasi  -> tab "Pendaftaran" (1 baris per registration_code).
 *   - Available time tutor       -> tab "AvailableTime" (snapshot: semua baris milik
 *     tutor diganti tiap kali ada perubahan, jadi selalu sinkron dengan aplikasi).
 *   - Jadwal hasil plot          -> tab "Jadwal" (1 baris per schedule_id, upsert).
 */

var SHEET_NAME = 'Pendaftaran';
var REG_HEADERS = [
  'timestamp', 'event', 'registration_code', 'name', 'email', 'phone', 'city',
  'age', 'occupation', 'education_level', 'education_background', 'instagram',
  'program_type', 'selected_class', 'package_group', 'package_name', 'package_price',
  'duration', 'meeting_count', 'study_time', 'start_date', 'friend_name',
  'coupon_code', 'referral_code', 'payment_total', 'status', 'transfer_proof_url'
];

var AT_SHEET_NAME = 'AvailableTime';
var AT_HEADERS = [
  'synced_at', 'tutor_id', 'tutor_name', 'tutor_email', 'period_label', 'period_start',
  'day_category', 'day_label', 'custom_days', 'start_time', 'end_time', 'is_available'
];

var JADWAL_SHEET_NAME = 'Jadwal';
var JADWAL_HEADERS = [
  'synced_at', 'schedule_id', 'date', 'start_time', 'end_time', 'title', 'program_name',
  'tutor_name', 'tutor_email', 'location', 'meeting_link', 'status', 'member_count', 'member_names'
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.event === 'available_time') {
      return handleAvailableTime(data);
    }
    if (data.event === 'jadwal') {
      return handleSchedule(data);
    }
    return handleRegistration(data);
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Health check ketika URL dibuka di browser (GET).
function doGet() {
  return jsonOutput({ ok: true, service: 'Kelas Online Spreadsheet Sync' });
}

// ---- Pendaftaran: 1 baris per registration_code (upsert) ----
function handleRegistration(data) {
  var sheet = getSheet(SHEET_NAME, REG_HEADERS);
  var row = REG_HEADERS.map(function (key) {
    return data[key] !== undefined && data[key] !== null ? data[key] : '';
  });
  var codeCol = REG_HEADERS.indexOf('registration_code') + 1;
  var existingRow = findRowByValue(sheet, codeCol, data.registration_code);
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, REG_HEADERS.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return jsonOutput({ ok: true });
}

// ---- Available time: ganti semua baris milik tutor ini (snapshot) ----
function handleAvailableTime(data) {
  var sheet = getSheet(AT_SHEET_NAME, AT_HEADERS);
  var idCol = AT_HEADERS.indexOf('tutor_id') + 1;
  deleteRowsByValue(sheet, idCol, data.tutor_id);

  var slots = data.slots || [];
  var rows = slots.map(function (s) {
    return [
      data.timestamp, data.tutor_id, data.tutor_name, data.tutor_email,
      s.period_label, s.period_start, s.day_category, s.day_label,
      s.custom_days, s.start_time, s.end_time, s.is_available
    ];
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, AT_HEADERS.length).setValues(rows);
  }
  return jsonOutput({ ok: true, written: rows.length });
}

// ---- Jadwal hasil plot: 1 baris per schedule_id (upsert) ----
function handleSchedule(data) {
  var sheet = getSheet(JADWAL_SHEET_NAME, JADWAL_HEADERS);
  var row = [
    data.timestamp, data.schedule_id, data.date, data.start_time, data.end_time, data.title,
    data.program_name, data.tutor_name, data.tutor_email, data.location, data.meeting_link,
    data.status, data.member_count, data.member_names
  ];
  var idCol = JADWAL_HEADERS.indexOf('schedule_id') + 1;
  var existingRow = findRowByValue(sheet, idCol, data.schedule_id);
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, JADWAL_HEADERS.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return jsonOutput({ ok: true });
}

// ---- Helpers ----
function getSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRowByValue(sheet, col, value) {
  if (!value) return -1;
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var values = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(value)) return i + 2;
  }
  return -1;
}

function deleteRowsByValue(sheet, col, value) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var values = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(value)) sheet.deleteRow(i + 2);
  }
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
