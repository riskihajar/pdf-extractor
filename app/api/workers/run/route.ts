import { NextResponse } from "next/server"

import { runWorkers } from "@/lib/job-actions"

export async function POST() {
  return NextResponse.json(await runWorkers())
}
