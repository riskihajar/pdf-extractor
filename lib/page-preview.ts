import type { PageTask } from "@/lib/dashboard-data"

export function buildPagePreviewUrl(pageId: string) {
  return `/api/pages/${encodeURIComponent(pageId)}/preview`
}

export function attachPagePreviewUrl<T extends PageTask>(page: T): T {
  if (!page.id || !page.imagePath) {
    return page
  }

  return {
    ...page,
    previewUrl: buildPagePreviewUrl(page.id),
  }
}
