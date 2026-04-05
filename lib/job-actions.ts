import type {
  ExtractionMode,
  JobDetail,
  JobRecord,
  OutputFormat,
} from "@/lib/dashboard-data"
import {
  createJobs,
  getJobById,
  getJobLogsById,
  getJobOutputById,
  getJobPagesById,
  getJobsState,
  retryPageById,
  retryJobById,
  shouldAutoRefreshJobPages,
  startAllStoredJobs,
  startJobById,
} from "@/lib/job-store"

export type UploadJobsRequest = {
  files?: string[]
  mode: ExtractionMode
  output: OutputFormat
}

export type UploadJobsResponse = {
  jobs: JobRecord[]
  details: Record<string, JobDetail>
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
}

export type GetJobsResponse = {
  jobs: JobRecord[]
  details: Record<string, JobDetail>
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

export function getJob(jobId: string): GetJobResponse | null {
  return getJobById(jobId)
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
  return getJobPagesById(jobId)
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
