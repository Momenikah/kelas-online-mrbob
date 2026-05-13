require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: 'postgres', // Connect to default postgres db
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function createDB() {
  const client = await pool.connect();
  try {
    console.log('Creating database kelasonline...');
    await client.query('CREATE DATABASE kelasonline');
    console.log('Database created successfully.');
  } catch (err) {
    console.error('Error creating database:', err);
  } finally {
    client.release();
    pool.end();
  }
}

createDB();