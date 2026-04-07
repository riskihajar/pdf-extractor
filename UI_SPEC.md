# UI Specification

## 1. Purpose

Dokumen ini menjelaskan arah UI untuk PDF Extractor berdasarkan workflow produk yang paling penting bagi user.

UI harus berpusat pada:

- dokumen PDF,
- status ekstraksi per dokumen,
- status ekstraksi per halaman,
- review hasil compare saat mode `Both`,
- download hasil akhir `.md` atau `.txt`.

UI tidak boleh dipimpin oleh istilah internal seperti pipeline lane, intake, worker cockpit, atau jargon sistem lain yang bukan bahasa user.

## 2. Primary User Tasks

User datang ke aplikasi untuk melakukan hal-hal berikut:

1. Upload satu atau banyak dokumen PDF.
2. Memilih mode ekstraksi: `LLM`, `Tesseract`, atau `Both`.
3. Melihat dokumen mana yang sudah selesai diekstrak dan mana yang belum.
4. Melihat halaman mana yang sudah selesai diekstrak dan mana yang gagal atau masih berjalan.
5. Membandingkan hasil LLM dan Tesseract jika mode `Both` dipakai.
6. Mengunduh hasil akhir dalam format `Markdown` atau `TXT`.

Semua keputusan layout dan istilah UI harus mendukung alur di atas.

## 3. UI Vocabulary

Istilah yang dipakai di UI harus sederhana dan langsung:

- `Documents`
- `Upload documents`
- `Extraction mode`
- `Output`
- `Status`
- `Pages`
- `Compare`
- `Result`
- `Logs`
- `Download`
- `Failed pages`
- `Extracted pages`

Istilah yang sebaiknya dihindari di UI utama:

- `Intake`
- `Pipeline cockpit`
- `Worker lane`
- `Runtime health` sebagai fokus utama layar
- istilah teknis internal yang tidak membantu user menyelesaikan tugas utamanya

## 4. Screen Architecture

UI utama mengikuti struktur ini:

1. Header ringkas
2. Bar aksi upload dan pengaturan ekstraksi
3. Daftar dokumen sebagai area utama
4. Panel detail dokumen terpilih
5. Area runtime/diagnostics sebagai secondary section

Tujuan utamanya adalah membuat user segera melihat dokumen yang sedang diproses dan statusnya, bukan melihat kartu-kartu dashboard dekoratif.

## 5. Main Layout

### 5.1 Header

Header harus ringkas dan tidak terasa seperti hero section.

Header cukup berisi:

- nama produk,
- status singkat runtime jika perlu,
- action global seperti `Start all` jika relevan.

Header tidak boleh menghabiskan tinggi layar berlebihan.

### 5.2 Upload and Action Bar

Area upload harus compact dan utilitarian, bukan card besar seperti landing page.

Komponen minimum:

- tombol `Upload documents`,
- ringkasan file yang dipilih atau jumlah file terpilih,
- selector `Extraction mode`,
- selector `Output`,
- tombol `Stage upload`,
- tombol `Start all`.

Jika ada error upload, tampilkan inline alert kecil di bawah action bar.

Jika tidak ada file yang dipilih, tampilkan placeholder singkat, bukan panel besar kosong.

### 5.3 Documents List

Daftar dokumen adalah fokus utama halaman.

Setiap baris dokumen minimal menampilkan:

- nama file,
- total halaman,
- mode ekstraksi,
- output format,
- status,
- progress,
- jumlah halaman gagal,
- actions.

Actions minimum:

- `Start`
- `View`
- `Retry`
- `Download`

Jika user memilih sebuah dokumen, detail dokumen harus terbuka tanpa memecah fokus dari daftar utama.

### 5.4 Document Detail Panel

Panel detail harus kontekstual terhadap dokumen yang dipilih.

Bagian atas panel minimal menampilkan:

- nama file,
- status dokumen,
- mode ekstraksi,
- output format,
- progress ringkas,
- jumlah halaman selesai / gagal / pending.

Tabs yang didukung:

- `Pages`
- `Compare`
- `Result`
- `Logs`

### 5.5 Pages Tab

Tab `Pages` harus menunjukkan status tiap halaman dengan jelas.

Minimal menampilkan:

- nomor halaman,
- status halaman,
- status engine jika perlu,
- quick action `Retry page` untuk halaman gagal,
- preview render jika memang membantu.

Tujuan tab ini adalah menjawab pertanyaan user:

- halaman mana yang sudah selesai,
- halaman mana yang masih berjalan,
- halaman mana yang gagal.

### 5.6 Compare Tab

Tab `Compare` hanya relevan jika mode `Both` dipakai.

Tab ini harus menampilkan:

- hasil LLM,
- hasil Tesseract,
- pemenang saat ini,
- alasan/score jika tersedia,
- action manual override winner.

Compare tidak boleh menjadi fitur global yang mendominasi layar utama. Compare adalah alat review per dokumen atau per halaman.

### 5.7 Result Tab

Tab `Result` menampilkan hasil akhir dokumen.

Isi minimum:

- preview `Markdown`,
- preview `TXT`,
- tombol `Download .md`,
- tombol `Download .txt`,
- opsi partial download jika memang ada halaman gagal.

### 5.8 Logs Tab

Tab `Logs` menampilkan masalah yang bisa ditindaklanjuti.

Yang harus diprioritaskan:

- error render,
- error OCR,
- error LLM,
- page yang gagal,
- retry-related messages.

Logs tidak boleh menjadi satu-satunya cara user memahami status proses. Status utama tetap harus terlihat dari daftar dokumen dan daftar halaman.

## 6. Information Hierarchy

Urutan prioritas informasi di UI utama:

1. Dokumen apa saja yang ada.
2. Status tiap dokumen.
3. Status tiap halaman di dokumen terpilih.
4. Hasil compare dan output.
5. Runtime diagnostics teknis.

Kalau layout membuat runtime/config cards lebih dominan daripada daftar dokumen, berarti hierarchy UI salah.

## 7. Runtime and Diagnostics Placement

Runtime status tetap penting, tetapi posisinya secondary.

Penempatan yang disarankan:

- badges kecil di header,
- collapsible section,
- panel settings/diagnostics terpisah.

Runtime test buttons seperti `Test LLM` atau `Test Tesseract` tidak boleh mengganggu workflow utama upload, review dokumen, dan download output.

## 8. Empty, Loading, and Error States

### 8.1 Empty State

Saat belum ada dokumen:

- tampilkan call to action sederhana untuk upload dokumen,
- jangan tampilkan dashboard kosong besar yang tidak informatif.

### 8.2 Loading State

Saat dokumen sedang diproses:

- tampilkan status progress di level dokumen,
- tampilkan progress atau state di level halaman,
- hindari hanya mengandalkan spinner global.

### 8.3 Error State

Saat ada error:

- tampilkan file atau halaman mana yang gagal,
- tampilkan pesan singkat yang actionable,
- tampilkan action retry yang relevan.

## 9. Responsive Behavior

Di desktop:

- daftar dokumen dan panel detail bisa tampil berdampingan.

Di mobile/tablet:

- daftar dokumen tetap menjadi prioritas pertama,
- detail dokumen dapat muncul di bawah daftar atau lewat sheet/tab terpisah,
- action upload dan selector harus tetap mudah dijangkau tanpa card besar.

## 10. Design Guardrails

Untuk pekerjaan UI berikutnya, ikuti guardrails ini:

- Fokus pada workflow dokumen, bukan dashboard dekoratif.
- Hindari istilah internal sistem di UI utama.
- Hindari hero section besar untuk action upload sederhana.
- Jadikan daftar dokumen sebagai pusat layar.
- Jadikan detail halaman sebagai alat observability utama.
- Compare hanya muncul saat relevan.
- Runtime/config adalah secondary layer.

## 11. Current UI Direction to Move Toward

Target layout praktis yang diinginkan:

- top bar ringkas,
- action bar compact untuk upload + mode + output,
- `Documents` list sebagai area utama,
- `Document detail` sebagai inspector panel,
- runtime/diagnostics di area sekunder.

Jika ada konflik antara tampilan dashboard generik dan kebutuhan workflow dokumen, selalu prioritaskan workflow dokumen.
