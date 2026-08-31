require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'kelasonline',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
    await client.query(sql);
    console.log('Tables created successfully.');

    console.log('Seeding initial data...');

    const adminPass = await bcrypt.hash('admin123', 10);
    const tutorPass = await bcrypt.hash('tutor123', 10);
    const memberPass = await bcrypt.hash('member123', 10);

    // Seed users
    await client.query(`
      INSERT INTO users (name, email, password, role, is_vip)
      VALUES
        ('Administrator', 'admin@kelasonline.com', $1, 'admin', true),
        ('Abror (Tutor)', 'tutor@kelasonline.com', $2, 'tutor', false),
        ('Abd Lathif Fatahillah', 'member@kelasonline.com', $3, 'member', true)
      ON CONFLICT (email) DO NOTHING
    `, [adminPass, tutorPass, memberPass]);

    // Seed programs
    await client.query(`
      INSERT INTO programs (name, description, duration_months, price)
      VALUES
        ('TOEFL Preparation', 'Program persiapan TOEFL intensif selama 3 bulan', 3, 1500000),
        ('English Conversation', 'Program percakapan bahasa Inggris sehari-hari', 2, 900000),
        ('IELTS Mastery', 'Program persiapan IELTS komprehensif', 4, 2000000)
      ON CONFLICT DO NOTHING
    `);

    // Seed enrollment for member
    await client.query(`
      INSERT INTO enrollments (member_id, program_id, start_date, end_date, status)
      SELECT u.id, p.id, CURRENT_DATE, CURRENT_DATE + INTERVAL '3 months', 'active'
      FROM users u, programs p
      WHERE u.email = 'member@kelasonline.com' AND p.name = 'TOEFL Preparation'
      ON CONFLICT DO NOTHING
    `);

    // Seed schedules
    await client.query(`
      INSERT INTO schedules (tutor_id, program_id, title, description, date, start_time, end_time, location, meeting_link, status)
      SELECT
        t.id,
        p.id,
        'Sesi TOEFL - Listening Section',
        'Pengantar strategi menjawab soal listening TOEFL',
        CURRENT_DATE + 2,
        '09:00', '10:30',
        'Online via Zoom',
        'https://zoom.us/j/example',
        'upcoming'
      FROM users t, programs p
      WHERE t.email = 'tutor@kelasonline.com' AND p.name = 'TOEFL Preparation'
    `);

    await client.query(`
      INSERT INTO schedules (tutor_id, program_id, title, description, date, start_time, end_time, location, meeting_link, status)
      SELECT
        t.id,
        p.id,
        'Sesi TOEFL - Structure & Written Expression',
        'Latihan tata bahasa dan ekspresi tertulis untuk TOEFL',
        CURRENT_DATE + 5,
        '10:00', '11:30',
        'Online via Zoom',
        'https://zoom.us/j/example2',
        'upcoming'
      FROM users t, programs p
      WHERE t.email = 'tutor@kelasonline.com' AND p.name = 'TOEFL Preparation'
    `);

    await client.query(`
      INSERT INTO schedules (tutor_id, program_id, title, description, date, start_time, end_time, location, meeting_link, status)
      SELECT
        t.id,
        p.id,
        'Sesi Sebelumnya - Reading Comprehension',
        'Teknik membaca cepat dan pemahaman teks',
        CURRENT_DATE - 3,
        '09:00', '10:30',
        'Online via Zoom',
        'https://zoom.us/j/example3',
        'completed'
      FROM users t, programs p
      WHERE t.email = 'tutor@kelasonline.com' AND p.name = 'TOEFL Preparation'
    `);

    // Seed presence for past schedule
    await client.query(`
      INSERT INTO presences (schedule_id, member_id, status, check_in_time)
      SELECT s.id, u.id, 'present', NOW() - INTERVAL '3 days'
      FROM schedules s, users u
      WHERE s.title = 'Sesi Sebelumnya - Reading Comprehension'
        AND u.email = 'member@kelasonline.com'
      ON CONFLICT DO NOTHING
    `);

    await client.query(`
      INSERT INTO schedule_members (schedule_id, member_id)
      SELECT s.id, e.member_id
      FROM schedules s
      JOIN enrollments e ON e.program_id = s.program_id AND e.status = 'active'
      ON CONFLICT DO NOTHING
    `);

    await client.query(`
      INSERT INTO presences (schedule_id, member_id, status, source)
      SELECT sm.schedule_id, sm.member_id, 'absent', 'system'
      FROM schedule_members sm
      ON CONFLICT DO NOTHING
    `);

    // Seed modules
    await client.query(`
      INSERT INTO modules (program_id, title, description, content, order_number, is_premium, created_by)
      SELECT
        p.id,
        'Pengantar TOEFL',
        'Mengenal struktur dan format ujian TOEFL secara keseluruhan',
        'TOEFL (Test of English as a Foreign Language) adalah ujian bahasa Inggris yang diakui secara internasional...',
        1, false, u.id
      FROM programs p, users u
      WHERE p.name = 'TOEFL Preparation' AND u.role = 'tutor'
    `);

    await client.query(`
      INSERT INTO modules (program_id, title, description, content, order_number, is_premium, created_by)
      SELECT
        p.id,
        'Listening - Short Conversations',
        'Strategi menjawab soal percakapan pendek dalam section listening',
        'Short conversations biasanya terdiri dari dua pembicara yang mendiskusikan topik tertentu...',
        2, false, u.id
      FROM programs p, users u
      WHERE p.name = 'TOEFL Preparation' AND u.role = 'tutor'
    `);

    await client.query(`
      INSERT INTO modules (program_id, title, description, content, order_number, is_premium, created_by)
      SELECT
        p.id,
        'Latihan Soal Premium',
        'Kumpulan soal-soal latihan TOEFL dengan tingkat kesulitan tinggi',
        'Paket latihan soal premium mencakup 500+ soal dengan pembahasan lengkap...',
        3, true, u.id
      FROM programs p, users u
      WHERE p.name = 'TOEFL Preparation' AND u.role = 'tutor'
    `);

    // Seed questionnaire
    await client.query(`
      INSERT INTO questionnaires (title, description, program_id, created_by, due_date, duration_minutes)
      SELECT
        'Kuis TOEFL - Sesi 1',
        'Evaluasi pemahaman materi listening dan structure',
        p.id,
        u.id,
        NULL,
        NULL
      FROM programs p, users u
      WHERE p.name = 'TOEFL Preparation' AND u.role = 'tutor'
    `);

    // Seed questions
    await client.query(`
      INSERT INTO questions (questionnaire_id, question_text, question_type, options, correct_answer, points, order_number)
      SELECT
        q.id,
        'What is the purpose of the TOEFL test?',
        'multiple_choice',
        '["To test grammar only", "To assess English proficiency for academic purposes", "To learn English", "To test speaking skills only"]'::jsonb,
        'To assess English proficiency for academic purposes',
        2, 1
      FROM questionnaires q WHERE q.title = 'Kuis TOEFL - Sesi 1'
    `);

    await client.query(`
      INSERT INTO questions (questionnaire_id, question_text, question_type, options, correct_answer, points, order_number)
      SELECT
        q.id,
        'How many sections does the TOEFL PBT have?',
        'multiple_choice',
        '["2 sections", "3 sections", "4 sections", "5 sections"]'::jsonb,
        '3 sections',
        2, 2
      FROM questionnaires q WHERE q.title = 'Kuis TOEFL - Sesi 1'
    `);

    await client.query(`
      INSERT INTO questions (questionnaire_id, question_text, question_type, options, correct_answer, points, order_number)
      SELECT
        q.id,
        'Apa kesulitan utama Anda dalam belajar TOEFL?',
        'essay',
        NULL,
        NULL,
        5, 3
      FROM questionnaires q WHERE q.title = 'Kuis TOEFL - Sesi 1'
    `);

    // Seed certificate
    await client.query(`
      INSERT INTO certificates (member_id, program_id, title, certificate_number)
      SELECT
        u.id, p.id,
        'Sertifikat Kelulusan - English Conversation',
        'CERT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-001'
      FROM users u, programs p
      WHERE u.email = 'member@kelasonline.com' AND p.name = 'English Conversation'
      ON CONFLICT DO NOTHING
    `);

    // Seed notifications
    await client.query(`
      INSERT INTO notifications (user_id, title, message, type)
      SELECT u.id, 'Selamat Datang!', 'Selamat bergabung di Super Seru Learning Platform. Semangat belajar!', 'success'
      FROM users u WHERE u.email = 'member@kelasonline.com'
    `);

    await client.query(`
      INSERT INTO notifications (user_id, title, message, type)
      SELECT u.id, 'Jadwal Baru', 'Tersedia jadwal baru: Sesi TOEFL - Listening Section. Jangan lewatkan!', 'info'
      FROM users u WHERE u.email = 'member@kelasonline.com'
    `);

    // Seed videos
    await client.query(`
      INSERT INTO videos (title, description, video_url, duration, is_premium, program_id, order_number, created_by)
      SELECT
        'Pengantar TOEFL Listening', 'Video penjelasan strategi dasar section listening',
        'https://www.youtube.com/embed/example1', '15:30', false, p.id, 1, u.id
      FROM programs p, users u
      WHERE p.name = 'TOEFL Preparation' AND u.role = 'tutor'
    `);

    await client.query(`
      INSERT INTO videos (title, description, video_url, duration, is_premium, program_id, order_number, created_by)
      SELECT
        'Advanced TOEFL Strategies', 'Teknik tingkat lanjut untuk mendapatkan skor maksimal',
        'https://www.youtube.com/embed/example2', '25:45', true, p.id, 2, u.id
      FROM programs p, users u
      WHERE p.name = 'TOEFL Preparation' AND u.role = 'tutor'
    `);

    // Bersihkan duplikat simulasi hasil seed lama: ON CONFLICT DO NOTHING di bawah
    // dulu ditulis tanpa unique constraint, sehingga tidak pernah menahan apa pun
    // dan tiap 'npm run migrate' menambah satu baris baru berjudul sama. Hanya
    // duplikat yang benar-benar kosong (tanpa soal & tanpa hasil) yang dihapus.
    await client.query(`
      DELETE FROM toefl_simulations ts
      WHERE EXISTS (SELECT 1 FROM toefl_simulations t2 WHERE t2.title = ts.title AND t2.id < ts.id)
        AND NOT EXISTS (SELECT 1 FROM toefl_questions q WHERE q.simulation_id = ts.id)
        AND NOT EXISTS (SELECT 1 FROM toefl_results r WHERE r.simulation_id = ts.id)
    `);
    // Seed TOEFL simulation — idempoten lewat NOT EXISTS (tidak butuh constraint,
    // jadi tetap aman kalau masih ada duplikat lama yang dipertahankan).
    await client.query(`
      INSERT INTO toefl_simulations (title, description, duration_minutes)
      SELECT 'TOEFL Simulation Test 1', 'Simulasi ujian TOEFL lengkap dengan listening, structure, dan reading', 120
      WHERE NOT EXISTS (SELECT 1 FROM toefl_simulations WHERE title = 'TOEFL Simulation Test 1')
    `);

    // Seed available times for tutor (FluentForm-style: Periode + Jam Belajar + Hari)
    await client.query(`
      INSERT INTO available_times (tutor_id, period_label, period_start, day_category, custom_days, start_time, end_time, is_available)
      SELECT u.id, v.period_label, v.period_start::date, v.day_category, v.custom_days, v.start_time::time, v.end_time::time, true
      FROM users u,
        (VALUES
          ('Minggu Ini', date_trunc('week', CURRENT_DATE)::date, 'weekdays', NULL, '09:00', '10:00'),
          ('Minggu Ini', date_trunc('week', CURRENT_DATE)::date, 'weekdays', NULL, '13:00', '14:00'),
          ('Minggu Ini', date_trunc('week', CURRENT_DATE)::date, 'weekend', NULL, '10:00', '11:00')
        ) AS v(period_label, period_start, day_category, custom_days, start_time, end_time)
      WHERE u.email = 'tutor@kelasonline.com'
    `);

    console.log('');
    console.log('========================================');
    console.log('Migration & Seeding completed!');
    console.log('========================================');
    console.log('Login credentials:');
    console.log('  Admin  : admin@kelasonline.com / admin123');
    console.log('  Tutor  : tutor@kelasonline.com / tutor123');
    console.log('  Member : member@kelasonline.com / member123');
    console.log('========================================');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
