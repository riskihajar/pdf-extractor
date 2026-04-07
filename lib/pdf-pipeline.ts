import { mkdir, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { spawn } from "node:child_process"

import type {
  ExtractionMode,
  JobDetail,
  JobRecord,
  OutputFormat,
  PageTask,
} from "@/lib/dashboard-data"
import type { StoredUpload } from "@/lib/pdf-storage"

const PDFTOPPM_BINARY =
  process.env.PDFTOPPM_PATH || "/opt/homebrew/bin/pdftoppm"
const STORAGE_ROOT =
  process.env.PDF_EXTRACTOR_STORAGE_ROOT ||
  join(
    process.cwd(),
    ".data",
    process.env.NODE_TEST_CONTEXT ? `storage-${process.pid}` : "storage"
  )

export type RenderedPageArtifact = {
  pageNumber: number
  pageLabel: string
  imagePath: string
}

export type UploadedPdfMetadata = {
  storageKey: string
  originalName: string
  storedPath: string
  mimeType: string
  sizeBytes: number
  pageCount: number | null
}

export type StagedUploadResult = {
  metadata: UploadedPdfMetadata
  job: JobRecord
  detail: JobDetail
}

export type PipelineResult = {
  metadata: UploadedPdfMetadata
  renderedPages: RenderedPageArtifact[]
  job: JobRecord
  detail: JobDetail
}

function buildPageNote(
  mode: ExtractionMode,
  pageNumber: number,
  totalPages: number
) {
  if (mode === "Both compare") {
    return `Rendered image ready for compare lane on page ${pageNumber} of ${totalPages}`
  }

  if (mode === "LLM only") {
    return `Rendered image ready for LLM extraction on page ${pageNumber} of ${totalPages}`
  }

  return `Rendered image ready for Tesseract extraction on page ${pageNumber} of ${totalPages}`
}

function buildOutputPreview(
  name: string,
  pages: RenderedPageArtifact[],
  output: OutputFormat
) {
  const pageLines = pages.map(
    (page) => `- ${page.pageLabel}: image artifact at ${page.imagePath}`
  )
  const markdown = `# ${name}\n\n## Render pipeline\n${pageLines.join("\n")}\n\nRendered page artifacts are ready for real OCR/extraction lanes.`
  const text = `${name}\n\nRender pipeline\n${pages
    .map((page) => `${page.pageLabel}: ${page.imagePath}`)
    .join(
      "\n"
    )}\n\nRendered page artifacts are ready for real OCR/extraction lanes.`

  return {
    markdown:
      output === "Text"
        ? `# ${name}\n\nText export selected. Rendered page artifacts are ready.`
        : markdown,
    text:
      output === "Markdown"
        ? `${name}\n\nMarkdown export selected. Rendered page artifacts are ready.`
        : text,
  }
}

async function runPdftoppm(pdfPath: string, outputPrefix: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(PDFTOPPM_BINARY, ["-png", pdfPath, outputPrefix], {
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

      reject(new Error(stderr.trim() || `pdftoppm exited with code ${code}`))
    })
  })
}

function buildPageTasks(
  mode: ExtractionMode,
  renderedPages: RenderedPageArtifact[]
): PageTask[] {
  const compareEnabled = mode === "Both compare"

  return renderedPages.map((page) => ({
    page: page.pageLabel,
    imagePath: page.imagePath,
    llm: compareEnabled || mode === "LLM only" ? "Queued" : "Ready",
    tesseract: compareEnabled || mode === "Tesseract only" ? "Queued" : "Ready",
    status: "Waiting",
    note: buildPageNote(mode, page.pageNumber, renderedPages.length),
  }))
}

export async function preparePdfPipeline(
  upload: StoredUpload,
  mode: ExtractionMode,
  output: OutputFormat,
  jobId: string
): Promise<PipelineResult> {
  const renderDir = join(STORAGE_ROOT, "renders", jobId)
  const prefix = join(renderDir, "page")

  await rm(renderDir, { recursive: true, force: true })
  await mkdir(renderDir, { recursive: true })
  await runPdftoppm(upload.storedPath, prefix)

  const renderedFiles = (await readdir(renderDir))
    .filter((name) => name.endsWith(".png"))
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    )

  const renderedPages = renderedFiles.map((filename, index) => ({
    pageNumber: index + 1,
    pageLabel: `Page ${String(index + 1).padStart(2, "0")}`,
    imagePath: join(renderDir, filename),
  }))

  const job: JobRecord = {
    id: jobId,
    name: upload.originalName,
    pages: renderedPages.length,
    mode,
    output,
    status: "Uploaded",
    progress: 0,
    rendered: 0,
    extracted: 0,
    failed: 0,
  }

  const detail: JobDetail = {
    title: upload.originalName,
    subtitle: `Stored locally and rendered into ${renderedPages.length} page image artifact${renderedPages.length === 1 ? "" : "s"}`,
    compareSummary:
      mode === "Both compare"
        ? "Real page images are ready for both extraction lanes once the job starts"
        : "Real page images are ready for the selected extraction lane once the job starts",
    background: {
      status: "prepared",
      worker: "render-worker",
      queue:
        mode === "Both compare"
          ? "extract-compare"
          : mode === "LLM only"
            ? "extract-llm"
            : "extract-ocr",
      preparedAt: new Date().toISOString(),
      summary:
        mode === "Both compare"
          ? "Render artifacts sudah dipersiapkan untuk handoff ke worker compare"
          : `Render artifacts sudah dipersiapkan untuk handoff ke worker ${mode === "LLM only" ? "vision" : "tesseract"}`,
    },
    pages: buildPageTasks(mode, renderedPages),
    events: [
      `Upload stored at ${upload.storedPath}`,
      `Render pipeline produced ${renderedPages.length} PNG artifact${renderedPages.length === 1 ? "" : "s"}`,
      `Render pipeline detected ${renderedPages.length} page${renderedPages.length === 1 ? "" : "s"}`,
    ],
    outputPreview: buildOutputPreview(
      upload.originalName,
      renderedPages,
      output
    ),
    compareRows:
      mode === "Both compare"
        ? renderedPages.map((page) => ({
            page: page.pageLabel,
            winner: "Tie" as const,
            llmSummary: "Rendered artifact queued for LLM extraction",
            tesseractSummary:
              "Rendered artifact queued for Tesseract extraction",
          }))
        : renderedPages.map((page) => ({
            page: page.pageLabel,
            winner:
              mode === "LLM only" ? ("LLM" as const) : ("Tesseract" as const),
            llmSummary:
              mode === "LLM only"
                ? "Rendered artifact queued for the active extraction lane"
                : "LLM lane not scheduled for this job",
            tesseractSummary:
              mode === "Tesseract only"
                ? "Rendered artifact queued for the active extraction lane"
                : "Tesseract lane not scheduled for this job",
          })),
    pipeline: [
      {
        title: "Upload stored",
        detail: `Binary PDF saved to local dev storage at ${upload.storedPath}`,
        state: "done",
      },
      {
        title: "Page renders ready",
        detail: `pdftoppm generated ${renderedPages.length} PNG artifact${renderedPages.length === 1 ? "" : "s"} for this job`,
        state: "done",
      },
      {
        title: "Extraction queue waiting",
        detail: "Real rendered page assets are staged and waiting for Start",
        state: "pending",
      },
      {
        title: "Output aggregation pending",
        detail:
          "Rendered asset inventory is available before OCR/LLM extraction is added",
        state: "pending",
      },
    ],
  }

  return {
    metadata: {
      storageKey: upload.storageKey,
      originalName: upload.originalName,
      storedPath: upload.storedPath,
      mimeType: upload.mimeType,
      sizeBytes: upload.size,
      pageCount: job.pages,
    },
    renderedPages,
    job,
    detail,
  }
}

export function createStagedUpload(
  upload: StoredUpload,
  mode: ExtractionMode,
  output: OutputFormat,
  jobId: string
): StagedUploadResult {
  const job: JobRecord = {
    id: jobId,
    name: upload.originalName,
    pages: 0,
    mode,
    output,
    status: "Uploaded",
    progress: 0,
    rendered: 0,
    extracted: 0,
    failed: 0,
  }

  const detail: JobDetail = {
    title: upload.originalName,
    subtitle: "PDF stored locally and waiting for render preparation",
    compareSummary:
      mode === "Both compare"
        ? "Upload selesai. Job menunggu start untuk menyiapkan render dan compare pipeline"
        : "Upload selesai. Job menunggu start untuk menyiapkan render dan extraction pipeline",
    background: {
      status: "idle",
      worker: "render-worker",
      queue: "render-pdf",
      preparedAt: null,
      summary:
        "File sudah tersimpan, tetapi render artifact belum dibuat sampai job dijalankan",
    },
    pages: [],
    events: [`Upload stored at ${upload.storedPath}`],
    outputPreview: {
      markdown: `# ${upload.originalName}\n\nUpload staged successfully. Render and extraction will start after you run the job.`,
      text: `${upload.originalName}\n\nUpload staged successfully. Render and extraction will start after you run the job.`,
    },
    compareRows: [],
    pipeline: [
      {
        title: "Upload stored",
        detail: `Binary PDF saved to local dev storage at ${upload.storedPath}`,
        state: "done",
      },
      {
        title: "Page renders pending",
        detail:
          "PNG render artifacts will be created only after Start is triggered",
        state: "pending",
      },
      {
        title: "Extraction queue waiting",
        detail:
          "OCR and LLM lanes stay idle until render preparation completes",
        state: "pending",
      },
      {
        title: "Output aggregation pending",
        detail:
          "Output preview will stay staged until render and extraction produce real page data",
        state: "pending",
      },
    ],
  }

  return {
    metadata: {
      storageKey: upload.storageKey,
      originalName: upload.originalName,
      storedPath: upload.storedPath,
      mimeType: upload.mimeType,
      sizeBytes: upload.size,
      pageCount: null,
    },
    job,
    detail,
  }
}
