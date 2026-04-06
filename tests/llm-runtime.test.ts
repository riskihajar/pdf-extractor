import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  buildLlmPagePayload,
  dataUrlToUint8Array,
  getLlmRuntimeStatus,
  readImageDataUrl,
  runLlmPage,
} from "@/lib/llm-runtime"

test("getLlmRuntimeStatus reports missing config by default", () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY
  const previousImageInputMode = process.env.LLM_IMAGE_INPUT_MODE

  delete process.env.LLM_BASE_URL
  delete process.env.LLM_MODEL
  delete process.env.LLM_API_KEY
  delete process.env.LLM_IMAGE_INPUT_MODE

  const status = getLlmRuntimeStatus()

  assert.equal(status.status, "missing_config")
  assert.equal(status.imageInputMode, "data_url")
  assert.equal(status.apiStyle, "responses")
  assert.equal(status.stream, false)

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
  process.env.LLM_IMAGE_INPUT_MODE = previousImageInputMode
})

test("getLlmRuntimeStatus reports ready when required config exists", () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY
  const previousImageInputMode = process.env.LLM_IMAGE_INPUT_MODE
  const previousApiStyle = process.env.LLM_API_STYLE
  const previousStream = process.env.LLM_STREAM

  process.env.LLM_BASE_URL = "https://api.example.com/v1"
  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_API_KEY = "secret"
  process.env.LLM_IMAGE_INPUT_MODE = "url"
  process.env.LLM_API_STYLE = "responses"
  process.env.LLM_STREAM = "true"

  const status = getLlmRuntimeStatus()

  assert.equal(status.status, "ready")
  assert.equal(status.model, "gpt-vision")
  assert.equal(status.imageInputMode, "url")
  assert.equal(status.apiStyle, "responses")
  assert.equal(status.stream, true)
  assert.equal(status.baseUrl, "https://api.example.com:default/v1")

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
  process.env.LLM_IMAGE_INPUT_MODE = previousImageInputMode
  process.env.LLM_API_STYLE = previousApiStyle
  process.env.LLM_STREAM = previousStream
})

test("buildLlmPagePayload uses configured image input mode", () => {
  const previousModel = process.env.LLM_MODEL
  const previousReasoningEffort = process.env.LLM_REASONING_EFFORT
  const previousImageInputMode = process.env.LLM_IMAGE_INPUT_MODE
  const previousApiStyle = process.env.LLM_API_STYLE

  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_REASONING_EFFORT = "high"
  process.env.LLM_IMAGE_INPUT_MODE = "url"
  process.env.LLM_API_STYLE = "responses"

  const payload = buildLlmPagePayload({
    imageUrl: "https://example.com/page-1.png",
    prompt: "Extract the invoice fields",
  })

  assert.equal(payload.model, "gpt-vision")
  assert.equal(
    "reasoning" in payload ? payload.reasoning?.effort : undefined,
    "high"
  )
  assert.equal("stream" in payload ? payload.stream : undefined, false)
  assert.equal("inputMode" in payload, false)
  assert.equal("input" in payload, true)
  assert.equal(
    "input" in payload ? payload.input?.[0]?.content[1]?.type : undefined,
    "input_image_url"
  )

  process.env.LLM_MODEL = previousModel
  process.env.LLM_REASONING_EFFORT = previousReasoningEffort
  process.env.LLM_IMAGE_INPUT_MODE = previousImageInputMode
  process.env.LLM_API_STYLE = previousApiStyle
})

test("runLlmPage posts payload and returns output text", async () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY
  const previousImageInputMode = process.env.LLM_IMAGE_INPUT_MODE
  const previousApiStyle = process.env.LLM_API_STYLE

  process.env.LLM_BASE_URL = "https://api.example.com/v1"
  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_API_KEY = "secret"
  process.env.LLM_IMAGE_INPUT_MODE = "data_url"
  process.env.LLM_API_STYLE = "responses"
  ;(
    globalThis as unknown as { __testOpenAIProvider?: unknown }
  ).__testOpenAIProvider = () => ({
    responses: () => ({ __testModel: true }),
  })
  ;(
    globalThis as unknown as { __testGenerateText?: unknown }
  ).__testGenerateText = async (_args: unknown) => ({ text: "ok:true" })

  const result = await runLlmPage({
    imageDataUrl: "data:image/png;base64,abc123",
    prompt: "Extract this page",
  })

  assert.equal(result.text, "ok:true")
  assert.equal(result.payload.model, "gpt-vision")
  assert.equal("input" in result.payload, true)

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
  process.env.LLM_IMAGE_INPUT_MODE = previousImageInputMode
  process.env.LLM_API_STYLE = previousApiStyle
  delete (globalThis as unknown as { __testOpenAIProvider?: unknown })
    .__testOpenAIProvider
  delete (globalThis as unknown as { __testGenerateText?: unknown })
    .__testGenerateText
})

test("runLlmPage throws on non-200 response", async () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY
  const previousApiStyle = process.env.LLM_API_STYLE

  process.env.LLM_BASE_URL = "https://api.example.com/v1"
  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_API_KEY = "secret"
  process.env.LLM_API_STYLE = "responses"
  ;(
    globalThis as unknown as { __testOpenAIProvider?: unknown }
  ).__testOpenAIProvider = () => ({
    responses: () => ({ __testModel: true }),
  })
  ;(
    globalThis as unknown as { __testGenerateText?: unknown }
  ).__testGenerateText = async () => {
    throw new Error("LLM runtime request failed with status 500")
  }

  await assert.rejects(
    () =>
      runLlmPage({
        imageDataUrl: "data:image/png;base64,aGVsbG8=",
        prompt: "Extract this page",
      }),
    /LLM runtime request failed/
  )

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
  process.env.LLM_API_STYLE = previousApiStyle
  delete (globalThis as unknown as { __testOpenAIProvider?: unknown })
    .__testOpenAIProvider
  delete (globalThis as unknown as { __testGenerateText?: unknown })
    .__testGenerateText
})

test("buildLlmPagePayload supports chat completions payload shape", () => {
  const previousModel = process.env.LLM_MODEL
  const previousReasoningEffort = process.env.LLM_REASONING_EFFORT
  const previousImageInputMode = process.env.LLM_IMAGE_INPUT_MODE
  const previousApiStyle = process.env.LLM_API_STYLE

  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_REASONING_EFFORT = "high"
  process.env.LLM_IMAGE_INPUT_MODE = "data_url"
  process.env.LLM_API_STYLE = "chat_completions"

  const payload = buildLlmPagePayload({
    imageDataUrl: "data:image/png;base64,abc123",
    prompt: "Extract the invoice fields",
  })

  assert.equal(payload.model, "gpt-vision")
  assert.equal("messages" in payload, true)
  assert.equal(payload.reasoning_effort, "high")
  assert.equal(payload.messages[0]?.content[0]?.type, "text")
  assert.equal(payload.messages[0]?.content[1]?.type, "image_url")

  process.env.LLM_MODEL = previousModel
  process.env.LLM_REASONING_EFFORT = previousReasoningEffort
  process.env.LLM_IMAGE_INPUT_MODE = previousImageInputMode
  process.env.LLM_API_STYLE = previousApiStyle
})

test("dataUrlToUint8Array decodes base64 image payload", () => {
  const bytes = dataUrlToUint8Array("data:image/png;base64,aGVsbG8=")

  assert.equal(Buffer.from(bytes).toString("utf8"), "hello")
})

test("readImageDataUrl encodes PNG file to data URL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "llm-runtime-"))
  const filePath = join(dir, "page.png")

  await writeFile(filePath, Buffer.from([137, 80, 78, 71]))

  const dataUrl = await readImageDataUrl(filePath)

  assert.match(dataUrl, /^data:image\/png;base64,/)
})
