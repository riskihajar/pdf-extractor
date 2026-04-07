"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { JobRecord } from "@/lib/dashboard-data"
import { statusTone } from "@/lib/status-helpers"
import { cn } from "@/lib/utils"

const filters = ["All", "Failed pages", "Compare mode"] as const

export type DocumentListProps = {
  jobs: JobRecord[]
  activeJobId: string
  activeFilter: string
  onFilterChange: (filter: string) => void
  onSelectJob: (jobId: string) => void
  onStartJob: (jobId: string) => void
  onRetryJob: (jobId: string) => void
  onDownloadJob: (jobId: string) => void
  onDeleteJob: (jobId: string) => void
}

export function DocumentList({
  jobs,
  activeJobId,
  activeFilter,
  onFilterChange,
  onSelectJob,
  onStartJob,
  onRetryJob,
  onDownloadJob,
  onDeleteJob,
}: DocumentListProps) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Documents</h2>
        <div className="flex gap-1">
          {filters.map((f) => (
            <Button
              key={f}
              variant={activeFilter === f ? "secondary" : "ghost"}
              size="sm"
              className={cn("h-7 px-2.5 text-[11px]")}
              onClick={() => onFilterChange(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card/50 px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No documents yet. Upload PDFs to start extracting.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card/60 shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="text-[11px] tracking-wider text-muted-foreground uppercase hover:bg-transparent">
                <TableHead className="h-9 pl-4">File</TableHead>
                <TableHead className="h-9 w-16">Pages</TableHead>
                <TableHead className="hidden h-9 md:table-cell">Mode</TableHead>
                <TableHead className="hidden h-9 lg:table-cell">
                  Output
                </TableHead>
                <TableHead className="h-9">Status</TableHead>
                <TableHead className="h-9 w-32">Progress</TableHead>
                <TableHead className="hidden h-9 w-16 sm:table-cell">
                  Failed
                </TableHead>
                <TableHead className="h-9 pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow
                  key={job.id}
                  className={cn(
                    "cursor-pointer transition-colors",
                    activeJobId === job.id && "bg-accent/50"
                  )}
                  onClick={() => onSelectJob(job.id)}
                >
                  <TableCell className="py-3 pl-4">
                    <p className="max-w-[200px] truncate text-sm font-medium text-foreground">
                      {job.name}
                    </p>
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">
                    {job.pages}
                  </TableCell>
                  <TableCell className="hidden py-3 text-xs text-muted-foreground md:table-cell">
                    {job.mode}
                  </TableCell>
                  <TableCell className="hidden py-3 text-xs text-muted-foreground lg:table-cell">
                    {job.output}
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge
                      variant="outline"
                      className={cn(
                        statusTone(job.status),
                        "rounded-full px-2 py-0.5 text-[10px]"
                      )}
                    >
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="space-y-1">
                      <div className="overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-sky-400 transition-all"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {job.progress}%
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden py-3 text-sm text-muted-foreground sm:table-cell">
                    {job.failed > 0 ? (
                      <span className="text-rose-400">{job.failed}</span>
                    ) : (
                      "0"
                    )}
                  </TableCell>
                  <TableCell className="py-3 pr-4">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={(event) => {
                          event.stopPropagation()
                          onStartJob(job.id)
                        }}
                      >
                        Start
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelectJob(job.id)
                        }}
                      >
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        disabled={!job.canRetry}
                        onClick={(event) => {
                          event.stopPropagation()
                          onRetryJob(job.id)
                        }}
                      >
                        Retry
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        disabled={
                          job.status !== "Completed" &&
                          job.status !== "Partial success"
                        }
                        onClick={(event) => {
                          event.stopPropagation()
                          onDownloadJob(job.id)
                        }}
                      >
                        Download
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px] text-rose-300 hover:text-rose-200"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDeleteJob(job.id)
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
