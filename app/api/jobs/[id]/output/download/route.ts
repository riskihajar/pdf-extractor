import { NextResponse } from "next/server"

import type { OutputFormat } from "@/lib/dashboard-data"
import { getJobOutput } from "@/lib/job-actions"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

type DownloadFormat = "markdown" | "text"

function resolveDownloadFormat(request: Request): DownloadFormat | null {
  const { searchParams } = new URL(request.url)
  const format = searchParams.get("format")

  return format === "markdown" || format === "text" ? format : null
}

function resolvePartialMode(request: Request) {
  const { searchParams } = new URL(request.url)
  return searchParams.get("partial") === "1"
}

function supportsFormat(output: OutputFormat, format: DownloadFormat) {
  if (output === "MD + TXT") {
    return true
  }

  if (output === "Markdown") {
    return format === "markdown"
  }

  return format === "text"
}

function buildDownloadFilename(title: string, format: DownloadFormat) {
  const baseName = title.replace(/\.pdf$/i, "")

  return `${baseName}.${format === "markdown" ? "md" : "txt"}`
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params
  const format = resolveDownloadFormat(request)
  const partialMode = resolvePartialMode(request)

  if (!format) {
    return NextResponse.json(
      { message: "Download format must be markdown or text" },
      { status: 400 }
    )
  }

  const output = getJobOutput(id)

  if (!output) {
    return NextResponse.json({ message: "Job not found" }, { status: 404 })
  }

  if (!supportsFormat(output.output, format)) {
    return NextResponse.json(
      { message: "Requested format is not enabled for this job" },
      { status: 400 }
    )
  }

  let body =
    format === "markdown" ? output.preview.markdown : output.preview.text

  if (partialMode) {
    const partialNotice = [
      output.failedPages?.length
        ? `Failed pages: ${output.failedPages.join(", ")}`
        : null,
      output.missingPages?.length
        ? `Pending pages: ${output.missingPages.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n")

    if (partialNotice) {
      body =
        format === "markdown"
          ? `> Explicit partial export\n> ${partialNotice.split("\n").join("\n> ")}\n\n${body}`
          : `[EXPLICIT PARTIAL EXPORT]\n${partialNotice}\n\n${body}`
    }
  }

  return new Response(body, {
    headers: {
      "content-type":
        format === "markdown"
          ? "text/markdown; charset=utf-8"
          : "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${buildDownloadFilename(output.title, format)}"`,
    },
  })
}
