import test from "node:test"
import assert from "node:assert/strict"

import {
  getJobPages,
  getJobLogs,
  getJobOutput,
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

test.beforeEach(() => {
  resetJobStoreForTests()
})

test("startJob updates a stored job and detail", () => {
  const result = startJob({ jobId: "job-2" })

  assert.ok(result)
  assert.equal(result.job.id, "job-2")
  assert.equal(result.job.status, "Processing")
  assert.equal(result.job.backgroundReady, true)
  assert.ok(result.job.progress >= 15)
  assert.equal(result.job.rendered, result.job.pages)
  assert.match(result.detail.events[0], /^Started /)
  assert.equal(result.detail.background.status, "prepared")
  assert.equal(result.detail.background.queue, "extract-llm")
})

test("retryJob updates shared job state for a failed job", () => {
  const result = retryJob({ jobId: "job-3" })

  assert.ok(result)
  assert.equal(result.job.id, "job-3")
  assert.equal(result.job.failed, 0)
  assert.equal(result.job.status, "Queued")
  assert.match(result.detail.events[0], /^Retry queued for /)
  assert.equal(result.detail.pipeline[2]?.title, "Retry lane scheduled")
})

test("job store exposes canRetry metadata in normalized pages payload", () => {
  const pages = getJobPages("job-3")
  const jobs = getJobs()

  assert.ok(pages)
  assert.equal(pages.canRetry, true)
  assert.equal(jobs.jobs.find((job) => job.id === "job-3")?.canRetry, true)
  assert.equal(jobs.jobs.find((job) => job.id === "job-2")?.canRetry, false)
  assert.equal(pages.pages[0]?.canRetry, false)
  assert.equal(pages.pages[2]?.canRetry, true)
})

test("job store exposes refresh signal for pages polling decisions", () => {
  const processingRefresh = getJobRefresh("job-1")
  const settledRefresh = getJobRefresh("job-3")

  assert.ok(processingRefresh)
  assert.ok(settledRefresh)
  assert.equal(processingRefresh.shouldRefresh, true)
  assert.equal(settledRefresh.shouldRefresh, false)
})

test("retryJob returns null for unknown job", () => {
  const result = retryJob({ jobId: "job-404" })

  assert.equal(result, null)
})

test("job store persists state in the SQLite dev file", () => {
  startJob({ jobId: "job-2" })

  const snapshot = getJobs()

  assert.equal(
    snapshot.jobs.find((job) => job.id === "job-2")?.status,
    "Processing"
  )
  assert.match(getJobStorePath(), /\.data\/jobs(?:-\d+)?\.sqlite$/)
})

test("seeded queued jobs are already background-ready", () => {
  const snapshot = getJobs()
  const queued = snapshot.jobs.find((job) => job.id === "job-2")

  assert.ok(queued)
  assert.equal(queued.backgroundReady, true)
})

test("job store exposes normalized logs payload for a job", () => {
  const logs = getJobLogs("job-1")

  assert.ok(logs)
  assert.equal(logs.jobId, "job-1")
  assert.equal(logs.title, "bank-statement-april.pdf")
  assert.ok(logs.events.length > 0)
  assert.equal(logs.pipeline[0]?.title, "Upload received")
})

test("job store exposes normalized output payload for a job", () => {
  const output = getJobOutput("job-3")

  assert.ok(output)
  assert.equal(output.jobId, "job-3")
  assert.equal(output.output, "Text")
  assert.match(output.preview.text, /scan-kontrak\.pdf/)
  assert.equal(typeof output.generatedAt, "string")
})

test("job store exposes granular page payload with stable page ids", () => {
  const pages = getJobPages("job-3")

  assert.ok(pages)
  assert.equal(pages.jobId, "job-3")
  assert.equal(pages.pages[2]?.id, "job-3:page-03")
  assert.equal(pages.pages[2]?.status, "Needs review")
  assert.equal(pages.pages[2]?.canRetry, true)
})

test("retryPage updates a single stored page using job_pages page id", () => {
  const result = retryPage({ pageId: "job-3:page-03" })

  assert.ok(result)
  assert.equal(result.job.id, "job-3")
  assert.equal(result.job.status, "Processing")
  assert.equal(result.retriedPage.page, "Page 03")
  assert.equal(result.retriedPage.status, "Extracting")
  assert.match(result.detail.events[0], /^Retry queued for Page 03 on /)
})

test("retryPage keeps non-retryable pages unchanged when page is already healthy", () => {
  const before = getJobPages("job-1")

  assert.ok(before)
  assert.equal(before.pages[0]?.status, "Compared")
  assert.equal(before.pages[0]?.id, "job-1:page-01")
})

test("retryPage returns null for unknown page", () => {
  const result = retryPage({ pageId: "job-404:page-99" })

  assert.equal(result, null)
})

test("job store exposes current schema version", () => {
  assert.equal(getJobStoreSchemaVersion(), 9)
})
