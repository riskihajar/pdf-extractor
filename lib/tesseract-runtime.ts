import { spawn } from "node:child_process"
import { access, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

export type TesseractPageResult = {
  text: string
  command: string
  args: string[]
}

export type TesseractRunner = (
  imagePath: string,
  config?: TesseractRuntimeConfig
) => Promise<TesseractPageResult>

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

export async function runTesseractPage(
  imagePath: string,
  config: TesseractRuntimeConfig = getTesseractRuntimeConfig()
): Promise<TesseractPageResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "pdf-extractor-tesseract-"))
  const outputBasePath = join(tempDir, "page")
  const { command, args } = buildTesseractCommand(
    imagePath,
    outputBasePath,
    config
  )

  try {
    await runTesseractCommand(command, args)
    const text = await readFile(`${outputBasePath}.txt`, "utf8")

    return {
      text: text.trim(),
      command,
      args,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function runTesseractCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr.trim() || `tesseract exited with code ${code}`))
    })
  })
}

async function hasExecutable(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
