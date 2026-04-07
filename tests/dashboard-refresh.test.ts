import assert from "node:assert/strict"
import test from "node:test"

import { schedulePagesRefresh } from "@/lib/dashboard-refresh"
import { getJob, getJobPages, getJobs } from "@/lib/job-actions"
import { POST as startJobRoute } from "@/app/api/jobs/start/route"
import { POST as uploadJobsRoute } from "@/app/api/jobs/upload/route"
import { resetJobStoreForTests } from "@/lib/job-store"

import { buildPdfBuffer } from "./helpers/pdf"

async function uploadJob() {
  const file = new File([buildPdfBuffer("Refresh Test")], "refresh-test.pdf", {
    type: "application/pdf",
  })
  const formData = new FormData()
  formData.set("mode", "LLM only")
  formData.set("output", "Markdown")
  formData.append("files", file)

  const response = await uploadJobsRoute(
    new Request("http://localhost/api/jobs/upload", {
      method: "POST",
      body: formData,
    })
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.ok(payload.jobs[0])

  const uploadedJobId = payload.jobs[0]?.id as string
  const fullJob = getJobs().jobs.find((job) => job.id === uploadedJobId)

  assert.ok(fullJob)

  return fullJob
}

async function startUploadedJob(jobId: string) {
  const response = await startJobRoute(
    new Request("http://localhost/api/jobs/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    })
  )

  assert.equal(response.status, 200)
}

test.beforeEach(() => {
  resetJobStoreForTests()
})

test("schedulePagesRefresh wires polling callback for active pages tab", async () => {
  const activeJob = await uploadJob()
  await startUploadedJob(activeJob.id)
  const startedJob = getJob(activeJob.id)?.job
  const payload = getJobPages(activeJob.id)
  let capturedDelay = 0
  let scheduledCallback: (() => Promise<void>) | undefined
  let refreshCalls = 0
  let appliedPages = 0

  assert.ok(payload)
  assert.ok(startedJob)

  const cleanup = schedulePagesRefresh({
    activeJob: startedJob,
    activeTab: "Pages",
    isDetailSyncing: false,
    getPages: () => payload.pages,
    schedule: (callback, delay) => {
      scheduledCallback = async () => {
        callback()
        await Promise.resolve()
      }
      capturedDelay = delay
      return 7
    },
    clear: () => {},
    refresh: async () => {
      refreshCalls += 1
      return payload
    },
    applyPages: (pages) => {
      appliedPages = pages.length
    },
  })

  assert.ok(cleanup)
  assert.equal(capturedDelay, 5000)
  assert.ok(scheduledCallback)

  const runScheduledCallback = scheduledCallback

  assert.ok(runScheduledCallback)

  await runScheduledCallback()

  assert.equal(refreshCalls, 1)
  assert.equal(appliedPages, payload.pages.length)
})

test("schedulePagesRefresh skips wiring when pages should not refresh", async () => {
  const settledJob = await uploadJob()
  const payload = getJobPages(settledJob.id)
  let scheduleCalls = 0

  assert.ok(payload)

  const cleanup = schedulePagesRefresh({
    activeJob: { ...settledJob, status: "Completed" },
    activeTab: "Pages",
    isDetailSyncing: false,
    getPages: () =>
      payload.pages.map((page) => ({ ...page, status: "Compared" })),
    schedule: () => {
      scheduleCalls += 1
      return 1
    },
    clear: () => {},
    refresh: async () => payload,
    applyPages: () => {},
  })

  assert.equal(cleanup, null)
  assert.equal(scheduleCalls, 0)
})
