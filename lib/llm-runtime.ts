import { readFile } from "node:fs/promises"

import { createOpenAI } from "@ai-sdk/openai"
import { generateText } from "ai"

import { getLlmRuntimeConfig, hasLlmRuntimeConfig } from "@/lib/env"

export type LlmRuntimeStatus = {
  status: "ready" | "missing_config"
  baseUrl: string
  apiStyle: string
  model: string
  reasoningEffort: string
  hasApiKey: boolean
  hasExamplePdfPath: boolean
  imageInputMode: string
  stream?: boolean
}

export type LlmPageRequest = {
  imageUrl?: string
  imageDataUrl?: string
  prompt: string
}

export type LlmPageResult = {
  text: string
  payload: Record<string, unknown>
}

export type LlmConnectionTestResult = {
  status: "ok" | "error" | "missing_config"
  message: string
  endpoint: string
  checkedAt: string
  latencyMs: number
  httpStatus?: number
  detail?: string
}

type ParsedLlmResponse = {
  text?: string
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export type LlmRunner = (request: LlmPageRequest) => Promise<LlmPageResult>

export function getLlmRuntimeStatus(): LlmRuntimeStatus {
  const config = getLlmRuntimeConfig()

  return {
    status: hasLlmRuntimeConfig(config) ? "ready" : "missing_config",
    baseUrl: maskBaseUrl(config.baseUrl),
    apiStyle: config.apiStyle,
    model: config.model || "not configured",
    reasoningEffort: config.reasoningEffort,
    hasApiKey: config.hasApiKey,
    hasExamplePdfPath: Boolean(config.examplePdfPath),
    imageInputMode: config.imageInputMode,
    stream: config.stream,
  }
}

export function buildLlmPagePayload(request: LlmPageRequest) {
  const config = getLlmRuntimeConfig()

  if (config.apiStyle === "chat_completions") {
    return {
      model: config.model,
      reasoning_effort: config.reasoningEffort,
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text",
              text: request.prompt,
            },
            {
              type: "image_url",
              image_url: {
                url:
                  config.imageInputMode === "url"
                    ? request.imageUrl
                    : request.imageDataUrl,
              },
            },
          ],
        },
      ],
    }
  }

  return {
    model: config.model,
    stream: false,
    reasoning: {
      effort: config.reasoningEffort,
    },
    input: [
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
            image_url:
              config.imageInputMode === "url"
                ? request.imageUrl
                : request.imageDataUrl,
          },
        ],
      },
    ],
  }
}

export async function testLlmRuntimeConnection(): Promise<LlmConnectionTestResult> {
  const config = getLlmRuntimeConfig()
  const checkedAt = new Date().toISOString()

  if (!hasLlmRuntimeConfig(config)) {
    return {
      status: "missing_config",
      message: "LLM runtime belum lengkap. Isi base URL, model, dan API key.",
      endpoint: maskBaseUrl(config.baseUrl),
      checkedAt,
      latencyMs: 0,
    }
  }

  const endpoint = buildLlmConnectionEndpoint(config.baseUrl, config.apiStyle)
  const payload =
    config.apiStyle === "chat_completions"
      ? {
          model: config.model,
          stream: false,
          max_tokens: 1,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Connection test: reply with OK.",
                },
              ],
            },
          ],
        }
      : {
          model: config.model,
          stream: false,
          max_output_tokens: 1,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "Connection test: reply with OK.",
                },
              ],
            },
          ],
        }
  const startedAt = Date.now()

  try {
    const response = await getRuntimeFetch()(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY ?? ""}`,
      },
      body: JSON.stringify(payload),
    })
    const latencyMs = Date.now() - startedAt

    if (!response.ok) {
      const errorText = (await response.text()).trim()

      return {
        status: "error",
        message: `LLM endpoint merespons status ${response.status}`,
        endpoint: maskBaseUrl(endpoint),
        checkedAt,
        latencyMs,
        httpStatus: response.status,
        detail: errorText.slice(0, 240) || "empty response body",
      }
    }

    return {
      status: "ok",
      message: "LLM runtime reachable dan menerima request test.",
      endpoint: maskBaseUrl(endpoint),
      checkedAt,
      latencyMs,
      httpStatus: response.status,
    }
  } catch (error) {
    return {
      status: "error",
      message: "Gagal menghubungi endpoint LLM.",
      endpoint: maskBaseUrl(endpoint),
      checkedAt,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function runLlmPage(
  request: LlmPageRequest
): Promise<LlmPageResult> {
  const config = getLlmRuntimeConfig()
  const payload = buildLlmPagePayload(request)
  const testGenerateText = (
    globalThis as unknown as {
      __testGenerateText?: typeof generateText
    }
  ).__testGenerateText
  const testOpenAIProvider = (
    globalThis as unknown as {
      __testOpenAIProvider?: typeof createOpenAI
    }
  ).__testOpenAIProvider
  if (config.apiStyle === "chat_completions") {
    const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`
    const chatPayload = {
      model: config.model,
      reasoning_effort: config.reasoningEffort,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: request.prompt,
            },
            {
              type: "image_url",
              image_url: {
                url:
                  config.imageInputMode === "url"
                    ? request.imageUrl
                    : request.imageDataUrl,
              },
            },
          ],
        },
      ],
      stream: config.stream,
    }

    const response = await getRuntimeFetch()(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY ?? ""}`,
      },
      body: JSON.stringify(chatPayload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `LLM runtime request failed with status ${response.status}: ${errorText}`
      )
    }

    const contentType = response.headers.get("content-type") || ""

    if (contentType.includes("text/event-stream") || config.stream) {
      return {
        text: await parseChatCompletionsSse(response),
        payload: chatPayload,
      }
    }

    const result = (await response.json()) as ParsedLlmResponse

    return {
      text: result.choices?.[0]?.message?.content ?? result.text ?? "",
      payload: chatPayload,
    }
  }

  const providerFactory = testOpenAIProvider ?? createOpenAI
  const provider = providerFactory({
    baseURL: config.baseUrl,
    apiKey: process.env.LLM_API_KEY,
  })

  const runText = testGenerateText ?? generateText
  const result = await runText({
    model: provider.responses(config.model),
    providerOptions: {
      openai: {
        reasoningEffort: config.reasoningEffort,
      },
    },
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: request.prompt,
          },
          {
            type: "image" as const,
            image:
              config.imageInputMode === "url"
                ? new URL(request.imageUrl ?? "http://localhost/invalid")
                : dataUrlToUint8Array(request.imageDataUrl ?? ""),
          },
        ],
      },
    ],
  })

  return {
    text: result.text,
    payload,
  }
}

function buildLlmConnectionEndpoint(baseUrl: string, apiStyle: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "")

  if (apiStyle === "chat_completions") {
    if (normalizedBase.endsWith("/chat/completions")) {
      return normalizedBase
    }

    if (normalizedBase.endsWith("/responses")) {
      return `${normalizedBase.slice(0, -"/responses".length)}/chat/completions`
    }

    return `${normalizedBase}/chat/completions`
  }

  if (normalizedBase.endsWith("/responses")) {
    return normalizedBase
  }

  if (normalizedBase.endsWith("/chat/completions")) {
    return `${normalizedBase.slice(0, -"/chat/completions".length)}/responses`
  }

  return `${normalizedBase}/responses`
}

function getRuntimeFetch() {
  const testFetch = (
    globalThis as unknown as {
      __testFetch?: typeof fetch
    }
  ).__testFetch

  return testFetch ?? fetch
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

export function dataUrlToUint8Array(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)

  if (!match) {
    throw new Error("Invalid data URL image payload")
  }

  return Uint8Array.from(Buffer.from(match[2], "base64"))
}

export async function readImageDataUrl(imagePath: string) {
  const bytes = await readFile(imagePath)
  return `data:image/png;base64,${bytes.toString("base64")}`
}

async function parseChatCompletionsSse(response: Response) {
  const raw = await response.text()

  return raw
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice(6))
    .filter((chunk) => chunk !== "[DONE]")
    .map((chunk) => {
      try {
        return JSON.parse(chunk) as {
          choices?: Array<{
            delta?: {
              content?: string
            }
          }>
        }
      } catch {
        return null
      }
    })
    .filter(
      (
        item
      ): item is {
        choices?: Array<{
          delta?: {
            content?: string
          }
        }>
      } => item !== null
    )
    .map((item) => item.choices?.[0]?.delta?.content ?? "")
    .join("")
}
