import { NextResponse } from "next/server"

import { getLlmRuntimeStatus } from "@/lib/llm-runtime"

export async function GET() {
  return NextResponse.json(getLlmRuntimeStatus())
}
