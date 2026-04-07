import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function statusTone(status: string) {
  switch (status) {
    case "Processing":
    case "Extracting":
    case "Running":
      return "border-sky-400/30 bg-sky-500/15 text-sky-200"
    case "Uploaded":
    case "Queued":
    case "Waiting":
      return "border-amber-400/30 bg-amber-500/15 text-amber-100"
    case "Paused":
      return "border-violet-400/30 bg-violet-500/15 text-violet-100"
    case "Partial success":
    case "Needs review":
      return "border-orange-400/30 bg-orange-500/15 text-orange-100"
    case "Cancelled":
    case "Compared":
    case "Done":
    case "Ready":
    case "Completed":
      return "border-emerald-400/30 bg-emerald-500/15 text-emerald-100"
    case "Failed":
      return "border-rose-400/30 bg-rose-500/15 text-rose-100"
    default:
      return "border-white/10 bg-white/10 text-stone-100"
  }
}

export function StatCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <Card className="rounded-[1.4rem] border-white/10 bg-white/6 text-white ring-white/10">
      <CardHeader className="gap-2">
        <CardDescription className="text-xs tracking-[0.22em] text-stone-400 uppercase">
          {label}
        </CardDescription>
        <CardTitle className="text-3xl font-semibold tracking-[-0.04em] text-white">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-stone-300">{detail}</p>
      </CardContent>
    </Card>
  )
}

export function PipelineStep({
  title,
  detail,
  state,
}: {
  title: string
  detail: string
  state: "done" | "active" | "pending"
}) {
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          "mt-1 h-3 w-3 rounded-full",
          state === "done" &&
            "bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]",
          state === "active" &&
            "bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.45)]",
          state === "pending" && "bg-white/20"
        )}
      />
      <div>
        <h3 className="text-sm font-medium text-white">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-stone-300">{detail}</p>
      </div>
    </div>
  )
}

export function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <Button
      onClick={onClick}
      variant={active ? "secondary" : "outline"}
      size="sm"
      className={cn(
        "rounded-full px-3 text-xs transition",
        active
          ? "border-amber-300/40 bg-amber-300/15 text-amber-100 hover:bg-amber-300/20"
          : "border-white/12 bg-white/6 text-stone-300 hover:bg-white/10"
      )}
    >
      {label}
    </Button>
  )
}

export function ConfigCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <Card className="rounded-[1.1rem] border-white/10 bg-white/5 text-white ring-white/10">
      <CardHeader className="gap-2">
        <CardDescription className="text-[11px] tracking-[0.2em] text-stone-500 uppercase">
          {label}
        </CardDescription>
        <CardTitle className="text-sm font-medium text-white">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs leading-5 text-stone-400">{hint}</p>
      </CardContent>
    </Card>
  )
}

export function MiniAction({
  label,
  subtle,
  disabled,
  onClick,
}: {
  label: string
  subtle?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <Button
      disabled={disabled}
      onClick={onClick}
      variant={subtle ? "outline" : "secondary"}
      size="sm"
      className={cn(
        "rounded-full px-3 text-xs font-medium transition",
        subtle
          ? "border border-white/10 bg-white/5 text-stone-200 hover:bg-white/10"
          : "bg-amber-300 text-stone-950 hover:bg-amber-200",
        disabled && "cursor-not-allowed opacity-45 hover:bg-inherit"
      )}
    >
      {label}
    </Button>
  )
}

export function EnginePill({ name, state }: { name: string; state: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1",
        statusTone(state)
      )}
    >
      <span className="text-[10px] tracking-[0.18em] uppercase">{name}</span>
      <span className="text-xs">{state}</span>
    </Badge>
  )
}

export function BackgroundLanePill({
  queue,
  worker,
  status,
}: {
  queue: string
  worker: string
  status: "idle" | "prepared"
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px]",
        status === "prepared"
          ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
          : "border-white/10 bg-white/5 text-stone-300"
      )}
    >
      <span className="tracking-[0.18em] uppercase">{queue}</span>
      <span className="text-stone-300">{worker}</span>
    </Badge>
  )
}
