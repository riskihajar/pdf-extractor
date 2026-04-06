export type LlmRuntimeConfig = {
  baseUrl: string
  model: string
  reasoningEffort: string
  hasApiKey: boolean
  examplePdfPath?: string
  imageInputMode: string
}

export type TesseractRuntimeConfig = {
  binaryPath: string
  language: string
  dataPath: string
}

export function getLlmRuntimeConfig(): LlmRuntimeConfig {
  return {
    baseUrl: process.env.LLM_BASE_URL ?? "",
    model: process.env.LLM_MODEL ?? "",
    reasoningEffort: process.env.LLM_REASONING_EFFORT ?? "medium",
    hasApiKey: Boolean(process.env.LLM_API_KEY),
    examplePdfPath: process.env.EXAMPLE_PDF_PATH_TO_EXTRACT,
    imageInputMode: process.env.LLM_IMAGE_INPUT_MODE ?? "data_url",
  }
}

export function hasLlmRuntimeConfig(config = getLlmRuntimeConfig()) {
  return Boolean(config.baseUrl && config.model && config.hasApiKey)
}

export function getTesseractRuntimeConfig(): TesseractRuntimeConfig {
  return {
    binaryPath: process.env.TESSERACT_PATH ?? "/opt/homebrew/bin/tesseract",
    language: process.env.TESSERACT_LANG ?? "eng",
    dataPath: process.env.TESSDATA_PREFIX ?? "",
  }
}
