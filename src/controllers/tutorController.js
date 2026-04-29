const { query } = require('../config/database');
const path = require('path');
const fs = require('fs');

exports.dashboard = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const [schedResult, memberCount, presStats] = await Promise.all([
      query(`SELECT s.*, p.name as program_name,
               COUNT(pr.id) FILTER (WHERE pr.status = 'present') as present_count
             FROM schedules s JOIN programs p ON s.program_id = p.id
             LEFT JOIN presences pr ON s.id = pr.schedule_id
             WHERE s.tutor_id = $1 AND s.date >= CURRENT_DATE
             GROUP BY s.id, p.name ORDER BY s.date LIMIT 5`, [tutorId]),
      query(`SELECT COUNT(DISTINCT e.member_id) as total
             FROM enrollments e JOIN programs p ON e.program_id = p.id
             JOIN schedules s ON s.program_id = p.id
             WHERE s.tutor_id = $1 AND e.status = 'active'`, [tutorId]),
      query(`SELECT COUNT(*) as total_schedules,
               COUNT(*) FILTER (WHERE status = 'completed') as completed
             FROM schedules WHERE tutor_id = $1`, [tutorId]),
    ]);
    res.render('tutor/dashboard', {
      title: 'Tutor Area',
      user: req.session.user,
      upcomingSchedules: schedResult.rows,
      memberCount: memberCount.rows[0].total,
      presStats: presStats.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.schedule = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const [schedResult, programsResult] = await Promise.all([
      query(`SELECT s.*, p.name as program_name,
               COUNT(pr.id) as registered_count,
               COUNT(pr.id) FILTER (WHERE pr.status = 'present') as present_count
             FROM schedules s JOIN programs p ON s.program_id = p.id
             LEFT JOIN presences pr ON s.id = pr.schedule_id
             WHERE s.tutor_id = $1
             GROUP BY s.id, p.name ORDER BY s.date DESC`, [tutorId]),
      query('SELECT * FROM programs WHERE is_active = true ORDER BY name'),
    ]);
    res.render('tutor/schedule', {
      title: 'Jadwal Mengajar',
      user: req.session.user,
      schedules: schedResult.rows,
      programs: programsResult.rows,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.createSchedule = async (req, res) => {
  const tutorId = req.session.user.id;
  const { program_id, title, description, date, start_time, end_time, location, meeting_link } = req.body;
  try {
    await query(
      `INSERT INTO schedules (tutor_id, program_id, title, description, date, start_time, end_time, location, meeting_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tutorId, program_id, title, description, date, start_time, end_time, location, meeting_link]
    );

    // Auto-create presence records for enrolled members
    await query(`
      INSERT INTO presences (schedule_id, member_id, status)
      SELECT currval('schedules_id_seq'), e.member_id, 'absent'
      FROM enrollments e WHERE e.program_id = $1 AND e.status = 'active'
      ON CONFLICT DO NOTHING
    `, [program_id]);

    req.flash('success', 'Jadwal berhasil ditambahkan.');
    res.redirect('/tutor/schedule');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menambahkan jadwal.');
    res.redirect('/tutor/schedule');
  }
};

exports.deleteSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM schedules WHERE id = $1 AND tutor_id = $2', [id, req.session.user.id]);
    req.flash('success', 'Jadwal berhasil dihapus.');
    res.redirect('/tutor/schedule');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menghapus jadwal.');
    res.redirect('/tutor/schedule');
  }
};

exports.availableTime = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const result = await query('SELECT * FROM available_times WHERE tutor_id = $1 ORDER BY day_of_week, start_time', [tutorId]);
    res.render('tutor/available-time', {
      title: 'Waktu Tersedia',
      user: req.session.user,
      availableTimes: result.rows,
      days: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.saveAvailableTime = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const { day_of_week, start_time, end_time } = req.body;
    await query(
      'INSERT INTO available_times (tutor_id, day_of_week, start_time, end_time) VALUES ($1,$2,$3,$4)',
      [tutorId, day_of_week, start_time, end_time]
    );
    req.flash('success', 'Waktu tersedia berhasil ditambahkan.');
    res.redirect('/tutor/available-time');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menyimpan waktu.');
    res.redirect('/tutor/available-time');
  }
};

exports.deleteAvailableTime = async (req, res) => {
  try {
    await query('DELETE FROM available_times WHERE id = $1 AND tutor_id = $2', [req.params.id, req.session.user.id]);
    req.flash('success', 'Waktu berhasil dihapus.');
    res.redirect('/tutor/available-time');
  } catch (err) {
    req.flash('error', 'Gagal menghapus waktu.');
    res.redirect('/tutor/available-time');
  }
};

exports.presence = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const schedResult = await query(
      `SELECT s.*, p.name as program_name FROM schedules s JOIN programs p ON s.program_id = p.id
       WHERE s.tutor_id = $1 ORDER BY s.date DESC`, [tutorId]
    );

    const selectedId = req.query.schedule_id;
    let members = [];
    let selectedSchedule = null;
    if (selectedId) {
      selectedSchedule = schedResult.rows.find(s => s.id == selectedId);
      const mResult = await query(`
        SELECT u.id, u.name, u.photo, pr.status, pr.notes, pr.check_in_time
        FROM presences pr JOIN users u ON pr.member_id = u.id
        WHERE pr.schedule_id = $1 ORDER BY u.name
      `, [selectedId]);
      members = mResult.rows;
    }

    res.render('tutor/presence', {
      title: 'Kelola Presensi',
      user: req.session.user,
      schedules: schedResult.rows,
      members,
      selectedSchedule,
      selectedId,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.updatePresence = async (req, res) => {
  try {
    const { schedule_id } = req.params;
    const { presences } = req.body;
    if (presences && typeof presences === 'object') {
      for (const [memberId, status] of Object.entries(presences)) {
        await query(`
          UPDATE presences SET status = $1, check_in_time = CASE WHEN $1 = 'present' THEN NOW() ELSE null END
          WHERE schedule_id = $2 AND member_id = $3
        `, [status, schedule_id, memberId]);
      }
    }
    await query(`UPDATE schedules SET status = 'completed' WHERE id = $1`, [schedule_id]);
    req.flash('success', 'Presensi berhasil disimpan.');
    res.redirect(`/tutor/presence?schedule_id=${schedule_id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menyimpan presensi.');
    res.redirect('/tutor/presence');
  }
};

exports.questionnaire = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const [qResult, programsResult] = await Promise.all([
      query(`SELECT q.*, p.name as program_name,
               COUNT(qq.id) as question_count,
               COUNT(qr.id) as response_count
             FROM questionnaires q JOIN programs p ON q.program_id = p.id
             LEFT JOIN questions qq ON q.id = qq.questionnaire_id
             LEFT JOIN questionnaire_responses qr ON q.id = qr.questionnaire_id
             WHERE q.created_by = $1
             GROUP BY q.id, p.name ORDER BY q.created_at DESC`, [tutorId]),
      query('SELECT * FROM programs WHERE is_active = true ORDER BY name'),
    ]);
    res.render('tutor/questionnaire', {
      title: 'Kuesioner',
      user: req.session.user,
      questionnaires: qResult.rows,
      programs: programsResult.rows,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.createQuestionnaire = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const { title, description, program_id, due_date, duration_minutes } = req.body;
    await query(
      `INSERT INTO questionnaires (title, description, program_id, created_by, due_date, duration_minutes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [title, description, program_id, tutorId, due_date || null, duration_minutes || 60]
    );
    req.flash('success', 'Kuesioner berhasil dibuat.');
    res.redirect('/tutor/questionnaire');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal membuat kuesioner.');
    res.redirect('/tutor/questionnaire');
  }
};

exports.questionnaireDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const [qResult, questionsResult, responsesResult] = await Promise.all([
      query('SELECT q.*, p.name as program_name FROM questionnaires q JOIN programs p ON q.program_id = p.id WHERE q.id = $1', [id]),
      query('SELECT * FROM questions WHERE questionnaire_id = $1 ORDER BY order_number', [id]),
      query(`SELECT qr.*, u.name as member_name FROM questionnaire_responses qr
             JOIN users u ON qr.member_id = u.id WHERE qr.questionnaire_id = $1`, [id]),
    ]);
    res.render('tutor/questionnaire-detail', {
      title: 'Detail Kuesioner',
      user: req.session.user,
      questionnaire: qResult.rows[0],
      questions: questionsResult.rows,
      responses: responsesResult.rows,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.addQuestion = async (req, res) => {
  try {
    const { questionnaire_id, question_text, question_type, options, correct_answer, points } = req.body;
    const optionsJson = options ? JSON.parse(options) : null;
    const orderResult = await query('SELECT COALESCE(MAX(order_number),0)+1 as next FROM questions WHERE questionnaire_id = $1', [questionnaire_id]);
    await query(
      `INSERT INTO questions (questionnaire_id, question_text, question_type, options, correct_answer, points, order_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [questionnaire_id, question_text, question_type, optionsJson ? JSON.stringify(optionsJson) : null, correct_answer, points || 1, orderResult.rows[0].next]
    );
    req.flash('success', 'Pertanyaan berhasil ditambahkan.');
    res.redirect(`/tutor/questionnaire/${questionnaire_id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menambahkan pertanyaan.');
    res.redirect(`/tutor/questionnaire/${req.body.questionnaire_id}`);
  }
};

exports.report = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const result = await query(`
      SELECT u.id, u.name, u.photo, p.name as program_name,
             COUNT(pr.*) as total_sessions,
             COUNT(pr.*) FILTER (WHERE pr.status = 'present') as present_count,
             AVG(qr.score::float / NULLIF(qr.max_score,0) * 100) as avg_score
      FROM enrollments e
      JOIN users u ON e.member_id = u.id
      JOIN programs p ON e.program_id = p.id
      JOIN schedules s ON s.program_id = p.id AND s.tutor_id = $1
      LEFT JOIN presences pr ON s.id = pr.schedule_id AND pr.member_id = u.id
      LEFT JOIN questionnaire_responses qr ON qr.member_id = u.id
      WHERE e.status = 'active'
      GROUP BY u.id, u.name, u.photo, p.name
      ORDER BY p.name, u.name
    `, [tutorId]);
    res.render('tutor/report', {
      title: 'Laporan Member',
      user: req.session.user,
      reports: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.certificate = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const [certsResult, membersResult] = await Promise.all([
      query(`SELECT c.*, u.name as member_name, p.name as program_name
             FROM certificates c JOIN users u ON c.member_id = u.id JOIN programs p ON c.program_id = p.id
             JOIN schedules s ON s.program_id = p.id WHERE s.tutor_id = $1
             GROUP BY c.id, u.name, p.name ORDER BY c.issued_date DESC`, [tutorId]),
      query(`SELECT DISTINCT u.id, u.name, p.id as program_id, p.name as program_name
             FROM enrollments e JOIN users u ON e.member_id = u.id
             JOIN programs p ON e.program_id = p.id
             JOIN schedules s ON s.program_id = p.id WHERE s.tutor_id = $1 AND e.status = 'active'`, [tutorId]),
    ]);
    res.render('tutor/certificate', {
      title: 'Kelola Sertifikat',
      user: req.session.user,
      certificates: certsResult.rows,
      members: membersResult.rows,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.issueCertificate = async (req, res) => {
  try {
    const { member_id, program_id, title } = req.body;
    const certNum = `CERT-${Date.now()}-${member_id}`;
    await query(
      `INSERT INTO certificates (member_id, program_id, title, certificate_number)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [member_id, program_id, title, certNum]
    );
    req.flash('success', 'Sertifikat berhasil diterbitkan.');
    res.redirect('/tutor/certificate');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menerbitkan sertifikat.');
    res.redirect('/tutor/certificate');
  }
};

exports.profile = async (req, res) => {
  try {
    const result = await query('SELECT * FROM users WHERE id = $1', [req.session.user.id]);
    res.render('tutor/profile', {
      title: 'Profil Tutor',
      user: req.session.user,
      profile: result.rows[0],
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { name, phone, bio } = req.body;
    let photoPath = null;
    if (req.file) {
      const u = await query('SELECT photo FROM users WHERE id = $1', [userId]);
      const old = u.rows[0].photo;
      if (old) {
        const oldPath = path.join(__dirname, '../../public', old);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      photoPath = `/uploads/${req.file.filename}`;
    }
    const q = photoPath
      ? 'UPDATE users SET name=$1, phone=$2, bio=$3, photo=$4, updated_at=NOW() WHERE id=$5'
      : 'UPDATE users SET name=$1, phone=$2, bio=$3, updated_at=NOW() WHERE id=$4';
    await query(q, photoPath ? [name, phone, bio, photoPath, userId] : [name, phone, bio, userId]);
    const updated = await query('SELECT * FROM users WHERE id = $1', [userId]);
    req.session.user = {
      id: updated.rows[0].id, name: updated.rows[0].name,
      email: updated.rows[0].email, role: updated.rows[0].role,
      photo: updated.rows[0].photo, is_vip: updated.rows[0].is_vip,
    };
    req.flash('success', 'Profil berhasil diperbarui.');
    res.redirect('/tutor/profile');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperbarui profil.');
    res.redirect('/tutor/profile');
  }
};
