import { Button } from "@/components/ui/button"

const jobs = [
  {
    name: "bank-statement-april.pdf",
    pages: 12,
    mode: "Both compare",
    output: "MD + TXT",
    status: "Processing",
    progress: 74,
    rendered: "12 / 12",
    extracted: "9 / 12",
    failed: 1,
  },
  {
    name: "invoice-batch-q2.pdf",
    pages: 5,
    mode: "LLM only",
    output: "Markdown",
    status: "Queued",
    progress: 18,
    rendered: "5 / 5",
    extracted: "0 / 5",
    failed: 0,
  },
  {
    name: "scan-kontrak.pdf",
    pages: 9,
    mode: "Tesseract",
    output: "Text",
    status: "Partial success",
    progress: 88,
    rendered: "9 / 9",
    extracted: "8 / 9",
    failed: 1,
  },
]

const pageTasks = [
  {
    page: "Page 01",
    llm: "Ready",
    tesseract: "Ready",
    status: "Compared",
    note: "Layout preserved, table blocks recognized",
  },
  {
    page: "Page 02",
    llm: "Running",
    tesseract: "Done",
    status: "Extracting",
    note: "Vision pass retries handwriting region",
  },
  {
    page: "Page 03",
    llm: "Done",
    tesseract: "Failed",
    status: "Needs review",
    note: "Fallback to LLM recommended",
  },
  {
    page: "Page 04",
    llm: "Queued",
    tesseract: "Queued",
    status: "Waiting",
    note: "Queued behind 3 pages",
  },
]

const events = [
  "18:42 - Render worker finished all 12 pages for bank-statement-april.pdf",
  "18:43 - Tesseract page 3 failed with empty OCR output",
  "18:43 - LLM retry scheduled for page 3 due to low OCR quality",
  "18:44 - Aggregator merged pages 1-8 into markdown draft",
]

function statusTone(status: string) {
  switch (status) {
    case "Processing":
    case "Extracting":
    case "Running":
      return "bg-sky-500/15 text-sky-200 border-sky-400/30"
    case "Queued":
    case "Waiting":
      return "bg-amber-500/15 text-amber-100 border-amber-400/30"
    case "Partial success":
    case "Needs review":
      return "bg-orange-500/15 text-orange-100 border-orange-400/30"
    case "Compared":
    case "Done":
    case "Ready":
      return "bg-emerald-500/15 text-emerald-100 border-emerald-400/30"
    case "Failed":
      return "bg-rose-500/15 text-rose-100 border-rose-400/30"
    default:
      return "bg-white/10 text-stone-100 border-white/10"
  }
}

export default function Page() {
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
                <Button className="h-11 rounded-full bg-amber-300 px-6 text-sm font-semibold text-stone-950 hover:bg-amber-200">
                  Start all jobs
                </Button>
                <Button
                  variant="outline"
                  className="h-11 rounded-full border-white/15 bg-white/5 px-6 text-sm text-stone-100 hover:bg-white/10"
                >
                  Review compare mode
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              <StatCard label="Active jobs" value="24" detail="8 rendering, 11 extracting, 5 aggregating" />
              <StatCard label="Queue depth" value="186" detail="Per-page tasks waiting across all workers" />
              <StatCard label="Output health" value="92%" detail="Partial results preserved for failed pages" />
            </div>
          </div>

          <div className="grid gap-4 px-5 py-5 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-6">
            <UploadPanel />
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Current focus</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">bank-statement-april.pdf</h2>
                </div>
                <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs text-sky-200">
                  Rendering complete
                </span>
              </div>
              <div className="mt-4 space-y-4">
                <PipelineStep
                  title="Upload received"
                  detail="12 pages detected, compare mode enabled, output set to markdown and text"
                  active
                />
                <PipelineStep
                  title="Page snapshots generated"
                  detail="All pages rasterized and stored for OCR, compare review, and export replay"
                  active
                />
                <PipelineStep
                  title="Extraction queue running"
                  detail="LLM and Tesseract tasks execute with retry and page-level visibility"
                  pending
                />
                <PipelineStep
                  title="Aggregator preparing exports"
                  detail="Markdown draft updates as each page resolves or is marked partial"
                  pending
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-5">
            <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Queue board</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">
                  File jobs ready for start, retry, or export
                </h2>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-stone-300">
                <FilterPill label="All jobs" active />
                <FilterPill label="Failed pages" />
                <FilterPill label="Compare mode" />
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
                {jobs.map((job) => (
                  <article key={job.name} className="grid gap-4 bg-black/10 px-4 py-4 md:grid-cols-[2.1fr_0.8fr_1fr_0.9fr_1.2fr_1fr] md:items-center">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-white">{job.name}</h3>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-stone-300">
                          {job.output}
                        </span>
                      </div>
                      <p className="text-xs text-stone-400">
                        Rendered {job.rendered} · Extracted {job.extracted} · Failed {job.failed}
                      </p>
                    </div>
                    <div className="text-sm text-stone-200">{job.pages}</div>
                    <div className="text-sm text-stone-200">{job.mode}</div>
                    <div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${statusTone(job.status)}`}>
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
                      <MiniAction label="Start" />
                      <MiniAction label="View" subtle />
                      <MiniAction label="Retry" subtle />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-6">
            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-5">
              <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Page queue</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">Per-page extraction monitor</h2>
                </div>
                <Button variant="outline" className="rounded-full border-white/15 bg-white/5 text-stone-100 hover:bg-white/10">
                  Retry failed pages
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {pageTasks.map((task) => (
                  <article key={task.page} className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-medium text-white">{task.page}</h3>
                        <p className="mt-1 text-xs text-stone-400">{task.note}</p>
                      </div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${statusTone(task.status)}`}>
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
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl sm:p-5">
              <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Diagnostics</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">Latest pipeline events</h2>
                </div>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
                  Live updates ready
                </span>
              </div>
              <div className="mt-4 space-y-3 font-mono text-xs text-stone-300">
                {events.map((event) => (
                  <div key={event} className="rounded-[1.2rem] border border-white/10 bg-black/15 px-3 py-3">
                    {event}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  )
}

function UploadPanel() {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-stone-400">Intake</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">Upload PDFs and route the extraction plan</h2>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-stone-300">
          <FilterPill label="LLM only" />
          <FilterPill label="Tesseract only" />
          <FilterPill label="Both compare" active />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[1.4rem] border border-dashed border-amber-200/30 bg-[linear-gradient(135deg,rgba(255,214,153,0.14),rgba(255,255,255,0.02))] p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-amber-100">Drop zone</p>
          <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white">
            Drop multiple PDF files here or browse from local storage.
          </h3>
          <p className="mt-3 max-w-xl text-sm leading-6 text-stone-300">
            Each file becomes an independent job with start, retry, compare, and export actions.
            Every page becomes a queue item so one bad scan never blocks the rest of the batch.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button className="rounded-full bg-white px-5 text-stone-950 hover:bg-stone-100">Upload files</Button>
            <Button variant="outline" className="rounded-full border-white/15 bg-white/5 text-stone-100 hover:bg-white/10">
              Import sample batch
            </Button>
          </div>
        </div>

        <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-black/15 p-4 sm:grid-cols-2">
          <ConfigCard label="Extraction mode" value="Both compare" hint="Run LLM and Tesseract for side-by-side review" />
          <ConfigCard label="Output" value="MD + TXT" hint="Keep markdown and plain text exports together" />
          <ConfigCard label="Render engine" value="Worker snapshots" hint="PDF pages rasterized before OCR or vision calls" />
          <ConfigCard label="Retry policy" value="Page-level" hint="Retry only failed pages instead of restarting everything" />
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4">
      <p className="text-xs uppercase tracking-[0.22em] text-stone-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-stone-300">{detail}</p>
    </div>
  )
}

function PipelineStep({
  title,
  detail,
  active,
  pending,
}: {
  title: string
  detail: string
  active?: boolean
  pending?: boolean
}) {
  return (
    <div className="flex gap-3">
      <div
        className={`mt-1 h-3 w-3 rounded-full ${
          active ? "bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]" : pending ? "bg-amber-300" : "bg-white/20"
        }`}
      />
      <div>
        <h3 className="text-sm font-medium text-white">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-stone-300">{detail}</p>
      </div>
    </div>
  )
}

function FilterPill({ label, active }: { label: string; active?: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 ${
        active
          ? "border-amber-300/40 bg-amber-300/15 text-amber-100"
          : "border-white/12 bg-white/6 text-stone-300"
      }`}
    >
      {label}
    </span>
  )
}

function ConfigCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[1.1rem] border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">{label}</p>
      <h3 className="mt-2 text-sm font-medium text-white">{value}</h3>
      <p className="mt-2 text-xs leading-5 text-stone-400">{hint}</p>
    </div>
  )
}

function MiniAction({ label, subtle }: { label: string; subtle?: boolean }) {
  return (
    <button
      type="button"
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
        subtle
          ? "border border-white/10 bg-white/5 text-stone-200 hover:bg-white/10"
          : "bg-amber-300 text-stone-950 hover:bg-amber-200"
      }`}
    >
      {label}
    </button>
  )
}

function EnginePill({ name, state }: { name: string; state: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 ${statusTone(state)}`}>
      <span className="text-[10px] uppercase tracking-[0.18em]">{name}</span>
      <span className="text-xs">{state}</span>
    </span>
  )
}
