const ensureSupportFeedbackTable = async (query) => {
  await query(`
    CREATE TABLE IF NOT EXISTS support_feedback (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      role_label VARCHAR(50) NOT NULL,
      name VARCHAR(255),
      email VARCHAR(255),
      contact_email VARCHAR(255),
      category VARCHAR(100) NOT NULL,
      priority VARCHAR(50) DEFAULT 'Normal',
      subject VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      page_url VARCHAR(500),
      status VARCHAR(50) DEFAULT 'new',
      email_status VARCHAR(50) DEFAULT 'pending',
      email_error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
};

const saveSupportFeedback = async (query, payload) => {
  await ensureSupportFeedbackTable(query);
  const result = await query(`
    INSERT INTO support_feedback
      (user_id, role_label, name, email, contact_email, category, priority, subject, message, page_url)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `, [
    payload.user.id,
    payload.roleLabel,
    payload.user.name,
    payload.user.email,
    payload.contactEmail || payload.user.email || null,
    payload.category,
    payload.priority,
    payload.subject,
    payload.message,
    payload.pageUrl || null,
  ]);
  return result.rows[0];
};

const updateSupportFeedbackEmailStatus = async (query, id, status, error = null) => {
  await query(
    `UPDATE support_feedback SET email_status = $1, email_error = $2, updated_at = NOW() WHERE id = $3`,
    [status, error, id]
  );
};

module.exports = {
  ensureSupportFeedbackTable,
  saveSupportFeedback,
  updateSupportFeedbackEmailStatus,
};
