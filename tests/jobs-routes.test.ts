import test from "node:test"
import assert from "node:assert/strict"

import { GET as getJobRoute } from "@/app/api/jobs/[id]/route"
import { GET as getJobLogsRoute } from "@/app/api/jobs/[id]/logs/route"
import { GET as getJobOutputRoute } from "@/app/api/jobs/[id]/output/route"
import { GET as downloadJobOutputRoute } from "@/app/api/jobs/[id]/output/download/route"
import { GET as getJobPagesRoute } from "@/app/api/jobs/[id]/pages/route"
import { POST as pauseJobRoute } from "@/app/api/jobs/[id]/pause/route"
import { POST as cancelJobRoute } from "@/app/api/jobs/[id]/cancel/route"
import { POST as overrideCompareWinnerRoute } from "@/app/api/jobs/[id]/compare/override/route"
import { GET as getPagePreviewRoute } from "@/app/api/pages/[id]/preview/route"
import { POST as retryJobRoute } from "@/app/api/jobs/[id]/retry/route"
import { POST as retryPageRoute } from "@/app/api/pages/[id]/retry/route"
import { GET as getJobsRoute } from "@/app/api/jobs/route"
import { POST as startAllJobsRoute } from "@/app/api/jobs/start-all/route"
import { POST as startJobRoute } from "@/app/api/jobs/start/route"
import { POST as uploadJobsRoute } from "@/app/api/jobs/upload/route"
import { resetJobStoreForTests } from "@/lib/job-store"

import { buildPdfBuffer } from "./helpers/pdf"

test.beforeEach(() => {
  resetJobStoreForTests()
})

test("GET /api/jobs returns the shared store snapshot", async () => {
  const response = await getJobsRoute()
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.ok(Array.isArray(payload.jobs))
  assert.ok(payload.jobs.length > 0)
  assert.equal(
    payload.jobs.find((job: { id: string }) => job.id === "job-3")?.canRetry,
    true
  )
  assert.equal(
    payload.jobs.find((job: { id: string }) => job.id === "job-2")?.canRetry,
    false
  )
  assert.ok(payload.details["job-1"])
})

test("GET /api/jobs/:id returns a matching job", async () => {
  const response = await getJobRoute(
    new Request("http://localhost/api/jobs/job-1"),
    {
      params: Promise.resolve({ id: "job-1" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.id, "job-1")
  assert.equal(payload.job.backgroundReady, true)
  assert.equal(payload.detail.title, "bank-statement-april.pdf")
  assert.equal(payload.background.status, "prepared")
  assert.equal(payload.background.queue, "extract-compare")
  assert.equal(payload.uploadedFile ?? null, null)
  assert.deepEqual(payload.renderArtifacts ?? [], [])
  assert.equal(payload.pages.jobId, "job-1")
  assert.equal(payload.pages.canRetry, true)
  assert.equal(payload.pages.pages[2]?.id, "job-1:page-03")
  assert.equal(payload.pages.pages[2]?.canRetry, true)
})

test("GET /api/jobs/:id/pages returns granular pages payload", async () => {
  const response = await getJobPagesRoute(
    new Request("http://localhost/api/jobs/job-3/pages"),
    {
      params: Promise.resolve({ id: "job-3" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.jobId, "job-3")
  assert.equal(payload.canRetry, true)
  assert.equal(payload.pages[2]?.id, "job-3:page-03")
  assert.equal(payload.pages[2]?.status, "Needs review")
  assert.equal(payload.pages[2]?.canRetry, true)
  assert.equal(payload.pages[0]?.canRetry, false)
  assert.equal(payload.pages[0]?.previewUrl, undefined)
})

test("GET /api/pages/:id/preview returns rendered PNG bytes for uploaded pages", async () => {
  const file = new File([buildPdfBuffer("Preview Route")], "previewable.pdf", {
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
    (job: { name: string }) => job.name === "previewable.pdf"
  )

  assert.ok(uploadedJob)

  const pagesResponse = await getJobPagesRoute(
    new Request(`http://localhost/api/jobs/${uploadedJob.id}/pages`),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const pagesPayload = await pagesResponse.json()
  const previewUrl = pagesPayload.pages[0]?.previewUrl

  assert.equal(pagesResponse.status, 200)
  assert.ok(previewUrl)

  const previewResponse = await getPagePreviewRoute(
    new Request(`http://localhost${previewUrl}`),
    {
      params: Promise.resolve({ id: pagesPayload.pages[0].id }),
    }
  )
  const previewBytes = new Uint8Array(await previewResponse.arrayBuffer())

  assert.equal(previewResponse.status, 200)
  assert.equal(previewResponse.headers.get("content-type"), "image/png")
  assert.deepEqual(
    Array.from(previewBytes.subarray(0, 8)),
    [137, 80, 78, 71, 13, 10, 26, 10]
  )
})

test("GET /api/pages/:id/preview returns 404 when preview is unavailable", async () => {
  const response = await getPagePreviewRoute(
    new Request("http://localhost/api/pages/job-1:page-01/preview"),
    {
      params: Promise.resolve({ id: "job-1:page-01" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 404)
  assert.equal(payload.message, "Page preview not found")
})

test("GET /api/jobs/:id/logs returns normalized job logs", async () => {
  const response = await getJobLogsRoute(
    new Request("http://localhost/api/jobs/job-1/logs"),
    {
      params: Promise.resolve({ id: "job-1" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.jobId, "job-1")
  assert.ok(Array.isArray(payload.events))
  assert.ok(payload.events.length > 0)
  assert.equal(payload.pipeline[0]?.title, "Upload received")
})

test("GET /api/jobs/:id/output returns normalized job output", async () => {
  const response = await getJobOutputRoute(
    new Request("http://localhost/api/jobs/job-1/output"),
    {
      params: Promise.resolve({ id: "job-1" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.jobId, "job-1")
  assert.equal(payload.output, "MD + TXT")
  assert.match(payload.preview.markdown, /bank-statement-april\.pdf/)
  assert.ok(Array.isArray(payload.compareAudit))
  assert.equal(payload.compareAudit[0]?.page, "Page 01")
  assert.equal(typeof payload.isPartial, "boolean")
})

test("GET /api/jobs/:id/output/download returns markdown attachment", async () => {
  const response = await downloadJobOutputRoute(
    new Request(
      "http://localhost/api/jobs/job-1/output/download?format=markdown"
    ),
    {
      params: Promise.resolve({ id: "job-1" }),
    }
  )
  const body = await response.text()

  assert.equal(response.status, 200)
  assert.equal(
    response.headers.get("content-type"),
    "text/markdown; charset=utf-8"
  )
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="bank-statement-april.md"'
  )
  assert.match(body, /bank-statement-april\.pdf/)
})

test("GET /api/jobs/:id/output/download rejects formats outside job preset", async () => {
  const response = await downloadJobOutputRoute(
    new Request("http://localhost/api/jobs/job-2/output/download?format=text"),
    {
      params: Promise.resolve({ id: "job-2" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 400)
  assert.equal(payload.message, "Requested format is not enabled for this job")
})

test("GET /api/jobs/:id/output/download supports explicit partial export", async () => {
  const response = await downloadJobOutputRoute(
    new Request(
      "http://localhost/api/jobs/job-3/output/download?format=text&partial=1"
    ),
    {
      params: Promise.resolve({ id: "job-3" }),
    }
  )
  const body = await response.text()

  assert.equal(response.status, 200)
  assert.match(body, /EXPLICIT PARTIAL EXPORT|PARTIAL EXPORT/)
})

test("POST /api/jobs/upload stores uploaded jobs in shared SQLite state", async () => {
  const response = await uploadJobsRoute(
    new Request("http://localhost/api/jobs/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: ["fresh-upload.pdf"],
        mode: "LLM only",
        output: "Markdown",
      }),
    })
  )
  const payload = await response.json()
  const uploadedJob = payload.jobs.find(
    (job: { name: string }) => job.name === "fresh-upload.pdf"
  )

  assert.equal(response.status, 200)
  assert.ok(uploadedJob)
  assert.equal(uploadedJob.status, "Uploaded")
  assert.equal(uploadedJob.backgroundReady, false)
  assert.ok(payload.details[uploadedJob.id])
})

test("POST /api/jobs/start updates the shared job state", async () => {
  const response = await startJobRoute(
    new Request("http://localhost/api/jobs/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobId: "job-2" }),
    })
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.id, "job-2")
  assert.equal(payload.job.status, "Processing")
})

test("POST /api/jobs/start-all updates queued jobs in shared state", async () => {
  const response = await startAllJobsRoute()
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(
    payload.jobs.find((job: { id: string }) => job.id === "job-2")?.status,
    "Processing"
  )
})

test("POST /api/jobs/:id/retry retries a stored job", async () => {
  const response = await retryJobRoute(
    new Request("http://localhost/api/jobs/job-3/retry", { method: "POST" }),
    {
      params: Promise.resolve({ id: "job-3" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.id, "job-3")
  assert.equal(payload.job.failed, 0)
  assert.match(payload.detail.events[0], /^Retry queued for /)
})

test("POST /api/jobs/:id/pause pauses a stored job", async () => {
  const response = await pauseJobRoute(
    new Request("http://localhost/api/jobs/job-1/pause", { method: "POST" }),
    {
      params: Promise.resolve({ id: "job-1" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.status, "Paused")
  assert.match(payload.detail.events[0], /^Paused /)
})

test("POST /api/jobs/:id/cancel preserves partial output state", async () => {
  const response = await cancelJobRoute(
    new Request("http://localhost/api/jobs/job-2/cancel", { method: "POST" }),
    {
      params: Promise.resolve({ id: "job-2" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.status, "Cancelled")
  assert.match(payload.detail.compareSummary, /dibatalkan/)
})

test("POST /api/jobs/:id/compare/override updates manual winner", async () => {
  const response = await overrideCompareWinnerRoute(
    new Request("http://localhost/api/jobs/job-1/compare/override", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page: "Page 02", winner: "Tesseract" }),
    }),
    {
      params: Promise.resolve({ id: "job-1" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.compareRow.page, "Page 02")
  assert.equal(payload.compareRow.winner, "Tesseract")
  assert.equal(payload.compareRow.overridden, true)
})

test("POST /api/jobs/:id/compare/override resets winner to auto scoring", async () => {
  await overrideCompareWinnerRoute(
    new Request("http://localhost/api/jobs/job-1/compare/override", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page: "Page 02", winner: "Tesseract" }),
    }),
    {
      params: Promise.resolve({ id: "job-1" }),
    }
  )

  const response = await overrideCompareWinnerRoute(
    new Request("http://localhost/api/jobs/job-1/compare/override", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page: "Page 02", winner: "auto" }),
    }),
    {
      params: Promise.resolve({ id: "job-1" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.compareRow.page, "Page 02")
  assert.equal(payload.compareRow.overridden, false)
  assert.equal(payload.compareRow.winner, "LLM")
})

test("POST /api/jobs/:id/retry returns 404 for missing job", async () => {
  const response = await retryJobRoute(
    new Request("http://localhost/api/jobs/job-404/retry", { method: "POST" }),
    {
      params: Promise.resolve({ id: "job-404" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 404)
  assert.equal(payload.message, "Job not found")
})

test("POST /api/pages/:id/retry retries a stored page", async () => {
  const response = await retryPageRoute(
    new Request("http://localhost/api/pages/job-3:page-03/retry", {
      method: "POST",
    }),
    {
      params: Promise.resolve({ id: "job-3:page-03" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.id, "job-3")
  assert.equal(payload.retriedPage.page, "Page 03")
  assert.equal(payload.retriedPage.status, "Extracting")
})

test("POST /api/pages/:id/retry returns 404 for missing page", async () => {
  const response = await retryPageRoute(
    new Request("http://localhost/api/pages/job-404:page-99/retry", {
      method: "POST",
    }),
    {
      params: Promise.resolve({ id: "job-404:page-99" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 404)
  assert.equal(payload.message, "Page not found")
})

test("GET /api/jobs/:id/pages returns 404 for missing job", async () => {
  const response = await getJobPagesRoute(
    new Request("http://localhost/api/jobs/job-404/pages"),
    {
      params: Promise.resolve({ id: "job-404" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 404)
  assert.equal(payload.message, "Job not found")
})

test("GET /api/jobs/:id/logs returns 404 for missing job", async () => {
  const response = await getJobLogsRoute(
    new Request("http://localhost/api/jobs/job-404/logs"),
    {
      params: Promise.resolve({ id: "job-404" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 404)
  assert.equal(payload.message, "Job not found")
})

test("GET /api/jobs/:id/output returns 404 for missing job", async () => {
  const response = await getJobOutputRoute(
    new Request("http://localhost/api/jobs/job-404/output"),
    {
      params: Promise.resolve({ id: "job-404" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 404)
  assert.equal(payload.message, "Job not found")
})
