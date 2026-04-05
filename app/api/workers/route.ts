import { NextResponse } from "next/server"

import { getWorkerDiagnostics } from "@/lib/job-actions"

export async function GET() {
  return NextResponse.json(getWorkerDiagnostics())
}
