"use client"

import type { RefObject } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ExtractionMode, OutputFormat } from "@/lib/dashboard-data"
import { cn } from "@/lib/utils"

const modeOptions: ExtractionMode[] = [
  "LLM only",
  "Tesseract only",
  "Both compare",
]
const outputOptions: OutputFormat[] = ["Markdown", "Text", "MD + TXT"]

export type UploadIssue = {
  fileName: string
  message: string
}

export type ActionBarProps = {
  mode: ExtractionMode
  output: OutputFormat
  pickedFiles: File[]
  isUploading: boolean
  uploadIssues: UploadIssue[]
  inputRef: RefObject<HTMLInputElement | null>
  onModeChange: (mode: ExtractionMode) => void
  onOutputChange: (output: OutputFormat) => void
  onFilePick: (files: FileList | null) => void
  onUpload: () => void
}

export function ActionBar({
  mode,
  output,
  pickedFiles,
  isUploading,
  uploadIssues,
  inputRef,
  onModeChange,
  onOutputChange,
  onFilePick,
  onUpload,
}: ActionBarProps) {
  return (
    <section className="border-b bg-card/40 px-4 py-2.5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(event) => onFilePick(event.target.files)}
        />
        <Button
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={() => inputRef.current?.click()}
        >
          Upload documents
        </Button>

        <span className="text-xs text-muted-foreground">
          {pickedFiles.length > 0
            ? `${pickedFiles.length} file${pickedFiles.length > 1 ? "s" : ""} selected`
            : "No files selected"}
        </span>

        <div className="hidden h-4 w-px bg-border sm:block" />

        <div className="flex items-center gap-1">
          <span className="mr-1 text-[10px] tracking-widest text-muted-foreground uppercase">
            Mode
          </span>
          {modeOptions.map((label) => (
            <Button
              key={label}
              variant={mode === label ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "h-7 px-2 text-[11px]",
                mode === label && "font-medium"
              )}
              onClick={() => onModeChange(label)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="hidden h-4 w-px bg-border sm:block" />

        <div className="flex items-center gap-1">
          <span className="mr-1 text-[10px] tracking-widest text-muted-foreground uppercase">
            Output
          </span>
          {outputOptions.map((label) => (
            <Button
              key={label}
              variant={output === label ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "h-7 px-2 text-[11px]",
                output === label && "font-medium"
              )}
              onClick={() => onOutputChange(label)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="hidden h-4 w-px bg-border sm:block" />

        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={onUpload}
          disabled={isUploading}
        >
          {isUploading ? "Staging..." : "Stage upload"}
        </Button>

        {pickedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {pickedFiles.map((f) => (
              <Badge
                key={f.name}
                variant="secondary"
                className="max-w-[180px] truncate text-[10px]"
              >
                {f.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {uploadIssues.length > 0 && (
        <Alert variant="destructive" className="mt-2 px-3 py-2">
          <AlertDescription className="space-y-0.5">
            {uploadIssues.map((issue) => (
              <p
                key={`${issue.fileName}-${issue.message}`}
                className="text-xs"
              >
                {issue.fileName}: {issue.message}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}
