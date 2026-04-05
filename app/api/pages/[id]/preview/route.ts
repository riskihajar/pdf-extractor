import { readFile } from "node:fs/promises"

import { NextResponse } from "next/server"

import { getJobPages } from "@/lib/job-actions"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

function parsePageId(pageId: string) {
  const marker = ":page-"
  const markerIndex = pageId.lastIndexOf(marker)

  if (markerIndex === -1) {
    return null
  }

  const jobId = pageId.slice(0, markerIndex)

  if (!jobId) {
    return null
  }

  return { jobId }
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  const parsed = parsePageId(id)

  if (!parsed) {
    return NextResponse.json(
      { message: "Page preview not found" },
      { status: 404 }
    )
  }

  const pages = getJobPages(parsed.jobId)

  if (!pages) {
    return NextResponse.json(
      { message: "Page preview not found" },
      { status: 404 }
    )
  }

  const page = pages.pages.find((entry) => entry.id === id)

  if (!page?.imagePath) {
    return NextResponse.json(
      { message: "Page preview not found" },
      { status: 404 }
    )
  }

  try {
    const image = await readFile(page.imagePath)

    return new NextResponse(image, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    })
  } catch {
    return NextResponse.json(
      { message: "Page preview not found" },
      { status: 404 }
    )
  }
}
