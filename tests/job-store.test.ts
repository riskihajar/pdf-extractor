import assert from "node:assert/strict"
import test from "node:test"

import {
  getJobLogs,
  getJobOutput,
  getJobPages,
  getJobRefresh,
  getJobs,
  retryPage,
  retryJob,
  startJob,
} from "@/lib/job-actions"
import {
  getJobStorePath,
  getJobStoreSchemaVersion,
  resetJobStoreForTests,
} from "@/lib/job-store"
import { POST as uploadJobsRoute } from "@/app/api/jobs/upload/route"

import { buildPdfBuffer } from "./helpers/pdf"

async function uploadFixture(options: {
  fileName: string
  mode: "LLM only" | "Tesseract only" | "Both compare"
  output: "Markdown" | "Text" | "MD + TXT"
  content: string
}) {
  const file = new File([buildPdfBuffer(options.content)], options.fileName, {
    type: "application/pdf",
  })
  const formData = new FormData()
  formData.set("mode", options.mode)
  formData.set("output", options.output)
  formData.append("files", file)

  const response = await uploadJobsRoute(
    new Request("http://localhost/api/jobs/upload", {
      method: "POST",
      body: formData,
    })
  )
  const payload = await response.json()
  const uploadedJob = payload.jobs[0]

  assert.equal(response.status, 200)
  assert.ok(uploadedJob)

  return uploadedJob as {
    id: string
    name: string
    status: string
    backgroundReady: boolean
  }
}

test.beforeEach(() => {
  resetJobStoreForTests()
})

test("startJob updates an uploaded stored job and detail", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "startable-job.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Startable Job",
  })

  const result = startJob({ jobId: uploadedJob.id })

  assert.ok(result)
  assert.equal(result.job.id, uploadedJob.id)
  assert.equal(result.job.status, "Processing")
  assert.equal(result.job.backgroundReady, true)
  assert.ok(result.job.progress >= 15)
  assert.equal(result.job.rendered, result.job.pages)
  assert.match(result.detail.events[0] ?? "", /^Started /)
  assert.equal(result.detail.background.status, "prepared")
  assert.equal(result.detail.background.queue, "extract-llm")
})

test("retryJob updates shared job state for a failed uploaded job", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "retryable-job.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Retryable Job",
  })
  const started = startJob({ jobId: uploadedJob.id })

  assert.ok(started)

  const result = retryJob({ jobId: uploadedJob.id })

  assert.ok(result)
  assert.equal(result.job.id, uploadedJob.id)
  assert.equal(result.job.failed, 0)
  assert.ok(["Queued", "Processing"].includes(result.job.status))
  assert.match(result.detail.events[0] ?? "", /^Retry queued for /)
  assert.equal(result.detail.pipeline[2]?.title, "Retry lane scheduled")
})

test("job store exposes canRetry metadata in normalized pages payload", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "pages-meta.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Pages Meta",
  })
  const pages = getJobPages(uploadedJob.id)
  const jobs = getJobs()

  assert.ok(pages)
  assert.equal(typeof pages.canRetry, "boolean")
  assert.equal(
    jobs.jobs.find((job) => job.id === uploadedJob.id)?.canRetry,
    false
  )
  assert.ok((pages.pages[0]?.id ?? "").startsWith(`${uploadedJob.id}:page-`))
  assert.equal(typeof pages.pages[0]?.canRetry, "boolean")
})

test("job store exposes refresh signal for pages polling decisions", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "refreshable.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Refreshable",
  })
  startJob({ jobId: uploadedJob.id })

  const processingRefresh = getJobRefresh(uploadedJob.id)

  assert.ok(processingRefresh)
  assert.equal(processingRefresh.shouldRefresh, true)
})

test("retryJob returns null for unknown job", () => {
  const result = retryJob({ jobId: "job-404" })

  assert.equal(result, null)
})

test("job store persists uploaded state in the SQLite dev file", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "persisted-job.pdf",
    mode: "Tesseract only",
    output: "Text",
    content: "Persisted Job",
  })
  startJob({ jobId: uploadedJob.id })

  const snapshot = startJob({ jobId: uploadedJob.id })

  assert.ok(snapshot)
  assert.equal(snapshot.job.status, "Processing")
  assert.match(getJobStorePath(), /\.data\/jobs(?:-\d+)?\.sqlite$/)
})

test("uploaded jobs are background-ready after render preparation", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "background-ready.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Background Ready",
  })
  const snapshot = getJobs()
  const queued = snapshot.jobs.find((job) => job.id === uploadedJob.id)

  assert.ok(queued)
  assert.equal(queued.backgroundReady, true)
})

test("job store exposes normalized logs payload for an uploaded job", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "logs-job.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Logs Job",
  })
  const logs = getJobLogs(uploadedJob.id)

  assert.ok(logs)
  assert.equal(logs.jobId, uploadedJob.id)
  assert.equal(logs.title, "logs-job.pdf")
  assert.ok(logs.events.length > 0)
  assert.equal(logs.pipeline[0]?.title, "Upload stored")
})

test("job store exposes normalized output payload for an uploaded job", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "output-job.pdf",
    mode: "Tesseract only",
    output: "Text",
    content: "Output Job",
  })
  const output = getJobOutput(uploadedJob.id)

  assert.ok(output)
  assert.equal(output.jobId, uploadedJob.id)
  assert.equal(output.output, "Text")
  assert.match(output.preview.text, /output-job\.pdf/)
  assert.equal(typeof output.generatedAt, "string")
})

test("job store exposes granular page payload with stable page ids", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "pages-job.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Pages Job",
  })
  const pages = getJobPages(uploadedJob.id)

  assert.ok(pages)
  assert.equal(pages.jobId, uploadedJob.id)
  assert.ok((pages.pages[0]?.id ?? "").startsWith(`${uploadedJob.id}:page-`))
  assert.equal(typeof pages.pages[0]?.status, "string")
  assert.equal(typeof pages.pages[0]?.canRetry, "boolean")
})

test("retryPage updates a single stored page using job_pages page id", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "retry-page-job.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Retry Page Job",
  })
  const before = getJobPages(uploadedJob.id)

  assert.ok(before)

  const pageId = before.pages[0]?.id ?? `${uploadedJob.id}:page-01`
  const result = retryPage({ pageId })

  assert.ok(result)
  assert.equal(result.job.id, uploadedJob.id)
  assert.equal(result.retriedPage.id, pageId)
})

test("retryPage keeps non-retryable pages unchanged when page is already healthy", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "healthy-page-job.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Healthy Page Job",
  })
  const before = getJobPages(uploadedJob.id)

  assert.ok(before)
  assert.ok((before.pages[0]?.id ?? "").startsWith(`${uploadedJob.id}:page-`))
})

test("retryPage returns null for unknown page", () => {
  const result = retryPage({ pageId: "job-404:page-99" })

  assert.equal(result, null)
})

test("job store exposes current schema version", () => {
  assert.equal(getJobStoreSchemaVersion(), 11)
})
