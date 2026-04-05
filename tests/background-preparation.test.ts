import assert from "node:assert/strict"
import test from "node:test"

import { createJobDetail } from "@/lib/dashboard-data"
import { getJob, getJobs } from "@/lib/job-actions"
import { GET as getWorkersRoute } from "@/app/api/workers/route"
import { resetJobStoreForTests } from "@/lib/job-store"

test.beforeEach(() => {
  resetJobStoreForTests()
})

test("createJobDetail maps extraction mode to background lane defaults", () => {
  const compareDetail = createJobDetail({
    id: "job-x",
    name: "compare.pdf",
    pages: 3,
    mode: "Both compare",
    output: "MD + TXT",
    status: "Uploaded",
    progress: 0,
    rendered: 0,
    extracted: 0,
    failed: 0,
  })

  const llmDetail = createJobDetail({
    id: "job-y",
    name: "llm.pdf",
    pages: 2,
    mode: "LLM only",
    output: "Markdown",
    status: "Uploaded",
    progress: 0,
    rendered: 0,
    extracted: 0,
    failed: 0,
  })

  assert.equal(compareDetail.background.queue, "extract-compare")
  assert.equal(compareDetail.background.worker, "compare-supervisor")
  assert.equal(compareDetail.background.status, "idle")
  assert.equal(llmDetail.background.queue, "extract-llm")
  assert.equal(llmDetail.background.worker, "vision-worker")
})

test("job snapshot exposes background handoff metadata", () => {
  const jobs = getJobs()
  const queued = jobs.jobs.find((job) => job.id === "job-2")
  const detail = getJob("job-2")

  assert.ok(queued)
  assert.ok(detail)
  assert.equal(queued.backgroundReady, true)
  assert.equal(detail.background.queue, "extract-llm")
  assert.equal(detail.background.status, "prepared")
})

test("worker diagnostics groups prepared jobs by queue lane", async () => {
  const response = await getWorkersRoute()
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.ok(Array.isArray(payload.workers))
  assert.equal(payload.totals.preparedJobs >= 3, true)
  assert.equal(
    payload.workers.some(
      (lane: { queue: string }) => lane.queue === "extract-compare"
    ),
    true
  )
})
