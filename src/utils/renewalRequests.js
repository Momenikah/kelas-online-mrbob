const ensureRenewalRequestsTable = async (query) => {
  await query(`
    CREATE TABLE IF NOT EXISTS renewal_requests (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      program_id INTEGER REFERENCES programs(id),
      request_type VARCHAR(30) DEFAULT 'renewal',
      member_name VARCHAR(255),
      member_email VARCHAR(255),
      phone VARCHAR(40),
      preferred_start_date DATE,
      study_time VARCHAR(80),
      package_name VARCHAR(255),
      package_price NUMERIC(12,2),
      transfer_proof VARCHAR(500),
      notes TEXT,
      status VARCHAR(30) DEFAULT 'pending',
      admin_notes TEXT,
      processed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Carry the class chosen at the initial registration onto the renewal request.
  await query(`ALTER TABLE renewal_requests ADD COLUMN IF NOT EXISTS selected_class VARCHAR(255)`);
};

const renewalStatuses = ['pending', 'approved', 'rejected', 'cancelled'];
const renewalTypes = ['renewal', 'new_program'];

module.exports = {
  ensureRenewalRequestsTable,
  renewalStatuses,
  renewalTypes,
};
