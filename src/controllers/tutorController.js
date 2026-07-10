const { query, pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const at = require('../utils/availableTime');
const { toCsv } = require('../utils/csv');
const { syncTutorAvailableTime, syncCertificate } = require('../utils/spreadsheetSync');
const { sendScheduleNotificationEmails } = require('../utils/scheduleEmail');
const { emptyReportDays, normalizeReportDays, ensureMemberReportsTable } = require('../utils/memberReports');
const { ensureCertificateDetailsColumn, normalizeCertificateDetails } = require('../utils/certificates');
const { SUPPORT_EMAIL, sendSupportFeedback } = require('../utils/supportEmail');
const { saveSupportFeedback, updateSupportFeedbackEmailStatus } = require('../utils/supportFeedback');
const {
  isTeachingQuestionnaire,
  teachingQuestionnaireFilter,
  teachingRatings,
  teachingEssays,
  ratingLabels,
  buildTeachingQuestionnaireAnswer,
  ensureTeachingQuestionnaires,
} = require('../utils/questionnaireTemplate');

// Fire-and-forget spreadsheet sync of a tutor's full available time snapshot.
// Never blocks the redirect; errors are logged only.
const pushAvailableTimeSync = (tutorId) => {
  syncTutorAvailableTime(tutorId).catch((e) =>
    console.error('Gagal sinkronisasi available time ke spreadsheet:', e.message));
};

const removeUploadedFile = (file) => {
  if (!file) return;
  fs.unlink(path.join(__dirname, '../../public/uploads', file.filename), () => {});
};

exports.dashboard = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const currentPeriod = at.currentPeriodValue();
    const [schedResult, memberCount, presStats, attendance, pendingPresence, availThisWeek] = await Promise.all([
      query(`SELECT s.*, p.name as program_name,
               COUNT(pr.id) FILTER (WHERE pr.status = 'present') as present_count
             FROM schedules s JOIN programs p ON s.program_id = p.id
             LEFT JOIN schedule_members sm ON s.id = sm.schedule_id
             LEFT JOIN presences pr ON s.id = pr.schedule_id AND pr.member_id = sm.member_id
             WHERE s.tutor_id = $1 AND s.date >= CURRENT_DATE
             GROUP BY s.id, p.name ORDER BY s.date LIMIT 5`, [tutorId]),
      query(`SELECT COUNT(DISTINCT e.member_id) as total
             FROM schedule_members sm
             JOIN schedules s ON sm.schedule_id = s.id
             JOIN enrollments e ON e.member_id = sm.member_id AND e.program_id = s.program_id
             WHERE s.tutor_id = $1 AND e.status = 'active'`, [tutorId]),
      query(`SELECT COUNT(*) as total_schedules,
               COUNT(*) FILTER (WHERE status = 'completed') as completed
             FROM schedules WHERE tutor_id = $1`, [tutorId]),
      query(`SELECT COUNT(*) FILTER (WHERE pr.status = 'present') as present, COUNT(*) as total
             FROM presences pr JOIN schedules s ON pr.schedule_id = s.id
             WHERE s.tutor_id = $1`, [tutorId]),
      query(`SELECT s.id, s.title, s.date, s.start_time, s.end_time, p.name as program_name,
               COUNT(sm.member_id) as member_count
             FROM schedules s JOIN programs p ON s.program_id = p.id
             LEFT JOIN schedule_members sm ON sm.schedule_id = s.id
             WHERE s.tutor_id = $1 AND s.date <= CURRENT_DATE
               AND s.status <> 'completed' AND s.status <> 'cancelled'
             GROUP BY s.id, p.name ORDER BY s.date DESC LIMIT 6`, [tutorId]),
      query('SELECT 1 FROM available_times WHERE tutor_id = $1 AND period_start = $2::date LIMIT 1', [tutorId, currentPeriod]),
    ]);

    const att = attendance.rows[0];
    const attendanceRate = Number(att.total) > 0 ? Math.round((Number(att.present) / Number(att.total)) * 100) : 0;

    res.render('tutor/dashboard', {
      title: 'Tutor Area',
      user: req.session.user,
      upcomingSchedules: schedResult.rows,
      memberCount: memberCount.rows[0].total,
      presStats: presStats.rows[0],
      attendanceRate,
      pendingPresence: pendingPresence.rows,
      hasAvailableThisWeek: availThisWeek.rows.length > 0,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.schedule = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    // Grouped per PERIODE (registration week); per-session detail lives on Presensi.
    const period = /^\d{4}-\d{2}-\d{2}$/.test(req.query.period || '') ? req.query.period : '';

    const params = [tutorId];
    let periodFilter = '';
    if (period) { params.push(period); periodFilter = ` AND date_trunc('week', s.date)::date = $${params.length}::date`; }

    const [schedResult, programsResult, periodsResult] = await Promise.all([
      query(`SELECT s.*, p.name as program_name,
             COUNT(sm.member_id) as registered_count,
             COUNT(pr.id) FILTER (WHERE pr.status = 'present') as present_count,
               COALESCE(
                 JSON_AGG(
                   JSON_BUILD_OBJECT('id', u.id, 'name', u.name, 'phone', u.phone, 'presence_status', COALESCE(pr.status, 'absent'))
                   ORDER BY u.name
                 ) FILTER (WHERE u.id IS NOT NULL),
                 '[]'::json
               ) as members
             FROM schedules s JOIN programs p ON s.program_id = p.id
             LEFT JOIN schedule_members sm ON s.id = sm.schedule_id
             LEFT JOIN users u ON sm.member_id = u.id
             LEFT JOIN presences pr ON s.id = pr.schedule_id AND pr.member_id = sm.member_id
             WHERE s.tutor_id = $1${periodFilter}
             GROUP BY s.id, p.name ORDER BY s.date ASC, s.start_time ASC`, params),
      query('SELECT * FROM programs WHERE is_active = true ORDER BY name'),
      query(`
        SELECT DISTINCT date_trunc('week', s.date)::date AS period_start
        FROM schedules s WHERE s.tutor_id = $1
        ORDER BY period_start DESC
      `, [tutorId]),
    ]);

    // Group the tutor's sessions by weekly period AND per member —
    // satu kartu untuk tiap member di tiap periode (terpisah antar member).
    const today = at.toISODate(new Date());
    const groups = new Map();
    schedResult.rows.forEach((s) => {
      const periodKey = at.mondayOf(s.date);
      const memberList = Array.isArray(s.members) ? s.members : [];
      const targets = memberList.length ? memberList : [null]; // sesi tanpa peserta tetap tampil
      targets.forEach((m) => {
        const key = periodKey + '|' + (m && m.id ? m.id : 0);
        if (!groups.has(key)) {
          groups.set(key, {
            period_start: periodKey,
            label: at.formatPeriodRange(periodKey),
            member: m && m.id ? { id: m.id, name: m.name, phone: m.phone || '' } : null,
            programs: new Set(),
            locations: new Set(),
            counts: { total: 0, upcoming: 0, completed: 0, cancelled: 0 },
            present_total: 0,
            next: null,
            firstSessionId: null,
            sessions: [],
          });
        }
        const g = groups.get(key);
        if (s.program_name) g.programs.add(s.program_name);
        if (s.location) g.locations.add(s.location);
        g.counts.total += 1;
        if (m && m.presence_status === 'present') g.present_total += 1;
        const isFuture = s.status !== 'cancelled' && at.toISODate(s.date) >= today;
        if (s.status === 'cancelled') g.counts.cancelled += 1;
        else if (isFuture) g.counts.upcoming += 1;
        else g.counts.completed += 1;
        if (g.firstSessionId === null) g.firstSessionId = s.id;
        if (isFuture && !g.next) g.next = s;
        g.sessions.push({
          date: s.date, start_time: s.start_time, end_time: s.end_time,
          program_name: s.program_name, location: s.location || '',
          meeting_link: s.meeting_link || '', status: s.status,
          kategori: s.kategori || '', paket: s.paket || '', durasi: s.durasi || '',
          presence_status: m ? m.presence_status : null,
        });
      });
    });

    // Kategori/Paket/Durasi per member — diambil dari pendaftaran (member_registrations).
    const memberIds = Array.from(
      new Set(Array.from(groups.values()).filter((g) => g.member).map((g) => g.member.id))
    );
    const regByMember = new Map(); // `${memberId}|${programLower}` -> info
    const regDefaultByMember = new Map(); // memberId -> first info
    if (memberIds.length) {
      const KAT = { adult: 'Adult', kids: 'Kids' };
      const regRows = await query(
        `SELECT user_id, selected_class, package_name, package_group, program_type, duration
         FROM member_registrations WHERE user_id = ANY($1) ORDER BY created_at DESC`,
        [memberIds]
      );
      regRows.rows.forEach((r) => {
        const info = {
          paket: r.package_name || r.package_group || '-',
          kategori: KAT[r.program_type] || r.program_type || '-',
          durasi: r.duration || '-',
        };
        if (!regDefaultByMember.has(r.user_id)) regDefaultByMember.set(r.user_id, info);
        const k = String(r.selected_class || '').trim().toLowerCase();
        if (k) {
          const mk = r.user_id + '|' + k;
          if (!regByMember.has(mk)) regByMember.set(mk, info);
        }
      });
    }

    const periodGroups = Array.from(groups.values())
      .map((g) => {
        const firstProg = Array.from(g.programs)[0] || '';
        const reg = (g.member && (
          regByMember.get(g.member.id + '|' + firstProg.toLowerCase()) ||
          regDefaultByMember.get(g.member.id)
        )) || {};
        const zoomLink = (g.next && g.next.meeting_link)
          || (g.sessions.find((s) => s.meeting_link) || {}).meeting_link || '';
        // Kategori/Paket/Durasi ikut sheet ploting (kolom di schedules); fallback
        // ke pendaftaran member per program bila sel sheet kosong.
        const sessions = g.sessions.map((s) => {
          const ri = (g.member && (
            regByMember.get(g.member.id + '|' + String(s.program_name || '').toLowerCase()) ||
            regDefaultByMember.get(g.member.id)
          )) || {};
          return {
            ...s,
            kategori: s.kategori || ri.kategori || '-',
            paket: s.paket || ri.paket || '-',
            durasi: s.durasi || ri.durasi || '-',
          };
        });
        return {
          period_start: g.period_start,
          label: g.label,
          member: g.member,
          members: g.member ? [g.member] : [],
          programs: Array.from(g.programs),
          location: Array.from(g.locations)[0] || '',
          paket: (sessions[0] && sessions[0].paket) || reg.paket || '-',
          kategori: (sessions[0] && sessions[0].kategori) || reg.kategori || '-',
          durasi: (sessions[0] && sessions[0].durasi) || reg.durasi || '-',
          counts: g.counts,
          present_total: g.present_total,
          status: g.counts.upcoming > 0 ? 'upcoming' : (g.counts.completed > 0 ? 'completed' : 'cancelled'),
          next: g.next,
          presence_session_id: (g.next && g.next.id) || g.firstSessionId,
          zoom_link: zoomLink,
          sessions,
        };
      })
      .sort((a, b) => {
        if (a.period_start !== b.period_start) return a.period_start < b.period_start ? 1 : -1;
        const an = a.member ? a.member.name : '~';
        const bn = b.member ? b.member.name : '~';
        return an.localeCompare(bn);
      });

    const periods = periodsResult.rows.map((r) => ({
      value: at.toISODate(r.period_start),
      label: at.formatPeriodRange(at.toISODate(r.period_start)),
    }));
    res.render('tutor/schedule', {
      title: 'Jadwal Mengajar',
      user: req.session.user,
      periodGroups,
      programs: programsResult.rows,
      periods,
      filters: { period },
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
    const inserted = await query(
      `INSERT INTO schedules (tutor_id, program_id, title, description, date, start_time, end_time, location, meeting_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [tutorId, program_id, title, description, date, start_time, end_time, location, meeting_link]
    );
    const scheduleId = inserted.rows[0].id;

    await query(`
      INSERT INTO schedule_members (schedule_id, member_id)
      SELECT $2, e.member_id
      FROM enrollments e WHERE e.program_id = $1 AND e.status = 'active'
      ON CONFLICT DO NOTHING
    `, [program_id, scheduleId]);
    await query(`
      INSERT INTO presences (schedule_id, member_id, status, updated_by, updated_at, source)
      SELECT $2, e.member_id, 'absent', $3, NOW(), 'system'
      FROM enrollments e WHERE e.program_id = $1 AND e.status = 'active'
      ON CONFLICT DO NOTHING
    `, [program_id, scheduleId, tutorId]);

    sendScheduleNotificationEmails(scheduleId, { subjectPrefix: 'Jadwal Belajar Baru' })
      .catch((e) => console.error('Gagal mengirim email jadwal:', e.message));

    req.flash('success', 'Jadwal berhasil ditambahkan.');
    res.redirect('/tutor/schedule');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menambahkan jadwal.');
    res.redirect('/tutor/schedule');
  }
};

exports.exportAvailableTime = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const result = await query(
      `SELECT atime.*, u.name as tutor_name, u.email as tutor_email
       FROM available_times atime
       JOIN users u ON atime.tutor_id = u.id
       WHERE atime.tutor_id = $1
       ORDER BY atime.period_start DESC NULLS LAST, atime.start_time`,
      [tutorId]
    );
    const rows = [];
    result.rows.forEach((slot) => {
      at.expandDays(slot.day_category, slot.custom_days).forEach((day) => {
        rows.push({
          tutor_id: slot.tutor_id,
          tutor_name: slot.tutor_name,
          tutor_email: slot.tutor_email,
          day_of_week: day,
          day_name: at.DAY_NAMES_ID[day],
          start_time: String(slot.start_time).slice(0, 5),
          end_time: String(slot.end_time).slice(0, 5),
          is_available: slot.is_available,
          notes: slot.notes || '',
        });
      });
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my-available-times.csv"');
    return res.send(toCsv(['tutor_id', 'tutor_name', 'tutor_email', 'day_of_week', 'day_name', 'start_time', 'end_time', 'is_available', 'notes'], rows));
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal export available time.');
    return res.redirect('/tutor/available-time');
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
    const result = await query(
      `SELECT * FROM available_times WHERE tutor_id = $1
       ORDER BY period_start DESC NULLS LAST, start_time, day_category`,
      [tutorId]
    );

    const toMinutes = (t) => {
      const [h, m] = String(t).split(':');
      return (Number(h) || 0) * 60 + (Number(m) || 0);
    };

    // Group saved slots by period for display + accumulate summary stats.
    const periodMap = new Map();
    let activeSlots = 0;
    let weeklyMinutes = 0;
    result.rows.forEach((row) => {
      const key = row.period_start ? new Date(row.period_start).toISOString().slice(0, 10) : 'legacy';
      if (!periodMap.has(key)) {
        periodMap.set(key, {
          key,
          period_start: row.period_start,
          period_label: row.period_label
            || (row.period_start ? at.formatPeriodLabel(row.period_start) : 'Tanpa Periode'),
          notes: row.notes,
          slots: [],
        });
      }
      const slotValue = at.formatSlotLabel(row.start_time, row.end_time);
      periodMap.get(key).slots.push({
        id: row.id,
        slotValue, // matches a HOUR_SLOTS option value, used to repopulate the form
        slotLabel: slotValue,
        categoryValue: row.day_category,
        categoryLabel: at.categoryLabel(row.day_category),
        customDays: row.custom_days || '',
        daysLabel: at.describeDays(row.day_category, row.custom_days),
        is_available: row.is_available,
      });

      if (row.is_available) {
        activeSlots += 1;
        const dayCount = at.expandDays(row.day_category, row.custom_days).length || 1;
        weeklyMinutes += Math.max(0, toMinutes(row.end_time) - toMinutes(row.start_time)) * dayCount;
      }
    });

    const savedPeriods = [...periodMap.values()];

    // Only periods the admin has opened can be filled.
    const openPeriodsRes = await query(
      'SELECT period_start, label FROM periods WHERE is_open = true ORDER BY period_start'
    );
    const openPeriods = openPeriodsRes.rows.map((p) => ({
      value: at.toISODate(p.period_start),
      label: p.label || at.formatPeriodLabel(p.period_start),
    }));

    res.render('tutor/available-time', {
      title: 'Available Time',
      user: req.session.user,
      periods: openPeriods,
      currentPeriod: at.currentPeriodValue(),
      hourSlots: at.HOUR_SLOTS,
      dayCategories: at.DAY_CATEGORIES,
      savedPeriods,
      stats: {
        periods: savedPeriods.length,
        activeSlots,
        weeklyHours: Math.round((weeklyMinutes / 60) * 10) / 10,
      },
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.saveAvailableTime = async (req, res) => {
  const tutorId = req.session.user.id;
  const redirectBack = () => res.redirect('/tutor/available-time');
  try {
    const periode = (req.body.periode || '').trim();
    const notes = (req.body.notes || '').trim() || null;

    // Normalise repeater fields into an array of rows.
    const toArray = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
    const jam = toArray(req.body.jam_belajar);
    const hari = toArray(req.body.hari);
    const custom = toArray(req.body.custom);

    if (!periode) {
      req.flash('error', 'Periode wajib dipilih.');
      return redirectBack();
    }

    // Gate: only periods opened by the admin can be filled.
    const openCheck = await query('SELECT 1 FROM periods WHERE period_start = $1 AND is_open = true', [periode]);
    if (!openCheck.rows.length) {
      req.flash('error', 'Periode tidak tersedia atau sudah ditutup admin.');
      return redirectBack();
    }

    const periodLabel = at.formatPeriodLabel(periode);
    const entries = [];
    const seen = new Set();
    const daySlots = new Map();
    for (let i = 0; i < jam.length; i += 1) {
      const slot = at.parseSlot(jam[i]);
      if (!slot) continue;
      const category = ['weekdays', 'weekend', 'custom'].includes(hari[i]) ? hari[i] : 'weekdays';
      const customDays = category === 'custom' ? (custom[i] || '').trim() : null;
      const expandedDays = at.expandDays(category, customDays);

      if (slot.end_time <= slot.start_time) {
        req.flash('error', 'Jam selesai harus lebih besar dari jam mulai.');
        return redirectBack();
      }
      if (category === 'custom' && !customDays) {
        req.flash('error', 'Isi kolom Custom jika memilih hari Custom.');
        return redirectBack();
      }
      if (category === 'custom' && expandedDays.length === 0) {
        req.flash('error', 'Custom day tidak dikenali. Gunakan nama hari seperti Senin, Rabu, Jumat.');
        return redirectBack();
      }
      // Reject duplicate/overlapping slots after expanding category to concrete days.
      const dupKey = `${slot.start_time}-${slot.end_time}-${category}-${(customDays || '').toLowerCase()}`;
      if (seen.has(dupKey)) {
        req.flash('error', `Slot ${at.formatSlotLabel(slot.start_time, slot.end_time)} (${at.categoryLabel(category)}) terduplikasi.`);
        return redirectBack();
      }
      seen.add(dupKey);
      for (const day of expandedDays) {
        const slots = daySlots.get(day) || [];
        const overlaps = slots.some((saved) => saved.start_time < slot.end_time && saved.end_time > slot.start_time);
        if (overlaps) {
          req.flash('error', `Slot ${at.formatSlotLabel(slot.start_time, slot.end_time)} overlap pada hari ${at.DAY_NAMES_ID[day]}.`);
          return redirectBack();
        }
        slots.push(slot);
        daySlots.set(day, slots);
      }
      entries.push({ ...slot, category, customDays });
    }

    if (entries.length === 0) {
      req.flash('error', 'Tambahkan minimal satu slot Jam Belajar.');
      return redirectBack();
    }

    // Re-submitting a period replaces its slots (data is filled per period).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM available_times WHERE tutor_id = $1 AND period_start = $2',
        [tutorId, periode]
      );
      for (const e of entries) {
        await client.query(
          `INSERT INTO available_times
             (tutor_id, period_label, period_start, day_category, custom_days, start_time, end_time, is_available, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)`,
          [tutorId, periodLabel, periode, e.category, e.customDays, e.start_time, e.end_time, notes]
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    pushAvailableTimeSync(tutorId);
    req.flash('success', `Available time periode ${periodLabel} berhasil disimpan (${entries.length} slot).`);
    return redirectBack();
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menyimpan available time.');
    return redirectBack();
  }
};

exports.deleteAvailableTime = async (req, res) => {
  try {
    await query('DELETE FROM available_times WHERE id = $1 AND tutor_id = $2', [req.params.id, req.session.user.id]);
    pushAvailableTimeSync(req.session.user.id);
    req.flash('success', 'Slot berhasil dihapus.');
    res.redirect('/tutor/available-time');
  } catch (err) {
    req.flash('error', 'Gagal menghapus slot.');
    res.redirect('/tutor/available-time');
  }
};

exports.toggleAvailableTime = async (req, res) => {
  try {
    await query(
      'UPDATE available_times SET is_available = NOT is_available WHERE id = $1 AND tutor_id = $2',
      [req.params.id, req.session.user.id]
    );
    pushAvailableTimeSync(req.session.user.id);
    req.flash('success', 'Status slot diperbarui.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperbarui status slot.');
  }
  res.redirect('/tutor/available-time');
};

exports.deleteAvailablePeriod = async (req, res) => {
  try {
    await query('DELETE FROM available_times WHERE tutor_id = $1 AND period_start = $2', [req.session.user.id, req.params.period]);
    pushAvailableTimeSync(req.session.user.id);
    req.flash('success', 'Periode available time berhasil dihapus.');
    res.redirect('/tutor/available-time');
  } catch (err) {
    req.flash('error', 'Gagal menghapus periode.');
    res.redirect('/tutor/available-time');
  }
};

exports.presence = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const [schedResult, submissionsResult, myPresResult, programsResult, periodsResult] = await Promise.all([
      query(
        `SELECT s.*, p.name as program_name FROM schedules s JOIN programs p ON s.program_id = p.id
         WHERE s.tutor_id = $1 ORDER BY s.date DESC`, [tutorId]
      ),
      query(`
        SELECT mp.*, m.name as member_name, m.photo as member_photo, p.name as program_name
        FROM member_presences mp
        JOIN users m ON mp.member_id = m.id
        LEFT JOIN programs p ON mp.program_id = p.id
        WHERE mp.tutor_id = $1 AND mp.member_id <> $1
        ORDER BY mp.created_at DESC
        LIMIT 25
      `, [tutorId]),
      // Tutor's own presence submissions (same flow as members).
      query(`
        SELECT mp.*, p.name as program_name
        FROM member_presences mp
        LEFT JOIN programs p ON mp.program_id = p.id
        WHERE mp.member_id = $1
        ORDER BY mp.created_at DESC
        LIMIT 25
      `, [tutorId]),
      query(`SELECT DISTINCT p.id, p.name FROM schedules s JOIN programs p ON s.program_id = p.id
             WHERE s.tutor_id = $1 ORDER BY p.name`, [tutorId]),
      query('SELECT period_start, label FROM periods ORDER BY period_start'),
    ]);

    const selectedId = req.query.schedule_id;
    let members = [];
    let selectedSchedule = null;
    let classProofs = [];
    if (selectedId) {
      selectedSchedule = schedResult.rows.find(s => s.id == selectedId);
      const [mResult, proofResult] = await Promise.all([
        query(`
          SELECT u.id, u.name, u.photo, u.phone,
                 COALESCE(pr.status, 'absent') as status,
                 pr.notes, pr.check_in_time
          FROM schedule_members sm
          JOIN users u ON sm.member_id = u.id
          LEFT JOIN presences pr ON pr.schedule_id = sm.schedule_id AND pr.member_id = sm.member_id
          WHERE sm.schedule_id = $1 ORDER BY u.name
        `, [selectedId]),
        query(`
          SELECT cp.*, u.photo as uploader_photo
          FROM class_proofs cp LEFT JOIN users u ON cp.uploaded_by = u.id
          WHERE cp.schedule_id = $1 ORDER BY cp.created_at DESC
        `, [selectedId]),
      ]);
      members = mResult.rows;
      classProofs = proofResult.rows;
    }
    const submissions = submissionsResult.rows.map((s) => ({
      ...s,
      period_label: s.period_start ? at.formatPeriodLabel(s.period_start) : '-',
    }));
    const myPresences = myPresResult.rows.map((s) => ({
      ...s,
      period_label: s.period_start ? at.formatPeriodLabel(s.period_start) : '-',
    }));
    const periods = periodsResult.rows.map((p) => ({
      value: at.toISODate(p.period_start),
      label: p.label || at.formatPeriodLabel(p.period_start),
    }));
    const meetings = Array.from({ length: 24 }, (_, i) => i + 1);

    res.render('tutor/presence', {
      title: 'Kelola Presensi',
      user: req.session.user,
      schedules: schedResult.rows,
      members,
      selectedSchedule,
      selectedId,
      submissions,
      myPresences,
      programs: programsResult.rows,
      periods,
      meetings,
      classProofs,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

// Tutor submits their own teaching presence + proof — same flow as members.
// Stored in member_presences with member_id = tutor (submitter) and tutor_id = self.
exports.submitPresence = async (req, res) => {
  try {
    const userId = req.session.user.id;
    const periodStart = req.body.period_start || null;
    const programId = Number(req.body.program_id) || null;
    const meeting = Number(req.body.meeting_number) || null;

    if (!periodStart || !programId || !meeting) {
      removeUploadedFile(req.file);
      req.flash('error', 'Lengkapi periode, program, dan meeting.');
      return res.redirect('/tutor/presence#riwayat-presensi');
    }
    if (!req.file) {
      req.flash('error', 'Screenshot kelas wajib diunggah.');
      return res.redirect('/tutor/presence#riwayat-presensi');
    }

    const screenshot = `/uploads/${req.file.filename}`;
    await query(
      `INSERT INTO member_presences (member_id, tutor_id, period_start, program_id, meeting_number, screenshot)
       VALUES ($1,$1,$2,$3,$4,$5)`,
      [userId, periodStart, programId, meeting, screenshot]
    );
    req.flash('success', 'Presensi berhasil dikirim. Terima kasih!');
    res.redirect('/tutor/presence#riwayat-presensi');
  } catch (err) {
    console.error(err);
    removeUploadedFile(req.file);
    req.flash('error', 'Gagal mengirim presensi.');
    res.redirect('/tutor/presence#riwayat-presensi');
  }
};

exports.updatePresence = async (req, res) => {
  try {
    const { schedule_id } = req.params;
    const { presences, notes } = req.body;
    const owner = await query('SELECT id FROM schedules WHERE id = $1 AND tutor_id = $2', [schedule_id, req.session.user.id]);
    if (!owner.rows.length) {
      req.flash('error', 'Jadwal tidak ditemukan.');
      return res.redirect('/tutor/presence');
    }
    if (presences && typeof presences === 'object') {
      for (const [rawKey, status] of Object.entries(presences)) {
        if (!['present', 'late', 'excused', 'absent'].includes(status)) continue;
        // field name memakai prefix "m" (mis. presences[m3]) agar tidak diubah
        // qs menjadi index array — ambil member id numerik aslinya.
        const memberId = Number(String(rawKey).replace(/^m/, ''));
        if (!Number.isInteger(memberId) || memberId <= 0) continue;
        const note = notes && notes[rawKey] ? notes[rawKey] : null;
        await query(`
          INSERT INTO presences (schedule_id, member_id, status, notes, check_in_time, updated_by, updated_at, source)
          VALUES ($2,$3,$1::varchar,$4,CASE WHEN $1::varchar IN ('present','late') THEN NOW() ELSE NULL END,$5,NOW(),'tutor')
          ON CONFLICT (schedule_id, member_id)
          DO UPDATE SET status = $1::varchar,
                        notes = $4,
                        check_in_time = CASE
                          WHEN $1::varchar IN ('present','late') THEN COALESCE(presences.check_in_time, NOW())
                          ELSE presences.check_in_time
                        END,
                        updated_by = $5,
                        updated_at = NOW(),
                        source = 'tutor'
        `, [status, schedule_id, memberId, note, req.session.user.id]);
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

const removeUploadFile = (file) => {
  if (!file) return;
  fs.unlink(path.join(__dirname, '../../public/uploads', file.filename), () => {});
};

exports.uploadClassProof = async (req, res) => {
  const { schedule_id } = req.params;
  const back = `/tutor/presence?schedule_id=${schedule_id}#foto-kelas`;
  try {
    const owner = await query('SELECT id FROM schedules WHERE id = $1 AND tutor_id = $2', [schedule_id, req.session.user.id]);
    if (!owner.rows.length) {
      removeUploadFile(req.file);
      req.flash('error', 'Jadwal tidak ditemukan.');
      return res.redirect('/tutor/presence');
    }
    if (!req.file) {
      req.flash('error', 'Pilih gambar foto kelas terlebih dahulu.');
      return res.redirect(back);
    }
    await query(
      `INSERT INTO class_proofs (schedule_id, uploaded_by, uploader_role, uploader_name, image, caption)
       VALUES ($1,$2,'tutor',$3,$4,$5)`,
      [schedule_id, req.session.user.id, req.session.user.name, `/uploads/${req.file.filename}`, (req.body.caption || '').trim() || null]
    );
    req.flash('success', 'Foto kelas berhasil diunggah.');
    res.redirect(back);
  } catch (err) {
    console.error(err);
    removeUploadFile(req.file);
    req.flash('error', 'Gagal mengunggah foto kelas.');
    res.redirect(back);
  }
};

exports.deleteClassProof = async (req, res) => {
  const { id } = req.params;
  try {
    // tutor hanya bisa menghapus foto pada sesi miliknya
    const result = await query(
      `SELECT cp.id, cp.image, cp.schedule_id
       FROM class_proofs cp JOIN schedules s ON cp.schedule_id = s.id
       WHERE cp.id = $1 AND s.tutor_id = $2`,
      [id, req.session.user.id]
    );
    const proof = result.rows[0];
    if (!proof) {
      req.flash('error', 'Foto tidak ditemukan.');
      return res.redirect('/tutor/presence');
    }
    await query('DELETE FROM class_proofs WHERE id = $1', [id]);
    if (proof.image) fs.unlink(path.join(__dirname, '../../public', proof.image), () => {});
    req.flash('success', 'Foto kelas dihapus.');
    res.redirect(`/tutor/presence?schedule_id=${proof.schedule_id}#foto-kelas`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menghapus foto kelas.');
    res.redirect('/tutor/presence');
  }
};

exports.questionnaire = async (req, res) => {
  try {
    if (req.session.user.role === 'admin') return res.redirect('/admin/questionnaire');
    const tutorId = req.session.user.id;
    await ensureTeachingQuestionnaires(query);
    const programId = req.query.program_id || '';
    const period = String(req.query.period || '').trim();
    const params = [String(tutorId)];
    const where = [`qr.answers->>'tutor_id' = $1`, teachingQuestionnaireFilter('q')];
    if (programId) {
      params.push(Number(programId));
      where.push(`q.program_id = $${params.length}`);
    }
    if (period) {
      params.push(period);
      where.push(`qr.answers->>'study_period' = $${params.length}`);
    }

    const [responsesResult, programsResult, periodsResult] = await Promise.all([
      query(`
        SELECT qr.*, q.title, q.description, p.name as program_name,
               u.name as member_name, u.email as member_email, u.photo as member_photo
        FROM questionnaire_responses qr
        JOIN questionnaires q ON q.id = qr.questionnaire_id
        JOIN programs p ON p.id = q.program_id
        JOIN users u ON u.id = qr.member_id
        WHERE ${where.join(' AND ')}
        ORDER BY qr.submitted_at DESC NULLS LAST, qr.started_at DESC
      `, params),
      query('SELECT id, name FROM programs WHERE is_active = true ORDER BY name'),
      query(`
        SELECT DISTINCT qr.answers->>'study_period' as period
        FROM questionnaire_responses qr
        JOIN questionnaires q ON q.id = qr.questionnaire_id
        WHERE qr.answers->>'tutor_id' = $1
          AND ${teachingQuestionnaireFilter('q')}
          AND COALESCE(qr.answers->>'study_period', '') <> ''
        ORDER BY period DESC
      `, [String(tutorId)]),
    ]);

    const responses = responsesResult.rows.map((response) => ({
      ...response,
      answer_map: typeof response.answers === 'string'
        ? JSON.parse(response.answers || '{}')
        : (response.answers || {}),
    }));

    const ratingStats = teachingRatings.map(([key, label]) => {
      const values = responses
        .map((r) => Number(r.answer_map.ratings && r.answer_map.ratings[key]))
        .filter((value) => value > 0);
      const avg = values.length
        ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
        : 0;
      return { key, label, avg, count: values.length };
    });
    const ratingCount = ratingStats.reduce((sum, item) => sum + item.count, 0);
    const ratingTotal = ratingStats.reduce((sum, item) => sum + (item.avg * item.count), 0);
    const averageRating = ratingCount ? Math.round((ratingTotal / ratingCount) * 10) / 10 : 0;
    const selfStudyYes = responses.filter((r) => String(r.answer_map.self_study_reference || '').toLowerCase() === 'ya').length;
    const stats = {
      responses: responses.length,
      averageRating,
      scorePercent: averageRating ? Math.round((averageRating / 5) * 100) : 0,
      selfStudyYes,
    };

    res.render('tutor/questionnaire', {
      title: 'Hasil Kuesioner Member',
      user: req.session.user,
      responses,
      programs: programsResult.rows,
      periods: periodsResult.rows.map((row) => row.period),
      filters: { programId, period },
      ratingStats,
      teachingRatings,
      teachingEssays,
      ratingLabels,
      stats,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.deleteQuestionnaire = async (req, res) => {
  if (req.session.user.role === 'tutor') {
    req.flash('error', 'Tutor hanya dapat melihat hasil kuesioner member.');
    return res.redirect('/tutor/questionnaire');
  }
  if (req.session.user.role === 'admin') {
    req.flash('error', 'Admin hanya dapat melihat questionnaire.');
    return res.redirect('/admin/questionnaire');
  }
  const { id } = req.params;
  const tutorId = req.session.user.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const own = await client.query('SELECT id FROM questionnaires WHERE id = $1 AND created_by = $2', [id, tutorId]);
    if (!own.rows.length) {
      await client.query('ROLLBACK');
      req.flash('error', 'Kuesioner tidak ditemukan.');
      return res.redirect('/tutor/questionnaire');
    }
    await client.query('DELETE FROM questionnaire_responses WHERE questionnaire_id = $1', [id]);
    await client.query('DELETE FROM questions WHERE questionnaire_id = $1', [id]);
    await client.query('DELETE FROM questionnaires WHERE id = $1', [id]);
    await client.query('COMMIT');
    req.flash('success', 'Kuesioner berhasil dihapus.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    req.flash('error', 'Gagal menghapus kuesioner.');
  } finally {
    client.release();
  }
  res.redirect('/tutor/questionnaire');
};

exports.createQuestionnaire = async (req, res) => {
  try {
    if (req.session.user.role === 'tutor') {
      req.flash('error', 'Tutor hanya dapat melihat hasil kuesioner member.');
      return res.redirect('/tutor/questionnaire');
    }
    if (req.session.user.role === 'admin') {
      req.flash('error', 'Admin hanya dapat melihat questionnaire.');
      return res.redirect('/admin/questionnaire');
    }
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
    if (req.session.user.role === 'admin') return res.redirect(`/admin/questionnaire/${req.params.id}`);
    req.flash('error', 'Tutor hanya dapat melihat hasil kuesioner member.');
    return res.redirect('/tutor/questionnaire');
    const { id } = req.params;
    const [qResult, questionsResult, responsesResult] = await Promise.all([
      query('SELECT q.*, p.name as program_name FROM questionnaires q JOIN programs p ON q.program_id = p.id WHERE q.id = $1', [id]),
      query('SELECT * FROM questions WHERE questionnaire_id = $1 ORDER BY order_number', [id]),
      query(`SELECT qr.*, u.name as member_name FROM questionnaire_responses qr
             JOIN users u ON qr.member_id = u.id WHERE qr.questionnaire_id = $1`, [id]),
    ]);
    const responses = responsesResult.rows.map((response) => ({
      ...response,
      answer_map: typeof response.answers === 'string' ? JSON.parse(response.answers || '{}') : (response.answers || {}),
    }));
    res.render('tutor/questionnaire-detail', {
      title: 'Detail Kuesioner',
      user: req.session.user,
      questionnaire: qResult.rows[0],
      questions: questionsResult.rows,
      responses,
      isTeachingQuestionnaire: isTeachingQuestionnaire(qResult.rows[0]),
      teachingRatings,
      teachingEssays,
      ratingLabels,
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
    if (req.session.user.role === 'tutor') {
      req.flash('error', 'Tutor hanya dapat melihat hasil kuesioner member.');
      return res.redirect('/tutor/questionnaire');
    }
    if (req.session.user.role === 'admin') {
      req.flash('error', 'Admin hanya dapat melihat questionnaire.');
      return res.redirect('/admin/questionnaire');
    }
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

exports.questionnaireAnswer = async (req, res) => {
  try {
    const userId = req.session.user.id;
    await ensureTeachingQuestionnaires(query);
    const result = await query(`
      WITH available AS (
        SELECT q.*,
               qr.id as response_id, qr.score, qr.max_score, qr.submitted_at,
               p.name as program_name,
               ROW_NUMBER() OVER (PARTITION BY p.name ORDER BY q.created_at DESC, q.id DESC) AS rn
        FROM questionnaires q
        JOIN programs p ON q.program_id = p.id
        LEFT JOIN questionnaire_responses qr ON q.id = qr.questionnaire_id AND qr.member_id = $1
        WHERE q.is_active = true
          AND ${teachingQuestionnaireFilter('q')}
      )
      SELECT *
      FROM available
      WHERE rn = 1
      ORDER BY created_at DESC
    `, [userId]);
    res.render('member/questionnaire', {
      title: 'Isi Questionnaire',
      user: req.session.user,
      activeNav: 'tutor',
      basePath: '/tutor/questionnaire/answer',
      questionnaires: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.questionnaireAnswerShow = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    const [qResult, questionsResult, responseResult, tutorsRes, programsRes, periodsRes] = await Promise.all([
      query('SELECT q.*, p.name as program_name FROM questionnaires q JOIN programs p ON q.program_id = p.id WHERE q.id = $1 AND q.is_active = true', [id]),
      query('SELECT * FROM questions WHERE questionnaire_id = $1 ORDER BY order_number', [id]),
      query('SELECT * FROM questionnaire_responses WHERE questionnaire_id = $1 AND member_id = $2', [id, userId]),
      query("SELECT id, name FROM users WHERE role = 'tutor' AND is_active = true ORDER BY name"),
      query('SELECT id, name FROM programs WHERE is_active = true ORDER BY name'),
      query('SELECT period_start, label FROM periods ORDER BY period_start DESC'),
    ]);
    const questionnaire = qResult.rows[0];
    if (!questionnaire) return res.redirect('/tutor/questionnaire/answer');
    res.render('member/questionnaire-take', {
      title: questionnaire.title,
      user: req.session.user,
      activeNav: 'tutor',
      backHref: '/tutor/questionnaire/answer',
      submitBasePath: '/tutor/questionnaire/answer',
      questionnaire,
      questions: questionsResult.rows,
      response: responseResult.rows[0] || null,
      isTeachingQuestionnaire: isTeachingQuestionnaire(questionnaire),
      teachingRatings,
      teachingEssays,
      ratingLabels,
      teachingOptions: {
        tutors: tutorsRes.rows,
        programs: programsRes.rows,
        periods: periodsRes.rows.map((p) => ({
          value: at.toISODate(p.period_start),
          label: p.label || at.formatPeriodLabel(p.period_start),
        })),
      },
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.questionnaireAnswerSubmit = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    const answers = req.body;
    const qResult = await query('SELECT * FROM questionnaires WHERE id = $1', [id]);
    const questionnaire = qResult.rows[0];
    if (questionnaire && isTeachingQuestionnaire(questionnaire)) {
      const built = buildTeachingQuestionnaireAnswer(req.body);
      await query(`
        INSERT INTO questionnaire_responses (questionnaire_id, member_id, answers, score, max_score, started_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (questionnaire_id, member_id) DO UPDATE SET answers=$3, score=$4, max_score=$5, submitted_at=NOW()
      `, [id, userId, JSON.stringify(built.answers), built.score, built.maxScore]);
      req.flash('success', 'Questionnaire berhasil dikumpulkan.');
      return res.redirect('/tutor/questionnaire/answer');
    }

    const questionsResult = await query('SELECT * FROM questions WHERE questionnaire_id = $1', [id]);
    const questions = questionsResult.rows;

    let score = 0;
    let maxScore = 0;
    const answerMap = {};
    questions.forEach((q) => {
      maxScore += q.question_type === 'rating' ? 5 : q.points;
      const userAnswer = answers[`q_${q.id}`] || '';
      answerMap[q.id] = userAnswer;
      if (q.question_type === 'multiple_choice' && userAnswer === q.correct_answer) {
        score += q.points;
      } else if (q.question_type === 'essay') {
        score += q.points > 0 && userAnswer.trim().length > 10 ? Math.floor(q.points * 0.5) : 0;
      } else if (q.question_type === 'rating') {
        score += Number(userAnswer || 0);
      }
    });

    await query(`
      INSERT INTO questionnaire_responses (questionnaire_id, member_id, answers, score, max_score, started_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (questionnaire_id, member_id) DO UPDATE SET answers=$3, score=$4, max_score=$5, submitted_at=NOW()
    `, [id, userId, JSON.stringify(answerMap), score, maxScore]);

    req.flash('success', 'Questionnaire berhasil dikumpulkan.');
    res.redirect('/tutor/questionnaire/answer');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengumpulkan questionnaire.');
    res.redirect(`/tutor/questionnaire/answer/${req.params.id}`);
  }
};

const fetchReportRows = async (tutorId, programId) => {
  const params = [tutorId];
  let progFilter = '';
  if (programId) { params.push(Number(programId)); progFilter = ` AND s.program_id = $${params.length}`; }
  const result = await query(`
    SELECT u.id, u.name, u.photo, p.name as program_name,
           COUNT(sm.schedule_id) as total_sessions,
           COUNT(sm.schedule_id) FILTER (WHERE pr.status IN ('present','late')) as present_count,
           COUNT(sm.schedule_id) FILTER (WHERE pr.status = 'late') as late_count,
           COUNT(sm.schedule_id) FILTER (WHERE pr.status = 'excused') as excused_count,
           AVG(qr.score::float / NULLIF(qr.max_score,0) * 100) as avg_score
    FROM schedule_members sm
    JOIN users u ON sm.member_id = u.id
    JOIN schedules s ON sm.schedule_id = s.id AND s.tutor_id = $1
    JOIN programs p ON s.program_id = p.id
    LEFT JOIN presences pr ON s.id = pr.schedule_id AND pr.member_id = u.id
    LEFT JOIN questionnaire_responses qr ON qr.member_id = u.id
    WHERE 1=1${progFilter}
    GROUP BY u.id, u.name, u.photo, p.name
    ORDER BY p.name, u.name
  `, params);
  return result.rows;
};

const reportDayArray = (days) => {
  const normalized = normalizeReportDays(days || {});
  return Array.from({ length: 15 }, (_, idx) => ({
    number: idx + 1,
    key: `day_${idx + 1}`,
    text: normalized[`day_${idx + 1}`],
  }));
};

const getTutorReportOptions = async (tutorId) => {
  const [membersRes, programsRes, periodsRes] = await Promise.all([
    query(`
      SELECT DISTINCT u.id, u.name, u.email, u.photo
      FROM schedule_members sm
      JOIN schedules s ON s.id = sm.schedule_id
      JOIN users u ON u.id = sm.member_id
      WHERE s.tutor_id = $1
      ORDER BY u.name
    `, [tutorId]),
    query(`
      SELECT DISTINCT p.id, p.name
      FROM schedules s
      JOIN programs p ON p.id = s.program_id
      WHERE s.tutor_id = $1
      ORDER BY p.name
    `, [tutorId]),
    query('SELECT period_start, label FROM periods ORDER BY period_start DESC'),
  ]);
  return {
    members: membersRes.rows,
    programs: programsRes.rows,
    periods: periodsRes.rows.map((p) => ({
      value: at.toISODate(p.period_start),
      label: at.formatPeriodLabelEN(p.period_start),
    })),
  };
};

exports.report = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const programId = req.query.program_id || '';
    await ensureMemberReportsTable(query);
    const [reports, programsRes, writtenReports] = await Promise.all([
      fetchReportRows(tutorId, programId),
      query(`SELECT DISTINCT p.id, p.name FROM programs p
             JOIN schedules s ON s.program_id = p.id WHERE s.tutor_id = $1 ORDER BY p.name`, [tutorId]),
      query(`
        SELECT mr.*, m.name as member_name, m.photo as member_photo, p.name as program_name
        FROM member_reports mr
        JOIN users m ON m.id = mr.member_id
        JOIN programs p ON p.id = mr.program_id
        WHERE mr.tutor_id = $1 ${programId ? 'AND mr.program_id = $2' : ''}
        ORDER BY mr.updated_at DESC
      `, programId ? [tutorId, Number(programId)] : [tutorId]),
    ]);

    let attSum = 0; let attCount = 0; let scoreSum = 0; let scoreCount = 0;
    reports.forEach((r) => {
      const total = Number(r.total_sessions) || 0;
      if (total > 0) { attSum += (Number(r.present_count) / total) * 100; attCount += 1; }
      if (r.avg_score !== null && r.avg_score !== undefined) { scoreSum += Number(r.avg_score); scoreCount += 1; }
    });

    res.render('tutor/report', {
      title: 'Laporan Member',
      user: req.session.user,
      reports,
      writtenReports: writtenReports.rows,
      programs: programsRes.rows,
      filters: { programId },
      stats: {
        members: reports.length,
        avgAttendance: attCount ? Math.round(attSum / attCount) : 0,
        avgScore: scoreCount ? Math.round(scoreSum / scoreCount) : null,
      },
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.reportEdit = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    await ensureMemberReportsTable(query);
    const options = await getTutorReportOptions(tutorId);
    const reportId = req.query.id || '';
    let report = null;
    if (reportId) {
      const result = await query(`
        SELECT mr.*, m.name as member_name, p.name as program_name
        FROM member_reports mr
        JOIN users m ON m.id = mr.member_id
        JOIN programs p ON p.id = mr.program_id
        WHERE mr.id = $1 AND mr.tutor_id = $2
      `, [reportId, tutorId]);
      report = result.rows[0] || null;
    }
    res.render('tutor/report-edit', {
      title: 'Isi Member Report',
      user: req.session.user,
      report,
      reportDays: reportDayArray(report ? report.days : emptyReportDays()),
      members: options.members,
      programs: options.programs,
      periods: options.periods,
      filters: {
        memberId: report ? report.member_id : (req.query.member_id || ''),
        programId: report ? report.program_id : (req.query.program_id || ''),
        periodStart: report ? at.toISODate(report.period_start) : (req.query.period_start || ''),
        packageName: report ? report.package_name : '',
      },
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.saveReport = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const memberId = Number(req.body.member_id);
    const programId = Number(req.body.program_id);
    const periodStart = req.body.period_start;
    const packageName = String(req.body.package_name || '').trim();
    const days = normalizeReportDays(req.body.days || {});

    if (!memberId || !programId || !periodStart) {
      req.flash('error', 'Member, program, dan periode wajib diisi.');
      return res.redirect('/tutor/report/edit');
    }
    const allowed = await query(`
      SELECT 1
      FROM schedule_members sm
      JOIN schedules s ON s.id = sm.schedule_id
      WHERE s.tutor_id = $1 AND sm.member_id = $2 AND s.program_id = $3
      LIMIT 1
    `, [tutorId, memberId, programId]);
    if (!allowed.rows.length) {
      req.flash('error', 'Member/program tidak sesuai dengan jadwal tutor.');
      return res.redirect('/tutor/report/edit');
    }

    await ensureMemberReportsTable(query);
    const saved = await query(`
      INSERT INTO member_reports (member_id, tutor_id, program_id, period_start, package_name, days, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      ON CONFLICT (member_id, tutor_id, program_id, period_start)
      DO UPDATE SET package_name = $5, days = $6, updated_at = NOW()
      RETURNING id
    `, [memberId, tutorId, programId, periodStart, packageName || null, JSON.stringify(days)]);
    req.flash('success', 'Member report berhasil disimpan.');
    res.redirect(`/tutor/report/${saved.rows[0].id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menyimpan member report.');
    res.redirect('/tutor/report/edit');
  }
};

exports.reportDetail = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    await ensureMemberReportsTable(query);
    const result = await query(`
      SELECT mr.*, m.name as member_name, m.photo as member_photo,
             t.name as tutor_name, p.name as program_name
      FROM member_reports mr
      JOIN users m ON m.id = mr.member_id
      JOIN users t ON t.id = mr.tutor_id
      JOIN programs p ON p.id = mr.program_id
      WHERE mr.id = $1 AND mr.tutor_id = $2
    `, [req.params.id, tutorId]);
    const report = result.rows[0];
    if (!report) return res.redirect('/tutor/report');
    res.render('shared/member-report-detail', {
      title: 'Detail Member Report',
      user: req.session.user,
      activeNav: 'tutor',
      backHref: '/tutor/report',
      canEdit: true,
      editHref: `/tutor/report/edit?id=${report.id}`,
      report,
      reportDays: reportDayArray(report.days),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.exportReportCsv = async (req, res) => {
  try {
    const rows = await fetchReportRows(req.session.user.id, req.query.program_id || '');
    const data = rows.map((r) => {
      const total = Number(r.total_sessions) || 0;
      return {
        member: r.name,
        program: r.program_name,
        total_sessions: total,
        present_count: Number(r.present_count) || 0,
        attendance_rate: total > 0 ? Math.round((Number(r.present_count) / total) * 100) : 0,
        avg_score: r.avg_score !== null && r.avg_score !== undefined ? Math.round(Number(r.avg_score)) : '',
      };
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="member-report.csv"');
    res.send(toCsv(['member', 'program', 'total_sessions', 'present_count', 'attendance_rate', 'avg_score'], data));
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal export laporan.');
    res.redirect('/tutor/report');
  }
};

exports.certificate = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    await ensureCertificateDetailsColumn(query);
    const search = (req.query.search || '').trim();
    const params = [tutorId];
    let searchFilter = '';
    if (search) {
      params.push(`%${search}%`);
      searchFilter = ` AND (u.name ILIKE $${params.length} OR c.certificate_number ILIKE $${params.length})`;
    }

    const [certsResult, membersResult, periodsResult, countResult] = await Promise.all([
      query(`SELECT c.*, u.name as member_name, p.name as program_name
             FROM certificates c JOIN users u ON c.member_id = u.id JOIN programs p ON c.program_id = p.id
             JOIN schedules s ON s.program_id = p.id WHERE s.tutor_id = $1${searchFilter}
             GROUP BY c.id, u.name, p.name ORDER BY c.issued_date DESC`, params),
      query(`SELECT DISTINCT u.id, u.name, u.email, p.id as program_id, p.name as program_name,
                    (SELECT COUNT(*)::int FROM presences pr
                     JOIN schedules s2 ON s2.id = pr.schedule_id
                     WHERE pr.member_id = u.id AND s2.program_id = p.id
                       AND pr.status IN ('present', 'late')) AS attended
             FROM enrollments e JOIN users u ON e.member_id = u.id
             JOIN programs p ON e.program_id = p.id
             JOIN schedules s ON s.program_id = p.id WHERE s.tutor_id = $1 AND e.status = 'active'`, [tutorId]),
      query('SELECT period_start, label FROM periods ORDER BY period_start DESC'),
      query(`SELECT COUNT(DISTINCT c.id) AS total
             FROM certificates c JOIN programs p ON c.program_id = p.id
             JOIN schedules s ON s.program_id = p.id WHERE s.tutor_id = $1`, [tutorId]),
    ]);
    res.render('tutor/certificate', {
      title: 'Kelola Sertifikat',
      user: req.session.user,
      certificates: certsResult.rows,
      members: membersResult.rows,
      periods: periodsResult.rows.map((p) => ({
        value: at.toISODate(p.period_start),
        label: at.formatPeriodLabelEN(p.period_start),
      })),
      filters: { search },
      stats: { total: Number(countResult.rows[0].total) },
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.deleteCertificate = async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM certificates
       WHERE id = $1 AND program_id IN (SELECT DISTINCT program_id FROM schedules WHERE tutor_id = $2)
       RETURNING certificate_number`,
      [req.params.id, req.session.user.id]
    );
    if (!result.rows.length) req.flash('error', 'Sertifikat tidak ditemukan atau di luar wewenang Anda.');
    else req.flash('success', `Sertifikat ${result.rows[0].certificate_number} berhasil dicabut.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mencabut sertifikat.');
  }
  res.redirect('/tutor/certificate');
};

exports.issueCertificate = async (req, res) => {
  try {
    const { member_id, program_id, title } = req.body;
    if (!member_id || !program_id) {
      req.flash('error', 'Pilih member dan program terlebih dahulu.');
      return res.redirect('/tutor/certificate');
    }

    await ensureCertificateDetailsColumn(query);
    const details = normalizeCertificateDetails(req.body);
    const certNum = `CERT-${Date.now()}-${member_id}`;
    const inserted = await query(
      `INSERT INTO certificates (member_id, program_id, title, certificate_number, details)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING
       RETURNING id`,
      [member_id, program_id, title, certNum, JSON.stringify(details)]
    );
    if (inserted.rows[0]) {
      syncCertificate(inserted.rows[0].id)
        .catch((e) => console.error('Gagal sinkronisasi sertifikat ke spreadsheet:', e.message));
    }
    req.flash('success', 'Sertifikat berhasil diterbitkan.');
    res.redirect('/tutor/certificate');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menerbitkan sertifikat.');
    res.redirect('/tutor/certificate');
  }
};

exports.certificatePrint = async (req, res) => {
  try {
    await ensureCertificateDetailsColumn(query);
    const result = await query(`
      SELECT c.*, u.name as member_name, p.name as program_name
      FROM certificates c
      JOIN users u ON c.member_id = u.id
      JOIN programs p ON c.program_id = p.id
      WHERE c.id = $1
        AND c.program_id IN (SELECT DISTINCT program_id FROM schedules WHERE tutor_id = $2)
    `, [req.params.id, req.session.user.id]);
    const cert = result.rows[0];
    if (!cert) {
      req.flash('error', 'Sertifikat tidak ditemukan atau di luar wewenang Anda.');
      return res.redirect('/tutor/certificate');
    }
    res.render('member/certificate-print', {
      title: 'Preview Sertifikat',
      user: req.session.user,
      cert,
      autoPrint: false,
      backHref: '/tutor/certificate',
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
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
    const { name, phone, bio, current_password, new_password, confirm_password } = req.body;
    let photoPath = null;

    if (new_password || confirm_password || current_password) {
      if (!current_password || !new_password || !confirm_password) {
        removeUploadedFile(req.file);
        req.flash('error', 'Lengkapi password lama, password baru, dan konfirmasi password.');
        return res.redirect('/tutor/profile');
      }
      if (new_password.length < 6) {
        removeUploadedFile(req.file);
        req.flash('error', 'Password baru minimal 6 karakter.');
        return res.redirect('/tutor/profile');
      }
      if (new_password !== confirm_password) {
        removeUploadedFile(req.file);
        req.flash('error', 'Konfirmasi password baru tidak cocok.');
        return res.redirect('/tutor/profile');
      }

      const userPassword = await query('SELECT password FROM users WHERE id = $1', [userId]);
      const validPassword = await bcrypt.compare(current_password, userPassword.rows[0].password);
      if (!validPassword) {
        removeUploadedFile(req.file);
        req.flash('error', 'Password lama tidak sesuai.');
        return res.redirect('/tutor/profile');
      }
    }

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
    if (new_password) {
      const hashedPassword = await bcrypt.hash(new_password, 10);
      await query('UPDATE users SET password=$1, updated_at=NOW() WHERE id=$2', [hashedPassword, userId]);
    }
    const updated = await query('SELECT * FROM users WHERE id = $1', [userId]);
    req.session.user = {
      id: updated.rows[0].id, name: updated.rows[0].name,
      email: updated.rows[0].email, role: updated.rows[0].role,
      photo: updated.rows[0].photo, is_vip: updated.rows[0].is_vip,
      is_luxury: updated.rows[0].is_luxury,
    };
    req.flash('success', new_password ? 'Profil dan password berhasil diperbarui.' : 'Profil berhasil diperbarui.');
    res.redirect('/tutor/profile');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal memperbarui profil.');
    res.redirect('/tutor/profile');
  }
};

// Read-only: member self-reported presence submissions to this tutor.
exports.memberPresence = async (req, res) => {
  try {
    const tutorId = req.session.user.id;
    const result = await query(`
      SELECT mp.*, m.name as member_name, m.photo as member_photo, p.name as program_name
      FROM member_presences mp
      JOIN users m ON mp.member_id = m.id
      LEFT JOIN programs p ON mp.program_id = p.id
      WHERE mp.tutor_id = $1
      ORDER BY mp.created_at DESC
    `, [tutorId]);
    const submissions = result.rows.map((s) => ({
      ...s,
      period_label: s.period_start ? at.formatPeriodLabel(s.period_start) : '-',
    }));
    res.render('tutor/member-presence', {
      title: 'Presensi Member',
      user: req.session.user,
      submissions,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.helpSupport = (req, res) => {
  res.render('shared/help-support', {
    title: 'Help & Support',
    user: req.session.user,
    activeNav: 'tutor',
    basePath: '/tutor/help-support',
    backHref: '/tutor',
    roleLabel: 'Tutor',
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
      return res.redirect('/tutor/help-support');
    }

    const payload = {
      user: req.session.user,
      roleLabel: 'Tutor',
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
    return res.redirect('/tutor/help-support');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengirim feedback. Coba lagi beberapa saat.');
    return res.redirect('/tutor/help-support');
  }
};
