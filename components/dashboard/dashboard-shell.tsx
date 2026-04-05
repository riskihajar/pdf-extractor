"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  createJobDetail,
  detailTabs,
  heroStats,
  type DetailTab,
  type ExtractionMode,
  type JobDetail,
  type JobRecord,
  type OutputFormat,
} from "@/lib/dashboard-data"
import type {
  GetJobsResponse,
  GetJobLogsResponse,
  GetJobOutputResponse,
  GetJobPagesResponse,
  RetryJobResponse,
  RetryPageResponse,
  StartAllJobsResponse,
  StartJobResponse,
  UploadJobsResponse,
} from "@/lib/job-actions"
import { schedulePagesRefresh } from "@/lib/dashboard-refresh"
import { shouldAutoRefreshPages } from "@/lib/pages-auto-refresh"
import { cn } from "@/lib/utils"

import {
  ConfigCard,
  BackgroundLanePill,
  EnginePill,
  FilterPill,
  MiniAction,
  PipelineStep,
  StatCard,
  statusTone,
} from "./ui"

const modeLabels: ExtractionMode[] = [
  "LLM only",
  "Tesseract only",
  "Both compare",
]
const outputLabels: OutputFormat[] = ["Markdown", "Text", "MD + TXT"]
const filters = ["All jobs", "Failed pages", "Compare mode"] as const

type Filter = (typeof filters)[number]

type RuntimeStatus = {
  status: string
  baseUrl: string
  model: string
  reasoningEffort: string
  hasApiKey: boolean
  hasExamplePdfPath: boolean
}

type WorkerDiagnostics = {
  workers: Array<{
    queue: string
    worker: string
    preparedJobs: number
    activeJobs: number
    pendingPages: number
  }>
  totals: {
    preparedJobs: number
    activeJobs: number
    pendingPages: number
  }
}

type DashboardShellProps = {
  initialState: GetJobsResponse
}

type UploadIssue = {
  fileName: string
  message: string
}

type DetailTabSyncOptions = {
  forcePagesRefresh?: boolean
}

export function DashboardShell({ initialState }: DashboardShellProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [jobs, setJobs] = useState<JobRecord[]>(() => initialState.jobs)
  const [jobDetails, setJobDetails] = useState<Record<string, JobDetail>>(
    () => initialState.details
  )
  const [mode, setMode] = useState<ExtractionMode>("Both compare")
  const [output, setOutput] = useState<OutputFormat>("MD + TXT")
  const [activeFilter, setActiveFilter] = useState<Filter>("All jobs")
  const [activeJobId, setActiveJobId] = useState(
    () => initialState.jobs[0]?.id ?? ""
  )
  const [activeTab, setActiveTab] = useState<DetailTab>("Pages")
  const [pickedFiles, setPickedFiles] = useState<File[]>([])
  const [uploadIssues, setUploadIssues] = useState<UploadIssue[]>([])
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const [workerDiagnostics, setWorkerDiagnostics] =
    useState<WorkerDiagnostics | null>(null)
  const [isDetailSyncing, setIsDetailSyncing] = useState(false)

  const updateJobPages = useCallback(
    (jobId: string, pagesPayload: GetJobPagesResponse) => {
      setJobDetails((current) => {
        const targetJob = jobs.find((job) => job.id === jobId)
        const base =
          current[jobId] ?? (targetJob ? createJobDetail(targetJob) : null)

        if (!base) {
          return current
        }

        return {
          ...current,
          [jobId]: {
            ...base,
            title: pagesPayload.title,
            subtitle: pagesPayload.subtitle,
            compareSummary: pagesPayload.compareSummary,
            pages: pagesPayload.pages,
          },
        }
      })
    },
    [jobs]
  )

  const visibleJobs = useMemo(() => {
    if (activeFilter === "Failed pages") {
      return jobs.filter((job) => job.failed > 0)
    }

    if (activeFilter === "Compare mode") {
      return jobs.filter((job) => job.mode === "Both compare")
    }

    return jobs
  }, [activeFilter, jobs])

  const activeJob =
    jobs.find((job) => job.id === activeJobId) ?? visibleJobs[0] ?? jobs[0]
  const activeDetail = activeJob
    ? (jobDetails[activeJob.id] ?? createJobDetail(activeJob))
    : null
  const shouldRefreshPages =
    activeJob && activeDetail && activeTab === "Pages"
      ? shouldAutoRefreshPages(activeJob, activeDetail.pages)
      : false

  const syncDetailTab = useCallback(
    async (job: JobRecord, tab: DetailTab, options?: DetailTabSyncOptions) => {
      const forcePagesRefresh = options?.forcePagesRefresh ?? false

      if (tab !== "Logs" && tab !== "Output" && tab !== "Pages") {
        return
      }

      setIsDetailSyncing(true)

      try {
        if (tab === "Pages") {
          const response = await fetch(`/api/jobs/${job.id}/pages`, {
            cache: forcePagesRefresh ? "no-store" : "default",
          })

          if (!response.ok) {
            return
          }

          const payload = (await response.json()) as GetJobPagesResponse
          updateJobPages(job.id, payload)
          return
        }

        if (tab === "Logs") {
          const response = await fetch(`/api/jobs/${job.id}/logs`, {
            cache: "no-store",
          })

          if (!response.ok) {
            return
          }

          const payload = (await response.json()) as GetJobLogsResponse

          setJobDetails((current) => {
            const base = current[job.id] ?? createJobDetail(job)

            return {
              ...current,
              [job.id]: {
                ...base,
                title: payload.title,
                events: payload.events,
                pipeline: payload.pipeline,
              },
            }
          })
          return
        }

        const response = await fetch(`/api/jobs/${job.id}/output`, {
          cache: "no-store",
        })

        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as GetJobOutputResponse

        setJobDetails((current) => {
          const base = current[job.id] ?? createJobDetail(job)

          return {
            ...current,
            [job.id]: {
              ...base,
              title: payload.title,
              outputPreview: payload.preview,
            },
          }
        })
      } finally {
        setIsDetailSyncing(false)
      }
    },
    [updateJobPages]
  )

  useEffect(() => {
    let ignore = false

    async function loadRuntimeStatus() {
      try {
        const response = await fetch("/api/config/llm")
        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as RuntimeStatus

        if (!ignore) {
          setRuntimeStatus(payload)
        }
      } catch {
        if (!ignore) {
          setRuntimeStatus({
            status: "unreachable",
            baseUrl: "unreachable",
            model: "unreachable",
            reasoningEffort: "unknown",
            hasApiKey: false,
            hasExamplePdfPath: false,
          })
        }
      }
    }

    void loadRuntimeStatus()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function loadWorkerDiagnostics() {
      try {
        const response = await fetch("/api/workers", { cache: "no-store" })

        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as WorkerDiagnostics

        if (!ignore) {
          setWorkerDiagnostics(payload)
        }
      } catch {
        if (!ignore) {
          setWorkerDiagnostics(null)
        }
      }
    }

    void loadWorkerDiagnostics()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (!activeJob) {
      return
    }

    let ignore = false

    void syncDetailTab(activeJob, activeTab).catch(() => {
      if (!ignore) {
        setIsDetailSyncing(false)
      }
    })

    return () => {
      ignore = true
    }
  }, [activeJob, activeTab, syncDetailTab])

  useEffect(() => {
    const cleanup = schedulePagesRefresh({
      activeJob: activeJob ?? null,
      activeTab,
      isDetailSyncing,
      getPages: () => activeDetail?.pages ?? [],
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      clear: (timerId) => window.clearTimeout(timerId),
      refresh: async () => {
        if (!activeJob) {
          return null
        }

        const response = await fetch(`/api/jobs/${activeJob.id}/pages`, {
          cache: "no-store",
        })

        if (!response.ok) {
          return null
        }

        return (await response.json()) as GetJobPagesResponse
      },
      applyPages: (pages) => {
        if (!activeJob || !activeDetail) {
          return
        }

        updateJobPages(activeJob.id, {
          jobId: activeJob.id,
          title: activeDetail.title,
          subtitle: activeDetail.subtitle,
          compareSummary: activeDetail.compareSummary,
          canRetry: activeJob.canRetry ?? false,
          pages,
        })
      },
    })

    return cleanup ?? undefined
  }, [activeDetail, activeJob, activeTab, isDetailSyncing, updateJobPages])

  async function handleUploadBatch() {
    setUploadIssues([])

    const response =
      pickedFiles.length > 0
        ? await (async () => {
            const formData = new FormData()
            formData.set("mode", mode)
            formData.set("output", output)
            pickedFiles.forEach((file) => {
              formData.append("files", file)
            })

            return fetch("/api/jobs/upload", {
              method: "POST",
              body: formData,
            })
          })()
        : await fetch("/api/jobs/upload", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              files: [],
              mode,
              output,
            }),
          })

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        errors?: UploadIssue[]
      } | null

      setUploadIssues(payload?.errors ?? [])
      return
    }

    const payload = (await response.json()) as UploadJobsResponse

    setJobs((current) => [...payload.jobs, ...current])
    setJobDetails((current) => ({
      ...current,
      ...payload.details,
    }))
    setActiveJobId(payload.jobs[0]?.id ?? activeJobId)
    setActiveTab("Pages")
    setPickedFiles([])
    setUploadIssues(payload.errors ?? [])

    if (inputRef.current) {
      inputRef.current.value = ""
    }
  }

  function handleFilePick(files: FileList | null) {
    if (!files) {
      return
    }

    setUploadIssues([])
    setPickedFiles(Array.from(files))
  }

  async function handleStartAll() {
    const response = await fetch("/api/jobs/start-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    })

    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as StartAllJobsResponse
    setJobs(payload.jobs)
    setJobDetails(payload.details)
  }

  async function handleJobStart(jobId: string) {
    const selectedJob = jobs.find((item) => item.id === jobId)
    if (!selectedJob) {
      return
    }

    const response = await fetch("/api/jobs/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobId,
      }),
    })

    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as StartJobResponse
    setJobs((current) =>
      current.map((job) => (job.id === jobId ? payload.job : job))
    )
    setJobDetails((current) => ({
      ...current,
      [jobId]: payload.detail,
    }))
    setActiveJobId(jobId)
    setActiveTab("Pages")
  }

  async function handleRetry(jobId: string) {
    const response = await fetch(`/api/jobs/${jobId}/retry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    })

    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as RetryJobResponse

    setActiveJobId(jobId)
    setActiveTab("Logs")
    setJobs((current) =>
      current.map((job) => (job.id === jobId ? payload.job : job))
    )
    setJobDetails((current) => ({
      ...current,
      [jobId]: payload.detail,
    }))
  }

  async function handlePageRetry(pageId: string) {
    if (!activeJob || !activeDetail) {
      return
    }
    const targetPage = activeDetail.pages.find((page) => page.id === pageId)

    if (!targetPage || !targetPage.canRetry) {
      return
    }

    const response = await fetch(`/api/pages/${pageId}/retry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    })

    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as RetryPageResponse

    setJobs((current) =>
      current.map((job) => (job.id === activeJob.id ? payload.job : job))
    )
    setJobDetails((current) => ({
      ...current,
      [activeJob.id]: payload.detail,
    }))
    setActiveTab("Pages")
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,183,77,0.22),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(83,109,254,0.18),_transparent_28%),linear-gradient(180deg,_#17120d_0%,_#120f0b_38%,_#0d0c0b_100%)] text-stone-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/20 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="grid gap-6 border-b border-white/10 px-5 py-6 lg:grid-cols-[1.3fr_0.7fr] lg:px-8 lg:py-8">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-200/10 px-3 py-1 text-xs tracking-[0.28em] text-amber-100 uppercase">
                Pipeline cockpit
              </div>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-4xl leading-none font-semibold tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
                  Orchestrate PDF extraction like a job queue, not a blind
                  upload form.
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-stone-300 sm:text-base">
                  Upload multiple PDFs, render each page into images, then route
                  every page through vision LLM, Tesseract, or both. Watch
                  failures, retries, and exports move in real time from one
                  control surface.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  className="h-11 rounded-full bg-amber-300 px-6 text-sm font-semibold text-stone-950 hover:bg-amber-200"
                  onClick={handleStartAll}
                >
                  Start all jobs
                </Button>
                <Button
                  variant="outline"
                  className="h-11 rounded-full border-white/15 bg-white/5 px-6 text-sm text-stone-100 hover:bg-white/10"
                  onClick={() => setActiveTab("Compare")}
                >
                  Review compare mode
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              {heroStats.map((stat) => (
                <StatCard
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  detail={stat.detail}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-4 px-5 py-5 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-6">
            <section className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs tracking-[0.22em] text-stone-400 uppercase">
                    Intake
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">
                    Upload PDFs and route the extraction plan
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-stone-300">
                  {modeLabels.map((label) => (
                    <FilterPill
                      key={label}
                      label={label}
                      active={mode === label}
                      onClick={() => setMode(label)}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-[1.4rem] border border-dashed border-amber-200/30 bg-[linear-gradient(135deg,rgba(255,214,153,0.14),rgba(255,255,255,0.02))] p-5">
                  <p className="text-xs tracking-[0.24em] text-amber-100 uppercase">
                    Drop zone
                  </p>
                  <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white">
                    Pick multiple PDF files and stage them directly into the
                    queue.
                  </h3>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-stone-300">
                    Each file becomes an independent job with its binary stored
                    in local dev storage, real page renders generated up front,
                    and page-level queue visibility before extraction starts.
                  </p>
                  <input
                    ref={inputRef}
                    type="file"
                    accept="application/pdf"
                    multiple
                    className="hidden"
                    onChange={(event) => handleFilePick(event.target.files)}
                  />
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button
                      className="rounded-full bg-white px-5 text-stone-950 hover:bg-stone-100"
                      onClick={() => inputRef.current?.click()}
                    >
                      Choose files
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-full border-white/15 bg-white/5 text-stone-100 hover:bg-white/10"
                      onClick={handleUploadBatch}
                    >
                      Stage upload batch
                    </Button>
                  </div>
                  <div className="mt-4 rounded-[1.1rem] border border-white/10 bg-black/15 p-3">
                    <p className="text-[11px] tracking-[0.2em] text-stone-500 uppercase">
                      Files selected
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pickedFiles.length > 0 ? (
                        pickedFiles.map((file) => (
                          <FilterPill
                            key={file.name}
                            label={file.name}
                            active
                          />
                        ))
                      ) : (
                        <span className="text-xs text-stone-400">
                          No local files selected yet. Choose PDFs to upload
                          into local dev storage.
                        </span>
                      )}
                    </div>
                  </div>
                  {uploadIssues.length > 0 ? (
                    <div className="mt-3 rounded-[1.1rem] border border-rose-300/20 bg-rose-400/10 p-3">
                      <p className="text-[11px] tracking-[0.2em] text-rose-100 uppercase">
                        Upload validation
                      </p>
                      <div className="mt-2 space-y-1">
                        {uploadIssues.map((issue) => (
                          <p
                            key={`${issue.fileName}-${issue.message}`}
                            className="text-xs text-rose-100/90"
                          >
                            {issue.fileName}: {issue.message}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-black/15 p-4 sm:grid-cols-2">
                  <ConfigCard
                    label="Extraction mode"
                    value={mode}
                    hint="Choose one engine or compare both results"
                  />
                  <ConfigCard
                    label="Output"
                    value={output}
                    hint="Keep markdown and plain text exports together"
                  />
                  <ConfigCard
                    label="Render engine"
                    value="Worker snapshots"
                    hint="PDF pages rasterized before OCR or vision calls"
                  />
                  <ConfigCard
                    label="LLM runtime"
                    value={
                      runtimeStatus?.status === "ready"
                        ? "Ready"
                        : runtimeStatus?.status === "unreachable"
                          ? "Offline"
                          : "Needs config"
                    }
                    hint={`${runtimeStatus?.model ?? "Loading model"} · ${runtimeStatus?.baseUrl ?? "Loading endpoint"}`}
                  />
                  <div className="rounded-[1.1rem] border border-white/10 bg-white/5 p-3">
                    <p className="text-[11px] tracking-[0.2em] text-stone-500 uppercase">
                      Output preset
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {outputLabels.map((label) => (
                        <FilterPill
                          key={label}
                          label={label}
                          active={output === label}
                          onClick={() => setOutput(label)}
                        />
                      ))}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-stone-400">
                      Tune export format before new files enter the queue.
                    </p>
                    <p className="mt-3 text-xs leading-5 text-stone-500">
                      API key:{" "}
                      {runtimeStatus?.hasApiKey ? "detected" : "missing"} ·
                      Example PDF path:{" "}
                      {runtimeStatus?.hasExamplePdfPath
                        ? "available"
                        : "not set"}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <p className="text-xs tracking-[0.24em] text-stone-400 uppercase">
                    Current focus
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    {activeDetail?.title ?? "No active file selected"}
                  </h2>
                  <p className="mt-1 text-sm text-stone-400">
                    {activeDetail?.subtitle}
                  </p>
                </div>
                <span
                  className={cn(
                    statusTone(activeJob?.status ?? "Queued"),
                    "rounded-full border px-3 py-1 text-xs"
                  )}
                >
                  {activeJob?.status ?? "Idle"}
                </span>
              </div>
              <div className="mt-4 space-y-4">
                {activeDetail?.background ? (
                  <div className="rounded-[1.25rem] border border-cyan-400/15 bg-cyan-400/5 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] tracking-[0.22em] text-cyan-200/75 uppercase">
                          Background handoff
                        </p>
                        <p className="mt-2 text-sm text-stone-200">
                          {activeDetail.background.summary}
                        </p>
                      </div>
                      <BackgroundLanePill
                        queue={activeDetail.background.queue}
                        worker={activeDetail.background.worker}
                        status={activeDetail.background.status}
                      />
                    </div>
                    <p className="mt-3 text-xs text-stone-400">
                      Prepared at{" "}
                      {activeDetail.background.preparedAt ?? "not yet prepared"}
                    </p>
                  </div>
                ) : null}
                {activeDetail?.pipeline.map((step) => (
                  <PipelineStep
                    key={step.title}
                    title={step.title}
                    detail={step.detail}
                    state={step.state}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <p className="text-xs tracking-[0.24em] text-stone-400 uppercase">
                    Worker lanes
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    Background queue diagnostics
                  </h2>
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-stone-300">
                  {workerDiagnostics?.totals.preparedJobs ?? 0} prepared
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {workerDiagnostics?.workers.map((lane) => (
                  <div
                    key={`${lane.queue}:${lane.worker}`}
                    className="rounded-[1.2rem] border border-white/10 bg-black/10 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <BackgroundLanePill
                        queue={lane.queue}
                        worker={lane.worker}
                        status={lane.preparedJobs > 0 ? "prepared" : "idle"}
                      />
                      <span className="text-xs text-stone-400">
                        {lane.pendingPages} pending pages
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-stone-400">
                      Prepared jobs {lane.preparedJobs} · Active jobs{" "}
                      {lane.activeJobs}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <section className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-5">
            <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs tracking-[0.22em] text-stone-400 uppercase">
                  Queue board
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">
                  File jobs ready for start, retry, or export
                </h2>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-stone-300">
                {filters.map((filter) => (
                  <FilterPill
                    key={filter}
                    label={filter}
                    active={activeFilter === filter}
                    onClick={() => setActiveFilter(filter)}
                  />
                ))}
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[1.5rem] border border-white/8">
              <div className="hidden grid-cols-[2.1fr_0.8fr_1fr_0.9fr_1.2fr_1fr] gap-3 bg-white/8 px-4 py-3 text-[11px] tracking-[0.2em] text-stone-400 uppercase md:grid">
                <span>File</span>
                <span>Pages</span>
                <span>Mode</span>
                <span>Status</span>
                <span>Progress</span>
                <span>Actions</span>
              </div>
              <div className="divide-y divide-white/8">
                {visibleJobs.map((job) => (
                  <article
                    key={job.id}
                    className={cn(
                      "grid gap-4 bg-black/10 px-4 py-4 transition md:grid-cols-[2.1fr_0.8fr_1fr_0.9fr_1.2fr_1fr] md:items-center",
                      activeJob?.id === job.id && "bg-white/10"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveJobId(job.id)
                        setActiveTab("Pages")
                      }}
                      className="space-y-2 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-white">
                          {job.name}
                        </h3>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] tracking-[0.2em] text-stone-300 uppercase">
                          {job.output}
                        </span>
                      </div>
                      <p className="text-xs text-stone-400">
                        Rendered {job.rendered} / {job.pages} · Extracted{" "}
                        {job.extracted} / {job.pages} · Failed {job.failed}
                      </p>
                      <p className="text-[11px] text-stone-500">
                        Background {job.backgroundReady ? "prepared" : "idle"}
                      </p>
                    </button>
                    <div className="text-sm text-stone-200">{job.pages}</div>
                    <div className="text-sm text-stone-200">{job.mode}</div>
                    <div>
                      <span
                        className={cn(
                          statusTone(job.status),
                          "inline-flex rounded-full border px-2.5 py-1 text-xs"
                        )}
                      >
                        {job.status}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-sky-300"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-stone-400">
                        {job.progress}% complete
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <MiniAction
                        label="Start"
                        onClick={() => void handleJobStart(job.id)}
                      />
                      <MiniAction
                        label="View"
                        subtle
                        onClick={() => {
                          setActiveJobId(job.id)
                          setActiveTab("Pages")
                        }}
                      />
                      <MiniAction
                        label="Retry"
                        subtle
                        disabled={!job.canRetry}
                        onClick={() => void handleRetry(job.id)}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <div className="grid gap-6">
            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-5">
              <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs tracking-[0.22em] text-stone-400 uppercase">
                    Job detail
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">
                    {activeDetail?.title ?? "Per-file detail view"}
                  </h2>
                  <p className="mt-1 text-sm text-stone-400">
                    {activeDetail?.compareSummary}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="rounded-full border-white/15 bg-white/5 text-stone-100 hover:bg-white/10"
                  onClick={() => setActiveTab("Logs")}
                >
                  Open logs
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-b border-white/10 pb-4">
                {detailTabs.map((tab) => (
                  <FilterPill
                    key={tab}
                    label={tab}
                    active={activeTab === tab}
                    onClick={() => setActiveTab(tab)}
                  />
                ))}
              </div>

              <div className="mt-4">
                {activeTab === "Pages" && (
                  <div className="space-y-3">
                    {activeDetail?.pages.map((task) => (
                      <article
                        key={task.page}
                        className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-medium text-white">
                              {task.page}
                            </h3>
                            <p className="mt-1 text-xs text-stone-400">
                              {task.note}
                            </p>
                            {task.imagePath ? (
                              <p className="mt-1 text-[11px] break-all text-stone-500">
                                Render artifact: {task.imagePath}
                              </p>
                            ) : null}
                          </div>
                          <span
                            className={cn(
                              statusTone(task.status),
                              "inline-flex rounded-full border px-2.5 py-1 text-xs"
                            )}
                          >
                            {task.status}
                          </span>
                        </div>
                        {task.previewUrl ? (
                          <div className="mt-4 overflow-hidden rounded-[1.15rem] border border-white/10 bg-stone-950/70">
                            <div className="border-b border-white/10 px-3 py-2">
                              <p className="text-[11px] tracking-[0.22em] text-stone-500 uppercase">
                                Render preview
                              </p>
                            </div>
                            <div className="bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.16),_transparent_48%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))] p-3">
                              <img
                                src={task.previewUrl}
                                alt={`${task.page} rendered preview`}
                                className="h-auto w-full rounded-[0.9rem] border border-white/10 bg-white object-contain shadow-[0_18px_45px_rgba(0,0,0,0.35)]"
                                loading="lazy"
                              />
                            </div>
                          </div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          <EnginePill name="LLM" state={task.llm} />
                          <EnginePill name="Tesseract" state={task.tesseract} />
                          {task.id && task.canRetry ? (
                            <MiniAction
                              label="Retry page"
                              subtle
                              onClick={() => void handlePageRetry(task.id!)}
                            />
                          ) : null}
                        </div>
                      </article>
                    ))}
                    {shouldRefreshPages && !isDetailSyncing ? (
                      <p className="text-[11px] tracking-[0.18em] text-stone-500 uppercase">
                        Auto-refresh aktif ringan selama job masih queued atau
                        processing
                      </p>
                    ) : null}
                  </div>
                )}

                {activeTab === "Compare" && (
                  <div className="space-y-3">
                    {activeDetail?.compareRows.map((row) => (
                      <article
                        key={row.page}
                        className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-sm font-medium text-white">
                            {row.page}
                          </h3>
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200">
                            Winner: {row.winner}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-3">
                            <p className="text-[11px] tracking-[0.2em] text-stone-500 uppercase">
                              LLM
                            </p>
                            <p className="mt-2 text-sm leading-6 text-stone-200">
                              {row.llmSummary}
                            </p>
                          </div>
                          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-3">
                            <p className="text-[11px] tracking-[0.2em] text-stone-500 uppercase">
                              Tesseract
                            </p>
                            <p className="mt-2 text-sm leading-6 text-stone-200">
                              {row.tesseractSummary}
                            </p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                {activeTab === "Output" && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <article className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
                      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                        <h3 className="text-sm font-medium text-white">
                          Markdown output
                        </h3>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] tracking-[0.2em] text-stone-300 uppercase">
                          .md
                        </span>
                      </div>
                      <pre className="mt-4 overflow-x-auto font-mono text-xs leading-6 whitespace-pre-wrap text-stone-300">
                        {activeDetail?.outputPreview.markdown}
                      </pre>
                      {isDetailSyncing && (
                        <p className="mt-3 text-[11px] tracking-[0.18em] text-stone-500 uppercase">
                          Syncing backend output...
                        </p>
                      )}
                    </article>
                    <article className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
                      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                        <h3 className="text-sm font-medium text-white">
                          Text output
                        </h3>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] tracking-[0.2em] text-stone-300 uppercase">
                          .txt
                        </span>
                      </div>
                      <pre className="mt-4 overflow-x-auto font-mono text-xs leading-6 whitespace-pre-wrap text-stone-300">
                        {activeDetail?.outputPreview.text}
                      </pre>
                    </article>
                  </div>
                )}

                {activeTab === "Logs" && (
                  <div className="space-y-3 font-mono text-xs text-stone-300">
                    {isDetailSyncing && (
                      <div className="rounded-[1.2rem] border border-amber-300/20 bg-amber-200/5 px-3 py-3 text-[11px] tracking-[0.18em] text-amber-100 uppercase">
                        Syncing backend logs...
                      </div>
                    )}
                    {activeDetail?.events.map((event) => (
                      <div
                        key={event}
                        className="rounded-[1.2rem] border border-white/10 bg-black/15 px-3 py-3"
                      >
                        {event}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  )
}
