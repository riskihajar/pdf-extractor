import { NextResponse } from "next/server"

import { startJob, type StartJobRequest } from "@/lib/job-actions"

export async function POST(request: Request) {
  const payload = (await request.json()) as StartJobRequest
  const result = startJob(payload)

  if (!result) {
    return NextResponse.json({ message: "Job not found" }, { status: 404 })
  }

  return NextResponse.json(result)
}
