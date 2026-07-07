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
 * Satu file ini menangani SEMUA event (routing otomatis via field "event").
 * Boleh ditempel sama persis di beberapa spreadsheet terpisah — tiap spreadsheet
 * hanya menerima event yang diarahkan ke URL Web App-nya lewat env var, jadi tidak
 * saling tabrakan.
 *   - Pendaftaran / konfirmasi     -> tab "Pendaftaran"   (1 baris per registration_code)
 *   - Available time tutor          -> tab "AvailableTime" (snapshot per tutor_id)
 *   - Jadwal hasil plot             -> tab "Jadwal"        (1 baris per schedule_id, upsert)
 *   - Sertifikat + Personal Report  -> tab "Sertifikat"    (1 baris per certificate_id, upsert)
 *   - Renewal                       -> tab "Renewal"       (1 baris per renewal_id, upsert)
 * Selain itu, doGet melayani import "Master Jadwal" (dipakai SCHEDULE_SOURCE_URL).
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

var SERTIFIKAT_SHEET_NAME = 'Sertifikat';
var SERTIFIKAT_HEADERS = [
  'timestamp', 'certificate_id', 'certificate_number', 'issued_date', 'title',
  'member_name', 'member_email', 'program_name', 'program_label', 'tutor_name',
  'period_label', 'category', 'grade', 'status',
  'speaking_score', 'pronunciation_score', 'vocabulary_score', 'grammar_score',
  'understanding_score', 'cefr_score', 'listening_score', 'structure_score',
  'reading_score', 'writing_score', 'total_score',
  'improvement_before', 'improvement_after', 'print_url'
];

var RENEWAL_SHEET_NAME = 'Renewal';
var RENEWAL_HEADERS = [
  'timestamp', 'renewal_id', 'request_type', 'member_name', 'member_email', 'phone',
  'program_name', 'selected_class', 'package_name', 'package_price',
  'preferred_start_date', 'study_time', 'status', 'notes', 'transfer_proof_url'
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
    if (data.event === 'sertifikat') {
      return handleUpsert(data, SERTIFIKAT_SHEET_NAME, SERTIFIKAT_HEADERS, 'certificate_id');
    }
    if (data.event === 'renewal') {
      return handleUpsert(data, RENEWAL_SHEET_NAME, RENEWAL_HEADERS, 'renewal_id');
    }
    return handleRegistration(data);
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---- INBOUND: app menarik master jadwal (Sheet = sumber kebenaran) ----
// Aplikasi memanggil GET URL ini (SCHEDULE_SOURCE_URL) dan menerima seluruh baris
// tab "Master Jadwal" sebagai JSON. Kolom header (baris 1):
//   id, tutor_email, program_name, title, date, start_time, end_time,
//   location, meeting_link, notes, member_emails
var MASTER_SHEET_NAME = 'Master Jadwal';

function doGet(e) {
  if (e && e.parameter && e.parameter.ping) {
    return jsonOutput({ ok: true, service: 'Kelas Online Spreadsheet Sync' });
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
    if (!sheet) return jsonOutput({ ok: true, rows: [] });
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return jsonOutput({ ok: true, rows: [] });

    var tz = ss.getSpreadsheetTimeZone();
    var headers = values[0].map(function (h) {
      return String(h).trim().toLowerCase().replace(/\s+/g, '_');
    });

    var rows = [];
    for (var i = 1; i < values.length; i++) {
      var raw = values[i];
      var allBlank = raw.every(function (c) { return String(c).trim() === ''; });
      if (allBlank) continue;
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = formatMasterCell(headers[j], raw[j], tz);
      }
      if (String(obj.id || '').trim() === '') continue; // baris tanpa ID diabaikan
      rows.push(obj);
    }
    return jsonOutput({ ok: true, rows: rows });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

// Ubah cell Date/waktu menjadi string yang stabil (hindari ambiguitas timezone).
function formatMasterCell(header, value, tz) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (header === 'date') return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    if (header === 'start_time' || header === 'end_time') return Utilities.formatDate(value, tz, 'HH:mm');
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  return value;
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

// ---- Generic upsert by an id column (dipakai Sertifikat & Renewal) ----
function handleUpsert(data, sheetName, headers, idKey) {
  var sheet = getSheet(sheetName, headers);
  var row = headers.map(function (key) {
    return data[key] !== undefined && data[key] !== null ? data[key] : '';
  });
  var idCol = headers.indexOf(idKey) + 1;
  var existingRow = findRowByValue(sheet, idCol, data[idKey]);
  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, headers.length).setValues([row]);
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
