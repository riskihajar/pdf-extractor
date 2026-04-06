import { NextResponse } from "next/server"

import { getTesseractRuntimeStatus } from "@/lib/tesseract-runtime"

export async function GET() {
  const runtime = await getTesseractRuntimeStatus()

  return NextResponse.json(runtime)
}
