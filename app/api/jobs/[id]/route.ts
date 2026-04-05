import { NextResponse } from "next/server"

import { getJob, getJobPages } from "@/lib/job-actions"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  const job = getJob(id)

  if (!job) {
    return NextResponse.json({ message: "Job not found" }, { status: 404 })
  }

  const pages = getJobPages(id)

  return NextResponse.json({
    ...job,
    pages,
  })
}
