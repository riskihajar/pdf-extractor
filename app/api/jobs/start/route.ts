import { NextResponse } from "next/server"

import { startJob, type StartJobRequest } from "@/lib/job-actions"

export async function POST(request: Request) {
  const payload = (await request.json()) as StartJobRequest
  const result = startJob(payload)

  return NextResponse.json(result)
}
