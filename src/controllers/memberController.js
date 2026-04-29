const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const kidsQuestions = require('../data/placementTestKids');

function calcLevel(score) {
  // Map score (max 20) to LEVEL 1-5 (proportional to original 50-scale ranges)
  if (score <= 2)  return { level_num: 1, level_label: 'LEVEL 1', level_desc: 'Beginner' };
  if (score <= 6)  return { level_num: 2, level_label: 'LEVEL 2', level_desc: 'Elementary' };
  if (score <= 10) return { level_num: 3, level_label: 'LEVEL 3', level_desc: 'Pre-Intermediate' };
  if (score <= 14) return { level_num: 4, level_label: 'LEVEL 4', level_desc: 'Intermediate' };
  return            { level_num: 5, level_label: 'LEVEL 5', level_desc: 'Advanced' };
}

exports.dashboard = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [enrollResult, notifResult, schedResult] = await Promise.all([
      query(`SELECT e.*, p.name as program_name, p.description
             FROM enrollments e JOIN programs p ON e.program_id = p.id
             WHERE e.member_id = $1 AND e.status = 'active'`, [userId]),
      query(`SELECT * FROM notifications WHERE user_id = $1 AND is_read = false ORDER BY created_at DESC LIMIT 5`, [userId]),
      query(`SELECT s.*, u.name as tutor_name, p.name as program_name
             FROM schedules s JOIN users u ON s.tutor_id = u.id JOIN programs p ON s.program_id = p.id
             WHERE p.id IN (SELECT program_id FROM enrollments WHERE member_id = $1 AND status = 'active')
             AND s.date >= CURRENT_DATE ORDER BY s.date LIMIT 3`, [userId]),
    ]);
    res.render('member/dashboard', {
      title: 'Member Area',
      user: req.session.user,
      enrollments: enrollResult.rows,
      notifications: notifResult.rows,
      upcomingSchedules: schedResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.schedule = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const result = await query(`
      SELECT s.*, u.name as tutor_name, p.name as program_name,
             pr.status as presence_status
      FROM schedules s
      JOIN users u ON s.tutor_id = u.id
      JOIN programs p ON s.program_id = p.id
      LEFT JOIN presences pr ON s.id = pr.schedule_id AND pr.member_id = $1
      WHERE p.id IN (SELECT program_id FROM enrollments WHERE member_id = $1 AND status = 'active')
      ORDER BY s.date DESC, s.start_time DESC
    `, [userId]);
    res.render('member/schedule', {
      title: 'Jadwal Kelas',
      user: req.session.user,
      schedules: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.module = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const result = await query(`
      SELECT m.*, p.name as program_name
      FROM modules m JOIN programs p ON m.program_id = p.id
      WHERE m.program_id IN (SELECT program_id FROM enrollments WHERE member_id = $1 AND status = 'active')
        AND m.is_active = true
      ORDER BY m.program_id, m.order_number
    `, [userId]);
    res.render('member/module', {
      title: 'Modul Belajar',
      user: req.session.user,
      modules: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.presence = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [presResult, statsResult] = await Promise.all([
      query(`
        SELECT pr.*, s.title as schedule_title, s.date, s.start_time, s.end_time, p.name as program_name
        FROM presences pr JOIN schedules s ON pr.schedule_id = s.id
        JOIN programs p ON s.program_id = p.id
        WHERE pr.member_id = $1 ORDER BY s.date DESC
      `, [userId]),
      query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE pr.status = 'present') as present,
          COUNT(*) FILTER (WHERE pr.status = 'late') as late,
          COUNT(*) FILTER (WHERE pr.status = 'absent') as absent,
          COUNT(*) FILTER (WHERE pr.status = 'excused') as excused
        FROM presences pr WHERE pr.member_id = $1
      `, [userId]),
    ]);
    const stats = statsResult.rows[0];
    const attendanceRate = stats.total > 0
      ? Math.round(((parseInt(stats.present) + parseInt(stats.late)) / parseInt(stats.total)) * 100)
      : 0;
    res.render('member/presence', {
      title: 'Presensi',
      user: req.session.user,
      presences: presResult.rows,
      stats: { ...stats, attendanceRate },
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.questionnaire = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const result = await query(`
      SELECT q.*,
             qr.id as response_id, qr.score, qr.max_score, qr.submitted_at,
             p.name as program_name
      FROM questionnaires q
      JOIN programs p ON q.program_id = p.id
      LEFT JOIN questionnaire_responses qr ON q.id = qr.questionnaire_id AND qr.member_id = $1
      WHERE q.program_id IN (SELECT program_id FROM enrollments WHERE member_id = $1 AND status = 'active')
        AND q.is_active = true
      ORDER BY q.created_at DESC
    `, [userId]);
    res.render('member/questionnaire', {
      title: 'Kuesioner & Kuis',
      user: req.session.user,
      questionnaires: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.questionnaireShow = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    const [qResult, questionsResult, responseResult] = await Promise.all([
      query('SELECT q.*, p.name as program_name FROM questionnaires q JOIN programs p ON q.program_id = p.id WHERE q.id = $1', [id]),
      query('SELECT * FROM questions WHERE questionnaire_id = $1 ORDER BY order_number', [id]),
      query('SELECT * FROM questionnaire_responses WHERE questionnaire_id = $1 AND member_id = $2', [id, userId]),
    ]);
    const questionnaire = qResult.rows[0];
    if (!questionnaire) return res.redirect('/member/questionnaire');
    res.render('member/questionnaire-take', {
      title: questionnaire.title,
      user: req.session.user,
      questionnaire,
      questions: questionsResult.rows,
      response: responseResult.rows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.questionnaireSubmit = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    const answers = req.body;

    const questionsResult = await query('SELECT * FROM questions WHERE questionnaire_id = $1', [id]);
    const questions = questionsResult.rows;

    let score = 0;
    let maxScore = 0;
    const answerMap = {};

    questions.forEach(q => {
      maxScore += q.points;
      const userAnswer = answers[`q_${q.id}`] || '';
      answerMap[q.id] = userAnswer;
      if (q.question_type === 'multiple_choice' && userAnswer === q.correct_answer) {
        score += q.points;
      } else if (q.question_type === 'essay') {
        // Essay graded manually, give partial credit
        score += q.points > 0 && userAnswer.trim().length > 10 ? Math.floor(q.points * 0.5) : 0;
      }
    });

    await query(`
      INSERT INTO questionnaire_responses (questionnaire_id, member_id, answers, score, max_score, started_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (questionnaire_id, member_id) DO UPDATE SET answers=$3, score=$4, submitted_at=NOW()
    `, [id, userId, JSON.stringify(answerMap), score, maxScore]);

    req.flash('success', `Kuis berhasil dikumpulkan! Skor kamu: ${score}/${maxScore}`);
    res.redirect('/member/questionnaire');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengumpulkan kuis.');
    res.redirect(`/member/questionnaire/${req.params.id}`);
  }
};

exports.report = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [enrollResult, presStats, quizStats] = await Promise.all([
      query(`SELECT e.*, p.name as program_name FROM enrollments e JOIN programs p ON e.program_id = p.id WHERE e.member_id = $1`, [userId]),
      query(`
        SELECT p.name as program_name,
               COUNT(pr.*) as total_schedules,
               COUNT(pr.*) FILTER (WHERE pr.status = 'present') as present_count,
               COUNT(pr.*) FILTER (WHERE pr.status = 'late') as late_count
        FROM programs p
        JOIN schedules s ON s.program_id = p.id
        LEFT JOIN presences pr ON s.id = pr.schedule_id AND pr.member_id = $1
        WHERE p.id IN (SELECT program_id FROM enrollments WHERE member_id = $1)
        GROUP BY p.name
      `, [userId]),
      query(`
        SELECT q.title, qr.score, qr.max_score, qr.submitted_at
        FROM questionnaire_responses qr JOIN questionnaires q ON qr.questionnaire_id = q.id
        WHERE qr.member_id = $1 ORDER BY qr.submitted_at DESC
      `, [userId]),
    ]);
    res.render('member/report', {
      title: 'Laporan Member',
      user: req.session.user,
      enrollments: enrollResult.rows,
      presStats: presStats.rows,
      quizStats: quizStats.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.certificate = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const result = await query(`
      SELECT c.*, p.name as program_name
      FROM certificates c JOIN programs p ON c.program_id = p.id
      WHERE c.member_id = $1 AND c.is_active = true
      ORDER BY c.issued_date DESC
    `, [userId]);
    res.render('member/certificate', {
      title: 'E-Sertifikat',
      user: req.session.user,
      certificates: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.profile = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
    res.render('member/profile', {
      title: 'Edit Profil',
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
      const user = await query('SELECT photo FROM users WHERE id = $1', [userId]);
      const oldPhoto = user.rows[0].photo;
      if (oldPhoto) {
        const oldPath = path.join(__dirname, '../../public', oldPhoto);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      photoPath = `/uploads/${req.file.filename}`;
    }

    const updateQuery = photoPath
      ? 'UPDATE users SET name=$1, phone=$2, bio=$3, photo=$4, updated_at=NOW() WHERE id=$5'
      : 'UPDATE users SET name=$1, phone=$2, bio=$3, updated_at=NOW() WHERE id=$4';
    const params = photoPath ? [name, phone, bio, photoPath, userId] : [name, phone, bio, userId];
    await query(updateQuery, params);

    const updated = await query('SELECT * FROM users WHERE id = $1', [userId]);
    req.session.user = {
      id: updated.rows[0].id,
      name: updated.rows[0].name,
      email: updated.rows[0].email,
      role: updated.rows[0].role,
      photo: updated.rows[0].photo,
      is_vip: updated.rows[0].is_vip,
    };
    req.flash('success', 'Profil berhasil diperbarui.');
    res.redirect('/member/profile');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperbarui profil.');
    res.redirect('/member/profile');
  }
};

exports.renewal = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [enrollResult, programsResult] = await Promise.all([
      query(`SELECT e.*, p.name as program_name, p.price, p.duration_months
             FROM enrollments e JOIN programs p ON e.program_id = p.id
             WHERE e.member_id = $1 ORDER BY e.end_date`, [userId]),
      query('SELECT * FROM programs WHERE is_active = true ORDER BY price'),
    ]);
    res.render('member/renewal', {
      title: 'Perpanjang Program',
      user: req.session.user,
      enrollments: enrollResult.rows,
      programs: programsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.toefl = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [simResult, resultsResult] = await Promise.all([
      query('SELECT * FROM toefl_simulations WHERE is_active = true'),
      query(`SELECT tr.*, ts.title FROM toefl_results tr
             JOIN toefl_simulations ts ON tr.simulation_id = ts.id
             WHERE tr.member_id = $1 ORDER BY tr.taken_at DESC`, [userId]),
    ]);
    res.render('member/toefl', {
      title: 'Simulasi TOEFL',
      user: req.session.user,
      simulations: simResult.rows,
      results: resultsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.video = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const result = await query(`
      SELECT v.*, p.name as program_name
      FROM videos v JOIN programs p ON v.program_id = p.id
      WHERE v.program_id IN (SELECT program_id FROM enrollments WHERE member_id = $1 AND status = 'active')
      ORDER BY v.program_id, v.order_number
    `, [userId]);
    res.render('member/video', {
      title: 'Video Premium',
      user: req.session.user,
      videos: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

// =====================================================
// Placement Test
// =====================================================
exports.placementTestIndex = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const result = await query(
      `SELECT * FROM placement_tests WHERE member_id = $1 ORDER BY taken_at DESC`,
      [userId]
    );
    res.render('member/placement-test/index', {
      title: 'Placement Test',
      user: req.session.user,
      history: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.placementTestKids = (req, res) => {
  res.render('member/placement-test/kids', {
    title: 'Placement Test - Kids',
    user: req.session.user,
    questions: kidsQuestions,
    profile: { name: req.session.user.name, email: req.session.user.email },
  });
};

exports.placementTestAdult = (req, res) => {
  res.render('member/placement-test/adult', {
    title: 'Placement Test - Adult',
    user: req.session.user,
  });
};

exports.submitPlacementTestKids = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { full_name, email, city, phone } = req.body;

    let score = 0;
    const answers = {};
    kidsQuestions.forEach(q => {
      const ans = req.body[q.key] || '';
      answers[q.key] = ans;
      if (ans === q.correct) score++;
    });

    const lvl = calcLevel(score);
    const result = await query(
      `INSERT INTO placement_tests
        (member_id, test_type, score, max_score, level_num, level_label, level_desc, answers,
         full_name, email, city, phone)
       VALUES ($1, 'kids', $2, 20, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [userId, score, lvl.level_num, lvl.level_label, lvl.level_desc,
        JSON.stringify(answers), full_name, email, city, phone]
    );
    res.redirect(`/member/placement-test/result/${result.rows[0].id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menyimpan jawaban placement test.');
    res.redirect('/member/placement-test/kids');
  }
};

exports.placementTestResult = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const result = await query(
      `SELECT * FROM placement_tests WHERE id = $1 AND member_id = $2`,
      [req.params.id, userId]
    );
    if (result.rows.length === 0) {
      req.flash('error', 'Hasil tes tidak ditemukan.');
      return res.redirect('/member/placement-test');
    }
    const test = result.rows[0];
    const questions = test.test_type === 'kids' ? kidsQuestions : [];
    res.render('member/placement-test/result', {
      title: 'Hasil Placement Test',
      user: req.session.user,
      test,
      questions,
      pct: test.max_score > 0 ? Math.round(test.score / test.max_score * 100) : 0,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.markNotifRead = async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.session.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
};
