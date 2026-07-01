# Sinkronisasi Pendaftaran & Bukti Transfer ke Google Spreadsheet

Aplikasi mengirim data ke Google Spreadsheet lewat **Google Apps Script Web App**.
Tidak perlu kredensial/JSON — cukup satu URL.

## 1. Siapkan Spreadsheet + Apps Script

1. Buat Google Spreadsheet baru (mis. "Pendaftaran Kelas Online").
2. Menu **Extensions → Apps Script**.
3. Hapus kode default, tempel seluruh isi [`spreadsheet-sync-apps-script.gs`](spreadsheet-sync-apps-script.gs), lalu **Save**.

## 2. Deploy sebagai Web App

1. Klik **Deploy → New deployment**.
2. Pilih tipe **Web app**.
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
3. **Deploy**, beri izin akses (pilih akun, "Advanced" → "Go to project (unsafe)" jika diminta).
4. Salin **Web app URL** (berakhiran `/exec`).

## 3. Hubungkan ke aplikasi

Isi di file `.env`:

```
SHEET_WEBHOOK_URL=https://script.google.com/macros/s/XXXXXXXX/exec
APP_URL=https://domain-produksi-anda.com   # agar link bukti transfer bisa dibuka
```

Restart aplikasi. Selesai.

## Cara kerja

- **Saat pendaftaran** (`event: pendaftaran`) → baris baru dibuat, status `pending_payment`.
- **Saat konfirmasi bukti transfer** (`event: konfirmasi`) → baris yang sama (berdasarkan
  `registration_code`) diperbarui jadi status `confirmed`, lengkap dengan `transfer_proof_url`.

Jadi satu pendaftar = satu baris yang ter-update otomatis.

## Available Time Tutor (tab "AvailableTime")

Kode Apps Script yang sama juga menerima data **available time tutor** dan menulisnya
ke tab terpisah **"AvailableTime"** (dibuat otomatis).

- Dipicu setiap tutor **menyimpan**, **menghapus slot**, **menghapus periode**, atau
  **mengaktifkan/menonaktifkan** slot.
- Yang dikirim adalah **snapshot penuh** available time tutor tersebut: semua baris milik
  `tutor_id` itu di sheet dihapus lalu ditulis ulang. Jadi tab selalu mirror dengan aplikasi.
- Kolom: `synced_at, tutor_id, tutor_name, tutor_email, period_label, period_start,
  day_category, day_label, custom_days, start_time, end_time, is_available`.

Default memakai `SHEET_WEBHOOK_URL` (spreadsheet yang sama, tab berbeda). Jika ingin
available time masuk ke spreadsheet/web app lain, isi `AVAILABLE_TIME_WEBHOOK_URL`.

> Karena kode Apps Script bertambah (penanganan event available time), **deploy ulang**
> web app: Manage deployments → Edit → Version: **New version**.

## Jadwal Hasil Plot (tab "Jadwal")

Saat admin memakai **Plot Jadwal** (membuat sesi dari available time tutor), tiap sesi yang
dibuat juga dikirim ke tab **"Jadwal"** (1 baris per `schedule_id`, upsert).

- Kolom: `synced_at, schedule_id, date, start_time, end_time, title, program_name,
  tutor_name, tutor_email, location, meeting_link, status, member_count, member_names`.
- Default memakai `SHEET_WEBHOOK_URL`; bisa dipisah via `SCHEDULE_WEBHOOK_URL`.

> Penanganan event `jadwal` baru ditambahkan ke Apps Script, jadi **deploy ulang** web app
> (Manage deployments → Edit → Version: New version) agar tab "Jadwal" aktif.

## Catatan

- Jika `SHEET_WEBHOOK_URL` kosong, sinkronisasi dilewati (aplikasi tetap jalan normal).
- Pengiriman dibungkus `Promise.allSettled` bersama email — jika webhook gagal/lambat
  (timeout 10 detik), proses pendaftaran/konfirmasi user **tidak** ikut gagal.
- `transfer_proof_url` = `APP_URL` + path file bukti. Agar bisa diklik dari Spreadsheet,
  set `APP_URL` ke domain yang bisa diakses publik (bukan `localhost`).
- Setiap kali kode Apps Script diubah, **deploy ulang** (Manage deployments → Edit → New version).
