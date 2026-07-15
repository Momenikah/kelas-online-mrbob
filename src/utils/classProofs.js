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
  // Nomor pertemuan supaya galeri bisa dikelompokkan per pertemuan — sebelumnya
  // tutor/member menulisnya manual di caption ("Day 1", "meeting ke 8", dst).
  await query(`ALTER TABLE class_proofs ADD COLUMN IF NOT EXISTS meeting_number INTEGER`);
}

// Kelompokkan foto menjadi [{ meeting, items[] }] — pertemuan bernomor lebih dulu
// (urut naik), lalu foto lama yang belum punya nomor di bagian "Lainnya" (meeting=null).
function groupProofsByMeeting(proofs = []) {
  const groups = new Map();
  proofs.forEach((p) => {
    const key = Number.isInteger(p.meeting_number) ? p.meeting_number : null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  return Array.from(groups.entries())
    .map(([meeting, items]) => ({ meeting, items }))
    .sort((a, b) => {
      if (a.meeting === null) return 1;
      if (b.meeting === null) return -1;
      return a.meeting - b.meeting;
    });
}

module.exports = { ensureClassProofTable, groupProofsByMeeting };
