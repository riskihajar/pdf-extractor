import { NextResponse } from "next/server"

import { drainWorkers } from "@/lib/job-actions"

export async function POST() {
  return NextResponse.json(await drainWorkers())
}
