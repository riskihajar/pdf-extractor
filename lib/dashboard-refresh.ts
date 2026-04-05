import type { JobRecord, PageTask } from "@/lib/dashboard-data"

import {
  PAGES_AUTO_REFRESH_INTERVAL_MS,
  shouldAutoRefreshPages,
} from "@/lib/pages-auto-refresh"

type RefreshPagesPayload = {
  pages: PageTask[]
}

type SchedulePagesRefreshInput = {
  activeJob: JobRecord | null
  activeTab: "Pages" | string
  isDetailSyncing: boolean
  getPages: () => PageTask[]
  schedule: (callback: () => void, delay: number) => number
  clear: (timerId: number) => void
  refresh: () => Promise<RefreshPagesPayload | null>
  applyPages: (pages: PageTask[]) => void
}

export function schedulePagesRefresh({
  activeJob,
  activeTab,
  isDetailSyncing,
  getPages,
  schedule,
  clear,
  refresh,
  applyPages,
}: SchedulePagesRefreshInput) {
  if (
    !activeJob ||
    activeTab !== "Pages" ||
    isDetailSyncing ||
    !shouldAutoRefreshPages(activeJob, getPages())
  ) {
    return null
  }

  const timerId = schedule(() => {
    void refresh().then((payload) => {
      if (payload) {
        applyPages(payload.pages)
      }
    })
  }, PAGES_AUTO_REFRESH_INTERVAL_MS)

  return () => {
    clear(timerId)
  }
}
