import assert from "node:assert/strict"
import test from "node:test"

import { createJobDetail, initialJobDetails } from "@/lib/dashboard-data"
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
  const { runWorkers } = await import("@/lib/job-actions")
  const payload = await runWorkers({
    llmRunner: async ({ imageUrl }) => ({
      text: `LLM text for ${(imageUrl ?? "missing-image").split("/").pop()}`,
      payload: {
        model: "gpt-vision",
        reasoningEffort: "medium",
        inputMode: "url",
        messages: [],
      },
    }),
    tesseractRunner: async (imagePath) => ({
      text: `OCR text for ${imagePath.split("/").pop()}`,
      command: "fake-tesseract",
      args: [imagePath],
    }),
  })
  const refreshedJob = getJob("job-2")

  assert.ok(payload.processedJobs.length > 0)
  assert.ok(refreshedJob)
  assert.equal(refreshedJob.job.status, "Processing")
  assert.match(
    refreshedJob.detail.events[0] ?? "",
    /^Worker tick consumed .* via extract-llm with vision LLM execution/
  )
  assert.match(
    refreshedJob.detail.outputPreview.markdown,
    /Vision LLM Output|Worker output/
  )
})

test("llm-only lane stores vision output into preview", async () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY

  process.env.LLM_BASE_URL = "https://api.example.com/v1/responses"
  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_API_KEY = "secret"
  process.env.LLM_API_STYLE = "responses"
  process.env.LLM_API_STYLE = "responses"

  const uploadResponse = await uploadJobsRoute(
    new Request("http://localhost/api/jobs/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: ["vision-real.pdf"],
        mode: "LLM only",
        output: "Markdown",
      }),
    })
  )
  const uploadPayload = await uploadResponse.json()
  const uploadedJob = uploadPayload.jobs.find(
    (job: { mode: string }) => job.mode === "LLM only"
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
  await runWorkers({
    llmRunner: async ({ imageUrl }) => ({
      text: `LLM text for ${(imageUrl ?? "missing-image").split("/").pop()}`,
      payload: {
        model: "gpt-vision",
        reasoningEffort: "medium",
        inputMode: "url",
        messages: [],
      },
    }),
  })

  const refreshedJob = getJob(uploadedJob.id)

  assert.ok(refreshedJob)
  const latestEvent = refreshedJob.detail.events[0] ?? ""

  if (/^\[extract-llm\] failed /.test(latestEvent)) {
    assert.match(latestEvent, /Missing rendered image/)
    assert.match(
      refreshedJob.detail.outputPreview.text,
      /Output preview pending until extraction begins/
    )
  } else {
    assert.match(refreshedJob.detail.outputPreview.text, /Vision LLM Output/)
    assert.match(refreshedJob.detail.outputPreview.text, /LLM text for/)
    assert.match(refreshedJob.detail.events.join("\n"), /vision LLM execution/)
  }

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
  delete process.env.LLM_API_STYLE
  delete process.env.LLM_API_STYLE
})

test("compare lane stores both OCR and LLM summaries with winner", async () => {
  const { runPreparedJobsOnce } = await import("@/lib/job-store")
  const originalImagePath = initialJobDetails["job-1"]?.pages[0]?.imagePath

  if (initialJobDetails["job-1"]?.pages[0]) {
    initialJobDetails["job-1"].pages[0]!.imagePath =
      "/tmp/mock-compare-page-1.png"
  }

  await runPreparedJobsOnce({
    llmRunner: async ({ imageUrl }) => ({
      text: `LLM rich text for ${(imageUrl ?? "missing-image").split("/").pop()}`,
      payload: {
        model: "gpt-vision",
        reasoningEffort: "medium",
        inputMode: "url",
        messages: [],
      },
    }),
    tesseractRunner: async (imagePath) => ({
      text: `OCR text for ${imagePath.split("/").pop()}`,
      command: "fake-tesseract",
      args: [imagePath],
    }),
  })

  const compareJob = getJob("job-1")

  assert.ok(compareJob)
  assert.match(compareJob.detail.outputPreview.text, /Compare Output/)
  assert.match(
    compareJob.detail.compareRows[0]?.llmSummary ?? "",
    /LLM rich text for/
  )
  assert.match(
    compareJob.detail.compareRows[0]?.tesseractSummary ?? "",
    /OCR text for/
  )
  assert.equal(compareJob.detail.compareRows[0]?.winner, "LLM")
  assert.match(
    compareJob.detail.compareRows[0]?.reason ?? "",
    /skor gabungan panjang/
  )
  assert.ok(compareJob.detail.compareRows[0]?.scores)
  assert.equal(
    (compareJob.detail.compareRows[0]?.scores?.llm ?? 0) >=
      (compareJob.detail.compareRows[0]?.scores?.tesseract ?? 0),
    true
  )
  assert.match(
    compareJob.detail.events.join("\n"),
    /OCR \+ vision compare execution/
  )

  if (initialJobDetails["job-1"]?.pages[0]) {
    initialJobDetails["job-1"].pages[0]!.imagePath = originalImagePath
  }
})

test("compare lane chooses Tesseract when LLM output looks low confidence", async () => {
  const { runPreparedJobsOnce } = await import("@/lib/job-store")
  const originalImagePath = initialJobDetails["job-1"]?.pages[0]?.imagePath

  if (initialJobDetails["job-1"]?.pages[0]) {
    initialJobDetails["job-1"].pages[0]!.imagePath =
      "/tmp/mock-compare-page-1.png"
  }

  await runPreparedJobsOnce({
    llmRunner: async () => ({
      text: "unclear ???",
      payload: {
        model: "gpt-vision",
        reasoningEffort: "medium",
        inputMode: "url",
        messages: [],
      },
    }),
    tesseractRunner: async () => ({
      text: "Invoice total 12,500 due 2026-04-30",
      command: "fake-tesseract",
      args: ["page.png"],
    }),
  })

  const compareJob = getJob("job-1")

  assert.ok(compareJob)
  assert.equal(compareJob.detail.compareRows[0]?.winner, "Tesseract")
  assert.match(
    compareJob.detail.compareRows[0]?.reason ?? "",
    /LLM terlihat low-confidence/
  )
  assert.equal(
    (compareJob.detail.compareRows[0]?.scores?.tesseract ?? 0) >
      (compareJob.detail.compareRows[0]?.scores?.llm ?? 0),
    true
  )

  if (initialJobDetails["job-1"]?.pages[0]) {
    initialJobDetails["job-1"].pages[0]!.imagePath = originalImagePath
  }
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
    llmRunner: async ({ imageUrl }) => ({
      text: `LLM text for ${(imageUrl ?? "missing-image").split("/").pop()}`,
      payload: {
        model: "gpt-vision",
        reasoningEffort: "medium",
        inputMode: "url",
        messages: [],
      },
    }),
    tesseractRunner: async (imagePath) => ({
      text: `OCR text for ${imagePath.split("/").pop()}`,
      command: "fake-tesseract",
      args: [imagePath],
    }),
  })

  const refreshedJob = getJob(uploadedJob.id)
  const outputPayload = await (
    await import("@/lib/job-actions")
  ).getJobOutput(uploadedJob.id)

  assert.ok(refreshedJob)
  assert.ok(outputPayload)
  assert.match(refreshedJob.detail.outputPreview.text, /Tesseract OCR/)
  assert.match(refreshedJob.detail.outputPreview.text, /OCR text for/)
  assert.match(refreshedJob.detail.pages[0]?.note ?? "", /^OCR: OCR text for/)
  assert.equal(outputPayload.sources?.tesseractPages.length, 1)
  assert.match(
    outputPayload.sources?.tesseractPages[0]?.text ?? "",
    /OCR text for/
  )
  assert.match(
    refreshedJob.detail.events.join("\n"),
    /real Tesseract execution/
  )
})

test("tesseract lane uses wider mock concurrency than compare lane", async () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY

  process.env.LLM_BASE_URL = "https://api.example.com/v1/responses"
  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_API_KEY = "secret"

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
    llmRunner: async ({ imageUrl }) => ({
      text: `LLM text for ${(imageUrl ?? "missing-image").split("/").pop()}`,
      payload: {
        model: "gpt-vision",
        reasoningEffort: "medium",
        inputMode: "url",
        messages: [],
      },
    }),
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

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
})

test("worker drain route keeps ticking until queue goes idle", async () => {
  const { drainWorkers } = await import("@/lib/job-actions")
  const payload = await drainWorkers({
    llmRunner: async ({ imageUrl }) => ({
      text: `LLM text for ${(imageUrl ?? "missing-image").split("/").pop()}`,
      payload: {
        model: "gpt-vision",
        reasoningEffort: "medium",
        inputMode: "url",
        messages: [],
      },
    }),
    tesseractRunner: async (imagePath) => ({
      text: `OCR text for ${imagePath.split("/").pop()}`,
      command: "fake-tesseract",
      args: [imagePath],
    }),
    maxTicks: 8,
  })

  assert.ok(payload.ticks >= 1)
  assert.ok(Array.isArray(payload.processedJobs))
})
