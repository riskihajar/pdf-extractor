export type ExtractionMode = "LLM only" | "Tesseract only" | "Both compare"
export type OutputFormat = "Markdown" | "Text" | "MD + TXT"
export type JobStatus =
  | "Uploaded"
  | "Queued"
  | "Processing"
  | "Paused"
  | "Cancelled"
  | "Partial success"
  | "Completed"
export type EngineState = "Ready" | "Queued" | "Running" | "Done" | "Failed"
export type PageStatus = "Waiting" | "Extracting" | "Compared" | "Needs review"
export type DetailTab = "Pages" | "Compare" | "Output" | "Logs"

export type JobRecord = {
  id: string
  canRetry?: boolean
  backgroundReady?: boolean
  name: string
  pages: number
  mode: ExtractionMode
  output: OutputFormat
  status: JobStatus
  progress: number
  rendered: number
  extracted: number
  failed: number
}

export type PageTask = {
  id?: string
  canRetry?: boolean
  page: string
  imagePath?: string
  previewUrl?: string
  llm: EngineState
  tesseract: EngineState
  status: PageStatus
  note: string
}

export type JobDetail = {
  title: string
  subtitle: string
  compareSummary: string
  background: {
    status: "idle" | "prepared"
    worker: string
    queue: string
    preparedAt: string | null
    summary: string
  }
  pages: PageTask[]
  events: string[]
  outputPreview: {
    markdown: string
    text: string
  }
  outputMeta?: {
    isPartial: boolean
    failedPages: string[]
    missingPages: string[]
    winnerOverrides: string[]
  }
  compareRows: Array<{
    page: string
    winner: "LLM" | "Tesseract" | "Tie"
    llmSummary: string
    tesseractSummary: string
    reason?: string
    overridden?: boolean
    scores?: {
      llm: number
      tesseract: number
    }
  }>
  pipeline: Array<{
    title: string
    detail: string
    state: "done" | "active" | "pending"
  }>
}

export const heroStats = [
  {
    label: "Active jobs",
    value: "24",
    detail: "8 rendering, 11 extracting, 5 aggregating",
  },
  {
    label: "Queue depth",
    value: "186",
    detail: "Per-page tasks waiting across all workers",
  },
  {
    label: "Output health",
    value: "92%",
    detail: "Partial results preserved for failed pages",
  },
]

export const detailTabs: DetailTab[] = ["Pages", "Compare", "Output", "Logs"]

export const initialJobs: JobRecord[] = [
  {
    id: "job-1",
    name: "bank-statement-april.pdf",
    pages: 12,
    mode: "Both compare",
    output: "MD + TXT",
    status: "Processing",
    progress: 74,
    rendered: 12,
    extracted: 9,
    failed: 1,
  },
  {
    id: "job-2",
    name: "invoice-batch-q2.pdf",
    pages: 5,
    mode: "LLM only",
    output: "Markdown",
    status: "Queued",
    progress: 18,
    rendered: 5,
    extracted: 0,
    failed: 0,
  },
  {
    id: "job-3",
    name: "scan-kontrak.pdf",
    pages: 9,
    mode: "Tesseract only",
    output: "Text",
    status: "Partial success",
    progress: 88,
    rendered: 9,
    extracted: 8,
    failed: 1,
  },
]

const bankPages: PageTask[] = [
  {
    page: "Page 01",
    llm: "Ready",
    tesseract: "Ready",
    status: "Compared",
    note: "Layout preserved, table blocks recognized",
  },
  {
    page: "Page 02",
    llm: "Running",
    tesseract: "Done",
    status: "Extracting",
    note: "Vision pass retries handwriting region",
  },
  {
    page: "Page 03",
    llm: "Done",
    tesseract: "Failed",
    status: "Needs review",
    note: "Fallback to LLM recommended",
  },
  {
    page: "Page 04",
    llm: "Queued",
    tesseract: "Queued",
    status: "Waiting",
    note: "Queued behind 3 pages",
  },
]

const invoicePages: PageTask[] = [
  {
    page: "Page 01",
    llm: "Queued",
    tesseract: "Ready",
    status: "Waiting",
    note: "Vision-only lane reserved for totals and stamps",
  },
  {
    page: "Page 02",
    llm: "Queued",
    tesseract: "Ready",
    status: "Waiting",
    note: "Ready to extract tables once queue slot opens",
  },
  {
    page: "Page 03",
    llm: "Queued",
    tesseract: "Ready",
    status: "Waiting",
    note: "Waiting on current LLM rate window",
  },
]

const contractPages: PageTask[] = [
  {
    page: "Page 01",
    llm: "Ready",
    tesseract: "Done",
    status: "Compared",
    note: "OCR baseline already captured signatures section",
  },
  {
    page: "Page 02",
    llm: "Ready",
    tesseract: "Done",
    status: "Compared",
    note: "Dense paragraph text normalized successfully",
  },
  {
    page: "Page 03",
    llm: "Done",
    tesseract: "Failed",
    status: "Needs review",
    note: "Skewed scan needs manual compare before export",
  },
]

export const initialJobDetails: Record<string, JobDetail> = {
  "job-1": {
    title: "bank-statement-april.pdf",
    subtitle: "Dual-engine compare mode with markdown and plain text export",
    compareSummary:
      "9 pages aligned, 1 page flagged for OCR fallback, 2 pages still running",
    background: {
      status: "prepared",
      worker: "render-worker",
      queue: "extract-compare",
      preparedAt: "2026-04-05T18:42:00.000Z",
      summary:
        "Rendered assets sudah dipublish ke queue compare untuk worker OCR dan LLM",
    },
    pages: bankPages,
    events: [
      "18:42 - Render worker finished all 12 pages for bank-statement-april.pdf",
      "18:43 - Tesseract page 3 failed with empty OCR output",
      "18:43 - LLM retry scheduled for page 3 due to low OCR quality",
      "18:44 - Aggregator merged pages 1-8 into markdown draft",
    ],
    outputPreview: {
      markdown:
        "# bank-statement-april.pdf\n\n## Page 1\nStatement opening balance confirmed.\n\n## Page 2\nTransactions extracted with line grouping still in progress.",
      text: "bank-statement-april.pdf\n\n----- Page 1 -----\nStatement opening balance confirmed.\n\n----- Page 2 -----\nTransactions extracted with line grouping still in progress.",
    },
    compareRows: [
      {
        page: "Page 01",
        winner: "Tie",
        llmSummary: "Structured table and headings preserved",
        tesseractSummary: "Clean OCR, similar content fidelity",
      },
      {
        page: "Page 02",
        winner: "LLM",
        llmSummary: "Handwritten annotation recognized with context",
        tesseractSummary: "Missed handwritten marginal notes",
      },
      {
        page: "Page 03",
        winner: "LLM",
        llmSummary: "Fallback fills blank OCR section",
        tesseractSummary: "Returned empty extraction",
      },
    ],
    pipeline: [
      {
        title: "Upload received",
        detail:
          "12 pages detected, compare mode enabled, output set to markdown and text",
        state: "done",
      },
      {
        title: "Page snapshots generated",
        detail:
          "All pages rasterized and stored for OCR, compare review, and export replay",
        state: "done",
      },
      {
        title: "Extraction queue running",
        detail:
          "LLM and Tesseract tasks execute with retry and page-level visibility",
        state: "active",
      },
      {
        title: "Aggregator preparing exports",
        detail:
          "Markdown draft updates as each page resolves or is marked partial",
        state: "pending",
      },
    ],
  },
  "job-2": {
    title: "invoice-batch-q2.pdf",
    subtitle:
      "Vision-only extraction queued for invoice totals and tabular data",
    compareSummary: "No compare lane enabled, waiting for LLM worker capacity",
    background: {
      status: "prepared",
      worker: "vision-worker",
      queue: "extract-llm",
      preparedAt: "2026-04-05T18:33:00.000Z",
      summary:
        "Snapshot batch sudah siap dan menunggu slot worker vision berikutnya",
    },
    pages: invoicePages,
    events: [
      "18:31 - Upload registered with 5 pages and markdown export preset",
      "18:33 - Page snapshots complete, queued for LLM extraction",
      "18:34 - Job waiting for available vision slot",
    ],
    outputPreview: {
      markdown:
        "# invoice-batch-q2.pdf\n\nOutput preview will unlock after the first LLM page resolves.",
      text: "invoice-batch-q2.pdf\n\nOutput preview pending until extraction begins.",
    },
    compareRows: [
      {
        page: "Page 01",
        winner: "LLM",
        llmSummary: "Expected to preserve invoice totals and stamps",
        tesseractSummary: "Not scheduled for this lane",
      },
    ],
    pipeline: [
      {
        title: "Upload received",
        detail: "5 pages detected, markdown export selected",
        state: "done",
      },
      {
        title: "Page snapshots generated",
        detail: "Images prepared and attached to the LLM-only queue",
        state: "done",
      },
      {
        title: "Extraction queue waiting",
        detail: "Job is queued behind high-priority compare jobs",
        state: "active",
      },
      {
        title: "Aggregator idle",
        detail: "Exports will begin as soon as page text starts landing",
        state: "pending",
      },
    ],
  },
  "job-3": {
    title: "scan-kontrak.pdf",
    subtitle:
      "Tesseract-first contract scan with partial success and manual review needs",
    compareSummary:
      "8 pages extracted, 1 page still flagged for skew correction before final export",
    background: {
      status: "prepared",
      worker: "tesseract-worker",
      queue: "extract-ocr",
      preparedAt: "2026-04-05T17:58:00.000Z",
      summary:
        "Worker OCR sudah menerima artifact render dan menjaga partial output untuk retry",
    },
    pages: contractPages,
    events: [
      "17:58 - Tesseract completed 8 pages successfully",
      "18:01 - One skewed page marked for review after confidence drop",
      "18:03 - Partial text export prepared for download",
    ],
    outputPreview: {
      markdown:
        "# scan-kontrak.pdf\n\n## Page 1\nContract heading and clauses available.\n\n## Page 3\nManual review recommended before release.",
      text: "scan-kontrak.pdf\n\n----- Page 1 -----\nContract heading and clauses available.\n\n----- Page 3 -----\nManual review recommended before release.",
    },
    compareRows: [
      {
        page: "Page 03",
        winner: "Tesseract",
        llmSummary: "Not scheduled yet, fallback available if retry requested",
        tesseractSummary: "Captured majority of clauses despite skewed scan",
      },
    ],
    pipeline: [
      {
        title: "Upload received",
        detail: "9 pages detected, text export selected",
        state: "done",
      },
      {
        title: "Page snapshots generated",
        detail: "Scanned pages normalized before OCR pass",
        state: "done",
      },
      {
        title: "Tesseract extraction finished",
        detail: "One page remains flagged because of skewed scan quality",
        state: "done",
      },
      {
        title: "Final export held",
        detail: "Partial text is ready while one page awaits review or retry",
        state: "active",
      },
    ],
  },
}

export function createUploadJob(
  index: number,
  mode: ExtractionMode,
  output: OutputFormat,
  name?: string
): JobRecord {
  const pages = 3 + (index % 6)
  const filename =
    name?.trim() || `incoming-batch-${String(index).padStart(2, "0")}.pdf`

  return {
    id: `uploaded-${index}`,
    name: filename,
    pages,
    mode,
    output,
    status: "Uploaded",
    progress: 0,
    rendered: 0,
    extracted: 0,
    failed: 0,
  }
}

export function createJobDetail(job: JobRecord): JobDetail {
  const compareEnabled = job.mode === "Both compare"
  const modeLabel = compareEnabled
    ? "Dual-engine compare lane ready"
    : `${job.mode} lane selected`

  return {
    title: job.name,
    subtitle: `${modeLabel} with ${job.output.toLowerCase()} export preset`,
    compareSummary: compareEnabled
      ? "New upload will compare LLM and Tesseract outputs as pages start processing"
      : "This job will follow a single extraction lane until retry or fallback changes it",
    background: {
      status: "idle",
      worker:
        job.mode === "Both compare"
          ? "compare-supervisor"
          : job.mode === "LLM only"
            ? "vision-worker"
            : "tesseract-worker",
      queue:
        job.mode === "Both compare"
          ? "extract-compare"
          : job.mode === "LLM only"
            ? "extract-llm"
            : "extract-ocr",
      preparedAt: null,
      summary: "Worker handoff belum disiapkan untuk job ini",
    },
    pages: Array.from({ length: Math.min(job.pages, 4) }, (_, index) => ({
      page: `Page ${String(index + 1).padStart(2, "0")}`,
      llm: compareEnabled || job.mode === "LLM only" ? "Queued" : "Ready",
      tesseract:
        compareEnabled || job.mode === "Tesseract only" ? "Queued" : "Ready",
      status: "Waiting",
      note: "Waiting for snapshots, extraction assignment, and first worker slot",
    })),
    events: [
      "New upload staged from dashboard intake",
      "Job metadata saved and waiting for explicit start action",
      "Page images will appear here once rendering begins",
    ],
    outputPreview: {
      markdown: `# ${job.name}\n\nOutput preview pending until extraction starts.`,
      text: `${job.name}\n\nOutput preview pending until extraction starts.`,
    },
    compareRows: [
      {
        page: "Page 01",
        winner: compareEnabled
          ? "Tie"
          : job.mode === "LLM only"
            ? "LLM"
            : "Tesseract",
        llmSummary:
          compareEnabled || job.mode === "LLM only"
            ? "Queued for vision extraction"
            : "LLM lane disabled",
        tesseractSummary:
          compareEnabled || job.mode === "Tesseract only"
            ? "Queued for OCR extraction"
            : "Tesseract lane disabled",
      },
    ],
    pipeline: [
      {
        title: "Upload received",
        detail: `${job.pages} pages detected with ${job.mode} extraction and ${job.output} output preset`,
        state: "done",
      },
      {
        title: "Page rendering pending",
        detail: "Snapshot worker has not started yet for this job",
        state: "active",
      },
      {
        title: "Extraction queue idle",
        detail: "No page tasks dispatched until rendering begins",
        state: "pending",
      },
      {
        title: "Export preparation pending",
        detail: "Aggregator waits for the first resolved pages",
        state: "pending",
      },
    ],
  }
}
