import { NextResponse } from "next/server"

import { buildUploadedJobs, type UploadJobsRequest } from "@/lib/job-actions"

export async function POST(request: Request) {
  const payload = (await request.json()) as UploadJobsRequest
  const result = buildUploadedJobs(payload)

  return NextResponse.json(result)
}
