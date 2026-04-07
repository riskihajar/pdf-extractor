"use client"

import Image from "next/image"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Calendar03Icon,
  File02Icon,
  FileSearchIcon,
  Settings02Icon,
  TaskDone02Icon,
  WorkflowSquare10Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  JobControlResponse,
  OverrideCompareWinnerResponse,
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
const workspaceNav = [
  { label: "Overview", icon: WorkflowSquare10Icon, active: true },
  { label: "Uploads", icon: File02Icon },
  { label: "Queue Review", icon: TaskDone02Icon },
  { label: "Compare", icon: FileSearchIcon },
]
const utilityNav = [
  { label: "Runtime", icon: Settings02Icon },
  { label: "Timeline", icon: Calendar03Icon },
]

type Filter = (typeof filters)[number]

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

type RuntimeConnectionCheck = {
  status: "ok" | "error" | "missing_config"
  message: string
  checkedAt: string
  latencyMs: number
  detail?: string
}

type OutputSourceSnapshot = {
  tesseractPages: Array<{
    page: string
    text: string
  }>
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

type UiNotice = {
  tone: "success" | "error"
  title: string
  message: string
}

type DetailTabSyncOptions = {
  forcePagesRefresh?: boolean
}

function buildOutputDownloadUrl(
  jobId: string,
  format: "markdown" | "text",
  partial?: boolean
) {
  return `/api/jobs/${encodeURIComponent(jobId)}/output/download?format=${format}${partial ? "&partial=1" : ""}`
}

function diffTone(type: "same" | "llm-only" | "tesseract-only") {
  switch (type) {
    case "llm-only":
      return "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
    case "tesseract-only":
      return "border-amber-300/30 bg-amber-300/10 text-amber-100"
    default:
      return "border-white/10 bg-white/5 text-stone-300"
  }
}

function isSeededJob(job: JobRecord) {
  return /^job-\d+$/.test(job.id)
}

function formatRuntimeCheck(check: RuntimeConnectionCheck | null) {
  if (!check) {
    return "belum diuji"
  }

  return `${check.message} · ${check.latencyMs}ms`
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
  const [isUploadingBatch, setIsUploadingBatch] = useState(false)
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<
    string | null
  >(null)
  const [uiNotice, setUiNotice] = useState<UiNotice | null>(null)
  const [uploadIssues, setUploadIssues] = useState<UploadIssue[]>([])
  const [llmRuntimeStatus, setLlmRuntimeStatus] =
    useState<LlmRuntimeStatus | null>(null)
  const [tesseractRuntimeStatus, setTesseractRuntimeStatus] =
    useState<TesseractRuntimeStatus | null>(null)
  const [llmConnectionCheck, setLlmConnectionCheck] =
    useState<RuntimeConnectionCheck | null>(null)
  const [tesseractConnectionCheck, setTesseractConnectionCheck] =
    useState<RuntimeConnectionCheck | null>(null)
  const [isLlmConnectionTesting, setIsLlmConnectionTesting] = useState(false)
  const [isTesseractConnectionTesting, setIsTesseractConnectionTesting] =
    useState(false)
  const [workerDiagnostics, setWorkerDiagnostics] =
    useState<WorkerDiagnostics | null>(null)
  const [outputSources, setOutputSources] = useState<
    Record<string, OutputSourceSnapshot>
  >({})
  const [isDetailSyncing, setIsDetailSyncing] = useState(false)
  const [isRunningWorkerTick, setIsRunningWorkerTick] = useState(false)

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
  const uploadedJobs = jobs.filter((job) => !isSeededJob(job))
  const hasUploadedJobs = uploadedJobs.length > 0
  const activeOutputMeta = activeDetail?.outputMeta
  const canDownloadMarkdown =
    activeJob?.output === "Markdown" || activeJob?.output === "MD + TXT"
  const canDownloadText =
    activeJob?.output === "Text" || activeJob?.output === "MD + TXT"
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

          setOutputSources((sources) => ({
            ...sources,
            [job.id]: payload.sources ?? { tesseractPages: [] },
          }))

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

  const refreshJobsSnapshot = useCallback(async () => {
    const response = await fetch("/api/jobs", { cache: "no-store" })

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as GetJobsResponse
    setJobs(payload.jobs)
    setJobDetails(payload.details)
    return payload
  }, [])

  const refreshWorkerDiagnostics = useCallback(async () => {
    const response = await fetch("/api/workers", { cache: "no-store" })

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as WorkerDiagnostics
    setWorkerDiagnostics(payload)
    return payload
  }, [])

  const runLlmConnectionTest = useCallback(async () => {
    setIsLlmConnectionTesting(true)

    try {
      const response = await fetch("/api/config/llm/test", { method: "POST" })
      const payload = (await response.json()) as RuntimeConnectionCheck
      setLlmConnectionCheck(payload)
    } catch (error) {
      setLlmConnectionCheck({
        status: "error",
        message: "LLM connection test gagal dipanggil dari dashboard.",
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsLlmConnectionTesting(false)
    }
  }, [])

  const runTesseractConnectionTest = useCallback(async () => {
    setIsTesseractConnectionTesting(true)

    try {
      const response = await fetch("/api/config/tesseract/test", {
        method: "POST",
      })
      const payload = (await response.json()) as RuntimeConnectionCheck
      setTesseractConnectionCheck(payload)
    } catch (error) {
      setTesseractConnectionCheck({
        status: "error",
        message: "Tesseract runtime test gagal dipanggil dari dashboard.",
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsTesseractConnectionTesting(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function loadLlmRuntimeStatus() {
      try {
        const response = await fetch("/api/config/llm")
        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as LlmRuntimeStatus

        if (!ignore) {
          setLlmRuntimeStatus(payload)
        }
      } catch {
        if (!ignore) {
          setLlmRuntimeStatus({
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

    void loadLlmRuntimeStatus()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function loadTesseractRuntimeStatus() {
      try {
        const response = await fetch("/api/config/tesseract")

        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as TesseractRuntimeStatus

        if (!ignore) {
          setTesseractRuntimeStatus(payload)
        }
      } catch {
        if (!ignore) {
          setTesseractRuntimeStatus({
            status: "unreachable",
            binaryPath: "unreachable",
            language: "unknown",
            hasDataPath: false,
          })
        }
      }
    }

    void loadTesseractRuntimeStatus()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function loadWorkerDiagnostics() {
      try {
        const payload = await refreshWorkerDiagnostics()

        if (!ignore && payload) {
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
  }, [refreshWorkerDiagnostics])

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
    if (pickedFiles.length === 0) {
      const issues = [
        {
          fileName: "No file selected",
          message: "Choose at least one PDF before staging the batch",
        },
      ]
      setUploadIssues(issues)
      setUploadSuccessMessage(null)
      setUiNotice({
        tone: "error",
        title: "No PDF selected",
        message: issues[0]!.message,
      })
      return
    }

    setUploadIssues([])
    setUploadSuccessMessage(null)
    setUiNotice(null)
    setIsUploadingBatch(true)

    try {
      const formData = new FormData()
      formData.set("mode", mode)
      formData.set("output", output)
      pickedFiles.forEach((file) => {
        formData.append("files", file)
      })

      const response = await fetch("/api/jobs/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string
          errors?: UploadIssue[]
        } | null

        const issues = payload?.errors ?? []
        setUploadIssues(issues)
        setUiNotice({
          tone: "error",
          title: payload?.message ?? "Upload failed",
          message:
            issues[0]?.message ??
            "The server rejected the upload batch. Check the validation panel for details.",
        })
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
      setActiveFilter("All jobs")
      setPickedFiles([])
      setUploadIssues(payload.errors ?? [])
      setUploadSuccessMessage(
        `${payload.jobs.length} file berhasil di-upload ke staging. Render dan extraction belum jalan sampai pipeline prepare/start dijalankan.`
      )
      setUiNotice({
        tone: "success",
        title: "Upload stored",
        message:
          payload.jobs.length === 1
            ? `${payload.jobs[0]?.name ?? "PDF"} berhasil tersimpan. Tahap render/extraction belum dimulai.`
            : `${payload.jobs.length} PDF berhasil tersimpan. Tahap render/extraction belum dimulai.`,
      })

      if (inputRef.current) {
        inputRef.current.value = ""
      }
    } finally {
      setIsUploadingBatch(false)
    }
  }

  function handleFilePick(files: FileList | null) {
    if (!files) {
      return
    }

    setUploadIssues([])
    setUploadSuccessMessage(null)
    setUiNotice(null)
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

  async function handlePause(jobId: string) {
    const response = await fetch(`/api/jobs/${jobId}/pause`, {
      method: "POST",
    })

    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as JobControlResponse
    setJobs((current) =>
      current.map((job) => (job.id === jobId ? payload.job : job))
    )
    setJobDetails((current) => ({
      ...current,
      [jobId]: payload.detail,
    }))
    setActiveJobId(jobId)
    setActiveTab("Logs")
  }

  async function handleCancel(jobId: string) {
    const response = await fetch(`/api/jobs/${jobId}/cancel`, {
      method: "POST",
    })

    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as JobControlResponse
    setJobs((current) =>
      current.map((job) => (job.id === jobId ? payload.job : job))
    )
    setJobDetails((current) => ({
      ...current,
      [jobId]: payload.detail,
    }))
    setActiveJobId(jobId)
    setActiveTab("Output")
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

  async function handleWinnerOverride(
    page: string,
    winner: "LLM" | "Tesseract" | "auto"
  ) {
    if (!activeJob) {
      return
    }

    const response = await fetch(`/api/jobs/${activeJob.id}/compare/override`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page, winner }),
    })

    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as OverrideCompareWinnerResponse
    setJobs((current) =>
      current.map((job) => (job.id === activeJob.id ? payload.job : job))
    )
    setJobDetails((current) => ({
      ...current,
      [activeJob.id]: payload.detail,
    }))
  }

  async function handleWorkerTick() {
    setIsRunningWorkerTick(true)

    try {
      const response = await fetch("/api/workers/run", {
        method: "POST",
      })

      if (!response.ok) {
        return
      }

      await Promise.all([refreshJobsSnapshot(), refreshWorkerDiagnostics()])

      const nextActiveJobId = activeJobId || jobs[0]?.id
      if (nextActiveJobId) {
        setActiveJobId(nextActiveJobId)
      }
    } finally {
      setIsRunningWorkerTick(false)
    }
  }

  return (
    <SidebarProvider
      defaultOpen
      style={
        {
          "--sidebar-width": "17rem",
          "--header-height": "3.5rem",
        } as React.CSSProperties
      }
    >
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-3 rounded-lg border bg-sidebar-accent/40 px-3 py-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <HugeiconsIcon icon={WorkflowSquare10Icon} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="text-xs tracking-[0.18em] text-sidebar-foreground/60 uppercase">
                PDF Extractor
              </p>
              <p className="truncate text-sm font-medium">Ops workspace</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {workspaceNav.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      isActive={item.active}
                      tooltip={item.label}
                    >
                      <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>Utilities</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {utilityNav.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton tooltip={item.label}>
                      <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="rounded-lg border bg-sidebar-accent/30 p-3 text-xs text-sidebar-foreground/70">
            {visibleJobs.length} jobs visible · {uploadedJobs.length} uploaded
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <main className="min-h-screen bg-background text-foreground">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
            <div className="flex h-14 items-center gap-3 border-b">
              <SidebarTrigger />
              <div className="min-w-0">
                <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
                  Local pipeline
                </p>
                <h1 className="truncate text-sm font-medium">
                  Queue, OCR comparison, and export review
                </h1>
              </div>
            </div>
            <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
              {uiNotice ? (
                <div className="pointer-events-none fixed top-5 right-5 z-50 max-w-md">
                  <Alert
                    variant={
                      uiNotice.tone === "error" ? "destructive" : "default"
                    }
                    className={cn(
                      "border px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl",
                      uiNotice.tone === "success"
                        ? "border-emerald-300/25 bg-emerald-400/15 text-emerald-50"
                        : "border-rose-300/25 bg-rose-400/15 text-rose-50"
                    )}
                  >
                    <AlertTitle className="text-[11px] tracking-[0.22em] uppercase">
                      {uiNotice.title}
                    </AlertTitle>
                    <AlertDescription className="mt-1 text-sm leading-6 text-inherit opacity-95">
                      {uiNotice.message}
                    </AlertDescription>
                  </Alert>
                </div>
              ) : null}
              <div className="grid gap-6 border-b px-5 py-6 lg:grid-cols-[1.45fr_0.55fr] lg:px-6 lg:py-6">
                <div className="space-y-5">
                  <Badge
                    variant="outline"
                    className="w-fit rounded-md px-2 py-1 text-[10px] tracking-[0.24em] uppercase"
                  >
                    Extraction dashboard
                  </Badge>
                  <div className="space-y-3">
                    <h1 className="max-w-3xl text-3xl leading-tight font-semibold tracking-[-0.04em] text-foreground sm:text-4xl lg:text-5xl">
                      PDF extraction workspace for queued uploads, page
                      rendering, OCR review, and export.
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                      Disusun ulang mengikuti pattern dashboard shadcn: header
                      kerja, metric cards, intake panel, queue table, dan detail
                      inspector yang lebih dekat ke aplikasi internal sungguhan.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      className="h-10 px-4 text-sm"
                      onClick={handleStartAll}
                    >
                      Start all jobs
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10 px-4 text-sm"
                      onClick={() => void handleWorkerTick()}
                      disabled={isRunningWorkerTick}
                    >
                      {isRunningWorkerTick
                        ? "Running worker tick..."
                        : "Run worker tick"}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10 px-4 text-sm"
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

              <div className="grid gap-6 px-5 py-5 lg:px-6 lg:py-6">
                <section className="rounded-lg border bg-card p-4 shadow-sm xl:col-span-2">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="max-w-xl">
                        <p className="text-xs tracking-[0.22em] text-muted-foreground uppercase">
                          Intake
                        </p>
                        <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">
                          Upload PDFs and route the extraction plan
                        </h2>
                      </div>
                      <div className="flex flex-col gap-3 lg:items-end">
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {modeLabels.map((label) => (
                            <FilterPill
                              key={label}
                              label={label}
                              active={mode === label}
                              onClick={() => setMode(label)}
                            />
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          <Badge variant="outline">{output}</Badge>
                          <Badge variant="outline">
                            {pickedFiles.length} file selected
                          </Badge>
                          <Badge variant="outline">
                            {uploadedJobs.length} uploaded jobs
                          </Badge>
                        </div>
                      </div>
                    </div>
                    {!hasUploadedJobs ? (
                      <Alert className="border-amber-300/20 bg-amber-300/10 px-3 py-2 text-amber-50">
                        <AlertDescription className="text-xs leading-5 text-inherit">
                          Masih pakai seeded demo jobs. Upload PDF sendiri lalu
                          jalankan stage/start/worker tick untuk melihat data
                          lokal.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <Alert className="border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-emerald-50">
                        <AlertDescription className="text-xs leading-5 text-inherit">
                          Real upload terdeteksi: {uploadedJobs.length} job
                          lokal siap dites visual.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>

                  <Card className="mt-4 rounded-lg border-dashed bg-muted/20 shadow-none">
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-1">
                          <p className="text-xs tracking-[0.24em] text-muted-foreground uppercase">
                            Upload batch
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Tambahkan beberapa PDF lalu stage ke queue lokal.
                          </p>
                        </div>
                        <Input
                          ref={inputRef}
                          type="file"
                          accept="application/pdf"
                          multiple
                          className="hidden"
                          onChange={(event) =>
                            handleFilePick(event.target.files)
                          }
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            className="px-4"
                            onClick={() => inputRef.current?.click()}
                          >
                            Choose files
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="px-4"
                            onClick={handleUploadBatch}
                            disabled={isUploadingBatch}
                          >
                            {isUploadingBatch
                              ? "Staging upload..."
                              : "Stage upload batch"}
                          </Button>
                        </div>
                      </div>
                      <div className="mt-4 flex min-h-10 flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2">
                        <span className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
                          Files
                        </span>
                        <Separator
                          orientation="vertical"
                          className="hidden h-4 md:block"
                        />
                        <div className="flex flex-1 flex-wrap gap-2">
                          {pickedFiles.length > 0 ? (
                            pickedFiles.map((file) => (
                              <Badge
                                key={file.name}
                                variant="secondary"
                                className="max-w-full truncate"
                              >
                                {file.name}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              No local files selected yet. Choose PDFs to upload
                              into local dev storage.
                            </span>
                          )}
                        </div>
                      </div>
                      {uploadIssues.length > 0 ? (
                        <Alert
                          variant="destructive"
                          className="mt-3 border-rose-300/20 bg-rose-400/10 p-3 text-rose-100"
                        >
                          <AlertTitle className="text-[11px] tracking-[0.2em] text-rose-100 uppercase">
                            Upload validation
                          </AlertTitle>
                          <AlertDescription className="mt-2 space-y-1 text-rose-100/90">
                            {uploadIssues.map((issue) => (
                              <p
                                key={`${issue.fileName}-${issue.message}`}
                                className="text-xs text-rose-100/90"
                              >
                                {issue.fileName}: {issue.message}
                              </p>
                            ))}
                          </AlertDescription>
                        </Alert>
                      ) : null}
                      {uploadSuccessMessage ? (
                        <Alert className="mt-3 border-emerald-300/20 bg-emerald-400/10 p-3 text-emerald-50">
                          <AlertTitle className="text-[11px] tracking-[0.2em] text-emerald-100 uppercase">
                            Upload staged
                          </AlertTitle>
                          <AlertDescription className="mt-2 text-xs text-emerald-50/90">
                            {uploadSuccessMessage}
                          </AlertDescription>
                        </Alert>
                      ) : null}
                    </CardContent>
                  </Card>
                </section>

                <section className="grid content-start gap-3 md:grid-cols-2 xl:grid-cols-3">
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
                      llmRuntimeStatus?.status === "ready"
                        ? "Ready"
                        : llmRuntimeStatus?.status === "unreachable"
                          ? "Offline"
                          : "Needs config"
                    }
                    hint={`${llmRuntimeStatus?.model ?? "Loading model"} · ${llmRuntimeStatus?.baseUrl ?? "Loading endpoint"}`}
                  />
                  <ConfigCard
                    label="Tesseract runtime"
                    value={
                      tesseractRuntimeStatus?.status === "ready"
                        ? "Ready"
                        : tesseractRuntimeStatus?.status === "unreachable"
                          ? "Offline"
                          : "Missing binary"
                    }
                    hint={`${tesseractRuntimeStatus?.language ?? "unknown"} · ${tesseractRuntimeStatus?.binaryPath ?? "Loading binary path"}`}
                  />
                  <Card className="rounded-[1.1rem] border-white/10 bg-white/5 text-white ring-white/10 xl:col-span-3">
                    <CardHeader>
                      <CardDescription className="text-[11px] tracking-[0.2em] text-stone-500 uppercase">
                        Output preset
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
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
                        {llmRuntimeStatus?.hasApiKey ? "detected" : "missing"} ·
                        Example PDF path:{" "}
                        {llmRuntimeStatus?.hasExamplePdfPath
                          ? "available"
                          : "not set"}
                      </p>
                      <Separator className="mt-3 bg-white/10" />
                      <div className="pt-3">
                        <p className="text-[11px] tracking-[0.2em] text-stone-500 uppercase">
                          Runtime checks
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full border-white/15 bg-white/5 text-stone-100 hover:bg-white/10"
                            disabled={isLlmConnectionTesting}
                            onClick={() => void runLlmConnectionTest()}
                          >
                            {isLlmConnectionTesting
                              ? "Testing LLM..."
                              : "Test LLM connection"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full border-white/15 bg-white/5 text-stone-100 hover:bg-white/10"
                            disabled={isTesseractConnectionTesting}
                            onClick={() => void runTesseractConnectionTest()}
                          >
                            {isTesseractConnectionTesting
                              ? "Testing Tesseract..."
                              : "Test Tesseract runtime"}
                          </Button>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-stone-400">
                          LLM: {formatRuntimeCheck(llmConnectionCheck)}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-stone-400">
                          Tesseract:{" "}
                          {formatRuntimeCheck(tesseractConnectionCheck)}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
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
                      <p className="mt-2 text-xs tracking-[0.18em] text-stone-500 uppercase">
                        {activeJob
                          ? isSeededJob(activeJob)
                            ? "Demo seeded state"
                            : "Real uploaded pipeline state"
                          : "No file selected"}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        statusTone(activeJob?.status ?? "Queued"),
                        "rounded-full px-3 py-1 text-xs"
                      )}
                    >
                      {activeJob?.status ?? "Idle"}
                    </Badge>
                  </div>
                  <div className="mt-4 space-y-4">
                    {activeDetail?.background ? (
                      <Card className="rounded-[1.25rem] border-cyan-400/15 bg-cyan-400/5 text-white ring-cyan-400/15">
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
                          {activeDetail.background.preparedAt ??
                            "not yet prepared"}
                        </p>
                      </Card>
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
                    <Badge
                      variant="outline"
                      className="rounded-full border-white/10 px-3 py-1 text-xs text-stone-300"
                    >
                      {workerDiagnostics?.totals.preparedJobs ?? 0} prepared
                    </Badge>
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

                <Card className="mt-4 overflow-hidden rounded-[1.5rem] border-white/8 bg-transparent py-0 text-white ring-white/8">
                  {!hasUploadedJobs ? (
                    <div className="border-b border-white/8 bg-white/6 px-4 py-3 text-xs text-stone-300">
                      Menampilkan seeded demo jobs agar layout dashboard tetap
                      bisa direview. Upload PDF sendiri untuk memunculkan job
                      nyata di urutan teratas.
                    </div>
                  ) : null}
                  <Table className="text-white">
                    <TableHeader className="hidden md:table-header-group">
                      <TableRow className="grid grid-cols-[2.1fr_0.8fr_1fr_0.9fr_1.2fr_1fr] gap-3 border-white/8 bg-white/8 px-4 py-3 text-[11px] tracking-[0.2em] text-stone-400 uppercase hover:bg-white/8">
                        <TableHead className="h-auto px-0 text-stone-400">
                          File
                        </TableHead>
                        <TableHead className="h-auto px-0 text-stone-400">
                          Pages
                        </TableHead>
                        <TableHead className="h-auto px-0 text-stone-400">
                          Mode
                        </TableHead>
                        <TableHead className="h-auto px-0 text-stone-400">
                          Status
                        </TableHead>
                        <TableHead className="h-auto px-0 text-stone-400">
                          Progress
                        </TableHead>
                        <TableHead className="h-auto px-0 text-stone-400">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-white/8">
                      {visibleJobs.map((job) => (
                        <TableRow
                          key={job.id}
                          className={cn(
                            "grid gap-4 border-white/8 bg-black/10 px-4 py-4 transition hover:bg-black/10 md:grid-cols-[2.1fr_0.8fr_1fr_0.9fr_1.2fr_1fr] md:items-center",
                            activeJob?.id === job.id && "bg-white/10"
                          )}
                        >
                          <TableCell className="space-y-2 px-0 py-0 whitespace-normal">
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
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "rounded-full px-2 py-0.5 text-[10px] tracking-[0.2em] uppercase",
                                    isSeededJob(job)
                                      ? "border-white/10 text-stone-300"
                                      : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                                  )}
                                >
                                  {isSeededJob(job)
                                    ? "Demo seed"
                                    : "Uploaded file"}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-white/10 px-2 py-0.5 text-[10px] tracking-[0.2em] text-stone-300 uppercase"
                                >
                                  {job.output}
                                </Badge>
                              </div>
                              <p className="text-xs text-stone-400">
                                Rendered {job.rendered} / {job.pages} ·
                                Extracted {job.extracted} / {job.pages} · Failed{" "}
                                {job.failed}
                              </p>
                              <p className="text-[11px] text-stone-500">
                                Background{" "}
                                {job.backgroundReady ? "prepared" : "idle"}
                              </p>
                            </button>
                          </TableCell>
                          <TableCell className="px-0 py-0 text-sm text-stone-200">
                            {job.pages}
                          </TableCell>
                          <TableCell className="px-0 py-0 text-sm whitespace-normal text-stone-200">
                            {job.mode}
                          </TableCell>
                          <TableCell className="px-0 py-0">
                            <Badge
                              variant="outline"
                              className={cn(
                                statusTone(job.status),
                                "inline-flex rounded-full px-2.5 py-1 text-xs"
                              )}
                            >
                              {job.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="space-y-2 px-0 py-0 whitespace-normal">
                            <Progress value={job.progress} className="gap-0">
                              <div className="w-full">
                                <div className="overflow-hidden rounded-full bg-white/10">
                                  <div
                                    className="h-2 rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-sky-300"
                                    style={{ width: `${job.progress}%` }}
                                  />
                                </div>
                              </div>
                            </Progress>
                            <p className="text-xs text-stone-400">
                              {job.progress}% complete
                            </p>
                          </TableCell>
                          <TableCell className="px-0 py-0 whitespace-normal">
                            <div className="flex flex-wrap gap-2 md:justify-end">
                              <MiniAction
                                label="Start"
                                onClick={() => void handleJobStart(job.id)}
                              />
                              <MiniAction
                                label="Pause"
                                subtle
                                disabled={job.status !== "Processing"}
                                onClick={() => void handlePause(job.id)}
                              />
                              <MiniAction
                                label="Cancel"
                                subtle
                                disabled={
                                  job.status === "Cancelled" ||
                                  job.status === "Completed"
                                }
                                onClick={() => void handleCancel(job.id)}
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
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
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

                  <Tabs
                    value={activeTab}
                    onValueChange={(value) => setActiveTab(value as DetailTab)}
                    className="mt-4"
                  >
                    <TabsList
                      variant="line"
                      className="flex flex-wrap gap-2 border-b border-white/10 pb-4"
                    >
                      {detailTabs.map((tab) => (
                        <TabsTrigger
                          key={tab}
                          value={tab}
                          className="flex-none rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-stone-300 data-active:border-amber-300/40 data-active:bg-amber-300/15 data-active:text-amber-100 data-active:after:hidden"
                        >
                          {tab}
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    <TabsContent value="Pages" className="mt-4">
                      <ScrollArea className="max-h-[72vh] pr-3">
                        <div className="space-y-3">
                          {activeDetail?.pages.map((task) => (
                            <Card
                              key={task.page}
                              className="rounded-[1.35rem] border-white/10 bg-black/10 text-white ring-white/10"
                            >
                              <CardContent className="p-4">
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
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      statusTone(task.status),
                                      "inline-flex rounded-full px-2.5 py-1 text-xs"
                                    )}
                                  >
                                    {task.status}
                                  </Badge>
                                </div>
                                {task.previewUrl ? (
                                  <div className="mt-4 overflow-hidden rounded-[1.15rem] border border-white/10 bg-stone-950/70">
                                    <div className="border-b border-white/10 px-3 py-2">
                                      <p className="text-[11px] tracking-[0.22em] text-stone-500 uppercase">
                                        Render preview
                                      </p>
                                    </div>
                                    <div className="bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.16),_transparent_48%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))] p-3">
                                      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[0.9rem] border border-white/10 bg-white shadow-[0_18px_45px_rgba(0,0,0,0.35)]">
                                        <Image
                                          src={task.previewUrl}
                                          alt={`${task.page} rendered preview`}
                                          fill
                                          className="object-contain"
                                          sizes="(max-width: 768px) 100vw, 420px"
                                          unoptimized
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ) : null}
                                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                  <EnginePill name="LLM" state={task.llm} />
                                  <EnginePill
                                    name="Tesseract"
                                    state={task.tesseract}
                                  />
                                  {task.id && task.canRetry ? (
                                    <MiniAction
                                      label="Retry page"
                                      subtle
                                      onClick={() =>
                                        void handlePageRetry(task.id!)
                                      }
                                    />
                                  ) : null}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                          {shouldRefreshPages && !isDetailSyncing ? (
                            <p className="text-[11px] tracking-[0.18em] text-stone-500 uppercase">
                              Auto-refresh aktif ringan selama job masih queued
                              atau processing
                            </p>
                          ) : null}
                        </div>
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value="Compare" className="mt-4">
                      <ScrollArea className="max-h-[72vh] pr-3">
                        <div className="space-y-3">
                          {activeDetail?.compareRows.map((row) => (
                            <Card
                              key={row.page}
                              className="rounded-[1.35rem] border-white/10 bg-black/10 text-white ring-white/10"
                            >
                              <CardContent className="p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <h3 className="text-sm font-medium text-white">
                                    {row.page}
                                  </h3>
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200"
                                  >
                                    Winner: {row.winner}
                                  </Badge>
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
                                    {row.tesseractSummary.startsWith(
                                      "OCR text"
                                    ) ? (
                                      <p className="mt-2 text-[11px] tracking-[0.18em] text-cyan-200 uppercase">
                                        Persisted OCR result
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                                {row.diffSegments &&
                                row.diffSegments.length > 0 ? (
                                  <div className="mt-3 rounded-[1rem] border border-white/10 bg-black/20 p-3">
                                    <p className="text-[11px] tracking-[0.2em] text-stone-500 uppercase">
                                      Detailed diff
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {row.diffSegments.map(
                                        (segment, index) => (
                                          <span
                                            key={`${row.page}-diff-${index}`}
                                            className={`rounded-full border px-2.5 py-1 text-xs ${diffTone(segment.type)}`}
                                          >
                                            {segment.value}
                                          </span>
                                        )
                                      )}
                                    </div>
                                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                      <div className="rounded-[0.9rem] border border-cyan-300/20 bg-cyan-300/5 p-3">
                                        <p className="text-[11px] tracking-[0.18em] text-cyan-100 uppercase">
                                          Full LLM text
                                        </p>
                                        <p className="mt-2 text-xs leading-6 text-stone-200">
                                          {row.llmFullText ?? row.llmSummary}
                                        </p>
                                      </div>
                                      <div className="rounded-[0.9rem] border border-amber-300/20 bg-amber-300/5 p-3">
                                        <p className="text-[11px] tracking-[0.18em] text-amber-100 uppercase">
                                          Full Tesseract text
                                        </p>
                                        <p className="mt-2 text-xs leading-6 text-stone-200">
                                          {row.tesseractFullText ??
                                            row.tesseractSummary}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}
                                {row.reason ? (
                                  <div className="mt-3 rounded-[1rem] border border-amber-300/15 bg-amber-200/5 p-3">
                                    <p className="text-[11px] tracking-[0.2em] text-amber-100 uppercase">
                                      Winner reason
                                    </p>
                                    <p className="mt-2 text-xs leading-6 text-stone-300">
                                      {row.reason}
                                    </p>
                                    {row.scores ? (
                                      <p className="mt-2 text-[11px] tracking-[0.18em] text-stone-400 uppercase">
                                        Scores · LLM {row.scores.llm} /
                                        Tesseract {row.scores.tesseract}
                                      </p>
                                    ) : null}
                                  </div>
                                ) : null}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <MiniAction
                                    label="Use LLM"
                                    subtle
                                    onClick={() =>
                                      void handleWinnerOverride(row.page, "LLM")
                                    }
                                  />
                                  <MiniAction
                                    label="Use Tesseract"
                                    subtle
                                    onClick={() =>
                                      void handleWinnerOverride(
                                        row.page,
                                        "Tesseract"
                                      )
                                    }
                                  />
                                  <MiniAction
                                    label="Reset auto"
                                    subtle
                                    disabled={!row.overridden}
                                    onClick={() =>
                                      void handleWinnerOverride(
                                        row.page,
                                        "auto"
                                      )
                                    }
                                  />
                                  {row.overridden ? (
                                    <Badge
                                      variant="outline"
                                      className="rounded-full border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[11px] tracking-[0.18em] text-cyan-100 uppercase"
                                    >
                                      Manual override
                                    </Badge>
                                  ) : null}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value="Output" className="mt-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <Card className="rounded-[1.35rem] border-white/10 bg-black/10 text-white ring-white/10">
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                              <div className="flex items-center gap-3">
                                <h3 className="text-sm font-medium text-white">
                                  Markdown output
                                </h3>
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-white/10 px-2 py-0.5 text-[10px] tracking-[0.2em] text-stone-300 uppercase"
                                >
                                  .md
                                </Badge>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-full border-white/15 bg-white/5 text-stone-100 hover:bg-white/10"
                                disabled={!activeJob || !canDownloadMarkdown}
                                onClick={() => {
                                  if (!activeJob || !canDownloadMarkdown) {
                                    return
                                  }

                                  window.location.assign(
                                    buildOutputDownloadUrl(
                                      activeJob.id,
                                      "markdown"
                                    )
                                  )
                                }}
                              >
                                Download .md
                              </Button>
                            </div>
                            <pre className="mt-4 overflow-x-auto font-mono text-xs leading-6 whitespace-pre-wrap text-stone-300">
                              {activeDetail?.outputPreview.markdown}
                            </pre>
                            {activeOutputMeta?.isPartial ? (
                              <p className="mt-3 text-[11px] tracking-[0.18em] text-amber-100 uppercase">
                                Partial export aktif · failed{" "}
                                {activeOutputMeta.failedPages.length} · pending{" "}
                                {activeOutputMeta.missingPages.length}
                              </p>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <MiniAction
                                label="Download partial .md"
                                subtle
                                disabled={!activeJob || !canDownloadMarkdown}
                                onClick={() => {
                                  if (!activeJob || !canDownloadMarkdown) {
                                    return
                                  }

                                  window.location.assign(
                                    buildOutputDownloadUrl(
                                      activeJob.id,
                                      "markdown",
                                      true
                                    )
                                  )
                                }}
                              />
                            </div>
                            {isDetailSyncing && (
                              <p className="mt-3 text-[11px] tracking-[0.18em] text-stone-500 uppercase">
                                Syncing backend output...
                              </p>
                            )}
                          </CardContent>
                        </Card>
                        <Card className="rounded-[1.35rem] border-white/10 bg-black/10 text-white ring-white/10">
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                              <div className="flex items-center gap-3">
                                <h3 className="text-sm font-medium text-white">
                                  Text output
                                </h3>
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-white/10 px-2 py-0.5 text-[10px] tracking-[0.2em] text-stone-300 uppercase"
                                >
                                  .txt
                                </Badge>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-full border-white/15 bg-white/5 text-stone-100 hover:bg-white/10"
                                disabled={!activeJob || !canDownloadText}
                                onClick={() => {
                                  if (!activeJob || !canDownloadText) {
                                    return
                                  }

                                  window.location.assign(
                                    buildOutputDownloadUrl(activeJob.id, "text")
                                  )
                                }}
                              >
                                Download .txt
                              </Button>
                            </div>
                            <pre className="mt-4 overflow-x-auto font-mono text-xs leading-6 whitespace-pre-wrap text-stone-300">
                              {activeDetail?.outputPreview.text}
                            </pre>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <MiniAction
                                label="Download partial .txt"
                                subtle
                                disabled={!activeJob || !canDownloadText}
                                onClick={() => {
                                  if (!activeJob || !canDownloadText) {
                                    return
                                  }

                                  window.location.assign(
                                    buildOutputDownloadUrl(
                                      activeJob.id,
                                      "text",
                                      true
                                    )
                                  )
                                }}
                              />
                            </div>
                            {(outputSources[activeJob?.id ?? ""]?.tesseractPages
                              .length ?? 0) > 0 ? (
                              <div className="mt-4 border-t border-white/10 pt-4">
                                <p className="text-[11px] tracking-[0.2em] text-cyan-200 uppercase">
                                  Persisted OCR pages
                                </p>
                                <div className="mt-3 space-y-2">
                                  {outputSources[
                                    activeJob?.id ?? ""
                                  ]?.tesseractPages.map((page) => (
                                    <div
                                      key={page.page}
                                      className="rounded-[1rem] border border-cyan-300/15 bg-cyan-300/5 p-3"
                                    >
                                      <p className="text-xs font-medium text-cyan-50">
                                        {page.page}
                                      </p>
                                      <p className="mt-2 text-xs leading-6 text-stone-300">
                                        {page.text}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </CardContent>
                        </Card>
                      </div>
                    </TabsContent>

                    <TabsContent value="Logs" className="mt-4">
                      <ScrollArea className="max-h-[72vh] pr-3">
                        <div className="space-y-3 font-mono text-xs text-stone-300">
                          {isDetailSyncing && (
                            <Alert className="border-amber-300/20 bg-amber-200/5 px-3 py-3 text-[11px] tracking-[0.18em] text-amber-100 uppercase">
                              Syncing backend logs...
                            </Alert>
                          )}
                          {activeDetail?.events.map((event) => (
                            <Card
                              key={event}
                              className="rounded-[1.2rem] border-white/10 bg-black/15 py-0 text-white ring-white/10"
                            >
                              <CardContent className="px-3 py-3">
                                {event}
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </ScrollArea>
                    </TabsContent>
                  </Tabs>
                </section>
              </div>
            </section>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
