# PDF Extractor - Product Requirements Document

## 1. Product Overview

PDF Extractor adalah aplikasi berbasis web untuk mengelola ekstraksi teks dari file PDF melalui pipeline yang dapat dipantau dan dikendalikan. Setiap file PDF diproses sebagai job, setiap halaman dirender menjadi gambar, lalu setiap gambar masuk ke queue ekstraksi menggunakan vision LLM dengan protokol OpenAI-like, Tesseract OCR, atau keduanya untuk kebutuhan komparasi.

Produk ini dirancang untuk kasus nyata di mana sebagian PDF tidak bisa diekstrak dengan konsisten oleh satu engine saja. Karena itu, sistem menekankan observability, retry granular, mode compare, dan output akhir yang bisa digunakan ulang dalam format Markdown (`.md`) maupun plain text (`.txt`).

## 2. Current Project Context

Saat ini repository sudah diinisialisasi dengan:

- Next.js App Router
- TypeScript
- Tailwind CSS v4
- shadcn/ui base preset
- dokumentasi awal produk di level repository root

Status implementasi saat ini masih berada pada tahap fondasi proyek dan perencanaan produk. Fokus berikutnya adalah membangun dashboard UI untuk workflow upload, queue, processing, compare, dan export.

## 3. Problem Statement

Pengguna menghadapi beberapa masalah utama saat mengekstrak isi PDF:

- satu metode ekstraksi sering tidak cukup andal untuk semua jenis PDF,
- file scan, layout kompleks, atau halaman tertentu bisa gagal diekstrak,
- batch processing banyak file sulit dipantau jika status hanya tersedia di level file,
- tidak ada alur yang jelas untuk retry per halaman,
- sulit membandingkan hasil OCR tradisional dengan vision model,
- output akhir sering perlu dinormalisasi agar siap dipakai di workflow lanjutan.

## 4. Product Goals

- Mendukung upload lebih dari satu PDF dalam satu sesi.
- Menjadikan setiap file sebagai job yang punya lifecycle jelas.
- Menjadikan setiap halaman sebagai unit queue untuk pemrosesan yang lebih fleksibel.
- Mendukung mode `LLM only`, `Tesseract only`, dan `Both (compare)`.
- Menyediakan action `Start` per file dan `Start All` secara global.
- Menampilkan progress dan error secara jelas di level file, halaman, dan engine.
- Menghasilkan output `.md` dan `.txt`.
- Memungkinkan retry parsial tanpa mengulang seluruh batch secara membabi buta.

## 5. Non-Goals

- Mengedit isi PDF langsung di aplikasi.
- Menyediakan editor hasil OCR tingkat lanjut pada MVP.
- Mendukung format dokumen selain PDF pada tahap awal.
- Menyediakan workflow multi-user, permission, atau role management pada MVP.
- Menyediakan sistem billing/token accounting lengkap pada versi awal.

## 6. Target Users

- Developer yang membangun workflow dokumen internal.
- Operator yang perlu memproses banyak PDF dengan visibilitas tinggi.
- Tim knowledge management yang ingin mengubah PDF menjadi teks terstruktur.
- Pengguna yang ingin membandingkan hasil Tesseract dan vision model sebelum memilih output akhir.

## 7. Core Product Principles

- Pipeline-first, bukan upload form biasa.
- Queue per halaman, bukan sekadar per file.
- Kegagalan satu halaman tidak boleh memblokir keseluruhan pengalaman.
- User harus tahu apa yang sedang terjadi tanpa membuka log teknis.
- Compare mode harus berguna untuk QA, bukan sekadar gimmick.
- Output harus siap dipakai ulang untuk downstream workflow.

## 8. User Stories

- Sebagai user, saya ingin upload banyak PDF sekaligus agar bisa memproses batch dalam satu alur.
- Sebagai user, saya ingin tiap file menjadi record terpisah agar bisa melihat progres dan error per file.
- Sebagai user, saya ingin menekan `Start` pada satu file agar bisa memproses prioritas tertentu lebih dulu.
- Sebagai user, saya ingin menekan `Start All` agar semua file pending langsung masuk pipeline.
- Sebagai user, saya ingin tiap halaman diproses terpisah agar kegagalan tidak memblokir seluruh file.
- Sebagai user, saya ingin memilih mode ekstraksi agar bisa menyeimbangkan kualitas, biaya, dan kecepatan.
- Sebagai user, saya ingin membandingkan hasil LLM dan Tesseract agar bisa memilih hasil terbaik.
- Sebagai user, saya ingin melihat halaman mana yang gagal agar retry bisa dilakukan dengan cepat.
- Sebagai user, saya ingin mengunduh hasil akhir dalam `.md` atau `.txt` agar hasil mudah dipakai di sistem lain.

## 9. Core Workflow

1. User mengunggah satu atau banyak file PDF.
2. Sistem membuat satu `FileJob` untuk setiap file.
3. User memilih mode ekstraksi dan format output.
4. User menekan `Start` pada file tertentu atau `Start All`.
5. Worker merender PDF menjadi gambar per halaman.
6. Sistem membuat task ekstraksi per halaman sesuai mode yang dipilih.
7. Task masuk ke queue dan diproses worker.
8. Hasil per halaman disimpan per engine.
9. Jika mode `Both`, hasil LLM dan Tesseract tersedia untuk dibandingkan.
10. Sistem mengagregasi hasil halaman menjadi output final file.
11. User dapat preview, melihat log, retry, dan download hasil akhir.

## 10. Pipeline Design

### 10.1 File-Level Pipeline

- `uploaded`
- `ready`
- `rendering_pages`
- `pages_rendered`
- `queueing_extraction`
- `extracting`
- `aggregating_output`
- `completed`

### 10.2 Error and Partial States

- `failed_render`
- `failed_extraction`
- `partial_success`
- `cancelled`

### 10.3 Page-Level Lifecycle

- `pending`
- `rendering`
- `queued`
- `extracting`
- `completed`
- `failed`

### 10.4 Engine Task Lifecycle

- `pending`
- `running`
- `success`
- `failed`
- `skipped`

## 11. Queue Strategy

### 11.1 Queue Granularity

Queue berjalan di level halaman, bukan di level file. Pendekatan ini memungkinkan:

- file pendek tetap selesai cepat walaupun ada file panjang di batch yang sama,
- retry granular per halaman atau per engine,
- distribusi worker yang lebih efisien,
- visibilitas bottleneck yang lebih jelas.

### 11.2 Worker Types

- PDF render worker
- Tesseract OCR worker
- Vision LLM worker
- Aggregation and export worker

### 11.3 Concurrency Recommendation

- Render PDF: `1-2` worker
- Tesseract OCR: `3-5` worker
- LLM vision: `1-3` worker tergantung rate limit

## 12. PDF to Image Strategy

Untuk kebutuhan pipeline produksi, rendering PDF ke gambar sebaiknya berjalan di backend atau worker, bukan di browser.

### 12.1 Recommended Direction

- Next.js digunakan untuk dashboard dan orchestration UI.
- PDF-to-image dilakukan di worker/backend.
- Hasil image per halaman disimpan untuk dipakai ulang oleh OCR dan compare view.

### 12.2 Technical Options

#### Option A - `pdfjs-dist`

Cocok untuk:

- preview halaman di UI,
- implementasi full JavaScript,
- kebutuhan parsing/render yang fleksibel.

Kelebihan:

- JavaScript-native,
- cocok untuk frontend dan skenario tertentu di server,
- kontrol render per halaman cukup detail.

Kekurangan:

- untuk batch processing besar, browser bisa berat,
- setup server-side butuh penyesuaian canvas/runtime,
- kurang ideal sebagai jalur utama pipeline skala besar.

#### Option B - `pdftoppm` / Poppler

Cocok untuk:

- queue pipeline production,
- rasterisasi PDF yang konsisten,
- batch processing di worker.

Kelebihan:

- stabil untuk convert halaman PDF menjadi image,
- cocok untuk job background,
- hasil raster biasanya konsisten untuk OCR downstream.

Kekurangan:

- bergantung pada binary sistem,
- setup environment lebih berat daripada solusi pure npm.

### 12.3 Product Recommendation

- Gunakan `pdfjs-dist` untuk preview dan kemungkinan fallback pure JavaScript.
- Prioritaskan `pdftoppm` atau tool sekelas Poppler untuk pipeline render di worker production.

## 13. Extraction Modes

### 13.1 LLM Only

- setiap image halaman dikirim ke vision model via OpenAI-like API,
- cocok untuk layout kompleks, dokumen semi-terstruktur, atau scan sulit.

### 13.2 Tesseract Only

- setiap image diproses lokal dengan Tesseract,
- cocok untuk kebutuhan murah, cepat, dan sederhana.

### 13.3 Both and Compare

- kedua engine dijalankan pada halaman yang sama,
- hasil disimpan terpisah,
- UI menampilkan perbandingan agar user dapat mengevaluasi kualitas.

### 13.4 Future Fallback Mode

Fitur lanjutan yang direkomendasikan:

- Tesseract dijalankan terlebih dahulu,
- jika hasil buruk atau confidence rendah, task LLM dibuat sebagai fallback,
- sistem menghemat biaya tanpa mengorbankan kualitas pada dokumen sulit.

## 14. Output Requirements

### 14.1 Supported Formats

- `.md`
- `.txt`

### 14.2 Output Structure

Markdown:

```md
# <filename>.pdf

## Page 1

<hasil ekstraksi>

## Page 2

<hasil ekstraksi>
```

Plain text:

```txt
<filename>.pdf

----- Page 1 -----
<hasil ekstraksi>

----- Page 2 -----
<hasil ekstraksi>
```

### 14.3 Output Rules

- normalisasi whitespace,
- separator per halaman,
- merge hasil per halaman menjadi satu output final,
- simpan partial output jika ada halaman gagal,
- jika mode compare aktif, simpan raw result per engine untuk inspeksi.

## 15. UI Requirements

### 15.1 Main Screens

1. Dashboard utama
2. Job detail view
3. Output preview panel
4. Logs or diagnostics panel

### 15.2 Dashboard Requirements

Dashboard harus menampilkan:

- upload area dengan drag-and-drop,
- multiple file selection,
- engine selector,
- output selector,
- global action `Start All`,
- daftar job file,
- status badge,
- progress bar,
- quick action per file.

### 15.3 Job List Columns

Kolom minimum:

- file name,
- total pages,
- extraction mode,
- output format,
- status,
- progress,
- failed pages count,
- actions.

Actions minimum:

- `Start`
- `View`
- `Retry`
- `Download`

### 15.4 Job Detail Requirements

Job detail harus menampilkan:

- file metadata,
- pipeline progress,
- daftar halaman,
- status per halaman,
- status per engine,
- compare result jika mode `Both`,
- output preview,
- logs/errors.

Suggested tabs:

- `Pages`
- `Compare`
- `Output`
- `Logs`

## 16. Error Handling Requirements

Sistem harus menampilkan error yang spesifik dan actionable.

Contoh error:

- PDF render failed
- encrypted PDF not supported
- vision API timeout
- Tesseract returned empty result
- rate limit reached
- invalid image generated from page

Required actions:

- retry page,
- retry file,
- rerun dengan engine berbeda,
- download partial result.

## 17. Conceptual Data Model

### 17.1 FileJob

- `id`
- `filename`
- `original_path`
- `status`
- `total_pages`
- `extraction_mode`
- `output_format`
- `created_at`
- `updated_at`

### 17.2 PageImage

- `id`
- `file_job_id`
- `page_number`
- `image_path`
- `render_status`

### 17.3 ExtractionTask

- `id`
- `page_image_id`
- `engine`
- `status`
- `error_message`
- `started_at`
- `finished_at`

### 17.4 ExtractionResult

- `id`
- `extraction_task_id`
- `raw_text`
- `normalized_text`
- `format`

### 17.5 FinalOutput

- `id`
- `file_job_id`
- `markdown_content`
- `text_content`
- `compare_summary`

## 18. Draft API Surface

- `POST /jobs/upload`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/start`
- `POST /jobs/start-all`
- `POST /jobs/:id/retry`
- `POST /pages/:id/retry`
- `GET /jobs/:id/output`
- `GET /jobs/:id/logs`

Optional realtime endpoint:

- `GET /events` via SSE

## 19. Technical Stack Snapshot

Current repository baseline:

- Next.js 16
- React 19
- TypeScript 5
- Tailwind CSS 4
- shadcn/ui preset
- ESLint
- Prettier

Planned additions for implementation:

- worker runtime untuk render dan extraction,
- queue provider atau internal job orchestration,
- OCR runtime,
- OpenAI-like vision client,
- storage untuk uploaded PDF, page images, dan outputs.

## 20. MVP Definition

MVP mencakup:

- multi-upload PDF,
- queue list per file,
- action `Start` dan `Start All`,
- PDF-to-image per halaman,
- extraction mode `LLM`, `Tesseract`, `Both`,
- output `.md` dan `.txt`,
- progress file dan page,
- retry basic,
- output preview dan download,
- log error sederhana.

## 21. Suggested Phase Plan

### Phase 1

- bangun dashboard UI statis,
- representasikan job, page, dan compare states dengan mock data,
- validasi informasi apa saja yang wajib tampil.

### Phase 2

- tambahkan upload flow dan state management,
- siapkan model data dan API contract,
- hubungkan dashboard ke data source internal.

### Phase 3

- implement render worker PDF-to-image,
- implement queue task per halaman,
- integrasikan Tesseract dan endpoint OpenAI-like.

### Phase 4

- implement compare flow,
- output aggregation,
- retry granular,
- observability dan logs.

## 22. Success Metrics

- User dapat memproses banyak file dalam satu workflow tanpa kebingungan.
- User dapat mengidentifikasi file atau halaman yang gagal dalam hitungan detik dari dashboard.
- File yang gagal sebagian tetap menghasilkan output parsial yang bisa diunduh.
- User dapat membandingkan hasil LLM dan Tesseract pada mode compare.
- Pipeline status dapat dipantau secara real-time atau near real-time.

## 23. Open Questions

- Apakah output perlu mendukung pemilihan `.md` dan `.txt` sekaligus pada MVP?
- Apakah compare mode cukup side-by-side atau perlu diff viewer penuh?
- Apakah perlu confidence score per engine di versi awal?
- Apakah job processing akan berjalan lokal, server-side, atau hybrid?
- Apakah endpoint OpenAI-like dikonfigurasi global, per workspace, atau per user?
