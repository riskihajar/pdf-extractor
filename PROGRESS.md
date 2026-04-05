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
- [~] Job state saat ini masih prototype/draft dan belum persisten
- [ ] Retry page-level action nyata
- [ ] Cancel / pause job

## 6. Job Detail Experience

- [x] Tab `Pages`
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
- [~] Route masih stateless/draft dan belum berbagi persistence nyata
- [ ] Tambahkan `GET /api/jobs`
- [ ] Tambahkan `GET /api/jobs/:id`
- [ ] Tambahkan `POST /api/jobs/:id/retry`
- [ ] Tambahkan `POST /api/pages/:id/retry`
- [ ] Tambahkan `GET /api/jobs/:id/output`
- [ ] Tambahkan `GET /api/jobs/:id/logs`

## 9. Shared State / Persistence

- [ ] Buat mock persistence terpusat untuk dev
- [ ] Pastikan semua route job berbagi state yang sama
- [ ] Tambahkan skema data lebih dekat ke backend final
- [ ] Siapkan transisi ke database/storage nyata

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
- [~] Log masih berbasis prototype dan draft route
- [ ] Log dari render worker nyata
- [ ] Log dari OCR / LLM runtime nyata
- [ ] Error taxonomy final dan retry reason

## 14. Quality Gates

- [x] `npm run lint` lolos untuk progres saat ini
- [x] `npm run typecheck` lolos untuk progres saat ini
- [ ] Tambahkan test untuk helper action dan API draft
- [ ] Tambahkan smoke test untuk flow utama dashboard

## 15. Immediate Next Priorities

- [ ] Commit dan push progres terbaru
- [ ] Tambahkan shared persistence/mock store untuk jobs
- [ ] Tambahkan `GET /api/jobs` dan `GET /api/jobs/:id`
- [ ] Pindahkan route draft ke model state yang lebih konsisten
- [ ] Mulai wiring upload PDF nyata dan render pipeline
