import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import {
  createJobDetail,
  initialJobDetails,
  initialJobs,
  type ExtractionMode,
  type JobDetail,
  type JobRecord,
  type OutputFormat,
} from "@/lib/dashboard-data"
import type {
  PipelineResult,
  StagedUploadResult,
  UploadedPdfMetadata,
} from "@/lib/pdf-pipeline"
import { readImageDataUrl, runLlmPage, type LlmRunner } from "@/lib/llm-runtime"
import { runTesseractPage, type TesseractRunner } from "@/lib/tesseract-runtime"

export type JobStoreState = {
  jobs: JobRecord[]
  details: Record<string, JobDetail>
}

export type WorkerDiagnosticsState = {
  workers: Array<{
    queue: string
    worker: string
    preparedJobs: number
    activeJobs: number
    pendingPages: number
  }>
  totals: {
    preparedJobs: number
    activeJobs: number
    pendingPages: number
  }
}

export type JobLogsPayload = {
  jobId: string
  title: string
  events: string[]
  pipeline: JobDetail["pipeline"]
}

export type JobOutputPayload = {
  jobId: string
  title: string
  output: OutputFormat
  preview: JobDetail["outputPreview"]
  generatedAt: string | null
  isPartial?: boolean
  failedPages?: string[]
  missingPages?: string[]
  winnerOverrides?: string[]
  sources?: {
    tesseractPages: Array<{
      page: string
      text: string
    }>
  }
  compareAudit?: Array<{
    page: string
    winner: "LLM" | "Tesseract" | "Tie"
    reason?: string
    overridden?: boolean
    scores?: {
      llm: number
      tesseract: number
    }
  }>
}

export type JobPagesPayload = {
  jobId: string
  title: string
  subtitle: string
  compareSummary: string
  canRetry: boolean
  pages: JobDetail["pages"]
}

export type UploadedFileRecord = {
  jobId: string
  storageKey: string
  originalName: string
  storedPath: string
  mimeType: string
  sizeBytes: number
  pageCount: number
}

export type RenderArtifactRecord = {
  jobId: string
  pageId: string
  position: number
  imagePath: string
}

type CreateJobsInput = {
  files?: string[]
  mode: ExtractionMode
  output: OutputFormat
}

type CreateUploadedJobInput = {
  pipeline: PipelineResult | StagedUploadResult
}

type CreateStoredUploadInput = {
  job: JobRecord
  detail: JobDetail
  metadata: UploadedPdfMetadata
}

type UpdateJobInput = {
  jobId: string
}

type OverrideCompareWinnerInput = {
  jobId: string
  page: string
  winner: "LLM" | "Tesseract" | "auto"
}

type RetryPageInput = {
  pageId: string
}

type JobMutation = {
  job: JobRecord
  detail: JobDetail
}

type WorkerRunMutation = {
  processedJobs: Array<{
    job: JobRecord
    detail: JobDetail
  }>
}

type WorkerDrainResult = {
  ticks: number
  processedJobs: Array<{
    job: JobRecord
    detail: JobDetail
  }>
}

type WorkerRunOptions = {
  llmRunner?: LlmRunner
  tesseractRunner?: TesseractRunner
}

type JobRow = {
  id: string
  name: string
  pages: number
  mode: ExtractionMode
  output: OutputFormat
  status: JobRecord["status"]
  progress: number
  rendered: number
  extracted: number
  failed: number
  sort_order: number
}

type JobDetailRow = {
  job_id: string
  payload: string
}

type JobMetaRow = {
  job_id: string
  title: string
  subtitle: string
  compare_summary: string
  background_status: JobDetail["background"]["status"]
  background_worker: string
  background_queue: string
  background_prepared_at: string | null
  background_summary: string
}

type JobEventRow = {
  job_id: string
  position: number
  message: string
}

type JobPageRow = {
  job_id: string
  page_id?: string | null
  position: number
  page_label: string
  image_path?: string | null
  llm_state: JobDetail["pages"][number]["llm"]
  tesseract_state: JobDetail["pages"][number]["tesseract"]
  tesseract_text?: string | null
  status: JobDetail["pages"][number]["status"]
  note: string
}

type UploadedFileRow = {
  job_id: string
  storage_key: string
  original_name: string
  stored_path: string
  mime_type: string
  size_bytes: number
  page_count: number
}

type RenderArtifactRow = {
  job_id: string
  page_id: string
  position: number
  image_path: string
}

type SchemaVersionRow = {
  version: number
}

type JobCompareRow = {
  job_id: string
  position: number
  page_label: string
  winner: JobDetail["compareRows"][number]["winner"]
  llm_summary: string
  tesseract_summary: string
  llm_full_text?: string | null
  tesseract_full_text?: string | null
  winner_reason?: string | null
  overridden?: number | null
  llm_score?: number | null
  tesseract_score?: number | null
}

type JobOutputMeta = NonNullable<JobDetail["outputMeta"]>

type JobPipelineRow = {
  job_id: string
  position: number
  title: string
  detail: string
  state: JobDetail["pipeline"][number]["state"]
}

type JobOutputRow = {
  job_id: string
  markdown: string
  text: string
  generated_at: string | null
}

function getTestIsolationSuffix() {
  return process.env.NODE_TEST_CONTEXT ? `-${process.pid}` : ""
}

const JOB_STORE_DIR = join(process.cwd(), ".data")
const JOB_STORE_PATH =
  process.env.PDF_EXTRACTOR_JOB_DB_PATH ||
  join(JOB_STORE_DIR, `jobs${getTestIsolationSuffix()}.sqlite`)
const JOB_STORE_SCHEMA_VERSION = 11

const globalStore = globalThis as typeof globalThis & {
  __pdfExtractorJobDatabase__?: DatabaseSync
}

function cloneState(state: JobStoreState): JobStoreState {
  return {
    jobs: state.jobs.map((job) => ({ ...job })),
    details: Object.fromEntries(
      Object.entries(state.details).map(([jobId, detail]) => [
        jobId,
        structuredClone(detail),
      ])
    ),
  }
}

function ensureParentDirectory() {
  mkdirSync(dirname(JOB_STORE_PATH), { recursive: true })
}

function mapJobRow(row: JobRow): JobRecord {
  const backgroundReady = row.status !== "Uploaded" || row.pages > 0

  return {
    id: row.id,
    canRetry: canRetryJob({
      status: row.status,
      failed: row.failed,
    }),
    backgroundReady,
    name: row.name,
    pages: row.pages,
    mode: row.mode,
    output: row.output,
    status: row.status,
    progress: row.progress,
    rendered: row.rendered,
    extracted: row.extracted,
    failed: row.failed,
  }
}

function withTransaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec("BEGIN")

  try {
    const result = callback()
    db.exec("COMMIT")
    return result
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

function normalizeDetail(job: JobRecord, detail?: JobDetail): JobDetail {
  const fallback = createJobDetail(job)
  const source = detail ?? fallback

  return {
    title: source.title || fallback.title,
    subtitle: source.subtitle || fallback.subtitle,
    compareSummary: source.compareSummary || fallback.compareSummary,
    background: {
      status: source.background?.status || fallback.background.status,
      worker: source.background?.worker || fallback.background.worker,
      queue: source.background?.queue || fallback.background.queue,
      preparedAt:
        source.background?.preparedAt !== undefined
          ? source.background.preparedAt
          : fallback.background.preparedAt,
      summary: source.background?.summary || fallback.background.summary,
    },
    pages: (source.pages.length > 0 ? source.pages : fallback.pages).map(
      (page) => ({
        ...page,
      })
    ),
    events: (source.events.length > 0 ? source.events : fallback.events).slice(
      0,
      12
    ),
    outputPreview: {
      markdown:
        source.outputPreview.markdown || fallback.outputPreview.markdown,
      text: source.outputPreview.text || fallback.outputPreview.text,
    },
    outputMeta: {
      isPartial: source.outputMeta?.isPartial ?? false,
      failedPages: source.outputMeta?.failedPages?.slice() ?? [],
      missingPages: source.outputMeta?.missingPages?.slice() ?? [],
      winnerOverrides: source.outputMeta?.winnerOverrides?.slice() ?? [],
    },
    compareRows:
      source.compareRows.length > 0
        ? source.compareRows.map((row) => ({ ...row }))
        : fallback.compareRows.map((row) => ({ ...row })),
    pipeline:
      source.pipeline.length > 0
        ? source.pipeline.map((step) => ({ ...step }))
        : fallback.pipeline.map((step) => ({ ...step })),
  }
}

function clearNormalizedTables(db: DatabaseSync, jobId?: string) {
  const clauses = [
    "DELETE FROM uploaded_files",
    "DELETE FROM render_artifacts",
    "DELETE FROM job_meta",
    "DELETE FROM job_events",
    "DELETE FROM job_pages",
    "DELETE FROM job_compare_rows",
    "DELETE FROM job_pipeline_steps",
    "DELETE FROM job_outputs",
  ]

  for (const sql of clauses) {
    if (jobId) {
      db.prepare(`${sql} WHERE job_id = ?`).run(jobId)
    } else {
      db.exec(sql)
    }
  }
}

function buildPageId(jobId: string, position: number) {
  return `${jobId}:page-${String(position + 1).padStart(2, "0")}`
}

function isRetryablePage(
  page: Pick<JobDetail["pages"][number], "status" | "llm" | "tesseract">
) {
  return (
    page.status === "Needs review" ||
    page.llm === "Failed" ||
    page.tesseract === "Failed"
  )
}

function canRetryJob(job: Pick<JobRecord, "status" | "failed">) {
  return job.failed > 0 || job.status === "Partial success"
}

function buildBackgroundState(
  job: Pick<JobRecord, "mode" | "status">,
  preparedAt: string | null = null
): JobDetail["background"] {
  const queue =
    job.mode === "Both compare"
      ? "extract-compare"
      : job.mode === "LLM only"
        ? "extract-llm"
        : "extract-ocr"

  const worker =
    job.mode === "Both compare"
      ? "compare-supervisor"
      : job.mode === "LLM only"
        ? "vision-worker"
        : "tesseract-worker"

  if (job.status === "Uploaded") {
    return {
      status: "idle",
      worker,
      queue,
      preparedAt,
      summary: "Worker handoff belum disiapkan untuk job ini",
    }
  }

  return {
    status: "prepared",
    worker,
    queue,
    preparedAt: preparedAt ?? new Date().toISOString(),
    summary: `Job sudah dipublish ke ${queue} dan siap diambil ${worker}`,
  }
}

function countPendingPages(detail: Pick<JobDetail, "pages">) {
  return detail.pages.filter(
    (page) => page.status === "Waiting" || page.status === "Extracting"
  ).length
}

function hasRunnableCompareArtifacts(detail: Pick<JobDetail, "pages">) {
  return detail.pages.some(
    (page) => page.status === "Extracting" && Boolean(page.imagePath)
  )
}

function buildWorkerProcessedPreview(job: JobRecord, detail: JobDetail) {
  const completedPages = detail.pages.filter(
    (page) => page.status === "Compared"
  )
  const pageSummary = completedPages
    .slice(0, 3)
    .map((page) => `- ${page.page}: extracted by worker lane`)
    .join("\n")

  return {
    markdown: `# ${job.name}\n\n## Worker output\n${pageSummary || "- No completed pages yet"}\n`,
    text: `${job.name}\n\nWorker output\n${
      completedPages
        .slice(0, 3)
        .map((page) => `${page.page}: extracted by worker lane`)
        .join("\n") || "No completed pages yet"
    }`,
  }
}

function getWorkerConcurrency(job: Pick<JobRecord, "mode">) {
  if (job.mode === "Both compare") {
    return 1
  }

  if (job.mode === "Tesseract only") {
    return 2
  }

  return 1
}

function getWorkerLaneLabel(job: Pick<JobRecord, "mode">) {
  if (job.mode === "Both compare") {
    return "extract-compare"
  }

  if (job.mode === "Tesseract only") {
    return "extract-ocr"
  }

  return "extract-llm"
}

function buildTesseractOutputPreview(job: JobRecord, outputs: string[]) {
  const body = outputs.length > 0 ? outputs.join("\n\n") : "No OCR output yet"

  return {
    markdown: `# ${job.name}\n\n## Tesseract OCR\n\n${body}`,
    text: `${job.name}\n\nTesseract OCR\n\n${body}`,
  }
}

function buildLlmOutputPreview(job: JobRecord, outputs: string[]) {
  const body = outputs.length > 0 ? outputs.join("\n\n") : "No LLM output yet"

  return {
    markdown: `# ${job.name}\n\n## Vision LLM Output\n\n${body}`,
    text: `${job.name}\n\nVision LLM Output\n\n${body}`,
  }
}

function buildCompareOutputPreview(
  job: JobRecord,
  llmOutputs: string[],
  tesseractOutputs: string[]
) {
  const sections = llmOutputs.map((llmOutput, index) => {
    const tesseractOutput = tesseractOutputs[index] ?? "No OCR output yet"

    return `${llmOutput}\n\n#### Tesseract\n\n${tesseractOutput.replace(/^### .*\n\n/, "")}`
  })

  const body =
    sections.length > 0 ? sections.join("\n\n") : "No compare output yet"

  return {
    markdown: `# ${job.name}\n\n## Compare Output\n\n${body}`,
    text: `${job.name}\n\nCompare Output\n\n${body}`,
  }
}

function splitWords(value: string) {
  return value
    .split(/(\s+)/)
    .map((part) => (part.trim() === "" ? part : part))
    .filter((part) => part.length > 0)
}

function buildDiffSegments(llmText: string, tesseractText: string) {
  const llmTokens = splitWords(llmText)
  const tesseractTokens = splitWords(tesseractText)
  const length = Math.max(llmTokens.length, tesseractTokens.length)
  const segments: Array<{
    type: "same" | "llm-only" | "tesseract-only"
    value: string
  }> = []

  for (let index = 0; index < length; index += 1) {
    const llmToken = llmTokens[index] ?? ""
    const tesseractToken = tesseractTokens[index] ?? ""

    if (llmToken === tesseractToken) {
      if (llmToken) {
        segments.push({ type: "same", value: llmToken })
      }
      continue
    }

    if (llmToken) {
      segments.push({ type: "llm-only", value: llmToken })
    }

    if (tesseractToken) {
      segments.push({ type: "tesseract-only", value: tesseractToken })
    }
  }

  return segments
}

function shouldFallbackToLlm(tesseractText: string) {
  const normalized = tesseractText.trim()

  if (!normalized) {
    return true
  }

  if (/\?{3,}|\bunclear\b|\bunknown\b/i.test(normalized)) {
    return true
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length
  return wordCount < 4
}

function chooseCompareWinner(llmText: string, tesseractText: string) {
  const { llm, tesseract } = scoreCompareOutputs(llmText, tesseractText)
  return llm >= tesseract ? "LLM" : "Tesseract"
}

function scoreCompareOutputs(llmText: string, tesseractText: string) {
  const normalizedLlm = llmText.trim()
  const normalizedTesseract = tesseractText.trim()

  if (!normalizedLlm && normalizedTesseract) {
    return { llm: 0, tesseract: 100 }
  }

  if (!normalizedTesseract && normalizedLlm) {
    return { llm: 100, tesseract: 0 }
  }

  const llmWordCount = normalizedLlm.split(/\s+/).filter(Boolean).length
  const tesseractWordCount = normalizedTesseract
    .split(/\s+/)
    .filter(Boolean).length

  const llmPenalty = /\?{3,}|\bunclear\b|\bunknown\b/i.test(normalizedLlm)
    ? 8
    : 0
  const tesseractPenalty = /\?{3,}|\bunclear\b|\bunknown\b/i.test(
    normalizedTesseract
  )
    ? 8
    : 0

  return {
    llm: normalizedLlm.length + llmWordCount * 2 - llmPenalty,
    tesseract:
      normalizedTesseract.length + tesseractWordCount * 2 - tesseractPenalty,
  }
}

function explainCompareWinner(llmText: string, tesseractText: string) {
  const normalizedLlm = llmText.trim()
  const normalizedTesseract = tesseractText.trim()

  if (!normalizedLlm && normalizedTesseract) {
    return "LLM kosong, jadi Tesseract menang otomatis"
  }

  if (!normalizedTesseract && normalizedLlm) {
    return "Tesseract kosong, jadi LLM menang otomatis"
  }

  const llmLowConfidence = /\?{3,}|\bunclear\b|\bunknown\b/i.test(normalizedLlm)
  const tesseractLowConfidence = /\?{3,}|\bunclear\b|\bunknown\b/i.test(
    normalizedTesseract
  )

  if (llmLowConfidence && !tesseractLowConfidence) {
    return "LLM terlihat low-confidence, Tesseract lebih stabil"
  }

  if (tesseractLowConfidence && !llmLowConfidence) {
    return "Tesseract terlihat low-confidence, LLM lebih stabil"
  }

  return "Winner dipilih dari skor gabungan panjang, jumlah kata, dan confidence penalty"
}

function buildOutputMeta(
  detail: Pick<JobDetail, "pages" | "compareRows">
): JobOutputMeta {
  const failedPages = detail.pages
    .filter(
      (page) =>
        page.status === "Needs review" ||
        page.llm === "Failed" ||
        page.tesseract === "Failed"
    )
    .map((page) => page.page)
  const missingPages = detail.pages
    .filter((page) => page.status === "Waiting" || page.status === "Extracting")
    .map((page) => page.page)
  const winnerOverrides = detail.compareRows
    .filter((row) => row.overridden)
    .map((row) => row.page)

  return {
    isPartial: failedPages.length > 0 || missingPages.length > 0,
    failedPages,
    missingPages,
    winnerOverrides,
  }
}

function buildPartialNotice(meta: JobOutputMeta) {
  const parts: string[] = []

  if (meta.failedPages.length > 0) {
    parts.push(`Failed pages: ${meta.failedPages.join(", ")}`)
  }

  if (meta.missingPages.length > 0) {
    parts.push(`Pending pages: ${meta.missingPages.join(", ")}`)
  }

  if (meta.winnerOverrides.length > 0) {
    parts.push(`Manual winners: ${meta.winnerOverrides.join(", ")}`)
  }

  return parts.join("\n")
}

function withOutputMeta(
  preview: JobDetail["outputPreview"],
  meta: JobOutputMeta
): JobDetail["outputPreview"] {
  if (!meta.isPartial && meta.winnerOverrides.length === 0) {
    return preview
  }

  const notice = buildPartialNotice(meta)
  const markdownPrefix = meta.isPartial
    ? `> Partial export\n> ${notice.split("\n").join("\n> ")}\n\n`
    : notice
      ? `> Manual compare overrides\n> ${notice.split("\n").join("\n> ")}\n\n`
      : ""
  const textPrefix = meta.isPartial
    ? `[PARTIAL EXPORT]\n${notice}\n\n`
    : notice
      ? `[MANUAL OVERRIDES]\n${notice}\n\n`
      : ""

  return {
    markdown: `${markdownPrefix}${preview.markdown}`,
    text: `${textPrefix}${preview.text}`,
  }
}

function applyOutputMeta(detail: JobDetail): JobDetail {
  const outputMeta = buildOutputMeta(detail)
  const preview = withOutputMeta(detail.outputPreview, outputMeta)

  return {
    ...detail,
    outputMeta,
    outputPreview: preview,
  }
}

function applyWorkerRun(job: JobRecord, detail: JobDetail): JobMutation {
  const concurrency = getWorkerConcurrency(job)
  const lane = getWorkerLaneLabel(job)
  let completedSlots = 0
  let runningSlots = 0
  const workerEvents: string[] = []

  const nextPages = detail.pages.map((page) => {
    if (page.status === "Compared") {
      return { ...page }
    }

    if (page.status === "Extracting" && completedSlots < concurrency) {
      completedSlots += 1
      workerEvents.push(
        `[${lane}] completed ${page.page} on slot ${completedSlots}/${concurrency}`
      )
      return {
        ...page,
        llm: job.mode === "Tesseract only" ? page.llm : "Done",
        tesseract: job.mode === "LLM only" ? page.tesseract : "Done",
        status: "Compared" as const,
        note: `${page.page} selesai diproses mock worker lane dan hasil parsial sudah masuk output`,
      }
    }

    if (page.status === "Waiting" && runningSlots < concurrency) {
      runningSlots += 1
      workerEvents.push(
        `[${lane}] started ${page.page} on slot ${runningSlots}/${concurrency}`
      )
      return {
        ...page,
        llm: job.mode === "Tesseract only" ? page.llm : "Running",
        tesseract: job.mode === "LLM only" ? page.tesseract : "Running",
        status: "Extracting" as const,
        note: `${page.page} sedang diproses worker lane aktif (slot ${runningSlots}/${concurrency})`,
      }
    }

    return { ...page }
  })

  const comparedPages = nextPages.filter(
    (page) => page.status === "Compared"
  ).length
  const nextJob: JobRecord = {
    ...job,
    status: comparedPages >= job.pages ? "Completed" : "Processing",
    progress: Math.min(Math.max(job.progress, 35) + 20, 100),
    rendered: Math.max(job.rendered, job.pages),
    extracted: Math.max(job.extracted, comparedPages),
  }

  const nextDetail: JobDetail = {
    ...detail,
    background: buildBackgroundState(nextJob, detail.background.preparedAt),
    subtitle: `${nextJob.mode} extraction advancing through mock worker runtime`,
    compareSummary:
      nextJob.mode === "Both compare"
        ? `${comparedPages} halaman sudah selesai dibandingkan oleh worker runtime mock`
        : `${comparedPages} halaman sudah diproses worker runtime mock pada lane aktif dengan concurrency ${concurrency}`,
    pages: nextPages,
    events: [
      ...workerEvents,
      `Worker tick consumed ${nextJob.name} via ${lane} with concurrency ${concurrency}`,
      ...detail.events,
    ].slice(0, 12),
    outputPreview: buildWorkerProcessedPreview(nextJob, {
      ...detail,
      pages: nextPages,
    }),
    pipeline: detail.pipeline.map((step, index) => {
      if (index === 2) {
        return {
          ...step,
          title:
            nextJob.status === "Completed"
              ? "Extraction queue drained"
              : "Extraction queue running",
          detail:
            nextJob.status === "Completed"
              ? "Mock worker menyelesaikan seluruh halaman yang siap diproses"
              : "Mock worker sedang memproses halaman berikutnya dari queue background",
          state:
            nextJob.status === "Completed"
              ? ("done" as const)
              : ("active" as const),
        }
      }

      if (index === 3) {
        return {
          ...step,
          title:
            nextJob.status === "Completed"
              ? "Output aggregation ready"
              : "Output aggregation warming up",
          detail:
            nextJob.status === "Completed"
              ? "Preview output sudah terisi dari hasil worker runtime mock"
              : "Preview output diperbarui setiap worker tick selesai",
          state:
            nextJob.status === "Completed"
              ? ("done" as const)
              : ("active" as const),
        }
      }

      return step
    }),
  }

  return {
    job: nextJob,
    detail: applyOutputMeta(nextDetail),
  }
}

async function applyTesseractWorkerRun(
  job: JobRecord,
  detail: JobDetail,
  runner: TesseractRunner,
  llmRunner?: LlmRunner
): Promise<JobMutation> {
  const outputs: string[] = []
  const nextPages = detail.pages.map((page) => ({ ...page }))
  const concurrency = getWorkerConcurrency(job)
  const lane = getWorkerLaneLabel(job)

  for (let index = 0; index < nextPages.length; index += 1) {
    const page = nextPages[index]

    if (!page || page.status !== "Extracting") {
      continue
    }

    const imagePath = page.imagePath ?? `/tmp/${job.id}-${index + 1}.png`
    const result = await runner(imagePath)
    let resolvedText = result.text
    let usedFallback = false

    if (shouldFallbackToLlm(result.text) && page.imagePath) {
      try {
        const imageDataUrl = await readImageDataUrl(page.imagePath)
        const fallback = llmRunner
          ? await llmRunner({
              imageUrl: page.imagePath,
              imageDataUrl,
              prompt: `Fallback extraction for ${page.page} after low-confidence Tesseract OCR`,
            })
          : await runLlmPage({
              imageUrl: page.imagePath,
              imageDataUrl,
              prompt: `Fallback extraction for ${page.page} after low-confidence Tesseract OCR`,
            })

        resolvedText = fallback.text
        usedFallback = true
      } catch {
        usedFallback = false
      }
    }

    outputs.push(`### ${page.page}\n\n${resolvedText}`)

    nextPages[index] = {
      ...page,
      imagePath,
      llm: usedFallback ? "Done" : page.llm,
      tesseract: "Done",
      status: "Compared",
      note: usedFallback
        ? `OCR: ${resolvedText} [fallback: LLM]`
        : `OCR: ${resolvedText}`,
    }
  }

  let activeSlots = 0
  nextPages.forEach((page, index) => {
    if (page.status !== "Waiting" || activeSlots >= concurrency) {
      return
    }

    activeSlots += 1
    nextPages[index] = {
      ...page,
      tesseract: "Running",
      status: "Extracting",
      note: `${page.page} sedang menunggu hasil OCR dari Tesseract runtime (slot ${activeSlots}/${concurrency})`,
    }
  })

  const comparedPages = nextPages.filter(
    (page) => page.status === "Compared"
  ).length
  const nextJob: JobRecord = {
    ...job,
    status: comparedPages >= job.pages ? "Completed" : "Processing",
    progress: Math.min(Math.max(job.progress, 35) + comparedPages * 10, 100),
    rendered: Math.max(job.rendered, job.pages),
    extracted: comparedPages,
  }

  return {
    job: nextJob,
    detail: applyOutputMeta({
      ...detail,
      background: buildBackgroundState(nextJob, detail.background.preparedAt),
      subtitle: "Tesseract OCR runtime is extracting rendered pages",
      compareSummary: `${comparedPages} halaman sudah punya hasil OCR nyata dari Tesseract`,
      pages: nextPages,
      events: [
        ...nextPages
          .filter((page) => page.status === "Compared")
          .map((page) => `[${lane}] OCR completed for ${page.page}`),
        `Worker tick consumed ${nextJob.name} via ${lane} with real Tesseract execution`,
        nextPages.some((page) => /fallback: LLM/.test(page.note))
          ? `[${lane}] low-confidence OCR triggered LLM fallback on selected pages`
          : null,
        ...detail.events,
      ]
        .filter(Boolean)
        .slice(0, 12) as string[],
      outputPreview: buildTesseractOutputPreview(nextJob, outputs),
      compareRows: detail.compareRows.map((row, index) => ({
        ...(function mapCompareRow() {
          const outputText = outputs[index]?.replace(/^### .*\n\n/, "")
          const pageState = nextPages[index]
          const fallbackApplied = /fallback: LLM/.test(pageState?.note ?? "")
          const llmText = fallbackApplied
            ? outputText || row.llmFullText || row.llmSummary
            : row.llmFullText || row.llmSummary
          const tesseractText =
            outputText || row.tesseractFullText || row.tesseractSummary

          return {
            ...row,
            winner: fallbackApplied ? ("LLM" as const) : row.winner,
            reason: fallbackApplied
              ? "Tesseract low-confidence memicu fallback ke LLM dan hasil fallback dipakai sebagai winner"
              : row.reason,
            llmSummary: fallbackApplied
              ? (outputText?.slice(0, 120) ?? row.llmSummary)
              : row.llmSummary,
            tesseractSummary: outputText?.slice(0, 120) ?? row.tesseractSummary,
            llmFullText: llmText,
            tesseractFullText: tesseractText,
            diffSegments: buildDiffSegments(llmText, tesseractText),
          }
        })(),
      })),
      pipeline: detail.pipeline.map((step, index) => {
        if (index === 2) {
          return {
            ...step,
            title:
              nextJob.status === "Completed"
                ? "Tesseract OCR completed"
                : "Tesseract OCR running",
            detail:
              nextJob.status === "Completed"
                ? "Semua halaman selesai diekstrak oleh binary Tesseract"
                : "Binary Tesseract sedang memproses batch halaman aktif",
            state: nextJob.status === "Completed" ? "done" : "active",
          }
        }

        if (index === 3) {
          return {
            ...step,
            title:
              nextJob.status === "Completed"
                ? "OCR output ready"
                : "OCR output warming up",
            detail:
              nextJob.status === "Completed"
                ? "Preview output terisi dari hasil OCR nyata"
                : "Preview output mulai terisi dari halaman yang sudah selesai OCR",
            state: nextJob.status === "Completed" ? "done" : "active",
          }
        }

        return step
      }),
    }),
  }
}

async function applyLlmWorkerRun(
  job: JobRecord,
  detail: JobDetail,
  runner: LlmRunner
): Promise<JobMutation> {
  const outputs: string[] = []
  const nextPages = detail.pages.map((page) => ({ ...page }))
  const concurrency = getWorkerConcurrency(job)
  const lane = getWorkerLaneLabel(job)

  for (let index = 0; index < nextPages.length; index += 1) {
    const page = nextPages[index]

    if (!page || page.status !== "Extracting") {
      continue
    }

    const imageUrl = page.imagePath
    let result: Awaited<ReturnType<LlmRunner>>

    try {
      if (!page.imagePath || !imageUrl) {
        throw new Error(`Missing rendered image for ${page.page}`)
      }

      const imageDataUrl = await readImageDataUrl(page.imagePath)
      result = await runner({
        imageUrl,
        imageDataUrl,
        prompt: `Extract the page content for ${page.page}`,
      })
    } catch (error) {
      nextPages[index] = {
        ...page,
        imagePath: imageUrl,
        llm: "Failed",
        status: "Waiting",
        note: `LLM error on ${page.page}: ${error instanceof Error ? error.message : String(error)}`,
      }

      return {
        job: {
          ...job,
          status: "Processing",
        },
        detail: applyOutputMeta({
          ...detail,
          pages: nextPages,
          events: [
            `[extract-llm] failed ${page.page}: ${error instanceof Error ? error.message : String(error)}`,
            ...detail.events,
          ].slice(0, 12),
        }),
      }
    }

    outputs.push(`### ${page.page}\n\n${result.text}`)

    nextPages[index] = {
      ...page,
      imagePath: imageUrl,
      llm: "Done",
      status: "Compared",
      note: `LLM: ${result.text}`,
    }
  }

  let activeSlots = 0
  nextPages.forEach((page, index) => {
    if (page.status !== "Waiting" || activeSlots >= concurrency) {
      return
    }

    activeSlots += 1
    nextPages[index] = {
      ...page,
      llm: "Running",
      status: "Extracting",
      note: `${page.page} sedang menunggu hasil extraction dari vision LLM (slot ${activeSlots}/${concurrency})`,
    }
  })

  const comparedPages = nextPages.filter(
    (page) => page.status === "Compared"
  ).length
  const nextJob: JobRecord = {
    ...job,
    status: comparedPages >= job.pages ? "Completed" : "Processing",
    progress: Math.min(Math.max(job.progress, 35) + comparedPages * 10, 100),
    rendered: Math.max(job.rendered, job.pages),
    extracted: comparedPages,
  }

  return {
    job: nextJob,
    detail: applyOutputMeta({
      ...detail,
      background: buildBackgroundState(nextJob, detail.background.preparedAt),
      subtitle: "Vision LLM runtime is extracting rendered pages",
      compareSummary: `${comparedPages} halaman sudah punya hasil extraction dari vision LLM`,
      pages: nextPages,
      events: [
        ...nextPages
          .filter((page) => page.status === "Compared")
          .map((page) => `[${lane}] LLM completed for ${page.page}`),
        `Worker tick consumed ${nextJob.name} via ${lane} with vision LLM execution`,
        ...detail.events,
      ].slice(0, 12),
      outputPreview: buildLlmOutputPreview(nextJob, outputs),
      compareRows: detail.compareRows.map((row, index) => ({
        ...row,
        llmSummary:
          outputs[index]?.replace(/^### .*\n\n/, "").slice(0, 120) ||
          row.llmSummary,
        llmFullText:
          outputs[index]?.replace(/^### .*\n\n/, "") || row.llmFullText,
        diffSegments: buildDiffSegments(
          outputs[index]?.replace(/^### .*\n\n/, "") ||
            row.llmFullText ||
            row.llmSummary,
          row.tesseractFullText ?? row.tesseractSummary
        ),
      })),
      pipeline: detail.pipeline.map((step, index) => {
        if (index === 2) {
          return {
            ...step,
            title:
              nextJob.status === "Completed"
                ? "Vision LLM completed"
                : "Vision LLM running",
            detail:
              nextJob.status === "Completed"
                ? "Semua halaman selesai diekstrak oleh vision LLM"
                : "Vision LLM sedang memproses batch halaman aktif",
            state: nextJob.status === "Completed" ? "done" : "active",
          }
        }

        if (index === 3) {
          return {
            ...step,
            title:
              nextJob.status === "Completed"
                ? "LLM output ready"
                : "LLM output warming up",
            detail:
              nextJob.status === "Completed"
                ? "Preview output terisi dari hasil LLM"
                : "Preview output mulai terisi dari halaman yang sudah selesai di vision LLM",
            state: nextJob.status === "Completed" ? "done" : "active",
          }
        }

        return step
      }),
    }),
  }
}

async function applyCompareWorkerRun(
  job: JobRecord,
  detail: JobDetail,
  llmRunner: LlmRunner,
  tesseractRunner: TesseractRunner
): Promise<JobMutation> {
  const llmOutputs: string[] = []
  const tesseractOutputs: string[] = []
  const processedOutputs = new Map<
    string,
    {
      llm: string
      tesseract: string
    }
  >()
  const nextPages = detail.pages.map((page) => ({ ...page }))
  const lane = getWorkerLaneLabel(job)

  for (let index = 0; index < nextPages.length; index += 1) {
    const page = nextPages[index]

    if (!page || page.status !== "Extracting" || !page.imagePath) {
      continue
    }

    const imagePath = page.imagePath
    const [llmResult, tesseractResult] = await Promise.all([
      llmRunner({
        imageUrl: imagePath,
        prompt: `Compare extraction input for ${page.page}`,
      }),
      tesseractRunner(imagePath),
    ])

    llmOutputs.push(`### ${page.page}\n\n${llmResult.text}`)
    tesseractOutputs.push(`### ${page.page}\n\n${tesseractResult.text}`)
    processedOutputs.set(page.page, {
      llm: llmResult.text,
      tesseract: tesseractResult.text,
    })

    nextPages[index] = {
      ...page,
      imagePath,
      llm: "Done",
      tesseract: "Done",
      status: "Compared",
      note: `COMPARE: ${chooseCompareWinner(llmResult.text, tesseractResult.text)}`,
    }
  }

  const nextWaitingIndex = nextPages.findIndex(
    (page) => page.status === "Waiting"
  )
  if (nextWaitingIndex >= 0) {
    nextPages[nextWaitingIndex] = {
      ...nextPages[nextWaitingIndex]!,
      llm: "Running",
      tesseract: "Running",
      status: "Extracting",
      note: `${nextPages[nextWaitingIndex]!.page} sedang dibandingkan oleh OCR + vision lane`,
    }
  }

  const comparedPages = nextPages.filter(
    (page) => page.status === "Compared"
  ).length
  const nextJob: JobRecord = {
    ...job,
    status: comparedPages >= job.pages ? "Completed" : "Processing",
    progress: Math.min(Math.max(job.progress, 35) + comparedPages * 10, 100),
    rendered: Math.max(job.rendered, job.pages),
    extracted: comparedPages,
  }

  return {
    job: nextJob,
    detail: applyOutputMeta({
      ...detail,
      background: buildBackgroundState(nextJob, detail.background.preparedAt),
      subtitle: "Compare lane is reconciling OCR and vision LLM output",
      compareSummary: `${comparedPages} halaman sudah punya hasil compare dari OCR dan vision LLM`,
      pages: nextPages,
      events: [
        ...nextPages
          .filter((page) => page.status === "Compared")
          .map((page) => `[${lane}] compare completed for ${page.page}`),
        `Worker tick consumed ${nextJob.name} via ${lane} with OCR + vision compare execution`,
        ...detail.events,
      ].slice(0, 12),
      outputPreview: buildCompareOutputPreview(
        nextJob,
        llmOutputs,
        tesseractOutputs
      ),
      compareRows: detail.compareRows.map((row) => {
        const processedRow = processedOutputs.get(row.page)
        const llmText = processedRow?.llm ?? row.llmSummary
        const tesseractText = processedRow?.tesseract ?? row.tesseractSummary

        return {
          ...row,
          winner: chooseCompareWinner(llmText, tesseractText) as
            | "LLM"
            | "Tesseract",
          reason: explainCompareWinner(llmText, tesseractText),
          overridden: row.overridden ?? false,
          scores: scoreCompareOutputs(llmText, tesseractText),
          llmSummary: processedRow?.llm.slice(0, 120) ?? row.llmSummary,
          llmFullText: processedRow?.llm ?? row.llmFullText ?? row.llmSummary,
          tesseractSummary:
            processedRow?.tesseract.slice(0, 120) ?? row.tesseractSummary,
          tesseractFullText:
            processedRow?.tesseract ??
            row.tesseractFullText ??
            row.tesseractSummary,
          diffSegments: buildDiffSegments(llmText, tesseractText),
        }
      }),
      pipeline: detail.pipeline.map((step, index) => {
        if (index === 2) {
          return {
            ...step,
            title:
              nextJob.status === "Completed"
                ? "Compare lane completed"
                : "Compare lane running",
            detail:
              nextJob.status === "Completed"
                ? "OCR dan vision LLM selesai dibandingkan untuk semua halaman"
                : "OCR dan vision LLM sedang diproses paralel untuk halaman aktif",
            state: nextJob.status === "Completed" ? "done" : "active",
          }
        }

        if (index === 3) {
          return {
            ...step,
            title:
              nextJob.status === "Completed"
                ? "Compare output ready"
                : "Compare output warming up",
            detail:
              nextJob.status === "Completed"
                ? "Winner compare dan output gabungan sudah siap"
                : "Winner compare mulai muncul dari halaman yang selesai diproses",
            state: nextJob.status === "Completed" ? "done" : "active",
          }
        }

        return step
      }),
    }),
  }
}

function writeNormalizedDetail(
  db: DatabaseSync,
  job: JobRecord,
  detail: JobDetail
) {
  const normalized = normalizeDetail(job, detail)

  clearNormalizedTables(db, job.id)

  db.prepare(
    `INSERT INTO job_meta (
      job_id,
      title,
      subtitle,
      compare_summary,
      background_status,
      background_worker,
      background_queue,
      background_prepared_at,
      background_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    job.id,
    normalized.title,
    normalized.subtitle,
    normalized.compareSummary,
    normalized.background.status,
    normalized.background.worker,
    normalized.background.queue,
    normalized.background.preparedAt,
    normalized.background.summary
  )

  normalized.events.forEach((event, index) => {
    db.prepare(
      `INSERT INTO job_events (job_id, position, message) VALUES (?, ?, ?)`
    ).run(job.id, index, event)
  })

  normalized.pages.forEach((page, index) => {
    db.prepare(
      `INSERT INTO job_pages (
        job_id, page_id, position, page_label, image_path, llm_state, tesseract_state, tesseract_text, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      job.id,
      buildPageId(job.id, index),
      index,
      page.page,
      page.imagePath ?? null,
      page.llm,
      page.tesseract,
      page.note.startsWith("OCR:") ? page.note.slice(5).trim() : null,
      page.status,
      page.note
    )
  })

  normalized.compareRows.forEach((row, index) => {
    db.prepare(
      `INSERT INTO job_compare_rows (
        job_id, position, page_label, winner, llm_summary, tesseract_summary, llm_full_text, tesseract_full_text, winner_reason, overridden, llm_score, tesseract_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      job.id,
      index,
      row.page,
      row.winner,
      row.llmSummary,
      row.tesseractSummary,
      row.llmFullText ?? row.llmSummary,
      row.tesseractFullText ?? row.tesseractSummary,
      row.reason ?? null,
      row.overridden ? 1 : 0,
      row.scores?.llm ?? null,
      row.scores?.tesseract ?? null
    )
  })

  normalized.pipeline.forEach((step, index) => {
    db.prepare(
      `INSERT INTO job_pipeline_steps (job_id, position, title, detail, state) VALUES (?, ?, ?, ?, ?)`
    ).run(job.id, index, step.title, step.detail, step.state)
  })

  db.prepare(
    `INSERT INTO job_outputs (job_id, markdown, text, generated_at) VALUES (?, ?, ?, ?)`
  ).run(
    job.id,
    normalized.outputPreview.markdown,
    normalized.outputPreview.text,
    new Date().toISOString()
  )

  db.prepare(
    `INSERT OR REPLACE INTO job_details (job_id, payload) VALUES (?, ?)`
  ).run(job.id, JSON.stringify(normalized))
}

function writeUploadedFileMetadata(
  db: DatabaseSync,
  metadata: UploadedPdfMetadata,
  jobId: string
) {
  db.prepare(
    `INSERT OR REPLACE INTO uploaded_files (
      job_id, storage_key, original_name, stored_path, mime_type, size_bytes, page_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    jobId,
    metadata.storageKey,
    metadata.originalName,
    metadata.storedPath,
    metadata.mimeType,
    metadata.sizeBytes,
    metadata.pageCount
  )
}

function writeRenderArtifacts(db: DatabaseSync, pipeline: PipelineResult) {
  pipeline.renderedPages.forEach((page, index) => {
    db.prepare(
      `INSERT OR REPLACE INTO render_artifacts (
        job_id, page_id, position, image_path
      ) VALUES (?, ?, ?, ?)`
    ).run(
      pipeline.job.id,
      buildPageId(pipeline.job.id, index),
      index,
      page.imagePath
    )
  })
}

function hasRenderedPages(
  pipeline: PipelineResult | StagedUploadResult
): pipeline is PipelineResult {
  return "renderedPages" in pipeline
}

function readLegacyDetails(db: DatabaseSync) {
  const detailRows = db
    .prepare(`SELECT job_id, payload FROM job_details ORDER BY job_id ASC`)
    .all() as JobDetailRow[]

  return Object.fromEntries(
    detailRows.map((row) => [row.job_id, JSON.parse(row.payload) as JobDetail])
  )
}

function hasNormalizedData(db: DatabaseSync): boolean {
  const tables = [
    "job_meta",
    "job_events",
    "job_pages",
    "job_compare_rows",
    "job_pipeline_steps",
    "job_outputs",
  ]

  return tables.some((tableName) => {
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
      .get() as {
      count: number
    }

    return row.count > 0
  })
}

function migrateLegacyDetails(db: DatabaseSync) {
  const jobs = db
    .prepare(
      `SELECT id, name, pages, mode, output, status, progress, rendered, extracted, failed, sort_order
       FROM jobs
       ORDER BY sort_order ASC, rowid ASC`
    )
    .all() as JobRow[]

  const legacyDetails = readLegacyDetails(db)

  withTransaction(db, () => {
    clearNormalizedTables(db)

    jobs.forEach((row) => {
      const job = mapJobRow(row)
      writeNormalizedDetail(
        db,
        job,
        legacyDetails[job.id] ?? createJobDetail(job)
      )
    })
  })
}

function seedDatabase(db: DatabaseSync) {
  if (process.env.PDF_EXTRACTOR_ENABLE_SAMPLE_SEED !== "true") {
    return
  }

  const insertJob = db.prepare(
    `INSERT INTO jobs (
      id, name, pages, mode, output, status, progress, rendered, extracted, failed, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  withTransaction(db, () => {
    initialJobs.forEach((job, index) => {
      insertJob.run(
        job.id,
        job.name,
        job.pages,
        job.mode,
        job.output,
        job.status,
        job.progress,
        job.rendered,
        job.extracted,
        job.failed,
        index
      )
      writeNormalizedDetail(db, job, initialJobDetails[job.id])
    })
  })
}

function cleanupLegacyOrphanJobs(db: DatabaseSync) {
  const orphanIds = db
    .prepare(
      `SELECT j.id
       FROM jobs j
       LEFT JOIN uploaded_files uf ON uf.job_id = j.id
       WHERE uf.job_id IS NULL`
    )
    .all() as Array<{ id: string }>

  if (orphanIds.length === 0) {
    return
  }

  orphanIds.forEach(({ id }) => {
    clearNormalizedTables(db, id)
    db.prepare(`DELETE FROM jobs WHERE id = ?`).run(id)
  })
}

function getCurrentSchemaVersion(db: DatabaseSync) {
  const row = db
    .prepare(`SELECT MAX(version) as version FROM schema_migrations`)
    .get() as SchemaVersionRow | undefined

  return row?.version ?? 0
}

function applySchemaMigrations(db: DatabaseSync) {
  const currentVersion = getCurrentSchemaVersion(db)

  if (currentVersion < 1) {
    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    ).run(1, new Date().toISOString())
  }

  if (currentVersion < 2) {
    const columns = db.prepare(`PRAGMA table_info(job_pages)`).all() as Array<{
      name: string
    }>

    if (!columns.some((column) => column.name === "page_id")) {
      db.exec(`ALTER TABLE job_pages ADD COLUMN page_id TEXT`)
    }

    db.exec(
      `UPDATE job_pages
       SET page_id = job_id || ':page-' || printf('%02d', position + 1)
       WHERE page_id IS NULL`
    )
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS job_pages_page_id_idx ON job_pages(page_id)`
    )
    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    ).run(JOB_STORE_SCHEMA_VERSION, new Date().toISOString())
  }

  if (currentVersion < 4) {
    const jobPageColumns = db
      .prepare(`PRAGMA table_info(job_pages)`)
      .all() as Array<{
      name: string
    }>

    if (!jobPageColumns.some((column) => column.name === "image_path")) {
      db.exec(`ALTER TABLE job_pages ADD COLUMN image_path TEXT`)
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS uploaded_files (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        storage_key TEXT NOT NULL,
        original_name TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        page_count INTEGER
      );

      CREATE TABLE IF NOT EXISTS render_artifacts (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        PRIMARY KEY (job_id, position)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS render_artifacts_page_id_idx ON render_artifacts(page_id);
    `)

    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    ).run(4, new Date().toISOString())
  }

  if (currentVersion < 5) {
    const jobMetaColumns = db
      .prepare(`PRAGMA table_info(job_meta)`)
      .all() as Array<{
      name: string
    }>

    if (!jobMetaColumns.some((column) => column.name === "background_status")) {
      db.exec(`ALTER TABLE job_meta ADD COLUMN background_status TEXT`)
    }

    if (!jobMetaColumns.some((column) => column.name === "background_worker")) {
      db.exec(`ALTER TABLE job_meta ADD COLUMN background_worker TEXT`)
    }

    if (!jobMetaColumns.some((column) => column.name === "background_queue")) {
      db.exec(`ALTER TABLE job_meta ADD COLUMN background_queue TEXT`)
    }

    if (
      !jobMetaColumns.some((column) => column.name === "background_prepared_at")
    ) {
      db.exec(`ALTER TABLE job_meta ADD COLUMN background_prepared_at TEXT`)
    }

    if (
      !jobMetaColumns.some((column) => column.name === "background_summary")
    ) {
      db.exec(`ALTER TABLE job_meta ADD COLUMN background_summary TEXT`)
    }

    db.exec(`
      UPDATE job_meta
      SET background_status = COALESCE(background_status, 'idle'),
          background_worker = COALESCE(background_worker, 'render-worker'),
          background_queue = COALESCE(background_queue, 'render-prep'),
          background_summary = COALESCE(background_summary, 'Worker handoff belum disiapkan untuk job ini')
    `)

    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    ).run(5, new Date().toISOString())
  }

  if (currentVersion < 6) {
    const jobPageColumns = db
      .prepare(`PRAGMA table_info(job_pages)`)
      .all() as Array<{
      name: string
    }>

    if (!jobPageColumns.some((column) => column.name === "tesseract_text")) {
      db.exec(`ALTER TABLE job_pages ADD COLUMN tesseract_text TEXT`)
    }

    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    ).run(6, new Date().toISOString())
  }

  if (currentVersion < 7) {
    const compareColumns = db
      .prepare(`PRAGMA table_info(job_compare_rows)`)
      .all() as Array<{
      name: string
    }>

    if (!compareColumns.some((column) => column.name === "winner_reason")) {
      db.exec(`ALTER TABLE job_compare_rows ADD COLUMN winner_reason TEXT`)
    }

    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    ).run(7, new Date().toISOString())
  }

  if (currentVersion < 8) {
    const compareColumns = db
      .prepare(`PRAGMA table_info(job_compare_rows)`)
      .all() as Array<{
      name: string
    }>

    if (!compareColumns.some((column) => column.name === "llm_score")) {
      db.exec(`ALTER TABLE job_compare_rows ADD COLUMN llm_score REAL`)
    }

    if (!compareColumns.some((column) => column.name === "tesseract_score")) {
      db.exec(`ALTER TABLE job_compare_rows ADD COLUMN tesseract_score REAL`)
    }

    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    ).run(8, new Date().toISOString())
  }

  if (currentVersion < 9) {
    const compareColumns = db
      .prepare(`PRAGMA table_info(job_compare_rows)`)
      .all() as Array<{
      name: string
    }>

    if (!compareColumns.some((column) => column.name === "overridden")) {
      db.exec(
        `ALTER TABLE job_compare_rows ADD COLUMN overridden INTEGER DEFAULT 0`
      )
    }

    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    ).run(9, new Date().toISOString())
  }

  if (currentVersion < 10) {
    const compareColumns = db
      .prepare(`PRAGMA table_info(job_compare_rows)`)
      .all() as Array<{
      name: string
    }>

    if (!compareColumns.some((column) => column.name === "llm_full_text")) {
      db.exec(`ALTER TABLE job_compare_rows ADD COLUMN llm_full_text TEXT`)
    }

    if (
      !compareColumns.some((column) => column.name === "tesseract_full_text")
    ) {
      db.exec(
        `ALTER TABLE job_compare_rows ADD COLUMN tesseract_full_text TEXT`
      )
    }

    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    ).run(10, new Date().toISOString())
  }

  if (currentVersion < 11) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS uploaded_files_new (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        storage_key TEXT NOT NULL,
        original_name TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        page_count INTEGER
      );

      INSERT OR IGNORE INTO uploaded_files_new
        SELECT job_id, storage_key, original_name, stored_path, mime_type, size_bytes, page_count
        FROM uploaded_files;

      DROP TABLE IF EXISTS uploaded_files;

      ALTER TABLE uploaded_files_new RENAME TO uploaded_files;
    `)

    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    ).run(11, new Date().toISOString())
  }
}

function initializeDatabase(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pages INTEGER NOT NULL,
      mode TEXT NOT NULL,
      output TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL,
      rendered INTEGER NOT NULL,
      extracted INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_details (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_meta (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      compare_summary TEXT NOT NULL,
      background_status TEXT,
      background_worker TEXT,
      background_queue TEXT,
      background_prepared_at TEXT,
      background_summary TEXT
    );

    CREATE TABLE IF NOT EXISTS job_events (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      message TEXT NOT NULL,
      PRIMARY KEY (job_id, position)
    );

    CREATE TABLE IF NOT EXISTS job_pages (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      page_id TEXT,
      position INTEGER NOT NULL,
      page_label TEXT NOT NULL,
      image_path TEXT,
      llm_state TEXT NOT NULL,
      tesseract_state TEXT NOT NULL,
      tesseract_text TEXT,
      status TEXT NOT NULL,
      note TEXT NOT NULL,
      PRIMARY KEY (job_id, position)
    );

    CREATE TABLE IF NOT EXISTS job_compare_rows (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      page_label TEXT NOT NULL,
      winner TEXT NOT NULL,
      llm_summary TEXT NOT NULL,
      tesseract_summary TEXT NOT NULL,
      llm_full_text TEXT,
      tesseract_full_text TEXT,
      winner_reason TEXT,
      overridden INTEGER DEFAULT 0,
      llm_score REAL,
      tesseract_score REAL,
      PRIMARY KEY (job_id, position)
    );

    CREATE TABLE IF NOT EXISTS job_pipeline_steps (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (job_id, position)
    );

    CREATE TABLE IF NOT EXISTS job_outputs (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      markdown TEXT NOT NULL,
      text TEXT NOT NULL,
      generated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS uploaded_files (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      page_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS render_artifacts (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      PRIMARY KEY (job_id, position)
    );
  `)

  applySchemaMigrations(db)

  const row = db.prepare(`SELECT COUNT(*) as count FROM jobs`).get() as {
    count: number
  }

  if (row.count === 0) {
    seedDatabase(db)
  }

  cleanupLegacyOrphanJobs(db)

  const refreshedRow = db
    .prepare(`SELECT COUNT(*) as count FROM jobs`)
    .get() as {
    count: number
  }

  if (refreshedRow.count === 0) {
    return
  }

  if (!hasNormalizedData(db)) {
    migrateLegacyDetails(db)
  }
}

function getDatabase() {
  if (!globalStore.__pdfExtractorJobDatabase__) {
    ensureParentDirectory()
    const db = new DatabaseSync(JOB_STORE_PATH)
    initializeDatabase(db)
    globalStore.__pdfExtractorJobDatabase__ = db
  }

  return globalStore.__pdfExtractorJobDatabase__
}

function buildDetailsFromNormalizedTables(db: DatabaseSync) {
  const metaRows = db
    .prepare(
      `SELECT
         job_id,
         title,
         subtitle,
         compare_summary,
         background_status,
         background_worker,
         background_queue,
         background_prepared_at,
         background_summary
       FROM job_meta
       ORDER BY job_id ASC`
    )
    .all() as JobMetaRow[]
  const eventRows = db
    .prepare(
      `SELECT job_id, position, message FROM job_events ORDER BY job_id ASC, position ASC`
    )
    .all() as JobEventRow[]
  const pageRows = db
    .prepare(
      `SELECT job_id, page_id, position, page_label, llm_state, tesseract_state, status, note
              , image_path, tesseract_text
       FROM job_pages
       ORDER BY job_id ASC, position ASC`
    )
    .all() as JobPageRow[]
  const compareRows = db
    .prepare(
      `SELECT job_id, position, page_label, winner, llm_summary, tesseract_summary
              , llm_full_text, tesseract_full_text
              , winner_reason, overridden, llm_score, tesseract_score
        FROM job_compare_rows
        ORDER BY job_id ASC, position ASC`
    )
    .all() as JobCompareRow[]
  const pipelineRows = db
    .prepare(
      `SELECT job_id, position, title, detail, state
       FROM job_pipeline_steps
       ORDER BY job_id ASC, position ASC`
    )
    .all() as JobPipelineRow[]
  const outputRows = db
    .prepare(
      `SELECT job_id, markdown, text, generated_at FROM job_outputs ORDER BY job_id ASC`
    )
    .all() as JobOutputRow[]

  const grouped: Record<string, Partial<JobDetail>> = {}

  metaRows.forEach((row) => {
    grouped[row.job_id] = {
      ...(grouped[row.job_id] ?? {}),
      title: row.title,
      subtitle: row.subtitle,
      compareSummary: row.compare_summary,
      background: {
        status: row.background_status || "idle",
        worker: row.background_worker || "render-worker",
        queue: row.background_queue || "render-prep",
        preparedAt: row.background_prepared_at,
        summary:
          row.background_summary ||
          "Worker handoff belum disiapkan untuk job ini",
      },
      events: [],
      pages: [],
      compareRows: [],
      pipeline: [],
      outputPreview: {
        markdown: "",
        text: "",
      },
    }
  })

  eventRows.forEach((row) => {
    const detail = grouped[row.job_id]
    if (!detail) {
      return
    }

    if (!detail.events) {
      detail.events = []
    }

    detail.events.push(row.message)
  })

  pageRows.forEach((row) => {
    const detail = grouped[row.job_id]
    if (!detail) {
      return
    }

    if (!detail.pages) {
      detail.pages = []
    }

    detail.pages.push({
      id: row.page_id ?? buildPageId(row.job_id, row.position),
      page: row.page_label,
      imagePath: row.image_path ?? undefined,
      llm: row.llm_state,
      tesseract: row.tesseract_state,
      status: row.status,
      note: row.tesseract_text ? `OCR: ${row.tesseract_text}` : row.note,
    })
  })

  compareRows.forEach((row) => {
    const detail = grouped[row.job_id]
    if (!detail) {
      return
    }

    if (!detail.compareRows) {
      detail.compareRows = []
    }

    detail.compareRows.push({
      page: row.page_label,
      winner: row.winner,
      llmSummary: row.llm_summary,
      tesseractSummary: row.tesseract_summary,
      llmFullText: row.llm_full_text ?? row.llm_summary,
      tesseractFullText: row.tesseract_full_text ?? row.tesseract_summary,
      diffSegments: buildDiffSegments(
        row.llm_full_text ?? row.llm_summary,
        row.tesseract_full_text ?? row.tesseract_summary
      ),
      reason: row.winner_reason ?? undefined,
      overridden: Boolean(row.overridden),
      scores:
        row.llm_score !== undefined &&
        row.llm_score !== null &&
        row.tesseract_score !== undefined &&
        row.tesseract_score !== null
          ? {
              llm: row.llm_score,
              tesseract: row.tesseract_score,
            }
          : undefined,
    })
  })

  pipelineRows.forEach((row) => {
    const detail = grouped[row.job_id]
    if (!detail) {
      return
    }

    if (!detail.pipeline) {
      detail.pipeline = []
    }

    detail.pipeline.push({
      title: row.title,
      detail: row.detail,
      state: row.state,
    })
  })

  outputRows.forEach((row) => {
    const detail = grouped[row.job_id]
    if (!detail) {
      return
    }
    detail.outputPreview = {
      markdown: row.markdown,
      text: row.text,
    }
  })

  return grouped
}

function readStateFromDatabase(db: DatabaseSync): JobStoreState {
  const jobRows = db
    .prepare(
      `SELECT id, name, pages, mode, output, status, progress, rendered, extracted, failed, sort_order
       FROM jobs
       WHERE id IN (SELECT job_id FROM uploaded_files)
       ORDER BY sort_order ASC, rowid ASC`
    )
    .all() as JobRow[]
  const normalizedDetails = buildDetailsFromNormalizedTables(db)
  const legacyDetails = readLegacyDetails(db)

  return {
    jobs: jobRows.map(mapJobRow),
    details: Object.fromEntries(
      jobRows.map((row) => {
        const job = mapJobRow(row)
        const normalized = normalizedDetails[job.id]

        if (normalized?.title) {
          return [job.id, normalizeDetail(job, normalized as JobDetail)]
        }

        return [job.id, normalizeDetail(job, legacyDetails[job.id])]
      })
    ),
  }
}

function readJobStateFromDatabase(db: DatabaseSync, jobId: string) {
  const jobRow = db
    .prepare(
      `SELECT id, name, pages, mode, output, status, progress, rendered, extracted, failed, sort_order
       FROM jobs
       WHERE id = ?`
    )
    .get(jobId) as JobRow | undefined

  if (!jobRow) {
    return null
  }

  const normalizedDetails = buildDetailsFromNormalizedTables(db)
  const legacyDetails = readLegacyDetails(db)
  const job = mapJobRow(jobRow)
  const normalized = normalizedDetails[job.id]

  return {
    job,
    detail: normalizeDetail(
      job,
      normalized?.title ? (normalized as JobDetail) : legacyDetails[job.id]
    ),
  }
}

function getJobsCount(db: DatabaseSync): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM jobs`).get() as {
    count: number
  }

  return row.count
}

function nextJobId(db: DatabaseSync): string {
  const row = db
    .prepare(
      `SELECT id FROM jobs WHERE id GLOB 'job-[0-9]*' ORDER BY CAST(SUBSTR(id, 5) AS INTEGER) DESC LIMIT 1`
    )
    .get() as { id?: string } | undefined

  const current = Number(row?.id?.replace("job-", "") ?? 0)

  return `job-${current + 1}`
}

function createUploadJob(
  db: DatabaseSync,
  mode: ExtractionMode,
  output: OutputFormat,
  name?: string
): JobRecord {
  const id = nextJobId(db)
  const numericId = Number(id.replace("job-", ""))
  const pages = 3 + (numericId % 6)
  const filename =
    name?.trim() || `incoming-batch-${String(numericId).padStart(2, "0")}.pdf`

  return {
    id,
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

function applyStart(job: JobRecord, detail?: JobDetail): JobMutation {
  const nextRendered = Math.max(job.rendered, job.pages)
  const nextExtracted = Math.max(job.extracted, Math.min(job.pages, 1))
  const nextJob: JobRecord = {
    ...job,
    status: "Processing",
    progress: Math.max(job.progress, 15),
    rendered: nextRendered,
    extracted: nextExtracted,
  }

  const baseDetail = detail ?? createJobDetail(nextJob)

  return {
    job: nextJob,
    detail: applyOutputMeta({
      ...baseDetail,
      background: buildBackgroundState(
        nextJob,
        baseDetail.background.preparedAt
      ),
      title: nextJob.name,
      subtitle: `${nextJob.mode} extraction with ${nextJob.output.toLowerCase()} export preset`,
      events: [`Started ${nextJob.name}`, ...baseDetail.events].slice(0, 6),
      compareSummary:
        nextJob.mode === "Both compare"
          ? `Rendered page artifacts are now feeding both extraction lanes for ${nextJob.pages} pages`
          : `Rendered page artifacts are now feeding the selected extraction lane for ${nextJob.pages} pages`,
      pages: baseDetail.pages.map((page, index) => ({
        ...page,
        llm:
          nextJob.mode === "Tesseract only"
            ? page.llm
            : index === 0
              ? "Running"
              : "Queued",
        tesseract:
          nextJob.mode === "LLM only"
            ? page.tesseract
            : index === 0
              ? "Running"
              : "Queued",
        status: index === 0 ? "Extracting" : "Waiting",
        note:
          page.imagePath && index === 0
            ? `${page.page} render artifact connected to the live extraction queue`
            : page.note,
      })),
      pipeline: baseDetail.pipeline.map((step, index) => {
        if (index === 2) {
          return {
            ...step,
            title: "Extraction queue running",
            detail:
              "Rendered page artifacts are now being consumed by the active extraction lanes",
            state: "active" as const,
          }
        }

        if (index === 3) {
          return {
            ...step,
            title: "Output aggregation warming up",
            detail:
              "Preview output is tracking the first extracted page while the rest remain queued",
            state: "pending" as const,
          }
        }

        return step
      }),
    }),
  }
}

function applyRetry(job: JobRecord, detail?: JobDetail): JobMutation {
  const nextFailed = Math.max(job.failed - 1, 0)
  const nextRendered = Math.max(job.rendered, Math.min(job.pages, 2))
  const nextJob: JobRecord = {
    ...job,
    status: nextFailed > 0 ? "Processing" : "Queued",
    failed: nextFailed,
    progress: Math.max(job.progress - 8, 0),
    rendered: nextRendered,
  }

  const baseDetail = detail ?? createJobDetail(nextJob)

  return {
    job: nextJob,
    detail: applyOutputMeta({
      ...baseDetail,
      background: buildBackgroundState(
        nextJob,
        baseDetail.background.preparedAt
      ),
      title: nextJob.name,
      subtitle: `${nextJob.mode} extraction with ${nextJob.output.toLowerCase()} export preset`,
      events: [`Retry queued for ${nextJob.name}`, ...baseDetail.events].slice(
        0,
        6
      ),
      pipeline: baseDetail.pipeline.map((step, index) => {
        if (index === 2) {
          return {
            ...step,
            title: "Retry lane scheduled",
            detail:
              nextFailed > 0
                ? "Failed pages moved back into extraction so the queue can resume from partial output"
                : "Job returned to queue so extraction can restart from the latest rendered pages",
            state: "active" as const,
          }
        }

        if (index === 3) {
          return {
            ...step,
            title: "Export preparation pending",
            detail:
              "Aggregator will refresh previews after retried pages settle",
            state: "pending" as const,
          }
        }

        return step
      }),
    }),
  }
}

function applyPageRetry(
  job: JobRecord,
  detail: JobDetail,
  pagePosition: number
): {
  job: JobRecord
  detail: JobDetail
  retriedPage: JobDetail["pages"][number]
} {
  const nextPages = detail.pages.map((page, index) => {
    if (index !== pagePosition) {
      return { ...page }
    }

    return {
      ...page,
      llm: job.mode === "Tesseract only" ? page.llm : "Queued",
      tesseract: job.mode === "LLM only" ? page.tesseract : "Queued",
      status: "Extracting" as const,
      note: `${page.page} dipindahkan kembali ke antrean retry untuk lane extraction aktif`,
    }
  })

  const retriedPage = nextPages[pagePosition]
  const nextJob: JobRecord = {
    ...job,
    status: "Processing",
    failed: Math.max(job.failed - 1, 0),
    extracted: Math.max(job.extracted - 1, 0),
    progress: Math.max(job.progress - 6, 0),
  }

  return {
    job: nextJob,
    retriedPage,
    detail: applyOutputMeta({
      ...detail,
      background: buildBackgroundState(nextJob, detail.background.preparedAt),
      title: nextJob.name,
      subtitle: `${nextJob.mode} extraction with ${nextJob.output.toLowerCase()} export preset`,
      pages: nextPages,
      compareSummary: `${retriedPage.page} dikirim ulang ke queue sementara hasil parsial job tetap dipertahankan`,
      events: [
        `Retry queued for ${retriedPage.page} on ${nextJob.name}`,
        ...detail.events,
      ].slice(0, 6),
      pipeline: detail.pipeline.map((step, index) => {
        if (index === 2) {
          return {
            ...step,
            title: "Page retry queued",
            detail: `${retriedPage.page} kembali ke lane extraction tanpa me-reset progres job lain`,
            state: "active" as const,
          }
        }

        if (index === 3) {
          return {
            ...step,
            title: "Export refresh pending",
            detail:
              "Preview output akan diperbarui setelah halaman retry selesai diekstrak",
            state: "pending" as const,
          }
        }

        return step
      }),
    }),
  }
}

function applyPause(job: JobRecord, detail?: JobDetail): JobMutation {
  const baseDetail = detail ?? createJobDetail(job)
  const nextJob: JobRecord = {
    ...job,
    status: "Paused",
  }

  return {
    job: nextJob,
    detail: applyOutputMeta({
      ...baseDetail,
      background: {
        ...buildBackgroundState(nextJob, baseDetail.background.preparedAt),
        status: "idle",
        summary: "Job dipause dan sementara tidak akan diambil worker",
      },
      events: [`Paused ${nextJob.name}`, ...baseDetail.events].slice(0, 12),
      compareSummary: `Job dipause dengan ${nextJob.failed} halaman gagal dan ${nextJob.extracted}/${nextJob.pages} halaman sudah diproses`,
      pages: baseDetail.pages.map((page) => {
        if (page.status === "Extracting") {
          return {
            ...page,
            llm: page.llm === "Running" ? "Queued" : page.llm,
            tesseract: page.tesseract === "Running" ? "Queued" : page.tesseract,
            status: "Waiting",
            note: `${page.page} dipause sebelum lane aktif menyelesaikan extraction`,
          }
        }

        return { ...page }
      }),
      pipeline: baseDetail.pipeline.map((step, index) => {
        if (index === 2) {
          return {
            ...step,
            title: "Extraction paused",
            detail:
              "Worker lane dihentikan sementara tanpa menghapus hasil parsial yang sudah ada",
            state: "pending" as const,
          }
        }

        return step
      }),
    }),
  }
}

function applyCancel(job: JobRecord, detail?: JobDetail): JobMutation {
  const baseDetail = detail ?? createJobDetail(job)
  const nextJob: JobRecord = {
    ...job,
    status: "Cancelled",
    progress: Math.min(job.progress, 99),
  }

  return {
    job: nextJob,
    detail: applyOutputMeta({
      ...baseDetail,
      background: {
        ...buildBackgroundState(nextJob, baseDetail.background.preparedAt),
        status: "idle",
        summary:
          "Job dibatalkan; hasil parsial tetap tersedia untuk inspeksi dan export",
      },
      events: [`Cancelled ${nextJob.name}`, ...baseDetail.events].slice(0, 12),
      compareSummary: `Job dibatalkan. Output parsial dipertahankan untuk ${nextJob.extracted} halaman yang sudah selesai`,
      pages: baseDetail.pages.map((page) => {
        if (page.status === "Waiting" || page.status === "Extracting") {
          return {
            ...page,
            llm: page.llm === "Running" ? "Queued" : page.llm,
            tesseract: page.tesseract === "Running" ? "Queued" : page.tesseract,
            status: "Needs review",
            note: `${page.page} dibatalkan sebelum extraction selesai; output file tetap ditandai partial`,
          }
        }

        return { ...page }
      }),
      pipeline: baseDetail.pipeline.map((step, index) => {
        if (index === 2) {
          return {
            ...step,
            title: "Job cancelled",
            detail:
              "Queue dihentikan manual dan halaman belum selesai ditandai untuk review manual",
            state: "pending" as const,
          }
        }

        if (index === 3) {
          return {
            ...step,
            title: "Partial export retained",
            detail:
              "Aggregator menyimpan hasil yang sudah ada agar tetap bisa diunduh setelah cancel",
            state: "active" as const,
          }
        }

        return step
      }),
    }),
  }
}

function applyCompareWinnerOverride(
  job: JobRecord,
  detail: JobDetail,
  input: OverrideCompareWinnerInput
) {
  const nextCompareRows = detail.compareRows.map((row) => {
    if (row.page !== input.page) {
      return { ...row }
    }

    if (input.winner === "auto") {
      const autoWinner = chooseCompareWinner(
        row.llmSummary,
        row.tesseractSummary
      ) as "LLM" | "Tesseract"

      return {
        ...row,
        winner: autoWinner,
        overridden: false,
        reason: explainCompareWinner(row.llmSummary, row.tesseractSummary),
      }
    }

    return {
      ...row,
      winner: input.winner,
      overridden: true,
      reason: `Winner diubah manual ke ${input.winner} oleh operator dashboard`,
      diffSegments: buildDiffSegments(
        row.llmFullText ?? row.llmSummary,
        row.tesseractFullText ?? row.tesseractSummary
      ),
    }
  })

  const updatedRow = nextCompareRows.find((row) => row.page === input.page)

  if (!updatedRow) {
    return null
  }

  const nextPages = detail.pages.map((page) => {
    if (page.page !== input.page) {
      return { ...page }
    }

    return {
      ...page,
      note:
        input.winner === "auto"
          ? `COMPARE: reset to auto winner`
          : `COMPARE: ${input.winner} (manual override)`,
    }
  })

  return {
    job,
    compareRow: updatedRow,
    detail: applyOutputMeta({
      ...detail,
      pages: nextPages,
      compareRows: nextCompareRows,
      events: [
        input.winner === "auto"
          ? `Winner override reset untuk ${input.page}`
          : `Manual winner override untuk ${input.page} -> ${input.winner}`,
        ...detail.events,
      ].slice(0, 12),
      compareSummary:
        input.winner === "auto"
          ? `${input.page} kembali memakai auto compare winner dari scoring engine`
          : `${input.page} sekarang memakai winner manual ${input.winner}; output final menyesuaikan override ini`,
      pipeline: detail.pipeline.map((step, index) => {
        if (index === 3) {
          return {
            ...step,
            title: "Output refreshed with manual winner",
            detail: `Aggregator menyesuaikan export berdasarkan override compare pada ${input.page}`,
            state: "active" as const,
          }
        }

        return step
      }),
    }),
  }
}

function applyStartAll(state: JobStoreState): JobStoreState {
  const nextJobs = state.jobs.map((job) => {
    if (job.status === "Uploaded" || job.status === "Queued") {
      return {
        ...job,
        status: "Processing" as const,
        progress: Math.max(job.progress, 12),
        rendered: Math.max(job.rendered, Math.min(job.pages, 2)),
      }
    }

    return job
  })

  const nextDetails = { ...state.details }

  for (const job of nextJobs) {
    if (job.status !== "Processing") {
      continue
    }

    const baseDetail = nextDetails[job.id] ?? createJobDetail(job)
    nextDetails[job.id] = {
      ...baseDetail,
      background: buildBackgroundState(job, baseDetail.background.preparedAt),
      subtitle: `${job.mode} extraction with ${job.output.toLowerCase()} export preset`,
      pipeline: baseDetail.pipeline.map((step, index) => {
        if (index === 1) {
          return {
            ...step,
            title: "Page rendering started",
            detail: "Snapshot worker is generating images for the first pages",
            state: "active" as const,
          }
        }

        if (index === 2) {
          return {
            ...step,
            title: "Extraction queue warming up",
            detail:
              "Page tasks are waiting for their first OCR and vision slots",
            state: "pending" as const,
          }
        }

        return step
      }),
      events: [
        `Start all moved ${job.name} into processing`,
        ...baseDetail.events,
      ].slice(0, 6),
    }
  }

  return {
    jobs: nextJobs,
    details: nextDetails,
  }
}

function insertJob(
  db: DatabaseSync,
  job: JobRecord,
  sortOrder: number,
  detail: JobDetail
) {
  db.prepare(
    `INSERT INTO jobs (
      id, name, pages, mode, output, status, progress, rendered, extracted, failed, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    job.id,
    job.name,
    job.pages,
    job.mode,
    job.output,
    job.status,
    job.progress,
    job.rendered,
    job.extracted,
    job.failed,
    sortOrder
  )

  writeNormalizedDetail(db, job, detail)
}

function updateStoredJob(db: DatabaseSync, mutation: JobMutation) {
  db.prepare(
    `UPDATE jobs
     SET name = ?, pages = ?, mode = ?, output = ?, status = ?, progress = ?, rendered = ?, extracted = ?, failed = ?
     WHERE id = ?`
  ).run(
    mutation.job.name,
    mutation.job.pages,
    mutation.job.mode,
    mutation.job.output,
    mutation.job.status,
    mutation.job.progress,
    mutation.job.rendered,
    mutation.job.extracted,
    mutation.job.failed,
    mutation.job.id
  )

  writeNormalizedDetail(db, mutation.job, mutation.detail)
}

function replaceState(db: DatabaseSync, state: JobStoreState) {
  withTransaction(db, () => {
    state.jobs.forEach((job, index) => {
      const detail = state.details[job.id] ?? createJobDetail(job)
      db.prepare(
        `UPDATE jobs
         SET name = ?, pages = ?, mode = ?, output = ?, status = ?, progress = ?, rendered = ?, extracted = ?, failed = ?, sort_order = ?
         WHERE id = ?`
      ).run(
        job.name,
        job.pages,
        job.mode,
        job.output,
        job.status,
        job.progress,
        job.rendered,
        job.extracted,
        job.failed,
        index,
        job.id
      )

      writeNormalizedDetail(db, job, detail)
    })
  })
}

export function getJobsState(): JobStoreState {
  return cloneState(readStateFromDatabase(getDatabase()))
}

export function getWorkerDiagnosticsState(): WorkerDiagnosticsState {
  const state = readStateFromDatabase(getDatabase())
  const grouped = new Map<
    string,
    {
      queue: string
      worker: string
      preparedJobs: number
      activeJobs: number
      pendingPages: number
    }
  >()

  state.jobs.forEach((job) => {
    const detail = state.details[job.id]

    if (!detail?.background) {
      return
    }

    const key = `${detail.background.queue}:${detail.background.worker}`
    const current = grouped.get(key) ?? {
      queue: detail.background.queue,
      worker: detail.background.worker,
      preparedJobs: 0,
      activeJobs: 0,
      pendingPages: 0,
    }

    if (detail.background.status === "prepared") {
      current.preparedJobs += 1
    }

    if (job.status === "Processing" || job.status === "Queued") {
      current.activeJobs += 1
    }

    current.pendingPages += countPendingPages(detail)
    grouped.set(key, current)
  })

  const workers = Array.from(grouped.values()).sort((left, right) =>
    left.queue.localeCompare(right.queue)
  )

  return {
    workers,
    totals: workers.reduce(
      (accumulator, worker) => ({
        preparedJobs: accumulator.preparedJobs + worker.preparedJobs,
        activeJobs: accumulator.activeJobs + worker.activeJobs,
        pendingPages: accumulator.pendingPages + worker.pendingPages,
      }),
      {
        preparedJobs: 0,
        activeJobs: 0,
        pendingPages: 0,
      }
    ),
  }
}

export async function runPreparedJobsOnce(
  options: WorkerRunOptions = {}
): Promise<WorkerRunMutation> {
  const db = getDatabase()
  const state = readStateFromDatabase(db)
  const processedJobs: JobMutation[] = []

  for (const job of state.jobs) {
    const detail = state.details[job.id]

    if (!detail?.background || detail.background.status !== "prepared") {
      continue
    }

    if (job.status !== "Queued" && job.status !== "Processing") {
      continue
    }

    if (job.mode === "Tesseract only") {
      processedJobs.push(
        await applyTesseractWorkerRun(
          job,
          detail,
          options.tesseractRunner ?? runTesseractPage,
          options.llmRunner ?? runLlmPage
        )
      )
      continue
    }

    if (job.mode === "LLM only") {
      processedJobs.push(
        await applyLlmWorkerRun(job, detail, options.llmRunner ?? runLlmPage)
      )
      continue
    }

    if (job.mode === "Both compare" && hasRunnableCompareArtifacts(detail)) {
      const llmRunner = options.llmRunner ?? runLlmPage
      const tesseractRunner = options.tesseractRunner ?? runTesseractPage

      processedJobs.push(
        await applyCompareWorkerRun(job, detail, llmRunner, tesseractRunner)
      )
      continue
    }

    if (job.mode === "Both compare") {
      processedJobs.push(applyWorkerRun(job, detail))
      continue
    }

    processedJobs.push(applyWorkerRun(job, detail))
  }

  withTransaction(db, () => {
    processedJobs.forEach((mutation) => {
      updateStoredJob(db, mutation)
    })
  })

  return {
    processedJobs: processedJobs.map((mutation) => ({
      job: { ...mutation.job },
      detail: structuredClone(mutation.detail),
    })),
  }
}

export async function runPreparedJobsUntilIdle(
  options: WorkerRunOptions & { maxTicks?: number } = {}
): Promise<WorkerDrainResult> {
  const maxTicks = options.maxTicks ?? 50
  const processedJobs = new Map<string, { job: JobRecord; detail: JobDetail }>()

  for (let tick = 1; tick <= maxTicks; tick += 1) {
    const result = await runPreparedJobsOnce(options)

    if (result.processedJobs.length === 0) {
      return {
        ticks: tick - 1,
        processedJobs: Array.from(processedJobs.values()),
      }
    }

    result.processedJobs.forEach((entry) => {
      processedJobs.set(entry.job.id, entry)
    })

    const state = readStateFromDatabase(getDatabase())
    const stillActive = state.jobs.some(
      (job) => job.status === "Queued" || job.status === "Processing"
    )

    if (!stillActive) {
      return {
        ticks: tick,
        processedJobs: Array.from(processedJobs.values()),
      }
    }
  }

  return {
    ticks: maxTicks,
    processedJobs: Array.from(processedJobs.values()),
  }
}

export function getJobById(jobId: string) {
  const result = readJobStateFromDatabase(getDatabase(), jobId)

  if (!result) {
    return null
  }

  return {
    job: { ...result.job },
    detail: structuredClone(result.detail ?? createJobDetail(result.job)),
  }
}

export function getJobLogsById(jobId: string): JobLogsPayload | null {
  const result = getJobById(jobId)

  if (!result) {
    return null
  }

  return {
    jobId,
    title: result.detail.title,
    events: [...result.detail.events],
    pipeline: result.detail.pipeline.map((step) => ({ ...step })),
  }
}

export function getJobPagesById(jobId: string): JobPagesPayload | null {
  const db = getDatabase()
  const result = getJobById(jobId)

  if (!result) {
    return null
  }

  const pageRows = db
    .prepare(
      `SELECT job_id, page_id, position, page_label, llm_state, tesseract_state, status, note
       , image_path
       FROM job_pages
       WHERE job_id = ?
       ORDER BY position ASC`
    )
    .all(jobId) as JobPageRow[]

  return {
    jobId,
    title: result.detail.title,
    subtitle: result.detail.subtitle,
    compareSummary: result.detail.compareSummary,
    canRetry: canRetryJob(result.job),
    pages: pageRows.map((row) => ({
      id: row.page_id ?? buildPageId(row.job_id, row.position),
      page: row.page_label,
      imagePath: row.image_path ?? undefined,
      llm: row.llm_state,
      tesseract: row.tesseract_state,
      status: row.status,
      note: row.note,
      canRetry: isRetryablePage({
        status: row.status,
        llm: row.llm_state,
        tesseract: row.tesseract_state,
      }),
    })),
  }
}

export function shouldAutoRefreshJobPages(jobId: string): boolean {
  const result = getJobById(jobId)

  if (!result) {
    return false
  }

  const pagesPayload = getJobPagesById(jobId)

  if (!pagesPayload) {
    return false
  }

  return pagesPayload.pages.some(
    (page) => page.status === "Waiting" || page.status === "Extracting"
  )
}

export function getJobOutputById(jobId: string): JobOutputPayload | null {
  const db = getDatabase()
  const result = getJobById(jobId)

  if (!result) {
    return null
  }

  const outputRow = db
    .prepare(
      `SELECT job_id, markdown, text, generated_at FROM job_outputs WHERE job_id = ?`
    )
    .get(jobId) as JobOutputRow | undefined

  const outputMeta = buildOutputMeta(result.detail)

  return {
    jobId,
    title: result.detail.title,
    output: result.job.output,
    preview: {
      markdown: outputRow?.markdown ?? result.detail.outputPreview.markdown,
      text: outputRow?.text ?? result.detail.outputPreview.text,
    },
    generatedAt: outputRow?.generated_at ?? null,
    isPartial: outputMeta.isPartial,
    failedPages: outputMeta.failedPages,
    missingPages: outputMeta.missingPages,
    winnerOverrides: outputMeta.winnerOverrides,
    sources: {
      tesseractPages: result.detail.pages
        .filter((page) => page.note.startsWith("OCR: "))
        .map((page) => ({
          page: page.page,
          text: page.note.slice(5).trim(),
        })),
    },
    compareAudit: result.detail.compareRows.map((row) => ({
      page: row.page,
      winner: row.winner,
      reason: row.reason,
      overridden: row.overridden ?? false,
      scores: row.scores,
    })),
  }
}

export function createJobs({
  files,
  mode,
  output,
}: CreateJobsInput): JobStoreState {
  const db = getDatabase()
  const batchNames = files && files.length > 0 ? files : [undefined, undefined]
  const startOrder = getJobsCount(db)

  withTransaction(db, () => {
    batchNames.forEach((name, index) => {
      const job = createUploadJob(db, mode, output, name)
      const detail = createJobDetail(job)
      insertJob(db, job, startOrder + index, detail)
    })
  })

  return getJobsState()
}

export function createUploadedJob({ pipeline }: CreateUploadedJobInput) {
  const db = getDatabase()
  const sortOrder = getJobsCount(db)

  withTransaction(db, () => {
    insertJob(db, pipeline.job, sortOrder, pipeline.detail)
    writeUploadedFileMetadata(db, pipeline.metadata, pipeline.job.id)
    if (hasRenderedPages(pipeline)) {
      writeRenderArtifacts(db, pipeline)
    }
  })

  return {
    job: pipeline.job,
    detail: pipeline.detail,
  }
}

export function createStoredUpload({
  job,
  detail,
  metadata,
}: CreateStoredUploadInput) {
  const db = getDatabase()
  const sortOrder = getJobsCount(db)

  withTransaction(db, () => {
    insertJob(db, job, sortOrder, detail)
    writeUploadedFileMetadata(db, metadata, job.id)
  })

  return {
    job,
    detail,
  }
}

export function startJobById({ jobId }: UpdateJobInput) {
  const db = getDatabase()
  const current = getJobById(jobId)

  if (!current) {
    return null
  }

  const uploadedFile = getUploadedFileByJobId(jobId)
  const renderArtifacts = getRenderArtifactsByJobId(jobId)

  if (uploadedFile && renderArtifacts.length === 0) {
    return null
  }

  const mutation = applyStart(current.job, current.detail)
  updateStoredJob(db, mutation)

  return {
    job: { ...mutation.job },
    detail: structuredClone(mutation.detail),
  }
}

export function reserveNextJobId() {
  return nextJobId(getDatabase())
}

export function getUploadedFileByJobId(
  jobId: string
): UploadedFileRecord | null {
  const row = getDatabase()
    .prepare(
      `SELECT job_id, storage_key, original_name, stored_path, mime_type, size_bytes, page_count
       FROM uploaded_files
       WHERE job_id = ?`
    )
    .get(jobId) as UploadedFileRow | undefined

  if (!row) {
    return null
  }

  return {
    jobId: row.job_id,
    storageKey: row.storage_key,
    originalName: row.original_name,
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    pageCount: row.page_count,
  }
}

export function getRenderArtifactsByJobId(
  jobId: string
): RenderArtifactRecord[] {
  const rows = getDatabase()
    .prepare(
      `SELECT job_id, page_id, position, image_path
       FROM render_artifacts
       WHERE job_id = ?
       ORDER BY position ASC`
    )
    .all(jobId) as RenderArtifactRow[]

  return rows.map((row) => ({
    jobId: row.job_id,
    pageId: row.page_id,
    position: row.position,
    imagePath: row.image_path,
  }))
}

export function deleteJobById({ jobId }: UpdateJobInput) {
  const db = getDatabase()
  const current = getJobById(jobId)

  if (!current) {
    return null
  }

  const uploadedFile = getUploadedFileByJobId(jobId)
  const renderArtifacts = getRenderArtifactsByJobId(jobId)

  if (!uploadedFile) {
    return null
  }

  withTransaction(db, () => {
    clearNormalizedTables(db, jobId)
    db.prepare(`DELETE FROM jobs WHERE id = ?`).run(jobId)
  })

  renderArtifacts.forEach((artifact) => {
    if (existsSync(artifact.imagePath)) {
      rmSync(artifact.imagePath, { force: true })
    }
  })

  if (existsSync(uploadedFile.storedPath)) {
    rmSync(uploadedFile.storedPath, { force: true })
  }

  const renderRoot = join(process.cwd(), ".data")
  const jobRenderDir = join(renderRoot, "storage", "renders", jobId)

  if (existsSync(jobRenderDir)) {
    rmSync(jobRenderDir, { recursive: true, force: true })
  }

  return true
}

export function startAllStoredJobs(): JobStoreState {
  const db = getDatabase()
  const nextState = applyStartAll(readStateFromDatabase(db))
  replaceState(db, nextState)

  return cloneState(nextState)
}

export function retryJobById({ jobId }: UpdateJobInput) {
  const db = getDatabase()
  const current = getJobById(jobId)

  if (!current) {
    return null
  }

  const mutation = applyRetry(current.job, current.detail)
  updateStoredJob(db, mutation)

  return {
    job: { ...mutation.job },
    detail: structuredClone(mutation.detail),
  }
}

export function pauseJobById({ jobId }: UpdateJobInput) {
  const db = getDatabase()
  const current = getJobById(jobId)

  if (!current) {
    return null
  }

  const mutation = applyPause(current.job, current.detail)
  updateStoredJob(db, mutation)

  return {
    job: { ...mutation.job },
    detail: structuredClone(mutation.detail),
  }
}

export function cancelJobById({ jobId }: UpdateJobInput) {
  const db = getDatabase()
  const current = getJobById(jobId)

  if (!current) {
    return null
  }

  const mutation = applyCancel(current.job, current.detail)
  updateStoredJob(db, mutation)

  return {
    job: { ...mutation.job },
    detail: structuredClone(mutation.detail),
  }
}

export function retryPageById({ pageId }: RetryPageInput) {
  const db = getDatabase()
  const pageRow = db
    .prepare(
      `SELECT job_id, page_id, position, page_label, llm_state, tesseract_state, status, note
       , image_path
        FROM job_pages
        WHERE page_id = ?`
    )
    .get(pageId) as JobPageRow | undefined

  if (!pageRow) {
    return null
  }

  const current = getJobById(pageRow.job_id)

  if (!current) {
    return null
  }

  const mutation = applyPageRetry(current.job, current.detail, pageRow.position)
  updateStoredJob(db, mutation)

  return {
    job: { ...mutation.job },
    detail: structuredClone(mutation.detail),
    retriedPage: { ...mutation.retriedPage },
  }
}

export function overrideCompareWinnerByPage(input: OverrideCompareWinnerInput) {
  const db = getDatabase()
  const current = getJobById(input.jobId)

  if (!current) {
    return null
  }

  const mutation = applyCompareWinnerOverride(
    current.job,
    current.detail,
    input
  )

  if (!mutation) {
    return null
  }

  updateStoredJob(db, {
    job: mutation.job,
    detail: mutation.detail,
  })

  return {
    job: { ...mutation.job },
    detail: structuredClone(mutation.detail),
    compareRow: { ...mutation.compareRow },
  }
}

export function getJobStorePath() {
  return JOB_STORE_PATH
}

export function getJobStoreSchemaVersion() {
  return JOB_STORE_SCHEMA_VERSION
}

export function resetJobStoreForTests() {
  globalStore.__pdfExtractorJobDatabase__?.close()
  globalStore.__pdfExtractorJobDatabase__ = undefined

  const storageRoot =
    process.env.PDF_EXTRACTOR_STORAGE_ROOT ||
    join(process.cwd(), ".data", `storage${getTestIsolationSuffix()}`)

  rmSync(storageRoot, {
    recursive: true,
    force: true,
  })

  rmSync(join(process.cwd(), "sample"), {
    recursive: true,
    force: true,
  })

  try {
    unlinkSync(JOB_STORE_PATH)
  } catch {
    // Ignore missing database file so tests can bootstrap from scratch.
  }

  try {
    unlinkSync(`${JOB_STORE_PATH}-shm`)
  } catch {
    // Ignore missing sidecar file.
  }

  try {
    unlinkSync(`${JOB_STORE_PATH}-wal`)
  } catch {
    // Ignore missing sidecar file.
  }
}
