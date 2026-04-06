import { NextResponse } from "next/server"

import { overrideCompareWinner } from "@/lib/job-actions"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params
  const body = (await request.json()) as {
    page?: string
    winner?: "LLM" | "Tesseract" | "auto"
  }

  if (
    !body.page ||
    (body.winner !== "LLM" &&
      body.winner !== "Tesseract" &&
      body.winner !== "auto")
  ) {
    return NextResponse.json(
      { message: "Page and winner are required" },
      { status: 400 }
    )
  }

  const result = overrideCompareWinner({
    jobId: id,
    page: body.page,
    winner: body.winner,
  })

  if (!result) {
    return NextResponse.json(
      { message: "Job or compare row not found" },
      { status: 404 }
    )
  }

  return NextResponse.json(result)
}
