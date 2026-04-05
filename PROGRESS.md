# Progress Tracker

Dokumen ini melacak progres implementasi fitur PDF Extractor berdasarkan kondisi repository saat ini.

## Legend

- `[x]` selesai
- `[~]` sedang berjalan / sudah ada draft awal
- `[ ]` belum dikerjakan

## 1. Repository Foundation

- [x] Inisialisasi repository Git dan GitHub
- [x] Setup Next.js App Router
- [x] Setup TypeScript
- [x] Setup Tailwind CSS v4
- [x] Setup shadcn/ui base preset
- [x] Setup ESLint dan Prettier
- [x] Tambahkan lisensi MIT resmi

## 2. Documentation

- [x] Buat `README.md` awal
- [x] Buat `PRD.md` awal
- [x] Update `README.md` sesuai progres implementasi terbaru
- [x] Update `PRD.md` sesuai prototype dan roadmap terbaru
- [x] Buat `PROGRESS.md` untuk tracking fitur dan task

## 3. Dashboard UI

- [x] Buat landing/dashboard awal untuk PDF extractor
- [x] Buat visual direction custom, bukan template default
- [x] Tampilkan queue board untuk file jobs
- [x] Tampilkan hero section dan pipeline overview
- [x] Tampilkan active/current job focus
- [x] Tampilkan progress visual per file
- [x] Tampilkan page-level monitor
- [x] Tampilkan diagnostics/log panel
- [x] Pecah dashboard ke komponen reusable
- [ ] Pecah `dashboard-shell` lebih lanjut ke section component yang lebih kecil

## 4. Upload Flow

- [x] Tambahkan file picker multi-upload di UI
- [x] Tampilkan file yang dipilih di intake panel
- [x] Stage upload batch menjadi job UI
- [~] Upload flow masih berbasis nama file dan internal draft API
- [ ] Upload binary PDF nyata ke server
- [ ] Validasi ukuran file, tipe file, dan error upload

## 5. Job Queue Interaction

- [x] Action `Start` per file
- [x] Action `Start All`
- [x] Action `Retry` per file
- [x] Active job selection dari queue board
- [x] Filter `All jobs`
- [x] Filter `Failed pages`
- [x] Filter `Compare mode`
- [x] Job state sekarang memakai SQLite dev persistence bersama antar route jobs
- [x] Retry page-level action nyata
- [x] Tombol `Retry page` sekarang mengikuti field backend `canRetry`, bukan hardcode rule di UI
- [x] Queue board/list job sekarang juga memakai metadata backend `canRetry` untuk action retry job
- [ ] Cancel / pause job

## 6. Job Detail Experience

- [x] Tab `Pages`
- [x] Tab `Pages` sekarang fetch detail halaman granular dari backend SQLite store
- [x] Tab `Pages` auto-refresh ringan saat job aktif masih `Queued`/`Processing` dan masih ada page task yang belum settle
- [x] Tab `Compare`
- [x] Tab `Output`
- [x] Tab `Logs`
- [x] Dynamic detail sesuai file yang dipilih
- [x] Compare summary per job
- [x] Output preview `.md`
- [x] Output preview `.txt`
- [ ] Diff compare viewer lebih detail
- [ ] Manual choose winner per page

## 7. Runtime Config and Environment

- [x] Tambahkan helper server-side untuk baca env di `lib/env.ts`
- [x] Lindungi secret agar tidak terekspos ke client
- [x] Tambahkan route `GET /api/config/llm`
- [x] Tampilkan status runtime LLM di dashboard
- [x] Tampilkan status API key dan example PDF path secara aman
- [ ] Tambahkan connection test ke endpoint LLM nyata

## 8. Internal API Draft

- [x] Tambahkan `POST /api/jobs/upload`
- [x] Tambahkan `POST /api/jobs/start`
- [x] Tambahkan `POST /api/jobs/start-all`
- [x] Hubungkan dashboard ke internal route tersebut
- [x] Dashboard mengambil initial state dari internal API `GET /api/jobs`
- [x] Route jobs sekarang berbagi persistence SQLite terpusat
- [x] Tambahkan `GET /api/jobs`
- [x] Tambahkan `GET /api/jobs/:id`
- [x] Tambahkan `POST /api/jobs/:id/retry`
- [x] Tambahkan `POST /api/pages/:id/retry`
- [x] Tambahkan `GET /api/jobs/:id/output`
- [x] Tambahkan `GET /api/jobs/:id/logs`
- [x] Tambahkan `GET /api/jobs/:id/pages`

## 9. Shared State / Persistence

- [x] Buat persistence SQLite sederhana untuk dev
- [x] Pastikan semua route job berbagi state yang sama
- [x] Persist jobs + job details ke file SQLite lokal untuk development
- [x] Tambahkan skema data lebih dekat ke backend final
- [x] Siapkan migrasi dari payload detail JSON ke tabel pipeline/page/output yang lebih granular
- [x] Tambahkan schema version ringan + migration versioned untuk SQLite dev store
- [x] Page payload granular sekarang membawa `page_id` stabil dari tabel `job_pages`
- [x] Payload pages/job detail terkait sekarang menyertakan metadata `canRetry` untuk job/page retryability
- [x] Payload `GET /api/jobs` sekarang juga menyertakan `canRetry` pada level list job untuk sinkronisasi sinyal retry frontend/backend

## 10. PDF Processing Pipeline

- [ ] Upload PDF nyata ke storage lokal/dev
- [ ] Render PDF ke image per halaman
- [ ] Simpan page image metadata
- [ ] Tampilkan thumbnail / preview page image nyata
- [ ] Pilih implementasi render utama (`pdfjs-dist` vs Poppler)
- [ ] Siapkan worker/background processing untuk render

## 11. OCR and Vision Extraction

- [ ] Integrasi Tesseract nyata
- [ ] Integrasi OpenAI-like vision API nyata
- [ ] Jalankan extraction per halaman
- [ ] Simpan hasil per engine
- [ ] Bandingkan hasil per engine berbasis output nyata
- [ ] Tambahkan fallback mode Tesseract -> LLM

## 12. Output and Export

- [x] Preview UI untuk `.md`
- [x] Preview UI untuk `.txt`
- [ ] Generate markdown nyata dari hasil extraction
- [ ] Generate text nyata dari hasil extraction
- [ ] Download output final
- [ ] Partial export jika ada halaman gagal

## 13. Observability and Logs

- [x] Log panel UI per job
- [x] Event list saat action UI dilakukan
- [x] Log/output sekarang punya endpoint baca nyata di atas SQLite store yang sama
- [~] Log masih berbasis prototype, tetapi sudah dibaca dari store granular terpusat
- [x] Tab `Logs` dan `Output` melakukan fetch ke endpoint backend saat dibuka
- [ ] Log dari render worker nyata
- [ ] Log dari OCR / LLM runtime nyata
- [ ] Error taxonomy final dan retry reason

## 14. Quality Gates

- [x] `npm run lint` lolos untuk progres saat ini
- [x] `npm run typecheck` lolos untuk progres saat ini
- [x] Tambahkan test untuk helper action dan API draft/shared store
- [x] Tambahkan test untuk endpoint payload halaman granular dan guard retryable page
- [x] Tambahkan test untuk metadata `canRetry` dan helper rule auto-refresh tab `Pages`
- [x] Tambahkan test integration-style ringan untuk wiring polling/refresh tab `Pages` tanpa browser stack tambahan
- [ ] Tambahkan smoke test untuk flow utama dashboard

## 15. Immediate Next Priorities

- [ ] Commit dan push progres terbaru
- [x] Ganti shared persistence mock jobs ke SQLite dev store
- [x] Tambahkan `GET /api/jobs` dan `GET /api/jobs/:id`
- [x] Sambungkan retry dashboard ke shared job API/store
- [x] Tambahkan test ringan untuk store jobs dan route jobs
- [x] Tambahkan test untuk endpoint/store logs dan output
- [x] Tambahkan test untuk retry page-level dan schema version store
- [x] Pindahkan route draft ke model state yang lebih konsisten
- [ ] Mulai wiring upload PDF nyata dan render pipeline
