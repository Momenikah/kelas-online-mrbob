# KELASONLINE - Super Seru Learning Platform

Aplikasi pengelola Member Area mirip SIAKAD untuk platform pembelajaran online dengan UI/UX modern bertema ungu (purple gradient). Dibangun dengan **Node.js + Express + PostgreSQL + EJS**.

## Fitur Utama

### Member Area
- Dashboard dengan profile banner gradient
- Schedule (Jadwal Kelas)
- Module (Modul Belajar)
- Presence (Presensi Kehadiran)
- Questionnaire (Kuesioner & Kuis Online dengan timer)
- Member's Report (Laporan progress)
- E-Certificate (Sertifikat Kelulusan)
- TOEFL Simulation (VIP Only)
- Video Premium (Bonus)
- Renewal Program
- Edit Profile

### Tutor Area
- Dashboard Tutor
- Schedule (Kelola Jadwal Mengajar)
- Available Time (Atur Waktu Tersedia)
- Presence (Kelola Presensi)
- Questionnaire (Buat & Kelola Kuesioner)
- Member's Report
- E-Certificate (Terbitkan Sertifikat)
- Help & Support
- Edit Profile

### Admin Panel
- Dashboard dengan statistik
- Kelola Pengguna (CRUD, toggle status, toggle VIP)
- Kelola Program
- Kelola Enrollment

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup PostgreSQL Database
Buat database baru:
```sql
CREATE DATABASE kelasonline;
```

### 3. Konfigurasi Environment
Salin `.env.example` ke `.env` lalu sesuaikan kredensial database:
```bash
cp .env.example .env
```

Edit `.env`:
```
PORT=3000
SESSION_SECRET=ubah_dengan_secret_random
DB_HOST=localhost
DB_PORT=5432
DB_NAME=kelasonline
DB_USER=postgres
DB_PASSWORD=password_postgres_anda
```

### 4. Migrasi Database (sekaligus seed data demo)
```bash
npm run migrate
```

### 5. Jalankan Server
```bash
npm start
```
Atau untuk development (auto-reload dengan nodemon):
```bash
npm run dev
```

Buka http://localhost:3000

## Akun Demo

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@kelasonline.com | admin123 |
| Tutor | tutor@kelasonline.com | tutor123 |
| Member | member@kelasonline.com | member123 |

## Struktur Proyek

```
kelasonline/
├── src/
│   ├── app.js                 # Entry point Express
│   ├── config/database.js     # PostgreSQL pool
│   ├── middleware/            # auth & upload
│   ├── routes/                # auth, member, tutor, admin
│   ├── controllers/           # business logic
│   └── views/                 # EJS templates
│       ├── partials/          # head, navbar, flash, footer
│       ├── auth/              # login, register
│       ├── member/            # 12 halaman member
│       ├── tutor/             # 9 halaman tutor
│       └── admin/             # dashboard, users, programs, enrollments
├── public/
│   ├── css/style.css          # Custom theme purple gradient
│   ├── js/main.js
│   └── uploads/               # Foto profile upload
├── migrations/
│   ├── init.sql               # Schema database
│   └── migrate.js             # Runner + seed
└── package.json
```

## Teknologi

- **Backend:** Node.js + Express 4
- **Database:** PostgreSQL (driver `pg`)
- **Template:** EJS
- **Auth:** express-session + bcryptjs
- **Upload:** Multer
- **Flash:** connect-flash
- **Icons:** Font Awesome 6
- **Font:** Poppins (Google Fonts)

## Schema Database (15 tabel)

`users`, `programs`, `enrollments`, `available_times`, `schedules`, `presences`, `modules`, `questionnaires`, `questions`, `questionnaire_responses`, `certificates`, `notifications`, `videos`, `toefl_simulations`, `toefl_results`
