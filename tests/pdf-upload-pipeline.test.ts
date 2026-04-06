import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import test from "node:test"

import { POST as uploadJobsRoute } from "@/app/api/jobs/upload/route"
import { getJob, getJobPages } from "@/lib/job-actions"
import {
  getJobPagesById,
  getJobStoreSchemaVersion,
  getRenderArtifactsByJobId,
  getUploadedFileByJobId,
  resetJobStoreForTests,
} from "@/lib/job-store"
import { buildPdfBuffer } from "./helpers/pdf"

test.beforeEach(() => {
  resetJobStoreForTests()
})

test("multipart upload stores PDF metadata and render artifacts", async () => {
  const file = new File([buildPdfBuffer("Hello Upload")], "hello-upload.pdf", {
    type: "application/pdf",
  })
  const formData = new FormData()
  formData.set("mode", "Both compare")
  formData.set("output", "MD + TXT")
  formData.append("files", file)

  const response = await uploadJobsRoute(
    new Request("http://localhost/api/jobs/upload", {
      method: "POST",
      body: formData,
    })
  )
  const payload = await response.json()
  const uploadedJob = payload.jobs.find(
    (job: { name: string }) => job.name === "hello-upload.pdf"
  )

  assert.equal(response.status, 200)
  assert.ok(uploadedJob)
  assert.equal(getJobStoreSchemaVersion(), 8)

  const storedFile = getUploadedFileByJobId(uploadedJob.id)
  const artifacts = getRenderArtifactsByJobId(uploadedJob.id)
  const pages = getJobPagesById(uploadedJob.id)
  const pagesPayload = getJobPages(uploadedJob.id)
  const job = getJob(uploadedJob.id)

  assert.ok(storedFile)
  assert.equal(storedFile.originalName, "hello-upload.pdf")
  assert.equal(storedFile.pageCount, 1)
  await access(storedFile.storedPath)
  assert.equal(artifacts.length, 1)
  await access(artifacts[0]!.imagePath)
  assert.ok(pages)
  assert.equal(pages.pages[0]?.imagePath, artifacts[0]!.imagePath)
  assert.match(pages.pages[0]?.note ?? "", /Rendered image ready/)
  assert.ok(pagesPayload)
  assert.ok(job?.uploadedFile)
  assert.equal(job?.renderArtifacts?.length, 1)
  assert.equal(job?.background.status, "prepared")
  assert.equal(job?.job.backgroundReady, false)
  assert.equal(
    pagesPayload?.pages[0]?.previewUrl,
    `/api/pages/${encodeURIComponent(pages.pages[0]!.id!)}/preview`
  )
})

test("start flow advances a real uploaded PDF job into processing", async () => {
  const file = new File([buildPdfBuffer("Pipeline Start")], "startable.pdf", {
    type: "application/pdf",
  })
  const formData = new FormData()
  formData.set("mode", "LLM only")
  formData.set("output", "Markdown")
  formData.append("files", file)

  const uploadResponse = await uploadJobsRoute(
    new Request("http://localhost/api/jobs/upload", {
      method: "POST",
      body: formData,
    })
  )
  const uploadPayload = await uploadResponse.json()
  const uploadedJob = uploadPayload.jobs.find(
    (job: { name: string }) => job.name === "startable.pdf"
  )

  assert.ok(uploadedJob)

  const { startJob } = await import("@/lib/job-actions")
  const started = startJob({ jobId: uploadedJob.id })

  assert.ok(started)
  assert.equal(started.job.status, "Processing")
  assert.equal(started.job.rendered, 1)
  assert.equal(started.detail.pages[0]?.status, "Extracting")
  assert.equal(started.detail.pages[0]?.llm, "Running")
  assert.match(
    started.detail.pipeline[2]?.detail ?? "",
    /active extraction lanes/
  )

  const artifactPath = started.detail.outputPreview.markdown.match(
    /image artifact at (.+)/
  )?.[1]
  assert.ok(artifactPath)
  const pngSignature = (await readFile(artifactPath!)).subarray(0, 8)
  assert.deepEqual(Array.from(pngSignature), [137, 80, 78, 71, 13, 10, 26, 10])
})

test("multipart upload rejects invalid PDF files with structured errors", async () => {
  const file = new File(["not a pdf"], "notes.txt", {
    type: "text/plain",
  })
  const formData = new FormData()
  formData.set("mode", "Both compare")
  formData.set("output", "MD + TXT")
  formData.append("files", file)

  const response = await uploadJobsRoute(
    new Request("http://localhost/api/jobs/upload", {
      method: "POST",
      body: formData,
    })
  )
  const payload = await response.json()

  assert.equal(response.status, 400)
  assert.equal(payload.message, "One or more files failed validation")
  assert.deepEqual(payload.errors, [
    {
      fileName: "notes.txt",
      message: "Only PDF files are supported",
    },
  ])
})

test("multipart upload rejects oversized PDF files with structured errors", async () => {
  const oversizedPdf = new File(
    [Buffer.alloc(10 * 1024 * 1024 + 1, 0)],
    "oversized.pdf",
    {
      type: "application/pdf",
    }
  )
  const formData = new FormData()
  formData.set("mode", "LLM only")
  formData.set("output", "Markdown")
  formData.append("files", oversizedPdf)

  const response = await uploadJobsRoute(
    new Request("http://localhost/api/jobs/upload", {
      method: "POST",
      body: formData,
    })
  )
  const payload = await response.json()

  assert.equal(response.status, 400)
  assert.deepEqual(payload.errors, [
    {
      fileName: "oversized.pdf",
      message: "File exceeds 10 MB upload limit",
    },
  ])
})
