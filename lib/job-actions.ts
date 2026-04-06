import type {
  ExtractionMode,
  JobDetail,
  JobRecord,
  OutputFormat,
} from "@/lib/dashboard-data"
import {
  createUploadedJob,
  createJobs,
  getJobById,
  getJobLogsById,
  getJobOutputById,
  getJobPagesById,
  getRenderArtifactsByJobId,
  getUploadedFileByJobId,
  getJobsState,
  getWorkerDiagnosticsState,
  runPreparedJobsOnce,
  reserveNextJobId,
  retryPageById,
  retryJobById,
  shouldAutoRefreshJobPages,
  startAllStoredJobs,
  startJobById,
} from "@/lib/job-store"
import { attachPagePreviewUrl } from "@/lib/page-preview"
import { preparePdfPipeline } from "@/lib/pdf-pipeline"
import { storeUploadedPdf } from "@/lib/pdf-storage"
import type { LlmRunner } from "@/lib/llm-runtime"
import type { TesseractRunner } from "@/lib/tesseract-runtime"

export type UploadJobsRequest = {
  files?: string[]
  mode: ExtractionMode
  output: OutputFormat
}

export type UploadedJobAsset = {
  storageKey: string
  storedPath: string
  mimeType: string
  sizeBytes: number
  pageCount: number
}

export type RenderArtifact = {
  pageId: string
  position: number
  imagePath: string
}

export type UploadJobsResponse = {
  jobs: JobRecord[]
  details: Record<string, JobDetail>
  errors?: Array<{
    fileName: string
    message: string
  }>
}

export type StartJobRequest = {
  jobId: string
}

export type StartJobResponse = {
  job: JobRecord
  detail: JobDetail
}

export type StartAllJobsResponse = {
  jobs: JobRecord[]
  details: Record<string, JobDetail>
}

export type RetryJobResponse = {
  job: JobRecord
  detail: JobDetail
}

export type RetryPageRequest = {
  pageId: string
}

export type RetryPageResponse = {
  job: JobRecord
  detail: JobDetail
  retriedPage: JobDetail["pages"][number]
}

export type GetJobResponse = {
  job: JobRecord
  detail: JobDetail
  background: JobDetail["background"]
  uploadedFile?: UploadedJobAsset | null
  renderArtifacts?: RenderArtifact[]
}

export type GetJobsResponse = {
  jobs: JobRecord[]
  details: Record<string, JobDetail>
}

export type WorkerSnapshot = {
  queue: string
  worker: string
  preparedJobs: number
  activeJobs: number
  pendingPages: number
}

export type WorkerDiagnosticsResponse = {
  workers: WorkerSnapshot[]
  totals: {
    preparedJobs: number
    activeJobs: number
    pendingPages: number
  }
}

export type RunWorkersResponse = {
  processedJobs: Array<{
    job: JobRecord
    detail: JobDetail
  }>
}

export type GetJobLogsResponse = {
  jobId: string
  title: string
  events: string[]
  pipeline: JobDetail["pipeline"]
}

export type GetJobOutputResponse = {
  jobId: string
  title: string
  output: OutputFormat
  preview: JobDetail["outputPreview"]
  generatedAt: string | null
  sources?: {
    tesseractPages: Array<{
      page: string
      text: string
    }>
  }
  compareAudit?: Array<{
    page: string
    winner: "LLM" | "Tesseract" | "Tie"
    reason?: string
    scores?: {
      llm: number
      tesseract: number
    }
  }>
}

export type GetJobPagesResponse = {
  jobId: string
  title: string
  subtitle: string
  compareSummary: string
  canRetry: boolean
  pages: JobDetail["pages"]
}

export type GetJobRefreshResponse = {
  jobId: string
  shouldRefresh: boolean
}

export function buildUploadedJobs({
  files,
  mode,
  output,
}: UploadJobsRequest): UploadJobsResponse {
  return createJobs({ files, mode, output })
}

export function startJob({ jobId }: StartJobRequest): StartJobResponse | null {
  return startJobById({ jobId })
}

export function startAllJobs(): StartAllJobsResponse {
  return startAllStoredJobs()
}

export function getJobs(): GetJobsResponse {
  return getJobsState()
}

export function getWorkerDiagnostics(): WorkerDiagnosticsResponse {
  return getWorkerDiagnosticsState()
}

export async function runWorkers(options?: {
  llmRunner?: LlmRunner
  tesseractRunner?: TesseractRunner
}) {
  return runPreparedJobsOnce(options)
}

export function getJob(jobId: string): GetJobResponse | null {
  const result = getJobById(jobId)

  if (!result) {
    return null
  }

  const uploadedFile = getUploadedFileByJobId(jobId)
  const renderArtifacts = getRenderArtifactsByJobId(jobId)

  return {
    ...result,
    background: result.detail.background,
    uploadedFile: uploadedFile && {
      storageKey: uploadedFile.storageKey,
      storedPath: uploadedFile.storedPath,
      mimeType: uploadedFile.mimeType,
      sizeBytes: uploadedFile.sizeBytes,
      pageCount: uploadedFile.pageCount,
    },
    renderArtifacts: renderArtifacts.map((artifact) => ({
      pageId: artifact.pageId,
      position: artifact.position,
      imagePath: artifact.imagePath,
    })),
  }
}

export async function uploadPdfFile(
  file: File,
  mode: ExtractionMode,
  output: OutputFormat
) {
  const stored = await storeUploadedPdf(file)
  const jobId = reserveNextJobId()
  const pipeline = await preparePdfPipeline(stored, mode, output, jobId)

  return createUploadedJob({ pipeline })
}

export function getJobRenderArtifacts(jobId: string) {
  return getRenderArtifactsByJobId(jobId)
}

export function retryJob({ jobId }: StartJobRequest): RetryJobResponse | null {
  return retryJobById({ jobId })
}

export function retryPage({
  pageId,
}: RetryPageRequest): RetryPageResponse | null {
  return retryPageById({ pageId })
}

export function getJobLogs(jobId: string): GetJobLogsResponse | null {
  return getJobLogsById(jobId)
}

export function getJobOutput(jobId: string): GetJobOutputResponse | null {
  return getJobOutputById(jobId)
}

export function getJobPages(jobId: string): GetJobPagesResponse | null {
  const pages = getJobPagesById(jobId)

  if (!pages) {
    return null
  }

  return {
    ...pages,
    pages: pages.pages.map(attachPagePreviewUrl),
  }
}

export function getJobRefresh(jobId: string): GetJobRefreshResponse | null {
  const job = getJobById(jobId)

  if (!job) {
    return null
  }

  return {
    jobId,
    shouldRefresh: shouldAutoRefreshJobPages(jobId),
  }
}
