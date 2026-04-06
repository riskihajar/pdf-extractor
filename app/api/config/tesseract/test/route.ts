import { NextResponse } from "next/server"

import { testTesseractRuntimeConnection } from "@/lib/tesseract-runtime"

export async function POST() {
  const result = await testTesseractRuntimeConnection()

  return NextResponse.json(result)
}
