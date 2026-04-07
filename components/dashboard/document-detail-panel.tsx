"use client"

import Image from "next/image"

import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  DetailTab,
  JobDetail,
  JobRecord,
  PageTask,
} from "@/lib/dashboard-data"
import { statusTone } from "@/lib/status-helpers"
import { cn } from "@/lib/utils"

export type OutputSourceSnapshot = {
  tesseractPages: Array<{
    page: string
    text: string
  }>
}

export type DocumentDetailPanelProps = {
  job: JobRecord | null
  detail: JobDetail | null
  activeTab: DetailTab
  isDetailSyncing: boolean
  shouldRefreshPages: boolean
  outputSources: OutputSourceSnapshot | null
  onTabChange: (tab: DetailTab) => void
  onPageRetry: (pageId: string) => void
  onWinnerOverride: (
    page: string,
    winner: "LLM" | "Tesseract" | "auto"
  ) => void
}

const tabs: DetailTab[] = ["Pages", "Compare", "Result", "Logs"]

function buildDownloadUrl(
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

/* ── Engine pill (inlined) ──────────────────────────────────────── */

function EnginePill({ name, state }: { name: string; state: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
        statusTone(state)
      )}
    >
      <span className="text-[10px] tracking-widest uppercase">{name}</span>
      <span className="text-[11px]">{state}</span>
    </Badge>
  )
}

/* ── Main component ─────────────────────────────────────────────── */

export function DocumentDetailPanel({
  job,
  detail,
  activeTab,
  isDetailSyncing,
  shouldRefreshPages,
  outputSources,
  onTabChange,
  onPageRetry,
  onWinnerOverride,
}: DocumentDetailPanelProps) {
  if (!job || !detail) {
    return (
      <section className="rounded-lg border border-dashed bg-card/50 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Select a document to view details.
        </p>
      </section>
    )
  }

  const outputMeta = detail.outputMeta
  const canDownloadMd =
    job.output === "Markdown" || job.output === "MD + TXT"
  const canDownloadTxt = job.output === "Text" || job.output === "MD + TXT"
  const completedPages = detail.pages.filter(
    (p) => p.status === "Compared" || p.llm === "Done" || p.tesseract === "Done"
  ).length
  const failedPages = detail.pages.filter(
    (p) => p.llm === "Failed" || p.tesseract === "Failed"
  ).length
  const pendingPages = detail.pages.length - completedPages - failedPages

  return (
    <section className="rounded-lg border bg-card/60 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {detail.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {job.mode} · {job.output} · {completedPages} done · {failedPages}{" "}
            failed · {pendingPages} pending
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            statusTone(job.status),
            "shrink-0 rounded-full px-2.5 py-0.5 text-[10px]"
          )}
        >
          {job.status}
        </Badge>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => onTabChange(v as DetailTab)}
      >
        <TabsList
          variant="line"
          className="flex gap-1 border-b px-4 pt-2 pb-0"
        >
          {tabs.map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs text-muted-foreground data-active:border-primary data-active:text-foreground data-active:after:hidden"
            >
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Pages ─────────────────────────── */}
        <TabsContent value="Pages" className="px-4 pt-3 pb-4">
          <ScrollArea className="max-h-[65vh] pr-2">
            <div className="space-y-2">
              {detail.pages.map((task) => (
                <PageCard
                  key={task.page}
                  task={task}
                  onRetry={onPageRetry}
                />
              ))}
              {shouldRefreshPages && !isDetailSyncing && (
                <p className="pt-1 text-[10px] text-muted-foreground">
                  Auto-refreshing while extraction is running…
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Compare ───────────────────────── */}
        <TabsContent value="Compare" className="px-4 pt-3 pb-4">
          <ScrollArea className="max-h-[65vh] pr-2">
            <div className="space-y-2">
              {detail.compareRows.map((row) => (
                <Card key={row.page} className="border bg-card/80">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-xs font-medium">{row.page}</h4>
                      <Badge
                        variant="outline"
                        className="rounded-full border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200"
                      >
                        Winner: {row.winner}
                      </Badge>
                    </div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md border bg-muted/30 p-2">
                        <p className="text-[10px] tracking-widest text-muted-foreground uppercase">
                          LLM
                        </p>
                        <p className="mt-1 text-xs leading-relaxed">
                          {row.llmSummary}
                        </p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-2">
                        <p className="text-[10px] tracking-widest text-muted-foreground uppercase">
                          Tesseract
                        </p>
                        <p className="mt-1 text-xs leading-relaxed">
                          {row.tesseractSummary}
                        </p>
                      </div>
                    </div>

                    {row.diffSegments && row.diffSegments.length > 0 && (
                      <div className="mt-2 rounded-md border bg-muted/20 p-2">
                        <p className="text-[10px] tracking-widest text-muted-foreground uppercase">
                          Diff
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {row.diffSegments.map((seg, idx) => (
                            <span
                              key={`${row.page}-d-${idx}`}
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[10px]",
                                diffTone(seg.type)
                              )}
                            >
                              {seg.value}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {row.reason && (
                      <div className="mt-2 rounded-md border border-amber-300/15 bg-amber-200/5 p-2">
                        <p className="text-[10px] tracking-widest text-amber-200 uppercase">
                          Reason
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {row.reason}
                        </p>
                        {row.scores && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            LLM {row.scores.llm} · Tesseract{" "}
                            {row.scores.tesseract}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => onWinnerOverride(row.page, "LLM")}
                      >
                        Use LLM
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => onWinnerOverride(row.page, "Tesseract")}
                      >
                        Use Tesseract
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        disabled={!row.overridden}
                        onClick={() => onWinnerOverride(row.page, "auto")}
                      >
                        Reset auto
                      </Button>
                      {row.overridden && (
                        <Badge
                          variant="outline"
                          className="rounded-full border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[10px] text-cyan-100"
                        >
                          Manual override
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Result (was Output) ────────────── */}
        <TabsContent value="Result" className="px-4 pt-3 pb-4">
          <div className="grid gap-3 lg:grid-cols-2">
            {/* Markdown */}
            <Card className="border bg-card/80">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2 border-b pb-2">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-medium">Markdown</h4>
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[9px]"
                    >
                      .md
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={!canDownloadMd}
                      onClick={() =>
                        window.location.assign(
                          buildDownloadUrl(job.id, "markdown")
                        )
                      }
                    >
                      Download .md
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={!canDownloadMd}
                      onClick={() =>
                        window.location.assign(
                          buildDownloadUrl(job.id, "markdown", true)
                        )
                      }
                    >
                      Partial
                    </Button>
                  </div>
                </div>
                <pre className="mt-2 max-h-60 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {detail.outputPreview.markdown}
                </pre>
              </CardContent>
            </Card>

            {/* Text */}
            <Card className="border bg-card/80">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2 border-b pb-2">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-medium">Text</h4>
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[9px]"
                    >
                      .txt
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={!canDownloadTxt}
                      onClick={() =>
                        window.location.assign(
                          buildDownloadUrl(job.id, "text")
                        )
                      }
                    >
                      Download .txt
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={!canDownloadTxt}
                      onClick={() =>
                        window.location.assign(
                          buildDownloadUrl(job.id, "text", true)
                        )
                      }
                    >
                      Partial
                    </Button>
                  </div>
                </div>
                <pre className="mt-2 max-h-60 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {detail.outputPreview.text}
                </pre>
              </CardContent>
            </Card>
          </div>

          {outputMeta?.isPartial && (
            <p className="mt-2 text-[10px] text-amber-200">
              Partial export · failed {outputMeta.failedPages.length} · pending{" "}
              {outputMeta.missingPages.length}
            </p>
          )}

          {(outputSources?.tesseractPages.length ?? 0) > 0 && (
            <div className="mt-3 border-t pt-3">
              <p className="text-[10px] tracking-widest text-cyan-200 uppercase">
                Persisted OCR pages
              </p>
              <div className="mt-2 space-y-1.5">
                {outputSources?.tesseractPages.map((p) => (
                  <div
                    key={p.page}
                    className="rounded-md border border-cyan-300/15 bg-cyan-300/5 p-2"
                  >
                    <p className="text-[11px] font-medium text-cyan-50">
                      {p.page}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {p.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isDetailSyncing && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Syncing output…
            </p>
          )}
        </TabsContent>

        {/* ── Logs ──────────────────────────── */}
        <TabsContent value="Logs" className="px-4 pt-3 pb-4">
          <ScrollArea className="max-h-[65vh] pr-2">
            <div className="space-y-1.5 font-mono text-xs text-muted-foreground">
              {isDetailSyncing && (
                <Alert className="border-amber-300/20 bg-amber-200/5 px-3 py-2 text-[10px] text-amber-100">
                  Syncing logs…
                </Alert>
              )}
              {detail.events.map((event, idx) => (
                <div
                  key={`${event}-${idx}`}
                  className="rounded-md border bg-card/80 px-3 py-2"
                >
                  {event}
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </section>
  )
}

/* ── Page card (inlined) ────────────────────────────────────────── */

function PageCard({
  task,
  onRetry,
}: {
  task: PageTask
  onRetry: (pageId: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card/80 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-medium text-foreground">{task.page}</h4>
          <Badge
            variant="outline"
            className={cn(
              statusTone(task.status),
              "rounded-full px-2 py-0.5 text-[10px]"
            )}
          >
            {task.status}
          </Badge>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {task.note}
        </p>
        {task.imagePath && (
          <p className="mt-0.5 text-[10px] break-all text-muted-foreground/60">
            {task.imagePath}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <EnginePill name="LLM" state={task.llm} />
        <EnginePill name="OCR" state={task.tesseract} />
        {task.id && task.canRetry && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => onRetry(task.id!)}
          >
            Retry page
          </Button>
        )}
      </div>

      {task.previewUrl && (
        <div className="mt-2 w-full overflow-hidden rounded-md border bg-muted/30">
          <div className="relative aspect-[3/4] max-h-48 w-full">
            <Image
              src={task.previewUrl}
              alt={`${task.page} preview`}
              fill
              className="object-contain"
              sizes="(max-width: 768px) 100vw, 300px"
              unoptimized
            />
          </div>
        </div>
      )}
    </div>
  )
}
