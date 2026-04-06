import { getLlmRuntimeConfig, hasLlmRuntimeConfig } from "@/lib/env"

export type LlmRuntimeStatus = {
  status: "ready" | "missing_config"
  baseUrl: string
  model: string
  reasoningEffort: string
  hasApiKey: boolean
  hasExamplePdfPath: boolean
  imageInputMode: string
}

export type LlmPageRequest = {
  imageUrl: string
  prompt: string
}

export type LlmPageResult = {
  text: string
  payload: ReturnType<typeof buildLlmPagePayload>
}

export type LlmRunner = (request: LlmPageRequest) => Promise<LlmPageResult>

export function getLlmRuntimeStatus(): LlmRuntimeStatus {
  const config = getLlmRuntimeConfig()

  return {
    status: hasLlmRuntimeConfig(config) ? "ready" : "missing_config",
    baseUrl: maskBaseUrl(config.baseUrl),
    model: config.model || "not configured",
    reasoningEffort: config.reasoningEffort,
    hasApiKey: config.hasApiKey,
    hasExamplePdfPath: Boolean(config.examplePdfPath),
    imageInputMode: config.imageInputMode,
  }
}

export function buildLlmPagePayload(request: LlmPageRequest) {
  const config = getLlmRuntimeConfig()

  return {
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    inputMode: config.imageInputMode,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: request.prompt,
          },
          {
            type:
              config.imageInputMode === "url"
                ? "input_image_url"
                : "input_image",
            image_url: request.imageUrl,
          },
        ],
      },
    ],
  }
}

export async function runLlmPage(
  request: LlmPageRequest,
  fetchImpl: typeof fetch = fetch
): Promise<LlmPageResult> {
  const config = getLlmRuntimeConfig()
  const payload = buildLlmPagePayload(request)

  const response = await fetchImpl(config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LLM_API_KEY ?? ""}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`LLM runtime request failed with status ${response.status}`)
  }

  const result = (await response.json()) as {
    output_text?: string
    text?: string
  }

  return {
    text: result.output_text ?? result.text ?? "",
    payload,
  }
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
