const { query } = require('../config/database');
const bcrypt = require('bcryptjs');

exports.dashboard = async (req, res) => {
  try {
    const [usersCount, membersCount, tutorsCount, enrollCount, schedCount] = await Promise.all([
      query('SELECT COUNT(*) FROM users'),
      query("SELECT COUNT(*) FROM users WHERE role = 'member'"),
      query("SELECT COUNT(*) FROM users WHERE role = 'tutor'"),
      query("SELECT COUNT(*) FROM enrollments WHERE status = 'active'"),
      query('SELECT COUNT(*) FROM schedules'),
    ]);
    const recentUsers = await query(
      'SELECT * FROM users ORDER BY created_at DESC LIMIT 10'
    );
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      user: req.session.user,
      stats: {
        totalUsers: usersCount.rows[0].count,
        totalMembers: membersCount.rows[0].count,
        totalTutors: tutorsCount.rows[0].count,
        activeEnrollments: enrollCount.rows[0].count,
        totalSchedules: schedCount.rows[0].count,
      },
      recentUsers: recentUsers.rows,
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.users = async (req, res) => {
  try {
    const { role, search } = req.query;
    let sql = 'SELECT * FROM users WHERE 1=1';
    const params = [];
    if (role) { sql += ` AND role = $${params.length + 1}`; params.push(role); }
    if (search) { sql += ` AND (name ILIKE $${params.length + 1} OR email ILIKE $${params.length + 1})`; params.push(`%${search}%`); }
    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.render('admin/users', {
      title: 'Kelola Pengguna',
      user: req.session.user,
      users: result.rows,
      filters: { role, search },
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, phone, is_vip } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    await query(
      'INSERT INTO users (name, email, password, role, phone, is_vip) VALUES ($1,$2,$3,$4,$5,$6)',
      [name, email, hashed, role, phone || null, is_vip === 'on']
    );
    req.flash('success', 'Pengguna berhasil ditambahkan.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menambahkan pengguna. Email mungkin sudah terdaftar.');
    res.redirect('/admin/users');
  }
};

exports.toggleUserStatus = async (req, res) => {
  try {
    await query('UPDATE users SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
    req.flash('success', 'Status pengguna diperbarui.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengubah status.');
    res.redirect('/admin/users');
  }
};

exports.toggleVip = async (req, res) => {
  try {
    await query('UPDATE users SET is_vip = NOT is_vip WHERE id = $1', [req.params.id]);
    req.flash('success', 'Status VIP diperbarui.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal mengubah status VIP.');
    res.redirect('/admin/users');
  }
};

exports.programs = async (req, res) => {
  try {
    const result = await query('SELECT * FROM programs ORDER BY created_at DESC');
    res.render('admin/programs', {
      title: 'Kelola Program',
      user: req.session.user,
      programs: result.rows,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.createProgram = async (req, res) => {
  try {
    const { name, description, duration_months, price } = req.body;
    await query(
      'INSERT INTO programs (name, description, duration_months, price) VALUES ($1,$2,$3,$4)',
      [name, description, duration_months, price]
    );
    req.flash('success', 'Program berhasil ditambahkan.');
    res.redirect('/admin/programs');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menambahkan program.');
    res.redirect('/admin/programs');
  }
};

exports.enrollments = async (req, res) => {
  try {
    const [enrollResult, membersResult, programsResult] = await Promise.all([
      query(`SELECT e.*, u.name as member_name, u.email, p.name as program_name
             FROM enrollments e JOIN users u ON e.member_id = u.id JOIN programs p ON e.program_id = p.id
             ORDER BY e.created_at DESC`),
      query("SELECT id, name, email FROM users WHERE role = 'member' ORDER BY name"),
      query("SELECT id, name FROM programs WHERE is_active = true ORDER BY name"),
    ]);
    res.render('admin/enrollments', {
      title: 'Kelola Enrollment',
      user: req.session.user,
      enrollments: enrollResult.rows,
      members: membersResult.rows,
      programs: programsResult.rows,
      error: req.flash('error'),
      success: req.flash('success'),
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Error', message: err.message, user: req.session.user });
  }
};

exports.createEnrollment = async (req, res) => {
  try {
    const { member_id, program_id, start_date, end_date } = req.body;
    await query(
      `INSERT INTO enrollments (member_id, program_id, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,'active') ON CONFLICT (member_id, program_id) DO UPDATE SET start_date=$3, end_date=$4, status='active'`,
      [member_id, program_id, start_date, end_date]
    );
    req.flash('success', 'Enrollment berhasil ditambahkan.');
    res.redirect('/admin/enrollments');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Gagal menambahkan enrollment.');
    res.redirect('/admin/enrollments');
  }
};
