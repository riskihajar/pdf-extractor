import { NextResponse } from "next/server"

import { getJobs } from "@/lib/job-actions"

export async function GET() {
  return NextResponse.json(getJobs())
}
