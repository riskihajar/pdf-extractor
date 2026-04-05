import assert from "node:assert/strict"
import test from "node:test"

import { createJobDetail, initialJobs } from "@/lib/dashboard-data"
import {
  PAGES_AUTO_REFRESH_INTERVAL_MS,
  shouldAutoRefreshPages,
} from "@/lib/pages-auto-refresh"

test("auto-refresh interval stays lightweight", () => {
  assert.equal(PAGES_AUTO_REFRESH_INTERVAL_MS, 5000)
})

test("Pages auto-refresh runs for active queued or processing jobs with unfinished pages", () => {
  const processingJob = initialJobs[0]
  const queuedJob = initialJobs[1]
  const processingPages = createJobDetail(processingJob).pages
  const queuedPages = createJobDetail(queuedJob).pages

  assert.equal(shouldAutoRefreshPages(processingJob, processingPages), true)
  assert.equal(shouldAutoRefreshPages(queuedJob, queuedPages), true)
})

test("Pages auto-refresh stays off for settled jobs even if pages previously failed", () => {
  const settledJob = initialJobs[2]
  const settledPages = createJobDetail(settledJob).pages

  assert.equal(shouldAutoRefreshPages(settledJob, settledPages), false)
})

test("Pages auto-refresh stays off when active job has no waiting work", () => {
  const completedJob = {
    ...initialJobs[0],
    status: "Processing" as const,
    failed: 0,
  }
  const settledPages = createJobDetail(initialJobs[2]).pages.map((page) => ({
    ...page,
    status: "Compared" as const,
    llm: page.llm === "Queued" || page.llm === "Running" ? "Done" : page.llm,
    tesseract:
      page.tesseract === "Queued" || page.tesseract === "Running"
        ? "Done"
        : page.tesseract,
  }))

  assert.equal(shouldAutoRefreshPages(completedJob, settledPages), false)
})
