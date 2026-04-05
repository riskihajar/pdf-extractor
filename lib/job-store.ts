import { mkdirSync, unlinkSync } from "node:fs"
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

export type JobStoreState = {
  jobs: JobRecord[]
  details: Record<string, JobDetail>
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
}

export type JobPagesPayload = {
  jobId: string
  title: string
  subtitle: string
  compareSummary: string
  canRetry: boolean
  pages: JobDetail["pages"]
}

type CreateJobsInput = {
  files?: string[]
  mode: ExtractionMode
  output: OutputFormat
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
  llm_state: JobDetail["pages"][number]["llm"]
  tesseract_state: JobDetail["pages"][number]["tesseract"]
  status: JobDetail["pages"][number]["status"]
  note: string
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

const JOB_STORE_DIR = join(process.cwd(), ".data")
const JOB_STORE_PATH =
  process.env.PDF_EXTRACTOR_JOB_DB_PATH || join(JOB_STORE_DIR, "jobs.sqlite")
const JOB_STORE_SCHEMA_VERSION = 3

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

function writeNormalizedDetail(
  db: DatabaseSync,
  job: JobRecord,
  detail: JobDetail
) {
  const normalized = normalizeDetail(job, detail)

  clearNormalizedTables(db, job.id)

  db.prepare(
    `INSERT INTO job_meta (job_id, title, subtitle, compare_summary) VALUES (?, ?, ?, ?)`
  ).run(
    job.id,
    normalized.title,
    normalized.subtitle,
    normalized.compareSummary
  )

  normalized.events.forEach((event, index) => {
    db.prepare(
      `INSERT INTO job_events (job_id, position, message) VALUES (?, ?, ?)`
    ).run(job.id, index, event)
  })

  normalized.pages.forEach((page, index) => {
    db.prepare(
      `INSERT INTO job_pages (
        job_id, page_id, position, page_label, llm_state, tesseract_state, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      job.id,
      buildPageId(job.id, index),
      index,
      page.page,
      page.llm,
      page.tesseract,
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
      `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`
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
      `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    ).run(JOB_STORE_SCHEMA_VERSION, new Date().toISOString())
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
      compare_summary TEXT NOT NULL
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
      llm_state TEXT NOT NULL,
      tesseract_state TEXT NOT NULL,
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
      `SELECT job_id, title, subtitle, compare_summary FROM job_meta ORDER BY job_id ASC`
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
      llm: row.llm_state,
      tesseract: row.tesseract_state,
      status: row.status,
      note: row.note,
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
  const nextJob: JobRecord = {
    ...job,
    status: "Processing",
    progress: Math.max(job.progress, 15),
    rendered: Math.max(job.rendered, Math.min(job.pages, 2)),
  }

  const baseDetail = detail ?? createJobDetail(nextJob)

  return {
    job: nextJob,
    detail: {
      ...baseDetail,
      title: nextJob.name,
      subtitle: `${nextJob.mode} extraction with ${nextJob.output.toLowerCase()} export preset`,
      events: [`Started ${nextJob.name}`, ...baseDetail.events].slice(0, 6),
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
