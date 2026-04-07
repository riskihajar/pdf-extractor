"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type RuntimeInfo = {
  status: string
} | null

export type AppHeaderProps = {
  llmRuntime: RuntimeInfo
  tesseractRuntime: RuntimeInfo
  onStartAll: () => void
}

export function AppHeader({
  llmRuntime,
  tesseractRuntime,
  onStartAll,
}: AppHeaderProps) {
  const llmReady = llmRuntime?.status === "ready"
  const tesseractReady = tesseractRuntime?.status === "ready"

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card/60 px-4 backdrop-blur-sm sm:px-6">
      <h1 className="text-sm font-semibold tracking-tight text-foreground">
        PDF Extractor
      </h1>

      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px]",
            llmReady
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              : "border-rose-400/30 bg-rose-400/10 text-rose-200"
          )}
        >
          LLM {llmReady ? "ready" : "offline"}
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px]",
            tesseractReady
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              : "border-rose-400/30 bg-rose-400/10 text-rose-200"
          )}
        >
          OCR {tesseractReady ? "ready" : "offline"}
        </Badge>
        <Button size="sm" className="ml-1 h-8 px-3 text-xs" onClick={onStartAll}>
          Start all
        </Button>
      </div>
    </header>
  )
}
