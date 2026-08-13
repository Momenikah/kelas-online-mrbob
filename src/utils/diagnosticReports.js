// =============================================
// Diagnostic Test Report — file (PDF/gambar) yang diunggah tutor atau admin untuk
// seorang member Luxury; member bisa mengunduhnya di halaman Report. Boleh lebih
// dari satu per member (riwayat).
// =============================================

async function ensureDiagnosticReportsTable(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS diagnostic_reports (
      id SERIAL PRIMARY KEY,
      member_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      uploader_role VARCHAR(20),
      uploader_name VARCHAR(255),
      title VARCHAR(255),
      file_url VARCHAR(500) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

module.exports = { ensureDiagnosticReportsTable };
