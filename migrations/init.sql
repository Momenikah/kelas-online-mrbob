-- =============================================
-- KELASONLINE - Database Schema
-- =============================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'member',  -- admin, tutor, member
    phone VARCHAR(30),
    photo VARCHAR(255),
    is_vip BOOLEAN DEFAULT false,
    is_luxury BOOLEAN DEFAULT false,
    luxury_since TIMESTAMP,
    tutor_grade VARCHAR(5) DEFAULT 'B',
    is_active BOOLEAN DEFAULT true,
    bio TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS programs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    duration_months INTEGER DEFAULT 3,
    price DECIMAL(12,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enrollments (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    program_id INTEGER REFERENCES programs(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'active',  -- active, expired, suspended
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(member_id, program_id)
);

CREATE TABLE IF NOT EXISTS available_times (
    id SERIAL PRIMARY KEY,
    tutor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    day_of_week INTEGER,  -- 0=Sun, 1=Mon, ..., 6=Sat (legacy; nullable for category-based rows)
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN DEFAULT true
);

-- Available Time, FluentForm parity: Periode (weekly start) + Jam Belajar slot +
-- Hari category (weekdays/weekend/custom). One row per submitted slot; day_of_week
-- is derived on export. See docs/schedule-available-time-flow.md.
ALTER TABLE available_times ADD COLUMN IF NOT EXISTS period_label VARCHAR(50);
ALTER TABLE available_times ADD COLUMN IF NOT EXISTS period_start DATE;
ALTER TABLE available_times ADD COLUMN IF NOT EXISTS day_category VARCHAR(20) DEFAULT 'weekdays';
ALTER TABLE available_times ADD COLUMN IF NOT EXISTS custom_days VARCHAR(255);
ALTER TABLE available_times ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE available_times ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE available_times ALTER COLUMN day_of_week DROP NOT NULL;

CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    tutor_id INTEGER REFERENCES users(id),
    program_id INTEGER REFERENCES programs(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    location VARCHAR(255),
    meeting_link VARCHAR(500),
    status VARCHAR(50) DEFAULT 'upcoming',  -- upcoming, ongoing, completed, cancelled
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schedule_members (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER REFERENCES schedules(id) ON DELETE CASCADE,
    member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    import_hash VARCHAR(64) UNIQUE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(schedule_id, member_id)
);

CREATE TABLE IF NOT EXISTS presences (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER REFERENCES schedules(id) ON DELETE CASCADE,
    member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'absent',  -- present, absent, late, excused
    check_in_time TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(schedule_id, member_id)
);

ALTER TABLE presences ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
ALTER TABLE presences ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
ALTER TABLE presences ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'system';

CREATE TABLE IF NOT EXISTS schedule_imports (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255),
    status VARCHAR(50) DEFAULT 'draft',
    total_rows INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    error_report_csv TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS presence_sync_logs (
    id SERIAL PRIMARY KEY,
    presence_id INTEGER REFERENCES presences(id) ON DELETE CASCADE,
    sync_status VARCHAR(50) DEFAULT 'pending',
    spreadsheet_row_id VARCHAR(100),
    error_message TEXT,
    synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO schedule_members (schedule_id, member_id)
SELECT s.id, e.member_id
FROM schedules s
JOIN enrollments e ON e.program_id = s.program_id AND e.status = 'active'
ON CONFLICT DO NOTHING;

INSERT INTO presences (schedule_id, member_id, status, source)
SELECT sm.schedule_id, sm.member_id, 'absent', 'system'
FROM schedule_members sm
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS modules (
    id SERIAL PRIMARY KEY,
    program_id INTEGER REFERENCES programs(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    content TEXT,
    file_url VARCHAR(500),
    video_url VARCHAR(500),
    order_number INTEGER DEFAULT 0,
    is_premium BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS questionnaires (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    program_id INTEGER REFERENCES programs(id),
    created_by INTEGER REFERENCES users(id),
    due_date TIMESTAMP,
    duration_minutes INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    questionnaire_id INTEGER REFERENCES questionnaires(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type VARCHAR(50) DEFAULT 'multiple_choice',  -- multiple_choice, essay, rating
    options JSONB,
    correct_answer VARCHAR(500),
    points INTEGER DEFAULT 1,
    order_number INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS questionnaire_responses (
    id SERIAL PRIMARY KEY,
    questionnaire_id INTEGER REFERENCES questionnaires(id),
    member_id INTEGER REFERENCES users(id),
    tutor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    study_program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
    study_period VARCHAR(100),
    answers JSONB,
    score INTEGER DEFAULT 0,
    max_score INTEGER DEFAULT 0,
    started_at TIMESTAMP,
    submitted_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS questionnaire_responses_teaching_scope_idx
ON questionnaire_responses (questionnaire_id, member_id, tutor_id)
WHERE tutor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS questionnaire_responses_default_scope_idx
ON questionnaire_responses (questionnaire_id, member_id)
WHERE tutor_id IS NULL;

CREATE TABLE IF NOT EXISTS member_reports (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tutor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    package_name VARCHAR(255),
    days JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(member_id, tutor_id, program_id, period_start)
);

CREATE TABLE IF NOT EXISTS certificates (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    program_id INTEGER REFERENCES programs(id),
    title VARCHAR(255) NOT NULL,
    issued_date DATE DEFAULT CURRENT_DATE,
    certificate_number VARCHAR(100) UNIQUE,
    details JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    type VARCHAR(50) DEFAULT 'info',  -- info, success, warning, danger
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

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
);

CREATE TABLE IF NOT EXISTS videos (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    video_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    duration VARCHAR(20),
    is_premium BOOLEAN DEFAULT false,
    program_id INTEGER REFERENCES programs(id),
    created_by INTEGER REFERENCES users(id),
    order_number INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS toefl_simulations (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    duration_minutes INTEGER DEFAULT 120,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS toefl_results (
    id SERIAL PRIMARY KEY,
    simulation_id INTEGER REFERENCES toefl_simulations(id),
    member_id INTEGER REFERENCES users(id),
    listening_score INTEGER DEFAULT 0,
    structure_score INTEGER DEFAULT 0,
    reading_score INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    taken_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS placement_tests (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    test_type VARCHAR(20) NOT NULL,  -- 'kids' or 'adult'
    score INTEGER DEFAULT 0,
    max_score INTEGER DEFAULT 20,
    level_num INTEGER DEFAULT 1,
    level_label VARCHAR(50),
    level_desc VARCHAR(100),
    answers JSONB,
    full_name VARCHAR(255),
    email VARCHAR(255),
    city VARCHAR(100),
    phone VARCHAR(30),
    taken_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_registrations (
    id SERIAL PRIMARY KEY,
    registration_code VARCHAR(40) UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    city VARCHAR(100),
    education_background VARCHAR(255),
    education_level VARCHAR(100),
    occupation VARCHAR(255),
    age INTEGER,
    instagram VARCHAR(150),
    phone_last_three VARCHAR(3),
    program_type VARCHAR(50),
    selected_class VARCHAR(255),
    package_group VARCHAR(100),
    package_name VARCHAR(255),
    package_price INTEGER,
    package_note TEXT,
    duration VARCHAR(100),
    meeting_count VARCHAR(100),
    study_time VARCHAR(100),
    start_date VARCHAR(100),
    preferred_tutor_id INTEGER REFERENCES users(id),
    preferred_tutor VARCHAR(255),
    friend_name VARCHAR(255),
    coupon_code VARCHAR(100),
    referral_code VARCHAR(100),
    transfer_proof VARCHAR(500),
    status VARCHAR(50) DEFAULT 'pending_payment',
    created_at TIMESTAMP DEFAULT NOW(),
    confirmed_at TIMESTAMP
);
