import { NextResponse } from "next/server"

import { getJobPages } from "@/lib/job-actions"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  const pages = getJobPages(id)

  if (!pages) {
    return NextResponse.json({ message: "Job not found" }, { status: 404 })
  }

  return NextResponse.json(pages)
}
