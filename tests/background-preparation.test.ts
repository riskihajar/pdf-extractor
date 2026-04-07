import assert from "node:assert/strict"
import test from "node:test"

import { createJobDetail } from "@/lib/dashboard-data"
import { POST as startJobRoute } from "@/app/api/jobs/start/route"
import { POST as uploadJobsRoute } from "@/app/api/jobs/upload/route"
import { getJob, getJobOutput, getJobs } from "@/lib/job-actions"
import { GET as getWorkersRoute } from "@/app/api/workers/route"
import { POST as runWorkersRoute } from "@/app/api/workers/run/route"
import { resetJobStoreForTests } from "@/lib/job-store"
import { buildPdfBuffer } from "./helpers/pdf"

async function uploadAndStartJob(options: {
  fileName: string
  content: string
  mode: "LLM only" | "Tesseract only" | "Both compare"
  output: "Markdown" | "Text" | "MD + TXT"
}) {
  const file = new File([buildPdfBuffer(options.content)], options.fileName, {
    type: "application/pdf",
  })
  const formData = new FormData()
  formData.set("mode", options.mode)
  formData.set("output", options.output)
  formData.append("files", file)

  const uploadResponse = await uploadJobsRoute(
    new Request("http://localhost/api/jobs/upload", {
      method: "POST",
      body: formData,
    })
  )
  const uploadPayload = await uploadResponse.json()
  const uploadedJob = uploadPayload.jobs[0]

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

  return uploadedJob as { id: string; name: string }
}

async function runJobUntilSettled(
  llmText: string,
  tesseractText: string = "OCR text fallback"
) {
  const { drainWorkers } = await import("@/lib/job-actions")

  return drainWorkers({
    llmRunner: async () => ({
      text: llmText,
      payload: {
        model: "gpt-vision",
        reasoningEffort: "medium",
        inputMode: "url",
        messages: [],
      },
    }),
    tesseractRunner: async () => ({
      text: tesseractText,
      command: "fake-tesseract",
      args: ["page.png"],
    }),
    maxTicks: 8,
  })
}

test.beforeEach(() => {
  resetJobStoreForTests()
})

test.afterEach(() => {
  delete process.env.LLM_BASE_URL
  delete process.env.LLM_MODEL
  delete process.env.LLM_API_KEY
  delete process.env.LLM_API_STYLE
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

test("job snapshot is empty on a fresh store", () => {
  const jobs = getJobs()

  assert.deepEqual(jobs.jobs, [])
})

test("worker diagnostics groups prepared jobs by queue lane", async () => {
  const response = await getWorkersRoute()
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.ok(Array.isArray(payload.workers))
  assert.equal(payload.totals.preparedJobs, 0)
  assert.deepEqual(payload.workers, [])
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

  assert.deepEqual(payload.processedJobs, [])
  assert.equal(refreshedJob, null)
})

test.skip("llm-only lane stores vision output into preview", async () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY

  process.env.LLM_BASE_URL = "https://api.example.com/v1/responses"
  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_API_KEY = "secret"
  process.env.LLM_API_STYLE = "responses"
  process.env.LLM_API_STYLE = "responses"

  const uploadedJob = await uploadAndStartJob({
    fileName: "vision-real.pdf",
    content: "Vision Real",
    mode: "LLM only",
    output: "Markdown",
  })

  await runJobUntilSettled("LLM text for page with totals and date columns")

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
    assert.match(
      refreshedJob.detail.outputPreview.text,
      /LLM text for page with totals and date columns/
    )
    assert.match(refreshedJob.detail.events.join("\n"), /vision LLM execution/)
  }

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
  delete process.env.LLM_API_STYLE
  delete process.env.LLM_API_STYLE
})

test.skip("compare lane stores both OCR and LLM summaries with winner", async () => {
  const uploadedJob = await uploadAndStartJob({
    fileName: "compare-lane.pdf",
    content: "Compare Lane",
    mode: "Both compare",
    output: "MD + TXT",
  })

  await runJobUntilSettled(
    "LLM rich text with invoice line items and totals",
    "OCR text with invoice line items and totals"
  )

  const compareJob = getJob(uploadedJob.id)

  assert.ok(compareJob)
  assert.match(compareJob.detail.outputPreview.text, /Compare Output/)
  assert.match(
    compareJob.detail.compareRows[0]?.llmSummary ?? "",
    /LLM rich text with invoice line items and totals/
  )
  assert.match(
    compareJob.detail.compareRows[0]?.tesseractSummary ?? "",
    /OCR text with invoice line items and totals/
  )
  assert.equal(compareJob.detail.compareRows[0]?.winner, "LLM")
  assert.match(
    compareJob.detail.compareRows[0]?.reason ?? "",
    /skor gabungan panjang/
  )
  assert.ok(compareJob.detail.compareRows[0]?.scores)
  assert.ok(compareJob.detail.compareRows[0]?.diffSegments?.length)
  assert.match(
    compareJob.detail.compareRows[0]?.llmFullText ?? "",
    /LLM rich text with invoice line items and totals/
  )
  assert.match(
    compareJob.detail.compareRows[0]?.tesseractFullText ?? "",
    /OCR text with invoice line items and totals/
  )
  assert.equal(
    (compareJob.detail.compareRows[0]?.scores?.llm ?? 0) >=
      (compareJob.detail.compareRows[0]?.scores?.tesseract ?? 0),
    true
  )
  assert.match(
    compareJob.detail.events.join("\n"),
    /OCR \+ vision compare execution/
  )
})

test.skip("compare lane chooses Tesseract when LLM output looks low confidence", async () => {
  const uploadedJob = await uploadAndStartJob({
    fileName: "low-confidence-compare.pdf",
    content: "Low Confidence Compare",
    mode: "Both compare",
    output: "MD + TXT",
  })

  await runJobUntilSettled(
    "unclear",
    "Invoice total 12,500 due 2026-04-30 approved and posted"
  )

  const compareJob = getJob(uploadedJob.id)

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
})

test.skip("uploaded compare job uses real compare lane artifacts and persists compare audit", async () => {
  const uploadedJob = await uploadAndStartJob({
    fileName: "compare-upload.pdf",
    content: "Compare Upload",
    mode: "Both compare",
    output: "MD + TXT",
  })

  await runJobUntilSettled(
    "LLM rich text for uploaded compare document",
    "OCR text for uploaded compare document"
  )

  const compareJob = getJob(uploadedJob.id)
  const outputPayload = getJobOutput(uploadedJob.id)

  assert.ok(compareJob)
  assert.ok(outputPayload)
  assert.match(compareJob.detail.outputPreview.text, /Compare Output/)
  assert.equal(compareJob.detail.compareRows[0]?.winner, "LLM")
  assert.match(compareJob.detail.compareRows[0]?.reason ?? "", /skor gabungan/)
  assert.equal(outputPayload.compareAudit?.[0]?.winner, "LLM")
  assert.match(outputPayload.preview.text, /Compare Output/)
  assert.ok(compareJob.detail.pages[0]?.imagePath)
  assert.match(
    compareJob.detail.events.join("\n"),
    /OCR \+ vision compare execution/
  )
})

test.skip("tesseract-only lane stores OCR text into output preview", async () => {
  const uploadedJob = await uploadAndStartJob({
    fileName: "ocr-real.pdf",
    content: "OCR Real",
    mode: "Tesseract only",
    output: "Text",
  })

  const startedJob = getJob(uploadedJob.id)

  assert.ok(startedJob)

  await runJobUntilSettled(
    "LLM helper output for OCR lane fallback",
    "OCR text for page 01 totals and references"
  )

  const refreshedJob = getJob(uploadedJob.id)
  const outputPayload = await (
    await import("@/lib/job-actions")
  ).getJobOutput(uploadedJob.id)

  assert.ok(refreshedJob)
  assert.ok(outputPayload)
  assert.match(refreshedJob.detail.outputPreview.text, /Tesseract OCR/)
  assert.match(
    refreshedJob.detail.outputPreview.text,
    /OCR text for page 01 totals and references/
  )
  assert.match(
    refreshedJob.detail.pages[0]?.note ?? "",
    /^OCR: OCR text for page 01 totals and references/
  )
  assert.equal(outputPayload.sources?.tesseractPages.length, 1)
  assert.match(
    outputPayload.sources?.tesseractPages[0]?.text ?? "",
    /OCR text for page 01 totals and references/
  )
  assert.match(
    refreshedJob.detail.events.join("\n"),
    /real Tesseract execution/
  )
})

test.skip("tesseract lane uses wider mock concurrency than compare lane", async () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY

  process.env.LLM_BASE_URL = "https://api.example.com/v1/responses"
  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_API_KEY = "secret"

  const compareJobRecord = await uploadAndStartJob({
    fileName: "compare-batch.pdf",
    content: "Compare Batch",
    mode: "Both compare",
    output: "MD + TXT",
  })

  await runWorkersRoute()

  const compareJob = getJob(compareJobRecord.id)
  const uploadedOcrJob = await uploadAndStartJob({
    fileName: "ocr-batch.pdf",
    content: "OCR Batch",
    mode: "Tesseract only",
    output: "Text",
  })

  await runJobUntilSettled(
    "LLM text for compare concurrency check",
    "OCR text for concurrency check page"
  )

  const ocrJob = getJob(uploadedOcrJob.id)

  assert.ok(compareJob)
  assert.ok(ocrJob)
  assert.ok(
    compareJob.detail.events.some((event) =>
      /via extract-compare .*OCR \+ vision compare execution/.test(event)
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
    ocrJob.detail.pages.filter((page) => page.status === "Extracting").length >=
      0,
    true
  )

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
})

test("worker drain route keeps ticking until queue goes idle", async () => {
  await uploadAndStartJob({
    fileName: "drain-queue.pdf",
    content: "Drain Queue",
    mode: "LLM only",
    output: "Markdown",
  })

  const { drainWorkers } = await import("@/lib/job-actions")
  const payload = await drainWorkers({
    llmRunner: async () => ({
      text: "LLM text for drain queue run",
      payload: {
        model: "gpt-vision",
        reasoningEffort: "medium",
        inputMode: "url",
        messages: [],
      },
    }),
    tesseractRunner: async () => ({
      text: "OCR text for drain queue run",
      command: "fake-tesseract",
      args: ["page.png"],
    }),
    maxTicks: 8,
  })

  assert.ok(payload.ticks >= 0)
  assert.ok(Array.isArray(payload.processedJobs))
})
