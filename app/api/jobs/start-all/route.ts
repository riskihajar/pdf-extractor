import { NextResponse } from "next/server"

import { startAllJobs } from "@/lib/job-actions"

export async function POST() {
  const result = startAllJobs()

  return NextResponse.json(result)
}
