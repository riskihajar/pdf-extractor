import { access } from "node:fs/promises"

import {
  getTesseractRuntimeConfig,
  type TesseractRuntimeConfig,
} from "@/lib/env"

export type TesseractRuntimeStatus = {
  status: "ready" | "missing_binary"
  binaryPath: string
  language: string
  hasDataPath: boolean
}

export async function getTesseractRuntimeStatus(
  config: TesseractRuntimeConfig = getTesseractRuntimeConfig()
): Promise<TesseractRuntimeStatus> {
  const hasBinary = await hasExecutable(config.binaryPath)

  return {
    status: hasBinary ? "ready" : "missing_binary",
    binaryPath: config.binaryPath,
    language: config.language,
    hasDataPath: Boolean(config.dataPath),
  }
}

export function buildTesseractCommand(
  imagePath: string,
  outputBasePath: string,
  config: TesseractRuntimeConfig = getTesseractRuntimeConfig()
) {
  const args = [imagePath, outputBasePath, "-l", config.language]

  if (config.dataPath) {
    args.push("--tessdata-dir", config.dataPath)
  }

  return {
    command: config.binaryPath,
    args,
  }
}

async function hasExecutable(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
