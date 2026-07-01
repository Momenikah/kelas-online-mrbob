// =============================================
// Foto/bukti kelas per sesi — tutor maupun member dapat mengunggah gambar
// dokumentasi kelas untuk sebuah jadwal. Semua peserta sesi dapat melihatnya.
// =============================================

async function ensureClassProofTable(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS class_proofs (
      id SERIAL PRIMARY KEY,
      schedule_id INTEGER REFERENCES schedules(id) ON DELETE CASCADE,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploader_role VARCHAR(20),
      uploader_name VARCHAR(255),
      image VARCHAR(500) NOT NULL,
      caption VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

module.exports = { ensureClassProofTable };
