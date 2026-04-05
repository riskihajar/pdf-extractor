import { NextResponse } from "next/server"

import { retryPage } from "@/lib/job-actions"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params
  const result = retryPage({ pageId: id })

  if (!result) {
    return NextResponse.json({ message: "Page not found" }, { status: 404 })
  }

  return NextResponse.json(result)
}
