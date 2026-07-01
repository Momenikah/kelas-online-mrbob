# Flow Schedule dan Available Time

Dokumen ini menjadi acuan sementara untuk fokus pengembangan modul `Available Time` tutor dan `Schedule` kelas. Fokus utama: tutor mengisi waktu tersedia, data tersedia untuk admin, admin upload CSV schedule, lalu member dan tutor mendapatkan jadwal masing-masing.

## Tujuan

- Tutor dapat mengisi dan memperbarui waktu tersedia dengan mudah.
- Data available time tutor dapat dipakai sebagai dasar penyusunan jadwal.
- Admin dapat mengupload CSV hasil olahan Google Sheet untuk membuat schedule kelas.
- Tutor dan member otomatis melihat schedule yang relevan di area masing-masing.
- Sistem memiliki validasi agar jadwal tidak bentrok dan data CSV tidak salah format.

## Flow Sistem

1. Tutor mengisi `Available Time` di Tutor Area.
2. Sistem menyimpan available time tutor di database.
3. Data available time dikirim atau diekspor ke Google Sheet.
4. Admin menyusun jadwal member dan tutor di Google Sheet.
5. Admin download Google Sheet sebagai CSV.
6. Admin upload CSV schedule di halaman Admin.
7. Sistem membaca CSV, memvalidasi data, lalu membuat schedule.
8. Schedule muncul di:
   - Member Area: jadwal kelas member tersebut.
   - Tutor Area: jadwal mengajar tutor tersebut.
   - Admin Area: daftar semua schedule hasil import.

## Scope Fase Ini

Fase ini hanya fokus pada:

- Tutor available time.
- Integrasi/export available time ke format Google Sheet.
- Upload CSV schedule oleh admin.
- Validasi CSV schedule.
- Tampilan schedule untuk tutor dan member.
- Presensi kelas oleh member atau tutor.
- Sinkronisasi presensi ke spreadsheet secara realtime atau near-realtime.

Tidak termasuk untuk fase ini:

- Payment automation.
- Reminder WhatsApp/email.
- Google Calendar sync.
- Auto-matching tutor dan member.
- Realtime collaboration Google Sheet API penuh.

## Available Time Tutor

Tutor mengisi waktu tersedia berdasarkan hari dan jam.

Data minimal:

- Tutor.
- Hari.
- Jam mulai.
- Jam selesai.
- Status aktif/nonaktif.
- Catatan opsional.

Aturan:

- Jam selesai harus lebih besar dari jam mulai.
- Tutor tidak boleh punya slot available time yang overlap di hari yang sama.
- Slot bisa diedit atau dihapus.
- Slot yang sudah dipakai schedule tetap boleh diedit, tetapi sistem perlu memberi warning.

Format tampilan yang diharapkan:

- Grid per hari.
- Tombol tambah slot.
- List slot tersedia.
- Label aktif/nonaktif.
- Validasi inline jika jam overlap.

## Google Sheet

Google Sheet menjadi workspace admin untuk menyusun jadwal berdasarkan available time tutor.

Ada dua pendekatan:

- Fase awal: sistem menyediakan export CSV available time, admin upload manual ke Google Sheet.
- Fase lanjutan: sistem push data langsung ke Google Sheet via API.

Untuk fase awal, cukup sediakan export data available time dengan kolom:

```csv
tutor_id,tutor_name,tutor_email,day_of_week,day_name,start_time,end_time,is_available,notes
```

## Upload CSV Schedule Admin

Admin upload file CSV berisi jadwal final.

Kolom CSV schedule yang direkomendasikan:

```csv
member_email,member_name,tutor_email,tutor_name,program_name,title,date,start_time,end_time,meeting_link,location,notes
```

Kolom wajib:

- `member_email`
- `tutor_email`
- `program_name`
- `title`
- `date`
- `start_time`
- `end_time`

Kolom opsional:

- `member_name`
- `tutor_name`
- `meeting_link`
- `location`
- `notes`

Format data:

- `date`: `YYYY-MM-DD`
- `start_time`: `HH:mm`
- `end_time`: `HH:mm`
- Email harus cocok dengan user yang sudah ada.

## Validasi Import CSV

Sebelum menyimpan schedule, sistem harus validasi:

- File harus `.csv`.
- Header CSV harus sesuai format.
- Member email ditemukan dan role adalah `member`.
- Tutor email ditemukan dan role adalah `tutor`.
- Program ditemukan.
- Tanggal dan jam valid.
- `end_time` lebih besar dari `start_time`.
- Jadwal tutor tidak bentrok dengan schedule lain.
- Jadwal member tidak bentrok dengan schedule lain.
- Jadwal berada di dalam available time tutor, atau minimal diberi warning jika di luar available time.

Hasil import harus menampilkan:

- Jumlah baris berhasil.
- Jumlah baris gagal.
- Detail error per baris.
- Tombol download error report CSV.

## Relasi Data

Schedule yang dibuat dari CSV perlu terhubung ke:

- Tutor.
- Member.
- Program.

Saat ini tabel `schedules` sudah memiliki `tutor_id` dan `program_id`, tetapi belum langsung menyimpan daftar member peserta schedule. Untuk schedule member yang spesifik, sistem perlu memakai tabel penghubung.

Rekomendasi tabel baru:

```sql
CREATE TABLE schedule_members (
  id SERIAL PRIMARY KEY,
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(schedule_id, member_id)
);
```

Dengan tabel ini:

- Satu schedule bisa punya satu atau banyak member.
- Member hanya melihat schedule yang ada di `schedule_members`.
- Tutor melihat schedule berdasarkan `schedules.tutor_id`.

## Tampilan Member Schedule

Member melihat:

- Program.
- Judul kelas.
- Tutor.
- Tanggal.
- Jam.
- Link meeting.
- Status: upcoming, ongoing, completed, cancelled.

Filter yang disarankan:

- Upcoming.
- Completed.
- Cancelled.

## Tampilan Tutor Schedule

Tutor melihat:

- Judul kelas.
- Program.
- Daftar member.
- Tanggal.
- Jam.
- Link meeting.
- Status.

Tutor tidak membuat schedule dari halaman ini pada fase CSV import, tetapi bisa melihat dan menjalankan kelas.

## Sistem Presensi

Presensi terhubung langsung dengan schedule. Setelah schedule dibuat, presensi dapat diisi oleh member atau tutor, dan keduanya bisa melihat status presensi kelas tersebut.

Tujuan presensi:

- Member dapat melakukan check-in ke kelasnya sendiri.
- Tutor dapat mengisi atau mengoreksi presensi member di kelas yang diajar.
- Member dan tutor sama-sama dapat melihat status presensi.
- Admin dapat melihat semua presensi untuk monitoring dan laporan.
- Data presensi dapat tersinkron ke spreadsheet secara realtime atau near-realtime.

### Siapa yang Bisa Mengisi Presensi

Member:

- Bisa mengisi presensi untuk jadwal miliknya sendiri.
- Tidak bisa mengisi presensi untuk schedule member lain.
- Idealnya hanya bisa presensi pada rentang waktu yang diizinkan.

Tutor:

- Bisa mengisi presensi untuk semua member pada schedule yang diajar.
- Bisa mengubah status presensi jika member lupa check-in.
- Bisa menambahkan catatan seperti telat, izin, kendala teknis, atau tidak hadir.

Admin:

- Bisa melihat semua data presensi.
- Bisa melakukan koreksi jika diperlukan.
- Bisa export atau sync data presensi ke spreadsheet.

### Status Presensi

Status yang digunakan:

- `present`: hadir.
- `late`: terlambat.
- `excused`: izin.
- `absent`: tidak hadir.

Status default saat schedule dibuat:

- `absent` atau belum ada record presensi.

Rekomendasi:

- Saat schedule dibuat untuk member, sistem bisa membuat record presensi awal dengan status `absent`.
- Jika belum ingin membuat record awal, view presensi harus tetap menampilkan status default `Belum presensi`.

### Aturan Presensi Member

Member hanya bisa check-in jika:

- Schedule tersebut memang miliknya.
- Schedule belum dibatalkan.
- Waktu presensi berada dalam window yang diizinkan.

Window presensi yang disarankan:

- Dibuka 15 menit sebelum kelas mulai.
- Ditutup 30 menit setelah kelas selesai.

Jika member check-in:

- Status menjadi `present` jika masih dalam rentang normal.
- Status menjadi `late` jika melewati jam mulai tetapi masih dalam batas toleransi.
- `check_in_time` otomatis terisi timestamp server.

### Aturan Presensi Tutor

Tutor dapat mengubah status presensi member pada schedule miliknya.

Tutor bisa mengisi:

- Status presensi.
- Catatan.
- Waktu koreksi.

Jika tutor mengubah presensi:

- Simpan siapa yang melakukan update.
- Simpan timestamp update.
- Jangan hapus `check_in_time` member kecuali memang ada aksi koreksi eksplisit.

### Visibilitas Presensi

Member melihat:

- Jadwal kelas.
- Status presensi dirinya sendiri.
- Waktu check-in.
- Catatan tutor/admin jika ada.

Tutor melihat:

- Jadwal kelas yang diajar.
- Daftar member pada schedule.
- Status presensi setiap member.
- Tombol ubah status presensi.
- Catatan per member.

Admin melihat:

- Semua schedule.
- Semua member dalam schedule.
- Status presensi.
- Tutor.
- Program.
- Filter tanggal, program, tutor, member, dan status.

### Relasi Data Presensi

Tabel `presences` saat ini sudah ada dan terhubung ke `schedule_id` dan `member_id`.

Untuk mendukung update oleh tutor/admin, rekomendasi tambahan kolom:

```sql
ALTER TABLE presences
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'system';
```

Nilai `source`:

- `member`: diisi oleh member.
- `tutor`: diisi atau dikoreksi tutor.
- `admin`: dikoreksi admin.
- `import`: berasal dari import spreadsheet.
- `system`: dibuat otomatis oleh sistem.

### Spreadsheet Realtime Presensi

Presensi nantinya harus terhubung ke spreadsheet secara realtime atau near-realtime.

Fase awal:

- Setiap presensi tersimpan di database.
- Sistem menyediakan export CSV presensi.
- Admin bisa download dan upload manual jika diperlukan.

Fase lanjutan:

- Setiap perubahan presensi langsung dikirim ke Google Sheet via API.
- Jika API gagal, data masuk ke queue retry.
- Sistem menyimpan status sync presensi.

Rekomendasi tabel sync:

```sql
CREATE TABLE presence_sync_logs (
  id SERIAL PRIMARY KEY,
  presence_id INTEGER REFERENCES presences(id) ON DELETE CASCADE,
  sync_status VARCHAR(50) DEFAULT 'pending',
  spreadsheet_row_id VARCHAR(100),
  error_message TEXT,
  synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

Status sync:

- `pending`: belum dikirim.
- `synced`: berhasil tersinkron.
- `failed`: gagal dikirim.
- `retrying`: sedang menunggu retry.

Kolom spreadsheet presensi yang direkomendasikan:

```csv
schedule_id,date,start_time,end_time,program_name,tutor_email,tutor_name,member_email,member_name,status,check_in_time,updated_by,source,notes
```

### Konflik Data Presensi

Jika presensi diubah dari aplikasi dan spreadsheet:

- Database tetap menjadi source of truth utama.
- Spreadsheet menjadi mirror/reporting layer.
- Perubahan langsung di spreadsheet sebaiknya tidak overwrite database pada fase awal.

Jika nanti spreadsheet dibuat dua arah:

- Perlu `updated_at` untuk menentukan data terbaru.
- Perlu audit log perubahan.
- Perlu aturan prioritas: admin > tutor > member > spreadsheet import.

### Acceptance Criteria Presensi

- Member bisa melihat daftar jadwal dan status presensi dirinya.
- Member bisa check-in pada schedule miliknya.
- Tutor bisa melihat daftar member pada schedule yang diajar.
- Tutor bisa mengubah status presensi member.
- Member bisa melihat hasil update presensi dari tutor.
- Admin bisa melihat semua presensi.
- Setiap perubahan presensi punya `source` dan `updated_by`.
- Data presensi siap diexport ke CSV.
- Desain data siap disinkronkan ke Google Sheet.

## Tampilan Admin Schedule Import

Admin membutuhkan halaman:

- Upload CSV schedule.
- Preview 10 baris pertama.
- Validasi sebelum import.
- Tombol `Import Schedule`.
- Import history.
- Error report.

Status import:

- `draft`: file sudah diupload, belum disimpan.
- `imported`: schedule berhasil dibuat.
- `failed`: semua baris gagal.
- `partial`: sebagian berhasil, sebagian gagal.

## Rencana Implementasi

1. Rapikan Available Time Tutor.
2. Tambah export CSV available time.
3. Tambah tabel `schedule_members`.
4. Buat halaman Admin Upload Schedule CSV.
5. Buat parser dan validator CSV.
6. Simpan schedule dan schedule member.
7. Update schedule view member agar memakai `schedule_members`.
8. Update schedule view tutor agar menampilkan member peserta.
9. Tambah import result dan error report.
10. Rapikan view presensi member.
11. Rapikan view presensi tutor.
12. Tambah logic member check-in.
13. Tambah logic tutor update presensi.
14. Tambah export CSV presensi.
15. Siapkan struktur sync presensi ke spreadsheet.

## Acceptance Criteria

- Tutor bisa mengisi available time tanpa overlap.
- Admin bisa upload CSV schedule.
- CSV invalid tidak langsung masuk database.
- Error CSV jelas per baris.
- Schedule berhasil muncul di dashboard member.
- Schedule berhasil muncul di dashboard tutor.
- Tutor tidak mendapatkan jadwal bentrok tanpa warning.
- Member tidak mendapatkan jadwal bentrok tanpa warning.
- Member dan tutor bisa melihat status presensi yang sama.
- Presensi siap disinkronkan ke spreadsheet.

## Catatan Implementasi

- Untuk fase awal, gunakan CSV manual agar cepat stabil.
- Google Sheet API bisa ditambahkan setelah struktur data dan validasi CSV matang.
- Semua import harus bisa diulang tanpa membuat duplikasi, idealnya memakai hash unik dari `member_email + tutor_email + date + start_time + end_time + program_name`.
- Jangan hapus schedule lama saat import baru kecuali admin memilih mode replace.
