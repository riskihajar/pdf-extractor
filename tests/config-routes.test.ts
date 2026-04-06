import assert from "node:assert/strict"
import { chmod, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { POST as testLlmRuntimeRoute } from "@/app/api/config/llm/test/route"
import { POST as testTesseractRuntimeRoute } from "@/app/api/config/tesseract/test/route"

test("POST /api/config/llm/test reports missing config", async () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY

  delete process.env.LLM_BASE_URL
  delete process.env.LLM_MODEL
  delete process.env.LLM_API_KEY

  const response = await testLlmRuntimeRoute()
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.status, "missing_config")

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
})

test("POST /api/config/llm/test returns runtime probe result", async () => {
  const previousBaseUrl = process.env.LLM_BASE_URL
  const previousModel = process.env.LLM_MODEL
  const previousApiKey = process.env.LLM_API_KEY
  const previousApiStyle = process.env.LLM_API_STYLE

  process.env.LLM_BASE_URL = "https://api.example.com/v1/responses"
  process.env.LLM_MODEL = "gpt-vision"
  process.env.LLM_API_KEY = "secret"
  process.env.LLM_API_STYLE = "responses"
  ;(globalThis as unknown as { __testFetch?: typeof fetch }).__testFetch =
    async () =>
      new Response(JSON.stringify({ id: "resp_1" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })

  const response = await testLlmRuntimeRoute()
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.status, "ok")
  assert.equal(payload.httpStatus, 200)

  process.env.LLM_BASE_URL = previousBaseUrl
  process.env.LLM_MODEL = previousModel
  process.env.LLM_API_KEY = previousApiKey
  process.env.LLM_API_STYLE = previousApiStyle
  delete (globalThis as unknown as { __testFetch?: typeof fetch }).__testFetch
})

test("POST /api/config/tesseract/test returns executable probe result", async () => {
  const previousPath = process.env.TESSERACT_PATH
  const previousLang = process.env.TESSERACT_LANG
  const tempDir = await mkdtemp(join(tmpdir(), "tesseract-config-route-"))
  const binaryPath = join(tempDir, "tesseract")

  await writeFile(binaryPath, "#!/bin/sh\nprintf 'tesseract 5.3.0\\n'\n")
  await chmod(binaryPath, 0o755)
  process.env.TESSERACT_PATH = binaryPath
  process.env.TESSERACT_LANG = "eng"

  const response = await testTesseractRuntimeRoute()
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.status, "ok")
  assert.match(payload.version ?? "", /tesseract 5\.3\.0/)

  process.env.TESSERACT_PATH = previousPath
  process.env.TESSERACT_LANG = previousLang
})
