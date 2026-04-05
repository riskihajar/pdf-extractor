import type { JobRecord, PageTask } from "@/lib/dashboard-data"

const ACTIVE_JOB_STATUSES = new Set<JobRecord["status"]>([
  "Queued",
  "Processing",
])

const ACTIVE_PAGE_STATUSES = new Set<PageTask["status"]>([
  "Waiting",
  "Extracting",
])

const ACTIVE_ENGINE_STATES = new Set<PageTask["llm"]>(["Queued", "Running"])

export const PAGES_AUTO_REFRESH_INTERVAL_MS = 5000

export function shouldAutoRefreshPages(job: JobRecord, pages: PageTask[]) {
  if (!ACTIVE_JOB_STATUSES.has(job.status)) {
    return false
  }

  return pages.some(
    (page) =>
      ACTIVE_PAGE_STATUSES.has(page.status) ||
      ACTIVE_ENGINE_STATES.has(page.llm) ||
      ACTIVE_ENGINE_STATES.has(page.tesseract)
  )
}
