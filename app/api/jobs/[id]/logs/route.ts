import { NextResponse } from "next/server"

import { getJobLogs } from "@/lib/job-actions"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  const logs = getJobLogs(id)

  if (!logs) {
    return NextResponse.json({ message: "Job not found" }, { status: 404 })
  }

  return NextResponse.json(logs)
}
