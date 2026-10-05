# Aksara Sunda OCR 🚀

Aplikasi web *production-ready* untuk pengenalan Aksara Sunda menggunakan AI. Proyek ini dibangun dengan React, Vite, Tailwind CSS, dan backend menggunakan Supabase Edge Functions.

## 🛠️ Persyaratan Sistem

- Node.js (versi 20 atau lebih baru)
- NPM atau Yarn
- Supabase CLI (Opsional untuk testing Edge Function secara lokal)
- Akun Github dan Supabase

## 🚀 Cara Setup Lokal

1. **Install dependensi:**
   ```bash
   npm install
   ```
2. **Setup file .env:**
   Copy file `.env.example` menjadi `.env` lalu isi dengan kredensial Supabase Anda:
   ```bash
   VITE_SUPABASE_URL=https://proyek-anda.supabase.co
   VITE_SUPABASE_ANON_KEY=kunci-anon-anda
   ```
3. **Jalankan server pengembangan:**
   ```bash
   npm run dev
   ```
   Aplikasi akan berjalan di `http://localhost:5173`.

## 🤖 Cara Memasang Modelku Sendiri

Secara default, aplikasi menggunakan *mock model* yang langsung mengembalikan hasil tiruan saat Anda menekan tombol "Jalankan OCR". 

Untuk menghubungkan AI/model asli Anda, buka file ini:
👉 `supabase/functions/ocr-aksara/model.ts`

Di dalam fungsi `recognize()`, hapus blok kode tiruan (mock) dan aktifkan kode `fetch` ke server API AI Anda. Pastikan Anda telah mengatur `MODEL_API_URL` dan `MODEL_API_KEY` menggunakan Supabase Secrets di environment Anda.

## 🚢 Cara Deploy

Proyek ini telah dikonfigurasi menggunakan GitHub Actions untuk deployment otomatis setiap kali ada `push` ke branch `main`.

### Deploy Otomatis (CI/CD)
1. Setiap perubahan di folder `src/` atau konfigurasi *frontend* akan secara otomatis dipublikasikan ke **GitHub Pages**.
2. Setiap perubahan di folder `supabase/` akan secara otomatis melakukan sinkronisasi *database migrations* dan *deploy Edge Functions* ke **Supabase**.

**Syarat Deploy Otomatis:**
Pastikan Anda sudah menyetel *Secrets* di Github Repositori Anda:
- `SUPABASE_ACCESS_TOKEN` (Untuk otentikasi CLI)
- `SUPABASE_PROJECT_ID` (ID proyek Anda di dashboard)
- `SUPABASE_DB_PASSWORD` (Password database proyek Anda)
- `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` (Sebagai Secrets atau Variables)

### Deploy Manual Backend (Edge Function)
Jika Anda ingin mend-deploy fungsi OCR ke Supabase secara manual lewat terminal:
```bash
supabase functions deploy ocr-aksara --project-ref ID_PROYEK_ANDA
```

## 🧪 Cara Menguji

1. Unggah atau *drag-and-drop* gambar ke area unggah.
2. Klik tombol "Jalankan OCR" dan tunggu hingga *mock* selesai bekerja (2 detik).
3. Anda akan melihat pratinjau teks dan hasil identifikasi.
4. Klik "Unduh PDF" untuk menyimpan hasilnya.
5. Karena fitur penyimpanan otomatis (*Phase 2*) telah tertanam, Anda juga dapat melihat tabel `ocr_results` dan *bucket* storage Anda di *dashboard* Supabase untuk melihat data yang masuk (pastikan mengaktifkan akses RLS dan auth Anonim).
