import {
  createJobDetail,
  createUploadJob,
  type ExtractionMode,
  type JobDetail,
  type JobRecord,
  type OutputFormat,
} from "@/lib/dashboard-data"

export type UploadJobsRequest = {
  files?: string[]
  mode: ExtractionMode
  output: OutputFormat
  existingCount?: number
}

export type UploadJobsResponse = {
  jobs: JobRecord[]
  details: Record<string, JobDetail>
}

export type StartJobRequest = {
  job: JobRecord
  detail?: JobDetail
}

export type StartJobResponse = {
  job: JobRecord
  detail: JobDetail
}

export type StartAllJobsRequest = {
  jobs: JobRecord[]
  details?: Record<string, JobDetail>
}

export type StartAllJobsResponse = {
  jobs: JobRecord[]
  details: Record<string, JobDetail>
}

export function buildUploadedJobs({ files, mode, output, existingCount = 0 }: UploadJobsRequest): UploadJobsResponse {
  const batchNames = files && files.length > 0 ? files : [undefined, undefined]
  const jobs = batchNames.map((name, index) =>
    createUploadJob(existingCount + index + 1, mode, output, name)
  )

  const details = Object.fromEntries(jobs.map((job) => [job.id, createJobDetail(job)]))

  return { jobs, details }
}

export function startJob({ job, detail }: StartJobRequest): StartJobResponse {
  const nextJob: JobRecord = {
    ...job,
    status: "Processing",
    progress: Math.max(job.progress, 15),
    rendered: Math.max(job.rendered, Math.min(job.pages, 2)),
  }

  const baseDetail = detail ?? createJobDetail(nextJob)

  return {
    job: nextJob,
    detail: {
      ...baseDetail,
      title: nextJob.name,
      subtitle: `${nextJob.mode} extraction with ${nextJob.output.toLowerCase()} export preset`,
      events: [`Started ${nextJob.name}`, ...baseDetail.events].slice(0, 6),
    },
  }
}

export function startAllJobs({ jobs, details = {} }: StartAllJobsRequest): StartAllJobsResponse {
  const nextJobs = jobs.map((job) => {
    if (job.status === "Uploaded" || job.status === "Queued") {
      return {
        ...job,
        status: "Processing" as const,
        progress: Math.max(job.progress, 12),
        rendered: Math.max(job.rendered, Math.min(job.pages, 2)),
      }
    }

    return job
  })

  const nextDetails = { ...details }

  for (const job of nextJobs) {
    if (job.status !== "Processing") {
      continue
    }

    const baseDetail = nextDetails[job.id] ?? createJobDetail(job)
    nextDetails[job.id] = {
      ...baseDetail,
      subtitle: `${job.mode} extraction with ${job.output.toLowerCase()} export preset`,
      pipeline: baseDetail.pipeline.map((step, index) => {
        if (index === 1) {
          return {
            ...step,
            title: "Page rendering started",
            detail: "Snapshot worker is generating images for the first pages",
            state: "active" as const,
          }
        }

        if (index === 2) {
          return {
            ...step,
            title: "Extraction queue warming up",
            detail: "Page tasks are waiting for their first OCR and vision slots",
            state: "pending" as const,
          }
        }

        return step
      }),
      events: [`Start all moved ${job.name} into processing`, ...baseDetail.events].slice(0, 6),
    }
  }

  return {
    jobs: nextJobs,
    details: nextDetails,
  }
}
