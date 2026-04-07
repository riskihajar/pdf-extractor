"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  createJobDetail,
  type DetailTab,
  type ExtractionMode,
  type JobDetail,
  type JobRecord,
  type OutputFormat,
} from "@/lib/dashboard-data"
import { schedulePagesRefresh } from "@/lib/dashboard-refresh"
import type {
  GetJobLogsResponse,
  GetJobOutputResponse,
  GetJobPagesResponse,
  GetJobsResponse,
  OverrideCompareWinnerResponse,
  RetryJobResponse,
  RetryPageResponse,
  StartAllJobsResponse,
  StartJobResponse,
  UploadJobsResponse,
} from "@/lib/job-actions"
import { shouldAutoRefreshPages } from "@/lib/pages-auto-refresh"
import { cn } from "@/lib/utils"

import { ActionBar, type UploadIssue } from "./action-bar"
import { AppHeader } from "./app-header"
import { DocumentDetailPanel, type OutputSourceSnapshot } from "./document-detail-panel"
import { DocumentList } from "./document-list"

/* ── Types ──────────────────────────────────────────────────────── */

type LlmRuntimeStatus = {
  status: string
  baseUrl: string
  model: string
  reasoningEffort: string
  hasApiKey: boolean
  hasExamplePdfPath: boolean
}

type TesseractRuntimeStatus = {
  status: string
  binaryPath: string
  language: string
  hasDataPath: boolean
}

type UiNotice = {
  tone: "success" | "error"
  title: string
  message: string
}

type DashboardProps = {
  initialState: GetJobsResponse
}

/* ── Filters ────────────────────────────────────────────────────── */

function applyFilter(jobs: JobRecord[], filter: string): JobRecord[] {
  if (filter === "Failed pages") return jobs.filter((j) => j.failed > 0)
  if (filter === "Compare mode")
    return jobs.filter((j) => j.mode === "Both compare")
  return jobs
}

/* ── Component ──────────────────────────────────────────────────── */

export function Dashboard({ initialState }: DashboardProps) {
  /* refs */
  const inputRef = useRef<HTMLInputElement>(null)

  /* core state */
  const [jobs, setJobs] = useState<JobRecord[]>(() => initialState.jobs)
  const [jobDetails, setJobDetails] = useState<Record<string, JobDetail>>(
    () => initialState.details
  )
  const [mode, setMode] = useState<ExtractionMode>("Both compare")
  const [output, setOutput] = useState<OutputFormat>("MD + TXT")
  const [activeFilter, setActiveFilter] = useState("All")
  const [activeJobId, setActiveJobId] = useState(
    () => initialState.jobs[0]?.id ?? ""
  )
  const [activeTab, setActiveTab] = useState<DetailTab>("Pages")

  /* upload state */
  const [pickedFiles, setPickedFiles] = useState<File[]>([])
  const [isUploadingBatch, setIsUploadingBatch] = useState(false)
  const [uploadIssues, setUploadIssues] = useState<UploadIssue[]>([])
  const [uiNotice, setUiNotice] = useState<UiNotice | null>(null)

  /* runtime state */
  const [llmRuntimeStatus, setLlmRuntimeStatus] =
    useState<LlmRuntimeStatus | null>(null)
  const [tesseractRuntimeStatus, setTesseractRuntimeStatus] =
    useState<TesseractRuntimeStatus | null>(null)

  /* detail panel state */
  const [outputSources, setOutputSources] = useState<
    Record<string, OutputSourceSnapshot>
  >({})
  const [isDetailSyncing, setIsDetailSyncing] = useState(false)

  /* ── Derived ────────────────────────────────────────────────── */

  const visibleJobs = useMemo(
    () => applyFilter(jobs, activeFilter),
    [jobs, activeFilter]
  )

  const activeJob =
    jobs.find((j) => j.id === activeJobId) ?? visibleJobs[0] ?? jobs[0]
  const activeDetail = activeJob
    ? (jobDetails[activeJob.id] ?? createJobDetail(activeJob))
    : null
  const needsPageRefresh =
    activeJob && activeDetail && activeTab === "Pages"
      ? shouldAutoRefreshPages(activeJob, activeDetail.pages)
      : false

  /* ── Callbacks ──────────────────────────────────────────────── */

  const updateJobPages = useCallback(
    (jobId: string, pagesPayload: GetJobPagesResponse) => {
      setJobDetails((cur) => {
        const target = jobs.find((j) => j.id === jobId)
        const base = cur[jobId] ?? (target ? createJobDetail(target) : null)
        if (!base) return cur
        return {
          ...cur,
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

  const syncDetailTab = useCallback(
    async (job: JobRecord, tab: DetailTab) => {
      if (tab !== "Logs" && tab !== "Result" && tab !== "Pages") return
      setIsDetailSyncing(true)
      try {
        if (tab === "Pages") {
          const res = await fetch(`/api/jobs/${job.id}/pages`)
          if (!res.ok) return
          const p = (await res.json()) as GetJobPagesResponse
          updateJobPages(job.id, p)
          return
        }
        if (tab === "Logs") {
          const res = await fetch(`/api/jobs/${job.id}/logs`, {
            cache: "no-store",
          })
          if (!res.ok) return
          const p = (await res.json()) as GetJobLogsResponse
          setJobDetails((cur) => {
            const base = cur[job.id] ?? createJobDetail(job)
            return {
              ...cur,
              [job.id]: {
                ...base,
                title: p.title,
                events: p.events,
                pipeline: p.pipeline,
              },
            }
          })
          return
        }
        /* Result tab → fetch output */
        const res = await fetch(`/api/jobs/${job.id}/output`, {
          cache: "no-store",
        })
        if (!res.ok) return
        const p = (await res.json()) as GetJobOutputResponse
        setJobDetails((cur) => {
          const base = cur[job.id] ?? createJobDetail(job)
          setOutputSources((s) => ({
            ...s,
            [job.id]: p.sources ?? { tesseractPages: [] },
          }))
          return {
            ...cur,
            [job.id]: {
              ...base,
              title: p.title,
              outputPreview: p.preview,
            },
          }
        })
      } finally {
        setIsDetailSyncing(false)
      }
    },
    [updateJobPages]
  )

  /* ── Effects ────────────────────────────────────────────────── */

  /* load LLM runtime status */
  useEffect(() => {
    let ignore = false
    void (async () => {
      try {
        const res = await fetch("/api/config/llm")
        if (res.ok && !ignore)
          setLlmRuntimeStatus((await res.json()) as LlmRuntimeStatus)
      } catch {
        if (!ignore)
          setLlmRuntimeStatus({
            status: "unreachable",
            baseUrl: "",
            model: "",
            reasoningEffort: "",
            hasApiKey: false,
            hasExamplePdfPath: false,
          })
      }
    })()
    return () => {
      ignore = true
    }
  }, [])

  /* load Tesseract runtime status */
  useEffect(() => {
    let ignore = false
    void (async () => {
      try {
        const res = await fetch("/api/config/tesseract")
        if (res.ok && !ignore)
          setTesseractRuntimeStatus(
            (await res.json()) as TesseractRuntimeStatus
          )
      } catch {
        if (!ignore)
          setTesseractRuntimeStatus({
            status: "unreachable",
            binaryPath: "",
            language: "",
            hasDataPath: false,
          })
      }
    })()
    return () => {
      ignore = true
    }
  }, [])

  /* sync detail tab when selection changes */
  useEffect(() => {
    if (!activeJob) return
    let ignore = false
    void syncDetailTab(activeJob, activeTab).catch(() => {
      if (!ignore) setIsDetailSyncing(false)
    })
    return () => {
      ignore = true
    }
  }, [activeJob, activeTab, syncDetailTab])

  /* auto-refresh pages */
  useEffect(() => {
    const cleanup = schedulePagesRefresh({
      activeJob: activeJob ?? null,
      activeTab,
      isDetailSyncing,
      getPages: () => activeDetail?.pages ?? [],
      schedule: (cb, delay) => window.setTimeout(cb, delay),
      clear: (id) => window.clearTimeout(id),
      refresh: async () => {
        if (!activeJob) return null
        const res = await fetch(`/api/jobs/${activeJob.id}/pages`, {
          cache: "no-store",
        })
        if (!res.ok) return null
        return (await res.json()) as GetJobPagesResponse
      },
      applyPages: (pages) => {
        if (!activeJob || !activeDetail) return
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

  /* auto-dismiss notice */
  useEffect(() => {
    if (!uiNotice) return
    const t = setTimeout(() => setUiNotice(null), 5000)
    return () => clearTimeout(t)
  }, [uiNotice])

  /* ── Handlers ───────────────────────────────────────────────── */

  function handleFilePick(files: FileList | null) {
    if (!files) return
    setUploadIssues([])
    setUiNotice(null)
    setPickedFiles(Array.from(files))
  }

  async function handleUploadBatch() {
    if (pickedFiles.length === 0) {
      setUploadIssues([
        {
          fileName: "No file selected",
          message: "Choose at least one PDF before staging",
        },
      ])
      setUiNotice({
        tone: "error",
        title: "No PDF selected",
        message: "Choose at least one PDF first.",
      })
      return
    }
    setUploadIssues([])
    setUiNotice(null)
    setIsUploadingBatch(true)
    try {
      const fd = new FormData()
      fd.set("mode", mode)
      fd.set("output", output)
      pickedFiles.forEach((f) => fd.append("files", f))
      const res = await fetch("/api/jobs/upload", {
        method: "POST",
        body: fd,
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          message?: string
          errors?: UploadIssue[]
        } | null
        setUploadIssues(payload?.errors ?? [])
        setUiNotice({
          tone: "error",
          title: payload?.message ?? "Upload failed",
          message:
            payload?.errors?.[0]?.message ??
            "The server rejected the upload batch.",
        })
        return
      }
      const payload = (await res.json()) as UploadJobsResponse
      setJobs((cur) => [...payload.jobs, ...cur])
      setJobDetails((cur) => ({ ...cur, ...payload.details }))
      setActiveJobId(payload.jobs[0]?.id ?? activeJobId)
      setActiveTab("Pages")
      setActiveFilter("All")
      setPickedFiles([])
      setUploadIssues(payload.errors ?? [])
      setUiNotice({
        tone: "success",
        title: "Upload stored",
        message: `${payload.jobs.length} PDF stored. Extraction starts after preparation/start.`,
      })
      if (inputRef.current) inputRef.current.value = ""
    } finally {
      setIsUploadingBatch(false)
    }
  }

  async function handleStartAll() {
    const res = await fetch("/api/jobs/start-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    if (!res.ok) return
    const p = (await res.json()) as StartAllJobsResponse
    setJobs(p.jobs)
    setJobDetails(p.details)
  }

  async function handleJobStart(jobId: string) {
    const res = await fetch("/api/jobs/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    })
    if (!res.ok) return
    const p = (await res.json()) as StartJobResponse
    setJobs((cur) => cur.map((j) => (j.id === jobId ? p.job : j)))
    setJobDetails((cur) => ({ ...cur, [jobId]: p.detail }))
    setActiveJobId(jobId)
    setActiveTab("Pages")
  }

  async function handleRetry(jobId: string) {
    const res = await fetch(`/api/jobs/${jobId}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    if (!res.ok) return
    const p = (await res.json()) as RetryJobResponse
    setJobs((cur) => cur.map((j) => (j.id === jobId ? p.job : j)))
    setJobDetails((cur) => ({ ...cur, [jobId]: p.detail }))
    setActiveJobId(jobId)
    setActiveTab("Logs")
  }
  async function handlePageRetry(pageId: string) {
    if (!activeJob || !activeDetail) return
    const target = activeDetail.pages.find((p) => p.id === pageId)
    if (!target?.canRetry) return
    const res = await fetch(`/api/pages/${pageId}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    if (!res.ok) return
    const p = (await res.json()) as RetryPageResponse
    setJobs((cur) => cur.map((j) => (j.id === activeJob.id ? p.job : j)))
    setJobDetails((cur) => ({ ...cur, [activeJob.id]: p.detail }))
    setActiveTab("Pages")
  }

  async function handleWinnerOverride(
    page: string,
    winner: "LLM" | "Tesseract" | "auto"
  ) {
    if (!activeJob) return
    const res = await fetch(`/api/jobs/${activeJob.id}/compare/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, winner }),
    })
    if (!res.ok) return
    const p = (await res.json()) as OverrideCompareWinnerResponse
    setJobs((cur) => cur.map((j) => (j.id === activeJob.id ? p.job : j)))
    setJobDetails((cur) => ({ ...cur, [activeJob.id]: p.detail }))
  }

  function handleDownloadJob(jobId: string) {
    const job = jobs.find((j) => j.id === jobId)
    if (!job) return
    const format =
      job.output === "Text" ? "text" : "markdown"
    window.location.assign(
      `/api/jobs/${encodeURIComponent(jobId)}/output/download?format=${format}`
    )
  }

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Toast */}
      {uiNotice && (
        <div className="pointer-events-none fixed top-4 right-4 z-50 max-w-sm">
          <Alert
            variant={uiNotice.tone === "error" ? "destructive" : "default"}
            className={cn(
              "pointer-events-auto border shadow-lg backdrop-blur-xl",
              uiNotice.tone === "success"
                ? "border-emerald-300/25 bg-emerald-400/15 text-emerald-50"
                : "border-rose-300/25 bg-rose-400/15 text-rose-50"
            )}
          >
            <AlertTitle className="text-[11px] tracking-widest uppercase">
              {uiNotice.title}
            </AlertTitle>
            <AlertDescription className="mt-0.5 text-xs opacity-90">
              {uiNotice.message}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <AppHeader
        llmRuntime={llmRuntimeStatus}
        tesseractRuntime={tesseractRuntimeStatus}
        onStartAll={() => void handleStartAll()}
      />

      <ActionBar
        mode={mode}
        output={output}
        pickedFiles={pickedFiles}
        isUploading={isUploadingBatch}
        uploadIssues={uploadIssues}
        inputRef={inputRef}
        onModeChange={setMode}
        onOutputChange={setOutput}
        onFilePick={handleFilePick}
        onUpload={() => void handleUploadBatch()}
      />

      <div className="mx-auto w-full max-w-screen-2xl flex-1 p-4 sm:p-6">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <DocumentList
            jobs={visibleJobs}
            activeJobId={activeJobId}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            onSelectJob={(id) => {
              setActiveJobId(id)
              setActiveTab("Pages")
            }}
            onStartJob={(id) => void handleJobStart(id)}
            onRetryJob={(id) => void handleRetry(id)}
            onDownloadJob={handleDownloadJob}
          />

          <DocumentDetailPanel
            job={activeJob ?? null}
            detail={activeDetail}
            activeTab={activeTab}
            isDetailSyncing={isDetailSyncing}
            shouldRefreshPages={needsPageRefresh}
            outputSources={
              activeJob ? (outputSources[activeJob.id] ?? null) : null
            }
            onTabChange={setActiveTab}
            onPageRetry={(id) => void handlePageRetry(id)}
            onWinnerOverride={(page, winner) =>
              void handleWinnerOverride(page, winner)
            }
          />
        </div>
      </div>
    </main>
  )
}
