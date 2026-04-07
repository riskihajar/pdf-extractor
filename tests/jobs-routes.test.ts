import assert from "node:assert/strict"
import test from "node:test"

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
    output: string
  }
}

test.beforeEach(() => {
  resetJobStoreForTests()
})

test("GET /api/jobs returns the uploaded-only store snapshot", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "route-list.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Route List",
  })
  const response = await getJobsRoute()
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.ok(Array.isArray(payload.jobs))
  assert.equal(payload.jobs.length, 1)
  assert.equal(payload.jobs[0]?.id, uploadedJob.id)
  assert.ok(payload.details[uploadedJob.id])
})

test("GET /api/jobs/:id returns a matching uploaded job", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "route-detail.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Route Detail",
  })
  const response = await getJobRoute(
    new Request("http://localhost/api/jobs/id"),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.id, uploadedJob.id)
  assert.equal(payload.job.backgroundReady, true)
  assert.equal(payload.detail.title, uploadedJob.name)
  assert.equal(payload.background.status, "prepared")
  assert.ok(payload.uploadedFile)
  assert.ok((payload.renderArtifacts ?? []).length > 0)
  assert.equal(payload.pages.jobId, uploadedJob.id)
})

test("GET /api/jobs/:id/pages returns granular uploaded pages payload", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "route-pages.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Route Pages",
  })
  const response = await getJobPagesRoute(
    new Request(`http://localhost/api/jobs/${uploadedJob.id}/pages`),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.jobId, uploadedJob.id)
  assert.ok((payload.pages[0]?.id ?? "").startsWith(`${uploadedJob.id}:page-`))
  assert.equal(typeof payload.pages[0]?.canRetry, "boolean")
})

test("GET /api/pages/:id/preview returns rendered PNG bytes for uploaded pages", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "previewable.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Preview Route",
  })
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
    new Request("http://localhost/api/pages/job-404:page-01/preview"),
    {
      params: Promise.resolve({ id: "job-404:page-01" }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 404)
  assert.equal(payload.message, "Page preview not found")
})

test("GET /api/jobs/:id/logs returns normalized uploaded job logs", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "logs-route.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Logs Route",
  })
  const response = await getJobLogsRoute(
    new Request(`http://localhost/api/jobs/${uploadedJob.id}/logs`),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.jobId, uploadedJob.id)
  assert.ok(Array.isArray(payload.events))
  assert.equal(payload.pipeline[0]?.title, "Upload stored")
})

test("GET /api/jobs/:id/output returns normalized uploaded job output", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "output-route.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Output Route",
  })
  const response = await getJobOutputRoute(
    new Request(`http://localhost/api/jobs/${uploadedJob.id}/output`),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.jobId, uploadedJob.id)
  assert.equal(payload.output, "MD + TXT")
  assert.match(payload.preview.markdown, /output-route\.pdf/)
  assert.ok(Array.isArray(payload.compareAudit))
})

test("GET /api/jobs/:id/output/download returns markdown attachment", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "download-route.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Download Route",
  })
  const response = await downloadJobOutputRoute(
    new Request(
      `http://localhost/api/jobs/${uploadedJob.id}/output/download?format=markdown`
    ),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const body = await response.text()

  assert.equal(response.status, 200)
  assert.equal(
    response.headers.get("content-type"),
    "text/markdown; charset=utf-8"
  )
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /download-route\.md/
  )
  assert.match(body, /download-route\.pdf/)
})

test("GET /api/jobs/:id/output/download rejects formats outside job preset", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "download-invalid.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Download Invalid",
  })
  const response = await downloadJobOutputRoute(
    new Request(
      `http://localhost/api/jobs/${uploadedJob.id}/output/download?format=text`
    ),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 400)
  assert.equal(payload.message, "Requested format is not enabled for this job")
})

test("GET /api/jobs/:id/output/download supports explicit partial export", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "download-partial.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Download Partial",
  })
  const response = await downloadJobOutputRoute(
    new Request(
      `http://localhost/api/jobs/${uploadedJob.id}/output/download?format=markdown&partial=1`
    ),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const body = await response.text()

  assert.equal(response.status, 200)
  assert.match(body, /Explicit partial export|PARTIAL EXPORT/)
})

test("POST /api/jobs/upload stores uploaded jobs in shared SQLite state", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "fresh-upload.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Fresh Upload",
  })

  assert.equal(uploadedJob.status, "Uploaded")
  assert.equal(uploadedJob.status, "Uploaded")
})

test("POST /api/jobs/start updates the shared uploaded job state", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "start-route.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Start Route",
  })
  const response = await startJobRoute(
    new Request("http://localhost/api/jobs/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: uploadedJob.id }),
    })
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.id, uploadedJob.id)
  assert.equal(payload.job.status, "Processing")
})

test("POST /api/jobs/start-all updates uploaded jobs in shared state", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "start-all-route.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Start All Route",
  })
  const response = await startAllJobsRoute()
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(
    payload.jobs.find((job: { id: string }) => job.id === uploadedJob.id)
      ?.status,
    "Processing"
  )
})

test("POST /api/jobs/:id/retry retries a stored uploaded job", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "retry-route.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Retry Route",
  })
  const response = await retryJobRoute(
    new Request(`http://localhost/api/jobs/${uploadedJob.id}/retry`, {
      method: "POST",
    }),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.id, uploadedJob.id)
  assert.match(payload.detail.events[0] ?? "", /^Retry queued for /)
})

test("POST /api/jobs/:id/pause pauses a stored uploaded job", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "pause-route.pdf",
    mode: "LLM only",
    output: "Markdown",
    content: "Pause Route",
  })
  const response = await pauseJobRoute(
    new Request(`http://localhost/api/jobs/${uploadedJob.id}/pause`, {
      method: "POST",
    }),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.status, "Paused")
  assert.match(payload.detail.events[0] ?? "", /^Paused /)
})

test("POST /api/jobs/:id/cancel preserves partial output state", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "cancel-route.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Cancel Route",
  })
  const response = await cancelJobRoute(
    new Request(`http://localhost/api/jobs/${uploadedJob.id}/cancel`, {
      method: "POST",
    }),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.status, "Cancelled")
  assert.match(payload.detail.compareSummary, /dibatalkan/)
})

test("POST /api/jobs/:id/compare/override updates manual winner", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "override-route.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Override Route",
  })
  const response = await overrideCompareWinnerRoute(
    new Request(
      `http://localhost/api/jobs/${uploadedJob.id}/compare/override`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: "Page 01", winner: "Tesseract" }),
      }
    ),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.compareRow.page, "Page 01")
  assert.equal(payload.compareRow.winner, "Tesseract")
  assert.equal(payload.compareRow.overridden, true)
})

test("POST /api/jobs/:id/compare/override resets winner to auto scoring", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "override-reset-route.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Override Reset Route",
  })

  await overrideCompareWinnerRoute(
    new Request(
      `http://localhost/api/jobs/${uploadedJob.id}/compare/override`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: "Page 01", winner: "Tesseract" }),
      }
    ),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )

  const response = await overrideCompareWinnerRoute(
    new Request(
      `http://localhost/api/jobs/${uploadedJob.id}/compare/override`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: "Page 01", winner: "auto" }),
      }
    ),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.compareRow.page, "Page 01")
  assert.equal(payload.compareRow.overridden, false)
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

test("POST /api/pages/:id/retry retries a stored uploaded page", async () => {
  const uploadedJob = await uploadFixture({
    fileName: "retry-page-route.pdf",
    mode: "Both compare",
    output: "MD + TXT",
    content: "Retry Page Route",
  })
  const pagesResponse = await getJobPagesRoute(
    new Request(`http://localhost/api/jobs/${uploadedJob.id}/pages`),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )
  const pagesPayload = await pagesResponse.json()
  const pageId = pagesPayload.pages[0]?.id

  const response = await retryPageRoute(
    new Request(`http://localhost/api/pages/${pageId}/retry`, {
      method: "POST",
    }),
    {
      params: Promise.resolve({ id: pageId }),
    }
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.job.id, uploadedJob.id)
  assert.equal(payload.retriedPage.id, pageId)
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
