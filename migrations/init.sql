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
    day_of_week INTEGER NOT NULL,  -- 0=Sun, 1=Mon, ..., 6=Sat
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN DEFAULT true
);

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
    duration_minutes INTEGER DEFAULT 60,
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
    answers JSONB,
    score INTEGER DEFAULT 0,
    max_score INTEGER DEFAULT 0,
    started_at TIMESTAMP,
    submitted_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(questionnaire_id, member_id)
);

CREATE TABLE IF NOT EXISTS certificates (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    program_id INTEGER REFERENCES programs(id),
    title VARCHAR(255) NOT NULL,
    issued_date DATE DEFAULT CURRENT_DATE,
    certificate_number VARCHAR(100) UNIQUE,
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
