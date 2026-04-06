# PDF Extractor

PDF Extractor adalah aplikasi berbasis Next.js untuk mengelola ekstraksi teks dari file PDF melalui pipeline dan queue yang terstruktur. Setiap file diproses sebagai job, setiap halaman dirender menjadi gambar, lalu diekstrak menggunakan vision LLM dengan protokol OpenAI-like, Tesseract OCR, atau keduanya untuk dibandingkan.

Repository ini sekarang sudah memiliki fondasi frontend interaktif, route internal untuk config runtime dan job actions, serta dokumentasi produk untuk membawa project dari dashboard prototype menuju pipeline extraction yang lebih production-ready.

## Highlights

- multi-upload PDF dalam satu sesi,
- job record per file,
- action `Start` per file dan `Start All` global,
- render PDF menjadi image per halaman,
- queue task di level halaman,
- mode ekstraksi `LLM only`, `Tesseract only`, dan `Both (compare)`,
- output `.md` dan `.txt`,
- compare result per engine,
- diff compare viewer per halaman dengan token highlight dan full-text panel,
- retry untuk file atau halaman yang gagal,
- fallback otomatis dari Tesseract ke vision LLM saat OCR low-confidence,
- observability status pipeline dari upload sampai export.

## Current Implementation Status

Yang sudah ada saat ini:

- Next.js App Router,
- TypeScript,
- Tailwind CSS v4,
- shadcn/ui base preset,
- dashboard interaktif untuk queue operator,
- file picker multi-upload untuk upload PDF nyata ke local dev storage,
- tabs detail `Pages`, `Compare`, `Output`, `Logs`,
- route internal untuk `upload`, `start`, `start-all`,
- route internal observability untuk `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/workers`, dan trigger mock worker `POST /api/workers/run`,
- route internal observability untuk `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/workers`, `POST /api/workers/run`, dan `POST /api/workers/drain`,
- metadata upload + render artifacts tersimpan di SQLite dev store,
- render pipeline nyata berbasis `pdftoppm` untuk menghasilkan PNG per halaman,
- metadata handoff worker/background sekarang ikut disimpan agar job siap dipindah ke queue runtime berikutnya,
- worker diagnostics dan mock worker tick untuk simulasi konsumsi queue background,
- preview image halaman nyata via endpoint internal dan panel `Pages`,
- lane `Tesseract only` sekarang sudah menjalankan OCR nyata via binary Tesseract lokal,
- lane `LLM only` sekarang sudah menjalankan extraction nyata via OpenAI-like `chat/completions` dengan image base64 dari artifact render,
- compare audit trail sekarang menyimpan winner, reason, dan score per halaman,
- compare tab sekarang punya diff viewer detail, full-text kedua engine, manual override, dan reset ke auto scoring,
- lane `Tesseract only` sekarang bisa memicu fallback ke vision LLM saat hasil OCR kosong atau low-confidence,
- route internal aman untuk status runtime LLM,
- route internal connection test untuk runtime LLM dan Tesseract,
- helper server-side untuk membaca env lokal tanpa mengekspos secret ke UI,
- dokumentasi produk dan tracking progres.

Yang masih belum selesai:

- worker/background queue terpisah penuh di luar proses app,
- queue runtime nyata dengan concurrency per lane,
- export pipeline final selain partial export yang sudah tersedia,
- cancel/pause job,
- log runtime per page untuk jalur compare yang lebih eksplisit.

## Product Workflow

1. Upload satu atau banyak file PDF.
2. Buat satu job untuk setiap file.
3. Pilih mode ekstraksi dan format output.
4. Jalankan `Start` per file atau `Start All`.
5. Render PDF menjadi image per halaman.
6. Masukkan setiap halaman ke queue extraction.
7. Proses halaman dengan Tesseract, LLM, atau keduanya.
8. Simpan hasil per halaman.
9. Gabungkan hasil menjadi output final.
10. Preview dan download `.md` atau `.txt`.

## Product Direction

Prinsip arsitektur yang sedang dituju:

- Next.js untuk dashboard dan orchestration layer,
- render PDF ke image dijalankan di backend atau worker,
- task queue berjalan di level halaman,
- compare mode menyimpan hasil per engine secara terpisah,
- compare review sekarang mendukung diff token-level ringan dan manual winner override,
- Tesseract lane dapat menaikkan halaman ke vision LLM sebagai fallback jika OCR terlihat low-confidence,
- output akhir digabung ke format Markdown dan plain text,
- env sensitif dibaca server-side melalui internal API, bukan langsung dari client.

Catatan teknis dari brainstorming dan implementasi saat ini:

- `pdfjs-dist` cocok untuk preview halaman dan jalur JavaScript-friendly,
- `pdftoppm` atau tool Poppler sejenis lebih cocok untuk render pipeline production di background worker,
- Tesseract cocok untuk jalur OCR lokal,
- vision LLM cocok untuk halaman dengan layout kompleks atau sebagai pembanding/fallback,
- route internal sudah mulai menggantikan mock action langsung di komponen UI.

## Tech Stack

Current stack di repository ini:

- Next.js 16
- React 19
- TypeScript 5
- Tailwind CSS 4
- shadcn/ui
- ESLint
- Prettier

## Runtime Configuration

Project ini sudah mengenali konfigurasi lokal untuk runtime LLM melalui `.env.local` secara server-side.

Variabel yang saat ini digunakan:

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_API_STYLE`
- `LLM_MODEL`
- `LLM_REASONING_EFFORT`
- `LLM_IMAGE_INPUT_MODE`
- `LLM_STREAM`
- `TESSERACT_PATH`
- `TESSERACT_LANG`
- `EXAMPLE_PDF_PATH_TO_EXTRACT`

Catatan:

- nilai secret tidak diekspos ke client,
- dashboard hanya membaca status aman via route internal `app/api/config/llm/route.ts`,
- `.env.local` harus tetap local-only dan tidak boleh di-commit.

## Internal API Draft

Route internal yang sudah tersedia:

- `GET /api/config/llm`
- `POST /api/config/llm/test`
- `GET /api/config/tesseract`
- `POST /api/config/tesseract/test`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/pages`
- `GET /api/jobs/:id/logs`
- `GET /api/jobs/:id/output`
- `GET /api/jobs/:id/output/download?format=markdown|text`
- `POST /api/jobs/:id/pause`
- `POST /api/jobs/:id/cancel`
- `POST /api/jobs/:id/compare/override`
- `POST /api/jobs/upload`
- `POST /api/jobs/start`
- `POST /api/jobs/start-all`
- `POST /api/jobs/:id/retry`
- `POST /api/pages/:id/retry`
- `GET /api/workers`
- `POST /api/workers/run`
- `POST /api/workers/drain`

`POST /api/jobs/upload` sekarang menerima `multipart/form-data` untuk PDF nyata dari dashboard. File PDF disimpan ke `.data/storage/uploads`, halaman dirender ke `.data/storage/renders/<job-id>`, lalu metadata path/page count/artifact disimpan ke SQLite agar job bisa dilanjutkan oleh flow `Start` yang sudah ada.

Job detail dan snapshot `GET /api/jobs` juga sekarang menyimpan metadata background preparation seperti target queue, worker lane, dan waktu handoff preparation, jadi integrasi worker runtime berikutnya tinggal membaca state ini daripada menebak dari UI state.

## Real Upload + Render Pipeline

Vertical slice yang sekarang benar-benar jalan di local dev:

- dashboard upload memilih file PDF asli dan mengirim binary via `multipart/form-data`,
- server menyimpan file ke local storage dev,
- intake pipeline membaca page count dan teks embedded ringan via `pdf-parse`,
- halaman dirender ke PNG per page memakai `pdftoppm`,
- SQLite menyimpan metadata upload dan artifact path per halaman,
- job hasil upload bisa masuk ke flow `Start`/`Start All` yang sama,
- detail `Pages` menampilkan path artifact render nyata per halaman,
- preview page image nyata sudah bisa dibuka dari endpoint internal page preview,
- mock worker tick bisa mengonsumsi job prepared untuk mensimulasikan progress extraction,
- `Tesseract only` sudah tervalidasi end-to-end pada sample PDF nyata,
- `LLM only` juga sudah tervalidasi end-to-end memakai payload `chat/completions` OpenAI-like dengan image data URL.

Catatan operasional:

- implementasi ini menargetkan macOS/Homebrew dev setup dan default ke `/opt/homebrew/bin/pdftoppm`,
- override path binary bisa dilakukan lewat env `PDFTOPPM_PATH`,
- hasil render saat ini sudah dipakai sebagai artifact yang bisa dipreview di browser, tetapi belum punya galeri/thumbnail experience yang polished.

## Repository Structure

Struktur utama saat ini:

```text
.
├── app/
│   ├── api/
│   └── page.tsx
├── components/
│   ├── dashboard/
│   └── ui/
├── hooks/
├── lib/
├── public/
├── LICENSE
├── PRD.md
├── PROGRESS.md
├── README.md
├── components.json
├── package.json
└── tsconfig.json
```

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install dependencies

```bash
npm install
```

### Run development server

```bash
npm run dev
```

### Available scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run format
```

## Documentation

- Product requirements document: `PRD.md`
- Progress tracker and checklist: `PROGRESS.md`

## Roadmap

### Phase 1

- bangun dashboard UI statis,
- representasikan queue, file job, dan compare states,
- validasi layout dan informasi inti.

### Phase 2

- tambahkan upload flow,
- definisikan API contract dan state model,
- sambungkan UI ke internal route.

### Phase 3

- implement shared persistence/mock store,
- implement render worker PDF-to-image,
- implement queue processing mock per halaman,
- integrasikan Tesseract dan vision API.

### Phase 4

- implement compare flow berbasis hasil nyata secara penuh,
- retry granular end-to-end,
- output aggregation,
- logs dan observability produksi.

## Contributing

Saat ini project masih berada di tahap prototyping dan pondasi teknis. Workflow kontribusi formal belum dibuat, tapi commit mengikuti Conventional Commits dan perubahan besar sebaiknya tetap melewati lint/typecheck.

## License

Project ini menggunakan lisensi MIT. Lihat `LICENSE` untuk detail lengkap.
