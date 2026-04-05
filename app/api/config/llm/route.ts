import { NextResponse } from "next/server"

import { getLlmRuntimeConfig, hasLlmRuntimeConfig } from "@/lib/env"

export async function GET() {
  const config = getLlmRuntimeConfig()

  return NextResponse.json({
    status: hasLlmRuntimeConfig(config) ? "ready" : "missing_config",
    baseUrl: maskBaseUrl(config.baseUrl),
    model: config.model || "not configured",
    reasoningEffort: config.reasoningEffort,
    hasApiKey: config.hasApiKey,
    hasExamplePdfPath: Boolean(config.examplePdfPath),
  })
}

function maskBaseUrl(value: string) {
  if (!value) {
    return "not configured"
  }

  try {
    const url = new URL(value)
    return `${url.protocol}//${url.hostname}:${url.port || "default"}${url.pathname}`
  } catch {
    return "configured"
  }
}
