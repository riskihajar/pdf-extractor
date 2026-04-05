import { NextResponse } from "next/server"

import { startAllJobs, type StartAllJobsRequest } from "@/lib/job-actions"

export async function POST(request: Request) {
  const payload = (await request.json()) as StartAllJobsRequest
  const result = startAllJobs(payload)

  return NextResponse.json(result)
}
