import assert from "node:assert/strict"
import test from "node:test"

import { initialJobs } from "@/lib/dashboard-data"
import { schedulePagesRefresh } from "@/lib/dashboard-refresh"
import { getJobPages } from "@/lib/job-actions"
import { resetJobStoreForTests } from "@/lib/job-store"

test.beforeEach(() => {
  resetJobStoreForTests()
})

test("schedulePagesRefresh wires polling callback for active pages tab", async () => {
  const activeJob = initialJobs[0]
  const payload = getJobPages(activeJob.id)
  let capturedDelay = 0
  let scheduledCallback: (() => Promise<void>) | undefined
  let refreshCalls = 0
  let appliedPages = 0

  assert.ok(payload)

  const cleanup = schedulePagesRefresh({
    activeJob,
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

  assert.equal(typeof cleanup, "function")
  assert.equal(capturedDelay, 5000)
  assert.ok(scheduledCallback)

  const runScheduledCallback = scheduledCallback

  assert.ok(runScheduledCallback)

  await runScheduledCallback()

  assert.equal(refreshCalls, 1)
  assert.equal(appliedPages, payload.pages.length)
})

test("schedulePagesRefresh skips wiring when pages should not refresh", () => {
  const settledJob = initialJobs[2]
  const payload = getJobPages(settledJob.id)
  let scheduleCalls = 0

  assert.ok(payload)

  const cleanup = schedulePagesRefresh({
    activeJob: settledJob,
    activeTab: "Pages",
    isDetailSyncing: false,
    getPages: () => payload.pages,
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
