# PDF Extractor

PDF Extractor adalah aplikasi berbasis Next.js untuk mengelola ekstraksi teks dari file PDF melalui pipeline dan queue yang terstruktur. Setiap file diproses sebagai job, setiap halaman dirender menjadi gambar, lalu diekstrak menggunakan vision LLM dengan protokol OpenAI-like, Tesseract OCR, atau keduanya untuk dibandingkan.

Repository ini saat ini berisi fondasi frontend, dokumentasi produk, dan baseline teknis untuk membangun dashboard pipeline extraction yang bisa dipantau per file dan per halaman.

## Highlights

- multi-upload PDF dalam satu sesi,
- job record per file,
- action `Start` per file dan `Start All` global,
- render PDF menjadi image per halaman,
- queue task di level halaman,
- mode ekstraksi `LLM only`, `Tesseract only`, dan `Both (compare)`,
- output `.md` dan `.txt`,
- compare result per engine,
- retry untuk file atau halaman yang gagal,
- observability status pipeline dari upload sampai export.

## Current Status

Project saat ini sudah memiliki:

- Next.js App Router,
- TypeScript,
- Tailwind CSS v4,
- shadcn/ui base preset,
- dokumentasi produk awal,
- repository GitHub di `riskihajar/pdf-extractor`.

Yang belum dibuat saat ini:

- dashboard UI final,
- upload flow production,
- worker render PDF,
- queue runtime,
- integrasi Tesseract,
- integrasi OpenAI-like vision API,
- export pipeline final.

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
- output akhir digabung ke format Markdown dan plain text.

Catatan teknis dari brainstorming saat ini:

- `pdfjs-dist` cocok untuk preview halaman dan jalur JavaScript-friendly,
- `pdftoppm` atau tool Poppler sejenis lebih cocok untuk render pipeline production di background worker,
- Tesseract cocok untuk jalur OCR lokal,
- vision LLM cocok untuk halaman dengan layout kompleks atau sebagai pembanding/fallback.

## Tech Stack

Current stack di repository ini:

- Next.js 16
- React 19
- TypeScript 5
- Tailwind CSS 4
- shadcn/ui
- ESLint
- Prettier

## Repository Structure

Struktur utama saat ini:

```text
.
├── app/
├── components/
├── hooks/
├── lib/
├── public/
├── PRD.md
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

## Roadmap

### Phase 1

- bangun dashboard UI statis,
- representasikan queue, file job, dan compare states,
- validasi layout dan informasi inti.

### Phase 2

- tambahkan upload flow,
- definisikan API contract dan state model,
- sambungkan UI ke data source internal.

### Phase 3

- implement render worker PDF-to-image,
- implement queue processing per halaman,
- integrasikan Tesseract dan vision API.

### Phase 4

- implement compare flow,
- retry granular,
- output aggregation,
- logs dan observability.

## Suggested README Metadata

- Project name: `pdf-extractor`
- Repository: `riskihajar/pdf-extractor`
- UI stack: Next.js + shadcn/ui
- Primary product concept: PDF extraction pipeline and queue dashboard

## Contributing

Saat ini project masih berada di tahap desain dan pondasi teknis. Jika nanti workflow kontribusi dibutuhkan, bagian ini bisa diperluas dengan standar branch, commit, code review, dan checklist testing.

## License

Lisensi default untuk repository ini adalah MIT, kecuali ditentukan lain di masa depan.

Jika kamu ingin, langkah berikutnya adalah menambahkan file `LICENSE` resmi agar deklarasi lisensi di repository konsisten.
