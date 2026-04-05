import { mkdir, writeFile } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import { randomUUID } from "node:crypto"

function getTestIsolationSuffix() {
  return process.env.NODE_TEST_CONTEXT ? `-${process.pid}` : ""
}

const STORAGE_ROOT =
  process.env.PDF_EXTRACTOR_STORAGE_ROOT ||
  join(process.cwd(), ".data", `storage${getTestIsolationSuffix()}`)

export type StoredUpload = {
  storageKey: string
  originalName: string
  size: number
  mimeType: string
  storedPath: string
}

function sanitizeFilename(name: string) {
  return (
    name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-") || "upload.pdf"
  )
}

export async function storeUploadedPdf(file: File): Promise<StoredUpload> {
  const originalName = file.name || "upload.pdf"
  const extension = extname(originalName).toLowerCase() || ".pdf"
  const baseName = sanitizeFilename(originalName.replace(/\.[^.]+$/, ""))
  const storageKey = `${Date.now()}-${randomUUID()}`
  const storedPath = join(
    STORAGE_ROOT,
    "uploads",
    `${storageKey}-${baseName}${extension}`
  )
  const buffer = Buffer.from(await file.arrayBuffer())

  await mkdir(dirname(storedPath), { recursive: true })
  await writeFile(storedPath, buffer)

  return {
    storageKey,
    originalName,
    size: file.size,
    mimeType: file.type || "application/pdf",
    storedPath,
  }
}

export function getStorageRoot() {
  return STORAGE_ROOT
}
