import { mkdirSync, rmSync, unlinkSync } from "node:fs"
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
import type { PipelineResult, UploadedPdfMetadata } from "@/lib/pdf-pipeline"
import { runLlmPage, type LlmRunner } from "@/lib/llm-runtime"
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
  sources?: {
    tesseractPages: Array<{
      page: string
      text: string
    }>
  }
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
  pipeline: PipelineResult
}

type UpdateJobInput = {
  jobId: string
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
}

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
const JOB_STORE_SCHEMA_VERSION = 6

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
  return {
    id: row.id,
    canRetry: canRetryJob({
      status: row.status,
      failed: row.failed,
    }),
    backgroundReady: row.status !== "Uploaded",
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
    detail: nextDetail,
  }
}

async function applyTesseractWorkerRun(
  job: JobRecord,
  detail: JobDetail,
  runner: TesseractRunner
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
    outputs.push(`### ${page.page}\n\n${result.text}`)

    nextPages[index] = {
      ...page,
      imagePath,
      tesseract: "Done",
      status: "Compared",
      note: `OCR: ${result.text}`,
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
    detail: {
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
        ...detail.events,
      ].slice(0, 12),
      outputPreview: buildTesseractOutputPreview(nextJob, outputs),
      compareRows: detail.compareRows.map((row, index) => ({
        ...row,
        tesseractSummary:
          outputs[index]?.replace(/^### .*\n\n/, "").slice(0, 120) ||
          row.tesseractSummary,
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
    },
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

    const imageUrl = page.imagePath ?? `/tmp/${job.id}-${index + 1}.png`
    const result = await runner({
      imageUrl,
      prompt: `Extract the page content for ${page.page}`,
    })
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
    detail: {
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
    },
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
        job_id, position, page_label, winner, llm_summary, tesseract_summary
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      job.id,
      index,
      row.page,
      row.winner,
      row.llmSummary,
      row.tesseractSummary
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
        page_count INTEGER NOT NULL
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
      page_count INTEGER NOT NULL
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
    detail: {
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
    },
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
    detail: {
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
    },
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
    detail: {
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
    },
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
          options.tesseractRunner ?? runTesseractPage
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

export function getJobById(jobId: string) {
  const state = readStateFromDatabase(getDatabase())
  const job = state.jobs.find((item) => item.id === jobId)

  if (!job) {
    return null
  }

  return {
    job: { ...job },
    detail: structuredClone(state.details[jobId] ?? createJobDetail(job)),
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

  return {
    jobId,
    title: result.detail.title,
    output: result.job.output,
    preview: {
      markdown: outputRow?.markdown ?? result.detail.outputPreview.markdown,
      text: outputRow?.text ?? result.detail.outputPreview.text,
    },
    generatedAt: outputRow?.generated_at ?? null,
    sources: {
      tesseractPages: result.detail.pages
        .filter((page) => page.note.startsWith("OCR: "))
        .map((page) => ({
          page: page.page,
          text: page.note.slice(5).trim(),
        })),
    },
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
    writeRenderArtifacts(db, pipeline)
  })

  return {
    job: pipeline.job,
    detail: pipeline.detail,
  }
}

export function startJobById({ jobId }: UpdateJobInput) {
  const db = getDatabase()
  const current = getJobById(jobId)

  if (!current) {
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
