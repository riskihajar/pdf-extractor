"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  createJobDetail,
  detailTabs,
  heroStats,
  initialJobDetails,
  initialJobs,
  type DetailTab,
  type ExtractionMode,
  type JobDetail,
  type JobRecord,
  type OutputFormat,
} from "@/lib/dashboard-data"
import type {
  StartAllJobsResponse,
  StartJobResponse,
  UploadJobsResponse,
} from "@/lib/job-actions"
import { cn } from "@/lib/utils"

import {
  ConfigCard,
  EnginePill,
  FilterPill,
  MiniAction,
  PipelineStep,
  StatCard,
  statusTone,
} from "./ui"

const modeLabels: ExtractionMode[] = ["LLM only", "Tesseract only", "Both compare"]
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

export function DashboardShell() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [jobs, setJobs] = useState<JobRecord[]>(initialJobs)
  const [jobDetails, setJobDetails] = useState<Record<string, JobDetail>>(initialJobDetails)
  const [mode, setMode] = useState<ExtractionMode>("Both compare")
  const [output, setOutput] = useState<OutputFormat>("MD + TXT")
  const [activeFilter, setActiveFilter] = useState<Filter>("All jobs")
  const [activeJobId, setActiveJobId] = useState(initialJobs[0]?.id ?? "")
  const [activeTab, setActiveTab] = useState<DetailTab>("Pages")
  const [pickedFiles, setPickedFiles] = useState<string[]>([])
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)

  const visibleJobs = useMemo(() => {
    if (activeFilter === "Failed pages") {
      return jobs.filter((job) => job.failed > 0)
    }

    if (activeFilter === "Compare mode") {
      return jobs.filter((job) => job.mode === "Both compare")
    }

    return jobs
  }, [activeFilter, jobs])

  const activeJob = jobs.find((job) => job.id === activeJobId) ?? visibleJobs[0] ?? jobs[0]
  const activeDetail = activeJob ? jobDetails[activeJob.id] ?? createJobDetail(activeJob) : null

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

  async function handleUploadBatch() {
    const files = pickedFiles.length > 0 ? pickedFiles : []
    const response = await fetch("/api/jobs/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files,
        mode,
        output,
        existingCount: jobs.length,
      }),
    })

    if (!response.ok) {
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

    if (inputRef.current) {
      inputRef.current.value = ""
    }
  }

  function handleFilePick(files: FileList | null) {
    if (!files) {
      return
    }

    const names = Array.from(files).map((file) => file.name)
    setPickedFiles(names)
  }

  async function handleStartAll() {
    const response = await fetch("/api/jobs/start-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobs,
        details: jobDetails,
      }),
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
        job: selectedJob,
        detail: jobDetails[jobId],
      }),
    })

    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as StartJobResponse
    setJobs((current) => current.map((job) => (job.id === jobId ? payload.job : job)))
    setJobDetails((current) => ({
      ...current,
      [jobId]: payload.detail,
    }))
    setActiveJobId(jobId)
    setActiveTab("Pages")
  }

  function handleRetry(jobId: string) {
    setActiveJobId(jobId)
    setActiveTab("Logs")
    setJobs((current) =>
      current.map((job) => {
        if (job.id !== jobId) {
          return job
        }

        return {
          ...job,
          status: "Queued",
          failed: Math.max(job.failed - 1, 0),
          progress: Math.max(job.progress - 8, 0),
        }
      })
    )
    setJobDetails((current) => {
      const detail = current[jobId]
      if (!detail) {
        return current
      }

      return {
        ...current,
        [jobId]: {
          ...detail,
          events: [`${timeStamp()} - Retry queued for ${detail.title}`, ...detail.events].slice(0, 6),
        },
      }
    })
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,183,77,0.22),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(83,109,254,0.18),_transparent_28%),linear-gradient(180deg,_#17120d_0%,_#120f0b_38%,_#0d0c0b_100%)] text-stone-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/20 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="grid gap-6 border-b border-white/10 px-5 py-6 lg:grid-cols-[1.3fr_0.7fr] lg:px-8 lg:py-8">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-200/10 px-3 py-1 text-xs uppercase tracking-[0.28em] text-amber-100">
                Pipeline cockpit
              </div>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-4xl leading-none font-semibold tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
                  Orchestrate PDF extraction like a job queue, not a blind upload form.
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-stone-300 sm:text-base">
                  Upload multiple PDFs, render each page into images, then route every page through
                  vision LLM, Tesseract, or both. Watch failures, retries, and exports move in real
                  time from one control surface.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button className="h-11 rounded-full bg-amber-300 px-6 text-sm font-semibold text-stone-950 hover:bg-amber-200" onClick={handleStartAll}>
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
                <StatCard key={stat.label} label={stat.label} value={stat.value} detail={stat.detail} />
              ))}
            </div>
          </div>

          <div className="grid gap-4 px-5 py-5 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-6">
            <section className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Intake</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">
                    Upload PDFs and route the extraction plan
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-stone-300">
                  {modeLabels.map((label) => (
                    <FilterPill key={label} label={label} active={mode === label} onClick={() => setMode(label)} />
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-[1.4rem] border border-dashed border-amber-200/30 bg-[linear-gradient(135deg,rgba(255,214,153,0.14),rgba(255,255,255,0.02))] p-5">
                  <p className="text-xs uppercase tracking-[0.24em] text-amber-100">Drop zone</p>
                  <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white">
                    Pick multiple PDF files and stage them directly into the queue.
                  </h3>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-stone-300">
                    Each file becomes an independent job with start, retry, compare, and export actions.
                    Every page becomes a queue item so one bad scan never blocks the rest of the batch.
                  </p>
                  <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(event) => handleFilePick(event.target.files)} />
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button className="rounded-full bg-white px-5 text-stone-950 hover:bg-stone-100" onClick={() => inputRef.current?.click()}>
                      Choose files
                    </Button>
                    <Button variant="outline" className="rounded-full border-white/15 bg-white/5 text-stone-100 hover:bg-white/10" onClick={handleUploadBatch}>
                      Stage upload batch
                    </Button>
                  </div>
                  <div className="mt-4 rounded-[1.1rem] border border-white/10 bg-black/15 p-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Files selected</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pickedFiles.length > 0 ? (
                        pickedFiles.map((file) => <FilterPill key={file} label={file} active />)
                      ) : (
                        <span className="text-xs text-stone-400">No local files selected yet. Use the picker or stage a synthetic batch.</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-black/15 p-4 sm:grid-cols-2">
                  <ConfigCard label="Extraction mode" value={mode} hint="Choose one engine or compare both results" />
                  <ConfigCard label="Output" value={output} hint="Keep markdown and plain text exports together" />
                  <ConfigCard label="Render engine" value="Worker snapshots" hint="PDF pages rasterized before OCR or vision calls" />
                  <ConfigCard
                    label="LLM runtime"
                    value={runtimeStatus?.status === "ready" ? "Ready" : runtimeStatus?.status === "unreachable" ? "Offline" : "Needs config"}
                    hint={`${runtimeStatus?.model ?? "Loading model"} · ${runtimeStatus?.baseUrl ?? "Loading endpoint"}`}
                  />
                  <div className="rounded-[1.1rem] border border-white/10 bg-white/5 p-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Output preset</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {outputLabels.map((label) => (
                        <FilterPill key={label} label={label} active={output === label} onClick={() => setOutput(label)} />
                      ))}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-stone-400">Tune export format before new files enter the queue.</p>
                    <p className="mt-3 text-xs leading-5 text-stone-500">
                      API key: {runtimeStatus?.hasApiKey ? "detected" : "missing"} · Example PDF path: {runtimeStatus?.hasExamplePdfPath ? "available" : "not set"}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Current focus</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{activeDetail?.title ?? "No active file selected"}</h2>
                  <p className="mt-1 text-sm text-stone-400">{activeDetail?.subtitle}</p>
                </div>
                <span className={cn(statusTone(activeJob?.status ?? "Queued"), "rounded-full border px-3 py-1 text-xs")}>
                  {activeJob?.status ?? "Idle"}
                </span>
              </div>
              <div className="mt-4 space-y-4">
                {activeDetail?.pipeline.map((step) => (
                  <PipelineStep key={step.title} title={step.title} detail={step.detail} state={step.state} />
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <section className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-5">
            <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Queue board</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">
                  File jobs ready for start, retry, or export
                </h2>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-stone-300">
                {filters.map((filter) => (
                  <FilterPill key={filter} label={filter} active={activeFilter === filter} onClick={() => setActiveFilter(filter)} />
                ))}
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-[1.5rem] border border-white/8">
              <div className="hidden grid-cols-[2.1fr_0.8fr_1fr_0.9fr_1.2fr_1fr] gap-3 bg-white/8 px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-stone-400 md:grid">
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
                        <h3 className="text-sm font-medium text-white">{job.name}</h3>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-stone-300">
                          {job.output}
                        </span>
                      </div>
                      <p className="text-xs text-stone-400">
                        Rendered {job.rendered} / {job.pages} · Extracted {job.extracted} / {job.pages} · Failed {job.failed}
                      </p>
                    </button>
                    <div className="text-sm text-stone-200">{job.pages}</div>
                    <div className="text-sm text-stone-200">{job.mode}</div>
                    <div>
                      <span className={cn(statusTone(job.status), "inline-flex rounded-full border px-2.5 py-1 text-xs")}>
                        {job.status}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-sky-300" style={{ width: `${job.progress}%` }} />
                      </div>
                      <p className="text-xs text-stone-400">{job.progress}% complete</p>
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <MiniAction label="Start" onClick={() => void handleJobStart(job.id)} />
                      <MiniAction
                        label="View"
                        subtle
                        onClick={() => {
                          setActiveJobId(job.id)
                          setActiveTab("Pages")
                        }}
                      />
                      <MiniAction label="Retry" subtle onClick={() => handleRetry(job.id)} />
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
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Job detail</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">
                    {activeDetail?.title ?? "Per-file detail view"}
                  </h2>
                  <p className="mt-1 text-sm text-stone-400">{activeDetail?.compareSummary}</p>
                </div>
                <Button variant="outline" className="rounded-full border-white/15 bg-white/5 text-stone-100 hover:bg-white/10" onClick={() => setActiveTab("Logs")}>
                  Open logs
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-b border-white/10 pb-4">
                {detailTabs.map((tab) => (
                  <FilterPill key={tab} label={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)} />
                ))}
              </div>

              <div className="mt-4">
                {activeTab === "Pages" && (
                  <div className="space-y-3">
                    {activeDetail?.pages.map((task) => (
                      <article key={task.page} className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-medium text-white">{task.page}</h3>
                            <p className="mt-1 text-xs text-stone-400">{task.note}</p>
                          </div>
                          <span className={cn(statusTone(task.status), "inline-flex rounded-full border px-2.5 py-1 text-xs")}>
                            {task.status}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          <EnginePill name="LLM" state={task.llm} />
                          <EnginePill name="Tesseract" state={task.tesseract} />
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                {activeTab === "Compare" && (
                  <div className="space-y-3">
                    {activeDetail?.compareRows.map((row) => (
                      <article key={row.page} className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-sm font-medium text-white">{row.page}</h3>
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200">
                            Winner: {row.winner}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-3">
                            <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">LLM</p>
                            <p className="mt-2 text-sm leading-6 text-stone-200">{row.llmSummary}</p>
                          </div>
                          <div className="rounded-[1rem] border border-white/10 bg-white/5 p-3">
                            <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Tesseract</p>
                            <p className="mt-2 text-sm leading-6 text-stone-200">{row.tesseractSummary}</p>
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
                        <h3 className="text-sm font-medium text-white">Markdown output</h3>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-stone-300">
                          .md
                        </span>
                      </div>
                      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-6 text-stone-300">
                        {activeDetail?.outputPreview.markdown}
                      </pre>
                    </article>
                    <article className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
                      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                        <h3 className="text-sm font-medium text-white">Text output</h3>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-stone-300">
                          .txt
                        </span>
                      </div>
                      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-6 text-stone-300">
                        {activeDetail?.outputPreview.text}
                      </pre>
                    </article>
                  </div>
                )}

                {activeTab === "Logs" && (
                  <div className="space-y-3 font-mono text-xs text-stone-300">
                    {activeDetail?.events.map((event) => (
                      <div key={event} className="rounded-[1.2rem] border border-white/10 bg-black/15 px-3 py-3">
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

function timeStamp() {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date())
}
