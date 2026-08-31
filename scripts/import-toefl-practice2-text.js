// =============================================
// Isi teks soal + opsi "TOEFL Practice Test 2" dari dua file .docx di root repo:
//   - "TOEFL Parctice 2 _ listening.docx"  -> section listening (soal 1-50)
//   - "TOEFL Practice 2 _ Reading.docx"    -> section reading  (soal 1-50)
// Kunci jawaban TIDAK disentuh (sudah diisi seed-toefl-practice2-key.js);
// script ini hanya UPDATE prompt/opsi, jadi aman dijalankan berulang.
// Section "structure" tidak punya file sumber, jadi dilewati.
//   node -r dotenv/config scripts/import-toefl-practice2-text.js
// =============================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pool, query } = require('../src/config/database');
const { ensureToeflTables } = require('../src/utils/toefl');

const TITLE = 'TOEFL Practice Test 2';
const ROOT = path.join(__dirname, '..');
const LISTENING_DOCX = path.join(ROOT, 'TOEFL Parctice 2 _ listening.docx');
const READING_DOCX = path.join(ROOT, 'TOEFL Practice 2 _ Reading.docx');

// --- Pembaca .docx minimal ---------------------------------------------------
// .docx = arsip zip. Header lokal kadang tidak memuat ukuran (streamed), jadi
// ukuran diambil dari central directory yang selalu terisi.
const readDocxXml = (file) => {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Bukan file zip/docx yang valid: ' + file);
  let ptr = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i += 1) {
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString();
    if (name === 'word/document.xml') {
      const method = buf.readUInt16LE(ptr + 10);
      const compSize = buf.readUInt32LE(ptr + 20);
      const localOff = buf.readUInt32LE(ptr + 42);
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.slice(start, start + compSize);
      return method === 8 ? zlib.inflateRawSync(raw).toString('utf8') : raw.toString('utf8');
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('word/document.xml tidak ditemukan di ' + file);
};

const xmlToLines = (xml) => xml
  // Buang objek gambar dulu: kalau tidak, atribut id-nya (mis. "333375260649")
  // ikut terbaca sebagai teks dan menempel di akhir prompt.
  .replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, '')
  .replace(/<w:pict>[\s\S]*?<\/w:pict>/g, '')
  .replace(/<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>/g, '')
  .replace(/<\/w:p>/g, '\n')
  .replace(/<w:br\s*\/>/g, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .split('\n')
  .map((l) => l.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

// --- Parser umum -------------------------------------------------------------
// Dokumen sumber sesekali salah ketik kurungnya (mis. "{B)" pada reading no. 46),
// jadi penanda opsi diterima dengan kurung apa pun.
const OPTION_RE = /^[([{]([A-D])[)\]}]\s*(.*)$/;
const OPTION_MARK = /[([{][A-D][)\]}]/g;

// Kalau satu baris memuat lebih dari satu penanda opsi (akibat salah ketik atau
// baris yang menyatu), pecah dulu supaya tiap opsi berdiri sendiri.
const splitOptionSegments = (line) => {
  const idx = [];
  let m;
  OPTION_MARK.lastIndex = 0;
  while ((m = OPTION_MARK.exec(line)) !== null) idx.push(m.index);
  if (idx.length <= 1) return [line];
  const out = [];
  if (idx[0] > 0) out.push(line.slice(0, idx[0]));
  for (let i = 0; i < idx.length; i += 1) {
    out.push(line.slice(idx[i], i + 1 < idx.length ? idx[i + 1] : undefined));
  }
  return out.map((s) => s.trim()).filter(Boolean);
};

// Kumpulkan soal bernomor beserta 4 opsinya. Nomor harus muncul berurutan supaya
// contoh soal di bagian Directions (yang juga berformat "(A) ...") tidak terbaca.
const parseQuestions = (lines, expectedTotal) => {
  const questions = [];
  let current = null;
  let expected = 1;
  let lastOpt = null;

  const takeLine = (line) => {
    const m = line.match(OPTION_RE);
    if (m) {
      const slot = m[1].toLowerCase();
      if (current[slot]) return; // slot sudah terisi -> baris contoh, abaikan
      current[slot] = m[2];
      lastOpt = slot;
      return;
    }
    if (lastOpt && current[lastOpt]) {
      current[lastOpt] += ' ' + line; // opsi yang terpotong ke baris berikutnya
    } else if (!current.a) {
      current.prompt = current.prompt ? current.prompt + ' ' + line : line;
    }
  };

  for (const line of lines) {
    const numMatch = line.match(/^(\d+)\.\s*(.*)$/);
    if (numMatch && Number(numMatch[1]) === expected && expected <= expectedTotal) {
      lastOpt = null;
      current = { number: expected, prompt: '', a: '', b: '', c: '', d: '' };
      questions.push(current);
      expected += 1;
      if (numMatch[2]) splitOptionSegments(numMatch[2]).forEach(takeLine);
      continue;
    }
    if (!current) continue;
    if (current.d) continue; // soal lengkap, tunggu nomor berikutnya
    splitOptionSegments(line).forEach(takeLine);
  }
  return questions;
};

// --- Listening ---------------------------------------------------------------
// Pertanyaannya diputar lewat audio, bukan ditulis — dokumen hanya memuat opsi.
const parseListening = () => {
  const lines = xmlToLines(readDocxXml(LISTENING_DOCX));
  const questions = parseQuestions(lines, 50);
  const partOf = (n) => (n <= 30 ? 'Part A' : n <= 38 ? 'Part B' : 'Part C');
  return questions.map((q) => Object.assign({}, q, { part: partOf(q.number) }));
};

// --- Reading -----------------------------------------------------------------
// Dokumen dibagi per bacaan lewat penanda "QUESTIONS n- m".
const parseReading = () => {
  const lines = xmlToLines(readDocxXml(READING_DOCX));
  const startIdx = lines.findIndex((l) => /^QUESTIONS\s+\d+/i.test(l));
  if (startIdx < 0) throw new Error('Penanda "QUESTIONS n- m" tidak ditemukan di file reading.');

  const blocks = [];
  let block = null;
  for (const line of lines.slice(startIdx)) {
    const head = line.match(/^QUESTIONS\s+(\d+)\s*-\s*(\d+)/i);
    if (head) {
      block = { from: Number(head[1]), to: Number(head[2]), body: [], qLines: [] };
      blocks.push(block);
      continue;
    }
    if (!block) continue;
    const firstQ = new RegExp('^' + block.from + '\\.\\s');
    if (block.qLines.length === 0 && !firstQ.test(line)) {
      block.body.push(line); // masih bagian teks bacaan
    } else {
      block.qLines.push(line);
    }
  }

  return blocks.map((b) => {
    // parseQuestions selalu mulai dari 1, jadi nomor blok digeser dulu.
    const shifted = b.qLines.map((l) => l.replace(/^(\d+)\./, (mm, n) => (Number(n) - b.from + 1) + '.'));
    const parsed = parseQuestions(shifted, b.to - b.from + 1);
    return {
      label: 'Questions ' + b.from + '-' + b.to,
      body: b.body.join(' '),
      from: b.from,
      to: b.to,
      questions: parsed.map((q) => Object.assign({}, q, { number: q.number + b.from - 1 })),
    };
  });
};

// --- Tulis ke database -------------------------------------------------------
(async () => {
  await ensureToeflTables(query);
  const sim = (await query('SELECT id FROM toefl_simulations WHERE title = $1', [TITLE])).rows[0];
  if (!sim) {
    console.error('Simulasi "' + TITLE + '" belum ada. Jalankan seed-toefl-practice2-shell.js lalu seed-toefl-practice2-key.js.');
    await pool.end();
    process.exit(1);
  }

  // ---- Listening ----
  const listening = parseListening();
  const partIds = {};
  (await query("SELECT id, label FROM toefl_passages WHERE simulation_id = $1 AND section = 'listening'", [sim.id]))
    .rows.forEach((p) => { partIds[p.label] = p.id; });

  let lisUpdated = 0;
  for (const q of listening) {
    const r = await query(
      'UPDATE toefl_questions'
      + ' SET prompt = $1, option_a = $2, option_b = $3, option_c = $4, option_d = $5,'
      + '     passage_id = COALESCE($6, passage_id)'
      + " WHERE simulation_id = $7 AND section = 'listening' AND number = $8",
      [q.prompt, q.a, q.b, q.c, q.d, partIds[q.part] || null, sim.id, q.number]
    );
    lisUpdated += r.rowCount;
  }

  // ---- Reading ----
  const readingBlocks = parseReading();
  let readUpdated = 0;
  let order = 0;
  for (const block of readingBlocks) {
    order += 1;
    let passage = (await query(
      "SELECT id FROM toefl_passages WHERE simulation_id = $1 AND section = 'reading' AND label = $2",
      [sim.id, block.label]
    )).rows[0];
    if (passage) {
      await query('UPDATE toefl_passages SET body = $1, order_number = $2 WHERE id = $3', [block.body, order, passage.id]);
    } else {
      passage = (await query(
        "INSERT INTO toefl_passages (simulation_id, section, label, body, order_number) VALUES ($1,'reading',$2,$3,$4) RETURNING id",
        [sim.id, block.label, block.body, order]
      )).rows[0];
    }
    for (const q of block.questions) {
      const r = await query(
        'UPDATE toefl_questions'
        + ' SET prompt = $1, option_a = $2, option_b = $3, option_c = $4, option_d = $5, passage_id = $6'
        + " WHERE simulation_id = $7 AND section = 'reading' AND number = $8",
        [q.prompt, q.a, q.b, q.c, q.d, passage.id, sim.id, q.number]
      );
      readUpdated += r.rowCount;
    }
  }

  console.log('Listening : ' + listening.length + ' soal terbaca, ' + lisUpdated + ' terisi.');
  console.log('Reading   : ' + readingBlocks.length + ' bacaan, '
    + readingBlocks.reduce((n, b) => n + b.questions.length, 0) + ' soal terbaca, ' + readUpdated + ' terisi.');
  console.log('Structure : dilewati (tidak ada file sumber).');

  const blank = await query(
    'SELECT section, COUNT(*)::int n FROM toefl_questions'
    + " WHERE simulation_id = $1 AND (option_a IS NULL OR option_a = '')"
    + ' GROUP BY section ORDER BY section',
    [sim.id]
  );
  console.log('Soal tanpa opsi:', blank.rows.length ? blank.rows : 'tidak ada');
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
