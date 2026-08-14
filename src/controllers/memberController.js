const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const at = require('../utils/availableTime');
const kidsQuestions = require('../data/placementTestKids');
const { normalizeReportDays, ensureMemberReportsTable } = require('../utils/memberReports');
const { ensureCertificateDetailsColumn } = require('../utils/certificates');
const { STUDY_TIME_SLOTS, PROGRAM_CATALOG } = require('../utils/catalog');
const { ensureRenewalRequestsTable } = require('../utils/renewalRequests');
const { getModuleMaterial } = require('../utils/moduleLinks');
const { ensureMemberPresenceTable } = require('../utils/memberPresence');
const { isSemiPrivateStart } = require('../utils/semiPrivate');
const { ensureDiagnosticReportsTable } = require('../utils/diagnosticReports');
const { packagesForProgram, PRICE_LIST } = require('../utils/priceList');
const { syncRenewal, syncQuestionnaire } = require('../utils/spreadsheetSync');
const { sendRenewalEmail, sendRenewalAdminEmail } = require('../utils/registrationEmail');
const { SUPPORT_EMAIL, sendSupportFeedback } = require('../utils/supportEmail');
const { saveSupportFeedback, updateSupportFeedbackEmailStatus } = require('../utils/supportFeedback');
const {
  isTeachingQuestionnaire,
  isTeachingMode,
  teachingQuestionnaireFilter,
  teachingRatings,
  teachingEssays,
  ratingLabels,
  buildTeachingQuestionnaireAnswer,
  ensureTeachingQuestionnaires,
} = require('../utils/questionnaireTemplate');

const RENEWAL_DISCOUNT = 100000;
const renewalPriceFor = (price) => Math.max(0, Number(price || 0) - RENEWAL_DISCOUNT);

const removeUploadedFile = (file) => {
  if (!file) return;
  fs.unlink(path.join(__dirname, '../../public/uploads', file.filename), () => {});
};

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
    await ensureTeachingQuestionnaires(query);
    const [enrollResult, notifResult, schedResult, statsRes, pendingQuiz, luxuryRes] = await Promise.all([
      query(`SELECT e.*, p.name as program_name, p.description
             FROM enrollments e JOIN programs p ON e.program_id = p.id
             WHERE e.member_id = $1 AND e.status = 'active'`, [userId]),
      query(`SELECT * FROM notifications WHERE user_id = $1 AND is_read = false ORDER BY created_at DESC LIMIT 5`, [userId]),
      query(`SELECT s.*, u.name as tutor_name, p.name as program_name
             FROM schedule_members sm
             JOIN schedules s ON sm.schedule_id = s.id
             JOIN users u ON s.tutor_id = u.id
             JOIN programs p ON s.program_id = p.id
             WHERE sm.member_id = $1
             AND s.date >= CURRENT_DATE ORDER BY s.date LIMIT 3`, [userId]),
      query(`SELECT
                (SELECT COUNT(*) FROM enrollments WHERE member_id = $1 AND status = 'active') AS programs,
                (SELECT COUNT(*) FROM schedule_members WHERE member_id = $1) AS sessions,
                (SELECT COUNT(*) FROM presences WHERE member_id = $1) AS pres_total,
                (SELECT COUNT(*) FROM presences WHERE member_id = $1 AND status = 'present') AS pres_present,
                (SELECT COUNT(*) FROM certificates WHERE member_id = $1) AS certificates`, [userId]),
      query(`
        WITH question_counts AS (
          SELECT questionnaire_id, COUNT(*) AS cnt
          FROM questions
          GROUP BY questionnaire_id
        ),
        member_programs AS (
          SELECT program_id
          FROM enrollments
          WHERE member_id = $1 AND status = 'active'
          UNION
          SELECT s.program_id
          FROM schedule_members sm
          JOIN schedules s ON s.id = sm.schedule_id
          WHERE sm.member_id = $1 AND s.status <> 'cancelled'
        ),
        eligible_tutors AS (
          SELECT DISTINCT s.program_id, s.tutor_id, t.name AS tutor_name
          FROM schedule_members sm
          JOIN schedules s ON s.id = sm.schedule_id
          JOIN users t ON t.id = s.tutor_id
          WHERE sm.member_id = $1
            AND s.status <> 'cancelled'
            AND t.is_active = true
        ),
        ranked AS (
          SELECT q.id, q.title, q.due_date, q.created_at, q.program_id, p.name as program_name,
                 COALESCE(qc.cnt, 0) AS question_count,
                 ROW_NUMBER() OVER (
                   PARTITION BY (CASE WHEN COALESCE(qc.cnt, 0) > 0 THEN 'c' || q.id ELSE 'p' || p.name END)
                   ORDER BY q.created_at DESC, q.id DESC
                 ) AS rn
          FROM questionnaires q
          JOIN programs p ON q.program_id = p.id
          LEFT JOIN question_counts qc ON qc.questionnaire_id = q.id
          WHERE q.program_id IN (SELECT program_id FROM member_programs)
            AND q.is_active = true
            AND (${teachingQuestionnaireFilter('q')} OR COALESCE(qc.cnt, 0) > 0)
        ),
        pending AS (
          SELECT r.id, r.title, r.due_date, r.program_name, et.tutor_id, et.tutor_name
          FROM ranked r
          JOIN eligible_tutors et ON et.program_id = r.program_id
          WHERE r.rn = 1
            AND r.question_count = 0
            AND ${teachingQuestionnaireFilter('r')}
            AND NOT EXISTS (
              SELECT 1 FROM questionnaire_responses qr
              WHERE qr.questionnaire_id = r.id AND qr.member_id = $1 AND qr.tutor_id = et.tutor_id
            )

          UNION ALL

          SELECT r.id, r.title, r.due_date, r.program_name, NULL::integer AS tutor_id, NULL::varchar AS tutor_name
          FROM ranked r
          WHERE r.rn = 1
            AND r.question_count > 0
            AND NOT EXISTS (
              SELECT 1 FROM questionnaire_responses qr
              WHERE qr.questionnaire_id = r.id AND qr.member_id = $1 AND qr.tutor_id IS NULL
            )
        )
        SELECT id, title, due_date, program_name, tutor_id, tutor_name
        FROM pending
        ORDER BY (tutor_id IS NULL), due_date NULLS LAST, program_name, tutor_name NULLS LAST
        LIMIT 5
      `, [userId]),
      query(`
        SELECT r.package_name, r.package_group, r.preferred_tutor, r.preferred_tutor_id,
               t.photo AS preferred_tutor_photo, t.bio AS preferred_tutor_bio, t.tutor_grade AS preferred_tutor_grade
        FROM member_registrations r
        LEFT JOIN users t ON t.id = r.preferred_tutor_id
        WHERE r.user_id = $1 AND r.status = 'confirmed'
        ORDER BY r.confirmed_at DESC NULLS LAST, r.created_at DESC
        LIMIT 1
      `, [userId]),
    ]);

    const st = statsRes.rows[0];
    const attendanceRate = Number(st.pres_total) > 0
      ? Math.round((Number(st.pres_present) / Number(st.pres_total)) * 100) : 0;

    res.render('member/dashboard', {
      title: 'Member Area',
      user: req.session.user,
      enrollments: enrollResult.rows,
      notifications: notifResult.rows,
      upcomingSchedules: schedResult.rows,
      stats: {
        programs: st.programs,
        sessions: st.sessions,
        attendanceRate,
        certificates: st.certificates,
      },
      pendingQuiz: pendingQuiz.rows,
      luxuryAccess: luxuryRes.rows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.schedule = async (req, res) => {
  try {
    const userId = req.session.user.id;
    // Schedule is grouped per PERIODE (the week the member is registered for);
    // the per-session / per-day breakdown lives on the Presensi page.
    const period = /^\d{4}-\d{2}-\d{2}$/.test(req.query.period || '') ? req.query.period : '';

    const params = [userId];
    let periodFilter = '';
    if (period) { params.push(period); periodFilter = ` AND date_trunc('week', s.date)::date = $${params.length}::date`; }

    const [result, statsResult, periodsResult, regResult] = await Promise.all([
      query(`
        SELECT s.*, u.name as tutor_name, u.phone as tutor_phone, p.name as program_name,
               COALESCE(pr.status, 'absent') as presence_status,
               pr.check_in_time, pr.notes as presence_notes
        FROM schedule_members sm
        JOIN schedules s ON sm.schedule_id = s.id
        JOIN users u ON s.tutor_id = u.id
        JOIN programs p ON s.program_id = p.id
        LEFT JOIN presences pr ON s.id = pr.schedule_id AND pr.member_id = $1
        WHERE sm.member_id = $1${periodFilter}
        ORDER BY s.date ASC, s.start_time ASC
      `, params),
      query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE s.status <> 'cancelled' AND s.date >= CURRENT_DATE) AS upcoming,
               COUNT(*) FILTER (WHERE s.status <> 'cancelled' AND s.date < CURRENT_DATE) AS completed
        FROM schedule_members sm JOIN schedules s ON sm.schedule_id = s.id
        WHERE sm.member_id = $1
      `, [userId]),
      query(`
        SELECT DISTINCT date_trunc('week', s.date)::date AS period_start
        FROM schedule_members sm JOIN schedules s ON sm.schedule_id = s.id
        WHERE sm.member_id = $1
        ORDER BY period_start DESC
      `, [userId]),
      query(`SELECT selected_class, package_name, package_group, program_type, duration
             FROM member_registrations WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
    ]);

    // Kategori/Paket/Durasi diambil dari pendaftaran member, dipetakan per program.
    const KAT = { adult: 'Adult', kids: 'Kids' };
    const regByProgram = new Map();
    let regDefault = null;
    regResult.rows.forEach((r) => {
      const info = {
        paket: r.package_name || r.package_group || '-',
        kategori: KAT[r.program_type] || r.program_type || '-',
        durasi: r.duration || '-',
      };
      if (!regDefault) regDefault = info;
      const k = String(r.selected_class || '').trim().toLowerCase();
      if (k && !regByProgram.has(k)) regByProgram.set(k, info);
    });

    // Group the member's sessions by weekly period (Monday-start).
    const today = at.toISODate(new Date());
    const groups = new Map();
    result.rows.forEach((s) => {
      const key = at.mondayOf(s.date);
      if (!groups.has(key)) {
        groups.set(key, {
          period_start: key,
          label: at.formatPeriodLabel(key),
          sessions: [],
          programs: new Set(),
          tutors: new Set(),
          locations: new Set(),
          counts: { total: 0, upcoming: 0, completed: 0, cancelled: 0 },
          attendance: { present: 0, late: 0, excused: 0, absent: 0 },
          next: null,
        });
      }
      const g = groups.get(key);
      g.sessions.push(s);
      if (s.program_name) g.programs.add(s.program_name);
      if (s.tutor_name) g.tutors.add(s.tutor_name);
      if (s.location) g.locations.add(s.location);
      g.counts.total += 1;
      // Status is derived from the date, not the DB flag: any session whose date
      // has passed counts as "Selesai" even if it's still marked upcoming in the DB.
      const isFuture = s.status !== 'cancelled' && at.toISODate(s.date) >= today;
      if (s.status === 'cancelled') g.counts.cancelled += 1;
      else if (isFuture) g.counts.upcoming += 1;
      else g.counts.completed += 1;
      if (g.attendance[s.presence_status] !== undefined) g.attendance[s.presence_status] += 1;
      // nearest upcoming session in this period (sessions already sorted asc)
      if (isFuture && !g.next) g.next = s;
    });

    const periodGroups = Array.from(groups.values())
      .map((g) => {
        const firstProg = Array.from(g.programs)[0] || '';
        const reg = regByProgram.get(firstProg.toLowerCase()) || regDefault || {};
        const zoomLink = (g.next && g.next.meeting_link)
          || (g.sessions.find((s) => s.meeting_link) || {}).meeting_link || '';
        const tutorPhone = (g.next && g.next.tutor_phone)
          || (g.sessions[0] && g.sessions[0].tutor_phone) || '';
        return {
          period_start: g.period_start,
          label: g.label,
          programs: Array.from(g.programs),
          tutors: Array.from(g.tutors),
          tutor_name: Array.from(g.tutors)[0] || '',
          tutor_phone: tutorPhone,
          zoom_link: zoomLink,
          location: Array.from(g.locations)[0] || '',
          paket: reg.paket || '-',
          kategori: reg.kategori || '-',
          durasi: reg.durasi || '-',
          counts: g.counts,
          attendance: g.attendance,
          attended: g.attendance.present + g.attendance.late,
          status: g.counts.upcoming > 0 ? 'upcoming' : (g.counts.completed > 0 ? 'completed' : 'cancelled'),
          next: g.next,
          sessions: g.sessions.map((s) => {
            // Kategori/Paket/Durasi ikut sheet ploting (kolom di schedules); jika
            // kosong (mis. jadwal buatan Plot), fallback ke pendaftaran member.
            const ri = regByProgram.get(String(s.program_name || '').toLowerCase()) || regDefault || {};
            return {
              date: s.date, start_time: s.start_time, end_time: s.end_time,
              program_name: s.program_name, tutor_name: s.tutor_name,
              tutor_phone: s.tutor_phone || '',
              location: s.location || '', meeting_link: s.meeting_link || '',
              kategori: s.kategori || ri.kategori || '-',
              paket: s.paket || ri.paket || '-',
              durasi: s.durasi || ri.durasi || '-',
              request: s.request || '',
              status: s.status, presence_status: s.presence_status,
            };
          }),
        };
      })
      .sort((a, b) => (a.period_start < b.period_start ? 1 : -1));

    const periods = periodsResult.rows.map((r) => ({
      value: at.toISODate(r.period_start),
      label: at.formatPeriodLabel(at.toISODate(r.period_start)),
    }));

    res.render('member/schedule', {
      title: 'Jadwal Kelas',
      user: req.session.user,
      periodGroups,
      periods,
      filters: { period },
      stats: statsResult.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.module = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const requestedProgramId = String(req.query.program_id || '');
    const programId = /^\d+$/.test(requestedProgramId) ? requestedProgramId : '';
    const params = [userId];
    let progFilter = '';
    if (programId) { params.push(Number(programId)); progFilter = ` AND m.program_id = $${params.length}`; }

    const [result, programsRes, statsRes, ebooksRes] = await Promise.all([
      // Daftar utama = modul biasa (non-premium). Modul premium ditampilkan hanya
      // di section "Module Premium" (khusus Luxury), tidak di sini.
      query(`
        SELECT m.*, p.name as program_name
        FROM modules m JOIN programs p ON m.program_id = p.id
        WHERE m.program_id IN (SELECT program_id FROM enrollments WHERE member_id = $1 AND status = 'active')
          AND m.is_active = true AND m.is_premium = false${progFilter}
        ORDER BY p.name, m.order_number
      `, params),
      query(`SELECT DISTINCT p.id, p.name FROM programs p
             JOIN enrollments e ON e.program_id = p.id
             WHERE e.member_id = $1 AND e.status = 'active' ORDER BY p.name`, [userId]),
      query(`SELECT COUNT(*) AS total
             FROM modules m
             WHERE m.program_id IN (SELECT program_id FROM enrollments WHERE member_id = $1 AND status = 'active')
               AND m.is_active = true AND m.is_premium = false${progFilter}`, params),
      // Module Premium (khusus Luxury): bonus umum (program_id NULL) + modul premium
      // untuk program yang di-enroll member. Non-Luxury tidak menerima daftar ini.
      query(`SELECT m.id, m.title, m.description, m.file_url, m.order_number, p.name AS program_name
             FROM modules m LEFT JOIN programs p ON p.id = m.program_id
             WHERE m.is_premium = true AND m.is_active = true
               AND (m.program_id IS NULL
                    OR m.program_id IN (SELECT program_id FROM enrollments WHERE member_id = $1 AND status = 'active'))
             ORDER BY (m.program_id IS NULL) DESC, p.name, m.order_number, m.title`, [userId]),
    ]);
    const isLuxury = req.session.user.is_luxury;
    const premiumEbooks = isLuxury ? ebooksRes.rows : [];
    // Google Drive material link per enrolled program (member only sees links
    // for programs they are enrolled in — access is scoped to the chosen program).
    const programMaterials = programsRes.rows
      .map((p) => ({ id: p.id, name: p.name, material_url: getModuleMaterial(p.name) }))
      .filter((p) => p.material_url);
    const visibleMaterialCount = programMaterials
      .filter((p) => !programId || String(programId) === String(p.id))
      .length;
    const stats = {
      total: Number(statsRes.rows[0].total || 0) + visibleMaterialCount + premiumEbooks.length,
      premium: premiumEbooks.length,
      manual: visibleMaterialCount,
    };

    res.render('member/module', {
      title: 'Modul Belajar',
      user: req.session.user,
      modules: result.rows,
      programs: programsRes.rows,
      programMaterials,
      premiumEbooks,
      filters: { programId },
      stats,
      isVip: req.session.user.is_vip || req.session.user.is_luxury,
      isLuxury: req.session.user.is_luxury,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.presence = async (req, res) => {
  try {
    const userId = req.session.user.id;
    await ensureMemberPresenceTable(query);
    const [periodsRes, programsRes, submissionsRes, schedulesRes] = await Promise.all([
      query('SELECT period_start, label FROM periods ORDER BY period_start'),
      query(`SELECT DISTINCT ON (p.name) p.id, p.name
             FROM programs p
             JOIN enrollments e ON e.program_id = p.id
             WHERE e.member_id = $1 AND e.status = 'active' AND p.is_active = true
             ORDER BY p.name, p.id`, [userId]),
      query(`SELECT mp.*, t.name as tutor_name, p.name as program_name,
                    s.date as schedule_date, s.start_time as schedule_start_time, s.end_time as schedule_end_time
             FROM member_presences mp
             LEFT JOIN users t ON mp.tutor_id = t.id
             LEFT JOIN programs p ON mp.program_id = p.id
             LEFT JOIN schedules s ON mp.schedule_id = s.id
             WHERE mp.member_id = $1 ORDER BY mp.created_at DESC`, [userId]),
      query(`
        SELECT s.*, u.name as tutor_name, u.phone as tutor_phone, p.name as program_name,
               COALESCE(pr.status, 'absent') as presence_status,
               pr.check_in_time, pr.notes as presence_notes,
               mp.id as submission_id,
               mp.screenshot as submission_screenshot,
               mp.created_at as submission_created_at,
               ROW_NUMBER() OVER (
                 PARTITION BY sm.member_id, s.program_id
                 ORDER BY s.date, s.start_time, s.id
               ) as meeting_number_guess
        FROM schedule_members sm
        JOIN schedules s ON sm.schedule_id = s.id
        JOIN users u ON s.tutor_id = u.id
        JOIN programs p ON s.program_id = p.id
        LEFT JOIN presences pr ON s.id = pr.schedule_id AND pr.member_id = $1
        LEFT JOIN member_presences mp ON mp.schedule_id = s.id AND mp.member_id = $1
        WHERE sm.member_id = $1
          AND s.status <> 'cancelled'
        ORDER BY s.date DESC, s.start_time DESC
        LIMIT 80
      `, [userId]),
    ]);

    const periods = periodsRes.rows.map((p) => ({
      value: at.toISODate(p.period_start),
      label: p.label || at.formatPeriodLabel(p.period_start),
    }));
    const submissions = submissionsRes.rows.map((s) => ({
      ...s,
      period_label: s.period_start ? at.formatPeriodLabel(s.period_start) : '-',
    }));
    const schedules = schedulesRes.rows.map((schedule) => ({
      ...schedule,
      period_start: at.mondayOf(schedule.date),
      meeting_number_guess: Number(schedule.meeting_number_guess) || '',
    }));
    // Pilihan Program untuk form presensi: utamakan program dari sesi jadwal member
    // (id-nya harus cocok dgn auto-fill saat sesi dipilih), lalu tambahkan program
    // dari enrollment yang belum tercakup. Enrollment saja sering kosong padahal
    // member punya sesi -> dropdown jadi kosong.
    const programByName = new Map();
    schedulesRes.rows.forEach((s) => {
      if (s.program_id && !programByName.has(s.program_name)) {
        programByName.set(s.program_name, { id: s.program_id, name: s.program_name });
      }
    });
    programsRes.rows.forEach((p) => {
      if (!programByName.has(p.name)) programByName.set(p.name, { id: p.id, name: p.name });
    });
    const presencePrograms = Array.from(programByName.values())
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    // Sampai 40 — mencakup paket terbesar (40 pertemuan), bukan hanya 24.
    const meetings = Array.from({ length: 40 }, (_, i) => i + 1);

    res.render('member/presence', {
      title: 'Presensi',
      user: req.session.user,
      periods,
      programs: presencePrograms,
      meetings,
      submissions,
      schedules,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.submitPresence = async (req, res) => {
  try {
    const userId = req.session.user.id;
    await ensureMemberPresenceTable(query);
    const scheduleId = Number(req.body.schedule_id) || null;
    let tutorId = Number(req.body.tutor_id) || null;
    let periodStart = req.body.period_start || null;
    let programId = Number(req.body.program_id) || null;
    const meeting = Number(req.body.meeting_number) || null;
    let schedule = null;

    if (!scheduleId && (!tutorId || !periodStart || !programId)) {
      removeUploadedFile(req.file);
      req.flash('error', 'Pilih sesi presensi terlebih dahulu.');
      return res.redirect('/member/presence');
    }
    if (!meeting) {
      removeUploadedFile(req.file);
      req.flash('error', 'Lengkapi nomor meeting.');
      return res.redirect('/member/presence');
    }
    if (!req.file) {
      req.flash('error', 'Screenshot kelas wajib diunggah.');
      return res.redirect('/member/presence');
    }

    if (scheduleId) {
      const scheduleResult = await query(`
        SELECT s.*
        FROM schedule_members sm
        JOIN schedules s ON s.id = sm.schedule_id
        WHERE sm.schedule_id = $1 AND sm.member_id = $2
        LIMIT 1
      `, [scheduleId, userId]);
      schedule = scheduleResult.rows[0];
      if (!schedule || schedule.status === 'cancelled') {
        removeUploadedFile(req.file);
        req.flash('error', 'Sesi tidak ditemukan atau sudah dibatalkan.');
        return res.redirect('/member/presence');
      }
      tutorId = schedule.tutor_id;
      programId = schedule.program_id;
      periodStart = at.mondayOf(schedule.date);
    }

    const screenshot = `/uploads/${req.file.filename}`;
    const existingProof = scheduleId
      ? await query('SELECT screenshot FROM member_presences WHERE member_id = $1 AND schedule_id = $2', [userId, scheduleId])
      : { rows: [] };
    await query(
      `INSERT INTO member_presences (member_id, tutor_id, schedule_id, period_start, program_id, meeting_number, screenshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (member_id, schedule_id)
       DO UPDATE SET tutor_id = EXCLUDED.tutor_id,
                     period_start = EXCLUDED.period_start,
                     program_id = EXCLUDED.program_id,
                     meeting_number = EXCLUDED.meeting_number,
                     screenshot = EXCLUDED.screenshot,
                     created_at = NOW()`,
      [userId, tutorId, scheduleId, periodStart, programId, meeting, screenshot]
    );
    if (existingProof.rows[0] && existingProof.rows[0].screenshot && existingProof.rows[0].screenshot !== screenshot) {
      fs.unlink(path.join(__dirname, '../../public', existingProof.rows[0].screenshot), () => {});
    }

    let marked = { rows: [] };
    if (scheduleId) {
      marked = await query(
        `INSERT INTO presences (schedule_id, member_id, status, check_in_time, updated_by, updated_at, source)
         VALUES ($1,$2,'present',NOW(),$2,NOW(),'self-report')
         ON CONFLICT (schedule_id, member_id)
         DO UPDATE SET status = 'present',
                       check_in_time = COALESCE(presences.check_in_time, NOW()),
                       updated_by = EXCLUDED.updated_by,
                       updated_at = NOW(),
                       source = 'self-report'
         RETURNING schedule_id`,
        [scheduleId, userId]
      );
    } else {
      // Fallback untuk request lama: tetap usahakan kaitkan ke satu jadwal.
      marked = await query(
        `INSERT INTO presences (schedule_id, member_id, status, check_in_time, updated_by, updated_at, source)
         SELECT s.id, $1, 'present', NOW(), $1, NOW(), 'self-report'
         FROM schedules s
         JOIN schedule_members sm ON sm.schedule_id = s.id AND sm.member_id = $1
         LEFT JOIN presences pr ON pr.schedule_id = s.id AND pr.member_id = $1
         WHERE s.program_id = $2
           AND date_trunc('week', s.date)::date = $3::date
           AND s.status <> 'cancelled'
           AND (pr.status IS NULL OR pr.status NOT IN ('present', 'late'))
         ORDER BY (s.tutor_id = $4) DESC, s.date, s.start_time
         LIMIT 1
         ON CONFLICT (schedule_id, member_id)
         DO UPDATE SET status = 'present',
                       check_in_time = COALESCE(presences.check_in_time, NOW()),
                       updated_by = EXCLUDED.updated_by, updated_at = NOW(), source = 'self-report'
         RETURNING schedule_id`,
        [userId, programId, periodStart, tutorId]
      );
    }

    req.flash('success', marked.rows.length
      ? 'Presensi berhasil dikirim. Kamu tercatat HADIR untuk sesi ini.'
      : 'Presensi berhasil dikirim, tetapi jadwal yang cocok tidak ditemukan (atau sudah tercatat hadir). Hubungi tutor bila status kehadiranmu belum berubah.');
    res.redirect('/member/presence');
  } catch (err) {
    console.error(err);
    removeUploadedFile(req.file);
    req.flash('error', 'Gagal mengirim presensi.');
    res.redirect('/member/presence');
  }
};

exports.checkInPresence = async (req, res) => {
  req.flash('error', 'Presensi sekarang hanya lewat form Upload Bukti Presensi.');
  return res.redirect('/member/presence');
};

exports.uploadClassProof = async (req, res) => {
  removeUploadedFile(req.file);
  req.flash('error', 'Upload bukti presensi member hanya lewat form Upload Bukti Presensi.');
  return res.redirect('/member/presence');
};

exports.deleteClassProof = async (req, res) => {
  try {
    const userId = req.session.user.id;
    // member hanya bisa menghapus foto yang ia unggah sendiri
    const result = await query(
      'SELECT id, image FROM class_proofs WHERE id = $1 AND uploaded_by = $2',
      [req.params.id, userId]
    );
    const proof = result.rows[0];
    if (!proof) {
      req.flash('error', 'Foto tidak ditemukan.');
      return res.redirect('/member/presence');
    }
    await query('DELETE FROM class_proofs WHERE id = $1', [proof.id]);
    if (proof.image) fs.unlink(path.join(__dirname, '../../public', proof.image), () => {});
    req.flash('success', 'Foto kelas dihapus.');
    return res.redirect('/member/presence');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menghapus foto kelas.');
    return res.redirect('/member/presence');
  }
};

exports.questionnaire = async (req, res) => {
  try {
    if (req.session.user.role === 'admin') return res.redirect('/admin/questionnaire');
    const userId = req.session.user.id;
    await ensureTeachingQuestionnaires(query);
    const result = await query(`
      WITH question_counts AS (
        SELECT questionnaire_id, COUNT(*) AS cnt
        FROM questions
        GROUP BY questionnaire_id
      ),
      member_programs AS (
        SELECT program_id
        FROM enrollments
        WHERE member_id = $1 AND status = 'active'
        UNION
        SELECT s.program_id
        FROM schedule_members sm
        JOIN schedules s ON s.id = sm.schedule_id
        WHERE sm.member_id = $1 AND s.status <> 'cancelled'
      ),
      eligible_tutors AS (
        SELECT DISTINCT s.program_id, s.tutor_id, t.name AS tutor_name
        FROM schedule_members sm
        JOIN schedules s ON s.id = sm.schedule_id
        JOIN users t ON t.id = s.tutor_id
        WHERE sm.member_id = $1
          AND s.status <> 'cancelled'
          AND t.is_active = true
      ),
      ranked_questionnaires AS (
        SELECT q.*,
               p.name as program_name,
               COALESCE(qc.cnt, 0) AS question_count,
               ROW_NUMBER() OVER (
                 PARTITION BY (CASE WHEN COALESCE(qc.cnt, 0) > 0 THEN 'c' || q.id ELSE 'p' || p.name END)
                 ORDER BY q.created_at DESC, q.id DESC
               ) AS rn
        FROM questionnaires q
        JOIN programs p ON q.program_id = p.id
        LEFT JOIN question_counts qc ON qc.questionnaire_id = q.id
        WHERE q.program_id IN (SELECT program_id FROM member_programs)
          AND q.is_active = true
          AND (${teachingQuestionnaireFilter('q')} OR COALESCE(qc.cnt, 0) > 0)
      ),
      available AS (
        SELECT rq.*,
               et.tutor_id,
               et.tutor_name,
               qr.id as response_id,
               qr.score,
               qr.max_score,
               qr.submitted_at
        FROM ranked_questionnaires rq
        JOIN eligible_tutors et ON et.program_id = rq.program_id
        LEFT JOIN questionnaire_responses qr
          ON rq.id = qr.questionnaire_id
         AND qr.member_id = $1
         AND qr.tutor_id = et.tutor_id
        WHERE rq.rn = 1
          AND rq.question_count = 0
          AND ${teachingQuestionnaireFilter('rq')}

        UNION ALL

        SELECT rq.*,
               NULL::integer AS tutor_id,
               NULL::varchar AS tutor_name,
               qr.id as response_id,
               qr.score,
               qr.max_score,
               qr.submitted_at
        FROM ranked_questionnaires rq
        LEFT JOIN questionnaire_responses qr
          ON rq.id = qr.questionnaire_id
         AND qr.member_id = $1
         AND qr.tutor_id IS NULL
        WHERE rq.rn = 1
          AND rq.question_count > 0
      )
      SELECT *
      FROM available
      ORDER BY (tutor_id IS NULL), created_at DESC, program_name, tutor_name NULLS LAST
    `, [userId]);
    res.render('member/questionnaire', {
      title: 'Questionnaire',
      user: req.session.user,
      activeNav: 'member',
      basePath: '/member/questionnaire',
      questionnaires: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.questionnaireShow = async (req, res) => {
  try {
    if (req.session.user.role === 'admin') return res.redirect(`/admin/questionnaire/${req.params.id}`);
    const { id } = req.params;
    const userId = req.session.user.id;
    await ensureTeachingQuestionnaires(query);
    const [qResult, questionsResult] = await Promise.all([
      query(`SELECT q.*, p.name as program_name
             FROM questionnaires q
             JOIN programs p ON q.program_id = p.id
             WHERE q.id = $1
               AND q.is_active = true
               AND q.program_id IN (
                 SELECT program_id FROM enrollments WHERE member_id = $2 AND status = 'active'
                 UNION
                 SELECT s.program_id
                 FROM schedule_members sm
                 JOIN schedules s ON s.id = sm.schedule_id
                 WHERE sm.member_id = $2 AND s.status <> 'cancelled'
               )`, [id, userId]),
      query('SELECT * FROM questions WHERE questionnaire_id = $1 ORDER BY order_number', [id]),
    ]);
    const questionnaire = qResult.rows[0];
    if (!questionnaire) return res.redirect('/member/questionnaire');
    const teachingMode = isTeachingMode(questionnaire, questionsResult.rows.length);
    const requestedTutorId = Number(req.query.tutor_id) || null;
    let tutors = [];
    let selectedTutor = null;
    let periods = [];

    if (teachingMode) {
      const tutorsRes = await query(`
        SELECT DISTINCT t.id, t.name
        FROM schedule_members sm
        JOIN schedules s ON s.id = sm.schedule_id
        JOIN users t ON t.id = s.tutor_id
        WHERE sm.member_id = $1
          AND s.program_id = $2
          AND s.status <> 'cancelled'
          AND t.is_active = true
        ORDER BY t.name
      `, [userId, questionnaire.program_id]);
      tutors = tutorsRes.rows;
      selectedTutor = tutors.find((t) => Number(t.id) === requestedTutorId) || (tutors.length === 1 ? tutors[0] : null);
      if (!selectedTutor) {
        req.flash('error', 'Pilih questionnaire dari kartu program dan tutor yang tersedia.');
        return res.redirect('/member/questionnaire');
      }
      const periodsRes = await query(`
        SELECT DISTINCT date_trunc('week', s.date)::date AS period_start
        FROM schedule_members sm
        JOIN schedules s ON s.id = sm.schedule_id
        WHERE sm.member_id = $1
          AND s.program_id = $2
          AND s.tutor_id = $3
          AND s.status <> 'cancelled'
        ORDER BY period_start DESC
      `, [userId, questionnaire.program_id, selectedTutor.id]);
      periods = periodsRes.rows.map((p) => ({
        value: at.toISODate(p.period_start),
        label: at.formatPeriodLabel(p.period_start),
      }));
    } else {
      const periodsRes = await query('SELECT period_start, label FROM periods ORDER BY period_start DESC');
      periods = periodsRes.rows.map((p) => ({
        value: at.toISODate(p.period_start),
        label: p.label || at.formatPeriodLabel(p.period_start),
      }));
    }

    const responseResult = teachingMode
      ? await query('SELECT * FROM questionnaire_responses WHERE questionnaire_id = $1 AND member_id = $2 AND tutor_id = $3', [id, userId, selectedTutor.id])
      : await query('SELECT * FROM questionnaire_responses WHERE questionnaire_id = $1 AND member_id = $2 AND tutor_id IS NULL', [id, userId]);

    res.render('member/questionnaire-take', {
      title: questionnaire.title,
      user: req.session.user,
      activeNav: 'member',
      backHref: '/member/questionnaire',
      submitBasePath: '/member/questionnaire',
      questionnaire,
      questions: questionsResult.rows,
      response: responseResult.rows[0] || null,
      isTeachingQuestionnaire: teachingMode,
      teachingRatings,
      teachingEssays,
      ratingLabels,
      teachingOptions: {
        tutors,
        selectedTutor,
        programs: [{ id: questionnaire.program_id, name: questionnaire.program_name }],
        selectedProgram: { id: questionnaire.program_id, name: questionnaire.program_name },
        periods,
      },
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.questionnaireSubmit = async (req, res) => {
  try {
    if (req.session.user.role === 'admin') {
      req.flash('error', 'Admin hanya dapat melihat hasil questionnaire.');
      return res.redirect('/admin/questionnaire');
    }
    const { id } = req.params;
    const userId = req.session.user.id;
    const answers = req.body;

    await ensureTeachingQuestionnaires(query);
    const qResult = await query(`
      SELECT q.*, p.name as program_name
      FROM questionnaires q
      JOIN programs p ON p.id = q.program_id
      WHERE q.id = $1
        AND q.is_active = true
        AND q.program_id IN (
          SELECT program_id FROM enrollments WHERE member_id = $2 AND status = 'active'
          UNION
          SELECT s.program_id
          FROM schedule_members sm
          JOIN schedules s ON s.id = sm.schedule_id
          WHERE sm.member_id = $2 AND s.status <> 'cancelled'
        )
    `, [id, userId]);
    const questionnaire = qResult.rows[0];
    if (!questionnaire) {
      req.flash('error', 'Questionnaire tidak tersedia untuk akun kamu.');
      return res.redirect('/member/questionnaire');
    }
    const questionsResult = await query('SELECT * FROM questions WHERE questionnaire_id = $1', [id]);
    const questions = questionsResult.rows;

    if (questionnaire && isTeachingMode(questionnaire, questions.length)) {
      const tutorId = Number(req.body.tutor_id) || null;
      if (!tutorId) {
        req.flash('error', 'Tutor wajib dipilih dari kartu questionnaire.');
        return res.redirect('/member/questionnaire');
      }
      const tutorResult = await query(`
        SELECT DISTINCT t.id, t.name
        FROM schedule_members sm
        JOIN schedules s ON s.id = sm.schedule_id
        JOIN users t ON t.id = s.tutor_id
        WHERE sm.member_id = $1
          AND s.program_id = $2
          AND s.tutor_id = $3
          AND s.status <> 'cancelled'
          AND t.is_active = true
        LIMIT 1
      `, [userId, questionnaire.program_id, tutorId]);
      const tutor = tutorResult.rows[0];
      if (!tutor) {
        req.flash('error', 'Tutor tidak sesuai dengan jadwal/program kamu.');
        return res.redirect('/member/questionnaire');
      }
      const built = buildTeachingQuestionnaireAnswer(req.body);
      built.answers.tutor_id = String(tutor.id);
      built.answers.tutor_name = tutor.name;
      built.answers.study_program_id = String(questionnaire.program_id);
      built.answers.study_program_name = questionnaire.program_name;
      const inserted = await query(`
        INSERT INTO questionnaire_responses
          (questionnaire_id, member_id, tutor_id, study_program_id, study_period, answers, score, max_score, started_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (questionnaire_id, member_id, tutor_id) WHERE tutor_id IS NOT NULL
        DO UPDATE SET study_program_id=$4, study_period=$5, answers=$6, score=$7, max_score=$8, submitted_at=NOW()
        RETURNING id
      `, [id, userId, tutor.id, questionnaire.program_id, built.answers.study_period || null, JSON.stringify(built.answers), built.score, built.maxScore]);
      syncQuestionnaire(inserted.rows[0].id)
        .catch((e) => console.error('Gagal sinkronisasi questionnaire ke spreadsheet:', e.message));
      req.flash('success', `Questionnaire berhasil dikumpulkan. Skor: ${built.score}/${built.maxScore}`);
      return res.redirect('/member/questionnaire');
    }

    let score = 0;
    let maxScore = 0;
    const answerMap = {};

    questions.forEach(q => {
      maxScore += q.question_type === 'rating' ? 5 : q.points;
      const userAnswer = answers[`q_${q.id}`] || '';
      answerMap[q.id] = userAnswer;
      if (q.question_type === 'multiple_choice' && userAnswer === q.correct_answer) {
        score += q.points;
      } else if (q.question_type === 'essay') {
        // Essay graded manually, give partial credit
        score += q.points > 0 && userAnswer.trim().length > 10 ? Math.floor(q.points * 0.5) : 0;
      } else if (q.question_type === 'rating') {
        score += Number(userAnswer || 0);
      }
    });

    const insertedCustom = await query(`
      INSERT INTO questionnaire_responses (questionnaire_id, member_id, tutor_id, study_program_id, answers, score, max_score, started_at)
      VALUES ($1, $2, NULL, $3, $4, $5, $6, NOW())
      ON CONFLICT (questionnaire_id, member_id) WHERE tutor_id IS NULL
      DO UPDATE SET study_program_id=$3, answers=$4, score=$5, max_score=$6, submitted_at=NOW()
      RETURNING id
    `, [id, userId, questionnaire.program_id, JSON.stringify(answerMap), score, maxScore]);
    syncQuestionnaire(insertedCustom.rows[0].id)
      .catch((e) => console.error('Gagal sinkronisasi questionnaire ke spreadsheet:', e.message));

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
    await ensureMemberReportsTable(query);
    await ensureDiagnosticReportsTable(query);
    const isLuxury = req.session.user.is_luxury;

    const periodFilter = req.query.period || '';
    const reportParams = [userId];
    let periodWhere = '';
    if (periodFilter) {
      reportParams.push(periodFilter);
      periodWhere = ` AND mr.period_start = $${reportParams.length}::date`;
    }

    const [enrollResult, presStats, quizStats, reportsRes, periodOptionsRes] = await Promise.all([
      query(`SELECT e.*, p.name as program_name FROM enrollments e JOIN programs p ON e.program_id = p.id WHERE e.member_id = $1`, [userId]),
      query(`
        SELECT p.name as program_name,
               COUNT(sm.schedule_id) as total_schedules,
               COUNT(sm.schedule_id) FILTER (WHERE COALESCE(pr.status, 'absent') = 'present') as present_count,
               COUNT(sm.schedule_id) FILTER (WHERE COALESCE(pr.status, 'absent') = 'late') as late_count
        FROM programs p
        JOIN schedules s ON s.program_id = p.id
        JOIN schedule_members sm ON sm.schedule_id = s.id AND sm.member_id = $1
        LEFT JOIN presences pr ON s.id = pr.schedule_id AND pr.member_id = $1
        WHERE p.id IN (SELECT program_id FROM enrollments WHERE member_id = $1)
        GROUP BY p.name
      `, [userId]),
      query(`
        SELECT q.title, qr.score, qr.max_score, qr.submitted_at
        FROM questionnaire_responses qr JOIN questionnaires q ON qr.questionnaire_id = q.id
        WHERE qr.member_id = $1 ORDER BY qr.submitted_at DESC
      `, [userId]),
      query(`
        SELECT mr.*, t.name as tutor_name, p.name as program_name
        FROM member_reports mr
        JOIN users t ON t.id = mr.tutor_id
        JOIN programs p ON p.id = mr.program_id
        WHERE mr.member_id = $1${periodWhere}
        ORDER BY mr.period_start DESC, mr.updated_at DESC
      `, reportParams),
      query(`
        SELECT DISTINCT to_char(mr.period_start, 'YYYY-MM-DD') AS period_value, pr.label
        FROM member_reports mr
        LEFT JOIN periods pr ON pr.period_start = mr.period_start
        WHERE mr.member_id = $1
        ORDER BY period_value DESC
      `, [userId]),
    ]);
    // Diagnostic Test Report hanya untuk member Luxury.
    let diagnosticReports = [];
    if (isLuxury) {
      const dr = await query(
        `SELECT id, title, file_url, uploader_name, uploader_role, created_at
         FROM diagnostic_reports WHERE member_id = $1 ORDER BY created_at DESC`,
        [userId]
      );
      diagnosticReports = dr.rows;
    }

    res.render('member/report', {
      title: 'Laporan Member',
      user: req.session.user,
      enrollments: enrollResult.rows,
      presStats: presStats.rows,
      quizStats: quizStats.rows,
      reports: reportsRes.rows,
      periodOptions: periodOptionsRes.rows,
      filters: { period: periodFilter },
      isLuxury,
      diagnosticReports,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.reportDetail = async (req, res) => {
  try {
    const userId = req.session.user.id;
    await ensureMemberReportsTable(query);
    const result = await query(`
      SELECT mr.*, m.name as member_name, m.photo as member_photo,
             t.name as tutor_name, p.name as program_name
      FROM member_reports mr
      JOIN users m ON m.id = mr.member_id
      JOIN users t ON t.id = mr.tutor_id
      JOIN programs p ON p.id = mr.program_id
      WHERE mr.id = $1 AND mr.member_id = $2
    `, [req.params.id, userId]);
    const report = result.rows[0];
    if (!report) return res.redirect('/member/report');
    const days = normalizeReportDays(report.days);
    res.render('shared/member-report-detail', {
      title: 'Detail Member Report',
      user: req.session.user,
      activeNav: 'member',
      backHref: '/member/report',
      canEdit: false,
      report,
      reportDays: Array.from({ length: 15 }, (_, idx) => ({
        number: idx + 1,
        key: `day_${idx + 1}`,
        text: days[`day_${idx + 1}`],
      })),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.certificate = async (req, res) => {
  try {
    const userId = req.session.user.id;
    await ensureCertificateDetailsColumn(query);
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

exports.certificatePrint = async (req, res) => {
  try {
    const userId = req.session.user.id;
    await ensureCertificateDetailsColumn(query);
    const result = await query(`
      SELECT c.*, p.name as program_name
      FROM certificates c JOIN programs p ON c.program_id = p.id
      WHERE c.id = $1 AND c.member_id = $2 AND c.is_active = true
    `, [req.params.id, userId]);
    if (!result.rows.length) {
      req.flash('error', 'Sertifikat tidak ditemukan.');
      return res.redirect('/member/certificate');
    }
    res.render('member/certificate-print', {
      title: 'Sertifikat',
      user: req.session.user,
      cert: result.rows[0],
      autoPrint: req.query.preview !== '1',
      embed: req.query.embed === '1',
      backHref: '/member/certificate',
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
    const { name, phone, bio, current_password, new_password, confirm_password } = req.body;
    let photoPath = null;

    if (new_password || confirm_password || current_password) {
      if (!current_password || !new_password || !confirm_password) {
        removeUploadedFile(req.file);
        req.flash('error', 'Lengkapi password lama, password baru, dan konfirmasi password.');
        return res.redirect('/member/profile');
      }
      if (new_password.length < 6) {
        removeUploadedFile(req.file);
        req.flash('error', 'Password baru minimal 6 karakter.');
        return res.redirect('/member/profile');
      }
      if (new_password !== confirm_password) {
        removeUploadedFile(req.file);
        req.flash('error', 'Konfirmasi password baru tidak cocok.');
        return res.redirect('/member/profile');
      }

      const userPassword = await query('SELECT password FROM users WHERE id = $1', [userId]);
      const validPassword = await bcrypt.compare(current_password, userPassword.rows[0].password);
      if (!validPassword) {
        removeUploadedFile(req.file);
        req.flash('error', 'Password lama tidak sesuai.');
        return res.redirect('/member/profile');
      }
    }

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
    if (new_password) {
      const hashedPassword = await bcrypt.hash(new_password, 10);
      await query('UPDATE users SET password=$1, updated_at=NOW() WHERE id=$2', [hashedPassword, userId]);
    }

    const updated = await query('SELECT * FROM users WHERE id = $1', [userId]);
    req.session.user = {
      id: updated.rows[0].id,
      name: updated.rows[0].name,
      email: updated.rows[0].email,
      role: updated.rows[0].role,
      photo: updated.rows[0].photo,
      is_vip: updated.rows[0].is_vip,
      is_luxury: updated.rows[0].is_luxury,
    };
    req.flash('success', new_password ? 'Profil dan password berhasil diperbarui.' : 'Profil berhasil diperbarui.');
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
    await ensureRenewalRequestsTable(query);
    const [enrollResult, programsResult, requestsResult, profileResult, registrationsResult, periodsResult] = await Promise.all([
      query(`SELECT e.*, p.name as program_name, p.description as program_description, p.price, p.duration_months
             FROM enrollments e JOIN programs p ON e.program_id = p.id
             WHERE e.member_id = $1 ORDER BY e.end_date`, [userId]),
      query('SELECT * FROM programs WHERE is_active = true ORDER BY price'),
      query(`SELECT rr.*, p.name AS program_name
             FROM renewal_requests rr
             JOIN programs p ON p.id = rr.program_id
             WHERE rr.member_id = $1
             ORDER BY rr.created_at DESC
             LIMIT 8`, [userId]),
      query('SELECT phone FROM users WHERE id = $1', [userId]),
      query(`SELECT selected_class, package_group, package_name, package_price, study_time, start_date, created_at
             FROM member_registrations WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
      query('SELECT period_start, label FROM periods ORDER BY period_start'),
    ]);

    // Original-registration data used to prefill class, package, and study time.
    const registrations = registrationsResult.rows;
    const latestReg = registrations[0] || null;
    const regByClass = new Map();
    registrations.forEach((r) => {
      const key = String(r.selected_class || '').trim().toLowerCase();
      if (key && !regByClass.has(key)) regByClass.set(key, r);
    });

    // Normalise admin WhatsApp (0xxxx -> 62xxxx) for the renewal request link.
    let adminWhatsapp = String(process.env.ADMIN_WHATSAPP || '').replace(/\D/g, '');
    if (adminWhatsapp.startsWith('0')) adminWhatsapp = `62${adminWhatsapp.slice(1)}`;
    else if (adminWhatsapp.startsWith('8')) adminWhatsapp = `62${adminWhatsapp}`;

    const now = new Date();
    const enrollments = enrollResult.rows.map((e) => {
      const start = e.start_date ? new Date(e.start_date) : null;
      const end = e.end_date ? new Date(e.end_date) : null;
      const daysLeft = end ? Math.ceil((end - now) / (1000 * 60 * 60 * 24)) : null;
      const totalDays = start && end ? Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24))) : 0;
      const elapsedDays = start ? Math.max(0, Math.ceil((now - start) / (1000 * 60 * 60 * 24))) : 0;
      const progress = totalDays ? Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100))) : 0;
      let urgency = 'safe';
      let statusText = 'Aktif';
      if (daysLeft !== null && daysLeft < 0) {
        urgency = 'expired';
        statusText = 'Sudah berakhir';
      } else if (daysLeft !== null && daysLeft <= 7) {
        urgency = 'danger';
        statusText = 'Segera renewal';
      } else if (daysLeft !== null && daysLeft <= 14) {
        urgency = 'warning';
        statusText = 'Hampir selesai';
      }
      return { ...e, days_left: daysLeft, progress, urgency, status_text: statusText };
    });

    const active = enrollments.filter((e) => e.status === 'active' && e.end_date);
    let nearestDays = null;
    active.forEach((e) => {
      const d = e.days_left;
      if (nearestDays === null || d < nearestDays) nearestDays = d;
    });
    const recommended = active.length
      ? [...active].sort((a, b) => (a.days_left ?? 9999) - (b.days_left ?? 9999))[0]
      : null;

    const activeProgramNames = new Set(active.map((e) => String(e.program_name || '').trim().toLowerCase()));
    const uniquePrograms = [];
    const seenPrograms = new Set();
    programsResult.rows.forEach((program) => {
      const key = String(program.name || '').trim().toLowerCase();
      if (!key || seenPrograms.has(key)) return;
      seenPrograms.add(key);
      const currentEnrollment = active.find((e) => String(e.program_name || '').trim().toLowerCase() === key);
      // Prefill class/package/study-time from the member's original registration:
      // prefer a registration whose selected_class matches this program, else the latest.
      const reg = regByClass.get(key) || latestReg;
      // Package price catalog for this program (real prices — the programs table
      // itself has no price column). Renewal total = package price - discount.
      const packages = packagesForProgram(program.name).map((p) => ({ name: p.name, price: p.price, note: p.note || '' }));
      const defaultPackagePrice = packages.length ? packages[0].price : Number(program.price || 0);
      const basePrice = reg && reg.package_price ? Number(reg.package_price) : defaultPackagePrice;
      uniquePrograms.push({
        ...program,
        packages,
        renewal_price: renewalPriceFor(basePrice),
        is_current: activeProgramNames.has(key),
        current_end_date: currentEnrollment ? currentEnrollment.end_date : null,
        current_days_left: currentEnrollment ? currentEnrollment.days_left : null,
        prefill_class: reg ? (reg.selected_class || '') : '',
        prefill_package: reg ? (reg.package_name || '') : '',
        prefill_package_price: reg && reg.package_price ? Number(reg.package_price) : defaultPackagePrice,
        prefill_study_time: reg ? (reg.study_time || '') : '',
      });
    });

    // Map catalog class name -> programs.id so the registration-style class picker
    // (which selects by class name) can resolve the program_id the backend needs.
    const programIdByName = {};
    programsResult.rows.forEach((p) => {
      const key = String(p.name || '').trim().toLowerCase();
      if (key && !(key in programIdByName)) programIdByName[key] = p.id;
    });

    res.render('member/renewal', {
      title: 'Perpanjang Program',
      user: req.session.user,
      enrollments,
      programs: uniquePrograms,
      renewalRequests: requestsResult.rows,
      studyTimes: STUDY_TIME_SLOTS,
      programCatalog: PROGRAM_CATALOG,
      priceList: PRICE_LIST,
      programIdByName,
      periods: periodsResult.rows.map((p) => ({
        value: at.toISODate(p.period_start),
        label: p.label || at.formatPeriodLabel(p.period_start),
      })),
      memberPhone: profileResult.rows[0] ? profileResult.rows[0].phone : '',
      adminWhatsapp,
      recommended,
      stats: {
        activeCount: active.length,
        nearestDays,
        availablePrograms: uniquePrograms.length,
        expiringSoon: active.filter((e) => e.days_left !== null && e.days_left <= 14).length,
      },
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.submitRenewal = async (req, res) => {
  try {
    const userId = req.session.user.id;
    await ensureRenewalRequestsTable(query);

    const programId = Number(req.body.program_id);
    const requestType = 'renewal';
    const preferredStartDate = req.body.preferred_start_date || null;
    const studyTime = String(req.body.study_time || '').trim();
    const phone = String(req.body.phone || '').trim();
    const notes = String(req.body.notes || '').trim();
    const selectedClass = String(req.body.selected_class || '').trim();
    const postedPackageName = String(req.body.package_name || '').trim();
    const postedPackagePrice = Number(req.body.package_price || 0);

    if (!programId || !preferredStartDate || !studyTime || !phone) {
      removeUploadedFile(req.file);
      req.flash('error', 'Lengkapi program, tanggal mulai, jam belajar, dan WhatsApp.');
      return res.redirect('/member/renewal#renewal-form');
    }
    // Kelas Semi Private hanya dibuka 2 minggu sekali.
    if (/semi/i.test(postedPackageName) && !isSemiPrivateStart(preferredStartDate)) {
      removeUploadedFile(req.file);
      req.flash('error', 'Kelas Semi Private dibuka 2 minggu sekali. Pilih periode yang tersedia.');
      return res.redirect('/member/renewal#renewal-form');
    }

    const [memberResult, programResult] = await Promise.all([
      query('SELECT name, email FROM users WHERE id = $1', [userId]),
      query('SELECT id, name, price FROM programs WHERE id = $1 AND is_active = true', [programId]),
    ]);

    const member = memberResult.rows[0];
    const program = programResult.rows[0];
    if (!member || !program) {
      removeUploadedFile(req.file);
      req.flash('error', 'Program tidak ditemukan atau sudah tidak aktif.');
      return res.redirect('/member/renewal#renewal-form');
    }

    const proofPath = req.file ? `/uploads/${req.file.filename}` : null;
    // Base price comes from the original registration's package (prefilled on the
    // form); fall back to the program price. Renewal discount is applied on top.
    const basePrice = postedPackagePrice > 0 ? postedPackagePrice : Number(program.price || 0);
    const packagePrice = renewalPriceFor(basePrice);
    const packageName = postedPackageName || program.name;
    const inserted = await query(`
      INSERT INTO renewal_requests (
        member_id, program_id, request_type, member_name, member_email, phone,
        preferred_start_date, study_time, selected_class, package_name, package_price,
        transfer_proof, notes, status, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',NOW())
      RETURNING id
    `, [
      userId,
      programId,
      requestType,
      member.name,
      member.email,
      phone,
      preferredStartDate,
      studyTime,
      selectedClass || null,
      packageName,
      packagePrice,
      proofPath,
      notes || null,
    ]);

    // Fire email notifications (member + admin) and spreadsheet sync — non-blocking.
    const renewalId = inserted.rows[0].id;
    const renewal = {
      member_name: member.name,
      member_email: member.email,
      phone,
      program_name: program.name,
      selected_class: selectedClass,
      package_name: packageName,
      package_price: packagePrice,
      discount: RENEWAL_DISCOUNT,
      preferred_start_date: preferredStartDate,
      study_time: studyTime,
      notes,
    };
    const tasks = [
      ['email renewal member', sendRenewalEmail(renewal)],
      ['email renewal admin', sendRenewalAdminEmail(renewal)],
      ['sinkronisasi renewal spreadsheet', syncRenewal(renewalId)],
    ];
    Promise.allSettled(tasks.map(([, p]) => p)).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`Gagal ${tasks[i][0]}:`, r.reason && r.reason.message);
      });
    });

    req.flash('success', 'Form renewal berhasil dikirim. Admin akan mengecek dan memproses request kamu.');
    return res.redirect('/member/renewal#riwayat-renewal');
  } catch (err) {
    console.error(err);
    removeUploadedFile(req.file);
    req.flash('error', 'Gagal mengirim form renewal.');
    return res.redirect('/member/renewal#renewal-form');
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
    // Video tanpa program (program_id NULL) = bonus umum: tampil ke semua member
    // Luxury. Video ber-program hanya tampil bila member aktif di program itu.
    // Bonus umum ditaruh paling atas.
    const result = await query(`
      SELECT v.*, p.name as program_name
      FROM videos v LEFT JOIN programs p ON v.program_id = p.id
      WHERE v.program_id IS NULL
         OR v.program_id IN (SELECT program_id FROM enrollments WHERE member_id = $1 AND status = 'active')
      ORDER BY (v.program_id IS NOT NULL), v.program_id, v.order_number
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

exports.helpSupport = (req, res) => {
  res.render('shared/help-support', {
    title: 'Help & Support',
    user: req.session.user,
    activeNav: 'member',
    basePath: '/member/help-support',
    backHref: '/member',
    roleLabel: 'Member',
    supportEmail: SUPPORT_EMAIL,
    error: req.flash('error'),
    success: req.flash('success'),
  });
};

exports.submitHelpSupport = async (req, res) => {
  try {
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    if (!subject || message.length < 10) {
      req.flash('error', 'Lengkapi subjek dan isi feedback minimal 10 karakter.');
      return res.redirect('/member/help-support');
    }

    const payload = {
      user: req.session.user,
      roleLabel: 'Member',
      category: req.body.category || 'Feedback',
      priority: req.body.priority || 'Normal',
      subject,
      message,
      pageUrl: req.body.page_url,
      contactEmail: req.body.contact_email,
    };
    const feedback = await saveSupportFeedback(query, payload);
    let result;
    try {
      result = await sendSupportFeedback(payload);
      await updateSupportFeedbackEmailStatus(query, feedback.id, result.skipped ? 'skipped' : 'sent');
    } catch (emailErr) {
      console.error(emailErr);
      await updateSupportFeedbackEmailStatus(query, feedback.id, 'failed', emailErr.message);
      result = { failed: true };
    }

    req.flash((result.skipped || result.failed) ? 'error' : 'success',
      result.skipped
        ? 'Feedback belum terkirim karena SMTP belum dikonfigurasi.'
        : result.failed
          ? 'Feedback tersimpan, tetapi email belum terkirim. Admin tetap bisa melihatnya.'
        : 'Feedback berhasil dikirim. Terima kasih!');
    return res.redirect('/member/help-support');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengirim feedback. Coba lagi beberapa saat.');
    return res.redirect('/member/help-support');
  }
};
