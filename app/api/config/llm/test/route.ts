import { NextResponse } from "next/server"

import { testLlmRuntimeConnection } from "@/lib/llm-runtime"

export async function POST() {
  const result = await testLlmRuntimeConnection()

  return NextResponse.json(result)
}
