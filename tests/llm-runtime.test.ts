import assert from "node:assert/strict"
import test from "node:test"

import {
  buildLlmPagePayload,
  getLlmRuntimeStatus,
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

  process.env.LLM_BASE_URL = "https://api.example.com/v1"
  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_API_KEY = "secret"
  process.env.LLM_IMAGE_INPUT_MODE = "url"

  const status = getLlmRuntimeStatus()

  assert.equal(status.status, "ready")
  assert.equal(status.model, "gpt-vision")
  assert.equal(status.imageInputMode, "url")
  assert.equal(status.baseUrl, "https://api.example.com:default/v1")

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
  process.env.LLM_IMAGE_INPUT_MODE = previousImageInputMode
})

test("buildLlmPagePayload uses configured image input mode", () => {
  const previousModel = process.env.LLM_MODEL
  const previousReasoningEffort = process.env.LLM_REASONING_EFFORT
  const previousImageInputMode = process.env.LLM_IMAGE_INPUT_MODE

  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_REASONING_EFFORT = "high"
  process.env.LLM_IMAGE_INPUT_MODE = "url"

  const payload = buildLlmPagePayload({
    imageUrl: "https://example.com/page-1.png",
    prompt: "Extract the invoice fields",
  })

  assert.equal(payload.model, "gpt-vision")
  assert.equal(payload.reasoningEffort, "high")
  assert.equal(payload.inputMode, "url")
  assert.equal(payload.messages[0]?.content[1]?.type, "input_image_url")

  process.env.LLM_MODEL = previousModel
  process.env.LLM_REASONING_EFFORT = previousReasoningEffort
  process.env.LLM_IMAGE_INPUT_MODE = previousImageInputMode
})

test("runLlmPage posts payload and returns output text", async () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY

  process.env.LLM_BASE_URL = "https://api.example.com/v1/responses"
  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_API_KEY = "secret"

  const result = await runLlmPage(
    {
      imageUrl: "https://example.com/page-1.png",
      prompt: "Extract this page",
    },
    async (_url, init) =>
      new Response(
        JSON.stringify({
          output_text: `ok:${String(init?.body).includes("page-1.png")}`,
        }),
        { status: 200 }
      )
  )

  assert.equal(result.text, "ok:true")
  assert.equal(result.payload.model, "gpt-vision")

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
})

test("runLlmPage throws on non-200 response", async () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY

  process.env.LLM_BASE_URL = "https://api.example.com/v1/responses"
  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_API_KEY = "secret"

  await assert.rejects(
    () =>
      runLlmPage(
        {
          imageUrl: "https://example.com/page-1.png",
          prompt: "Extract this page",
        },
        async () => new Response("boom", { status: 500 })
      ),
    /LLM runtime request failed/
  )

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
})
