import { NextResponse } from "next/server"

import { getJobOutput } from "@/lib/job-actions"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  const output = getJobOutput(id)

  if (!output) {
    return NextResponse.json({ message: "Job not found" }, { status: 404 })
  }

  return NextResponse.json(output)
}
