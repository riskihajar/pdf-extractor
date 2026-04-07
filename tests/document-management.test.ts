import assert from "node:assert/strict"
import { access } from "node:fs/promises"
import test from "node:test"

import { POST as deleteJobRoute } from "@/app/api/jobs/[id]/delete/route"
import { POST as uploadJobsRoute } from "@/app/api/jobs/upload/route"
import { getJob, getJobs } from "@/lib/job-actions"
import {
  getJobsState,
  getUploadedFileByJobId,
  resetJobStoreForTests,
} from "@/lib/job-store"
import { buildPdfBuffer } from "./helpers/pdf"

test.beforeEach(() => {
  resetJobStoreForTests()
})

test("job list hides legacy orphan jobs and starts empty on fresh store", () => {
  const jobs = getJobs()

  assert.deepEqual(jobs.jobs, [])
  assert.deepEqual(jobs.details, {})
})

test("delete route removes uploaded document and stored pdf", async () => {
  const file = new File([buildPdfBuffer("Delete Me")], "delete-me.pdf", {
    type: "application/pdf",
  })
  const formData = new FormData()
  formData.set("mode", "Both compare")
  formData.set("output", "MD + TXT")
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

  const uploadedFile = getUploadedFileByJobId(uploadedJob.id)

  assert.ok(uploadedFile)
  await access(uploadedFile.storedPath)

  const deleteResponse = await deleteJobRoute(
    new Request(`http://localhost/api/jobs/${uploadedJob.id}/delete`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
    {
      params: Promise.resolve({ id: uploadedJob.id }),
    }
  )

  assert.equal(deleteResponse.status, 200)
  assert.equal(getJob(uploadedJob.id), null)
  assert.equal(getUploadedFileByJobId(uploadedJob.id), null)
  assert.deepEqual(getJobs().jobs, [])
  await assert.rejects(access(uploadedFile.storedPath))
})

test("existing stores cleanup orphan jobs during initialization", () => {
  const currentDb = getJobsState()

  assert.deepEqual(currentDb.jobs, [])
})
