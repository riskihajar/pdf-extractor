import assert from "node:assert/strict"
import test from "node:test"

import { createJobDetail } from "@/lib/dashboard-data"
import { POST as startJobRoute } from "@/app/api/jobs/start/route"
import { POST as uploadJobsRoute } from "@/app/api/jobs/upload/route"
import { getJob, getJobs } from "@/lib/job-actions"
import { GET as getWorkersRoute } from "@/app/api/workers/route"
import { POST as runWorkersRoute } from "@/app/api/workers/run/route"
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

test("worker run route consumes prepared jobs once", async () => {
  const response = await runWorkersRoute()
  const payload = await response.json()
  const refreshedJob = getJob("job-2")

  assert.equal(response.status, 200)
  assert.ok(payload.processedJobs.length > 0)
  assert.ok(refreshedJob)
  assert.equal(refreshedJob.job.status, "Processing")
  assert.match(refreshedJob.detail.events[0] ?? "", /^\[extract-llm\] /)
  assert.match(
    refreshedJob.detail.events[1] ?? "",
    /^Worker tick consumed .* via extract-llm with concurrency /
  )
  assert.match(refreshedJob.detail.outputPreview.markdown, /Worker output/)
})

test("tesseract-only lane stores OCR text into output preview", async () => {
  const uploadResponse = await uploadJobsRoute(
    new Request("http://localhost/api/jobs/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: ["ocr-real.pdf"],
        mode: "Tesseract only",
        output: "Text",
      }),
    })
  )
  const uploadPayload = await uploadResponse.json()
  const uploadedJob = uploadPayload.jobs.find(
    (job: { mode: string }) => job.mode === "Tesseract only"
  )

  assert.ok(uploadedJob)

  await startJobRoute(
    new Request("http://localhost/api/jobs/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobId: uploadedJob.id }),
    })
  )

  const { runWorkers } = await import("@/lib/job-actions")
  const startedJob = getJob(uploadedJob.id)

  assert.ok(startedJob)

  await runWorkers({
    tesseractRunner: async (imagePath) => ({
      text: `OCR text for ${imagePath.split("/").pop()}`,
      command: "fake-tesseract",
      args: [imagePath],
    }),
  })

  const refreshedJob = getJob(uploadedJob.id)

  assert.ok(refreshedJob)
  assert.match(refreshedJob.detail.outputPreview.text, /Tesseract OCR/)
  assert.match(refreshedJob.detail.outputPreview.text, /OCR text for/)
  assert.match(
    refreshedJob.detail.events.join("\n"),
    /real Tesseract execution/
  )
})

test("tesseract lane uses wider mock concurrency than compare lane", async () => {
  await runWorkersRoute()

  const compareJob = getJob("job-1")
  const uploadResponse = await uploadJobsRoute(
    new Request("http://localhost/api/jobs/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: ["ocr-batch.pdf"],
        mode: "Tesseract only",
        output: "Text",
      }),
    })
  )
  const uploadPayload = await uploadResponse.json()
  const uploadedOcrJob = uploadPayload.jobs.find(
    (job: { mode: string }) => job.mode === "Tesseract only"
  )

  assert.ok(uploadedOcrJob)

  await startJobRoute(
    new Request("http://localhost/api/jobs/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobId: uploadedOcrJob.id }),
    })
  )

  const { runWorkers } = await import("@/lib/job-actions")
  await runWorkers({
    tesseractRunner: async (imagePath) => ({
      text: `OCR text for ${imagePath.split("/").pop()}`,
      command: "fake-tesseract",
      args: [imagePath],
    }),
  })

  const ocrJob = getJob(uploadedOcrJob.id)

  assert.ok(compareJob)
  assert.ok(ocrJob)
  assert.ok(
    compareJob.detail.events.some((event) =>
      /via extract-compare .*concurrency 1/.test(event)
    )
  )
  assert.ok(
    ocrJob.detail.events.some((event) =>
      /via extract-ocr .*real Tesseract execution/.test(event)
    )
  )
  assert.ok(
    ocrJob.detail.events.some((event) =>
      /^\[extract-ocr\] OCR completed for Page 01/.test(event)
    )
  )
  assert.ok(
    ocrJob.detail.events.some((event) => /real Tesseract execution/.test(event))
  )
  assert.equal(
    ocrJob.detail.pages.filter((page) => page.status === "Extracting").length,
    2
  )
})
