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
    case "Partial success":
    case "Needs review":
      return "border-orange-400/30 bg-orange-500/15 text-orange-100"
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
    <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4">
      <p className="text-xs tracking-[0.22em] text-stone-400 uppercase">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">
        {value}
      </p>
      <p className="mt-2 text-sm leading-6 text-stone-300">{detail}</p>
    </div>
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
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex rounded-full border px-3 py-1 text-xs transition",
        active
          ? "border-amber-300/40 bg-amber-300/15 text-amber-100"
          : "border-white/12 bg-white/6 text-stone-300 hover:bg-white/10"
      )}
    >
      {label}
    </button>
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
    <div className="rounded-[1.1rem] border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] tracking-[0.2em] text-stone-500 uppercase">
        {label}
      </p>
      <h3 className="mt-2 text-sm font-medium text-white">{value}</h3>
      <p className="mt-2 text-xs leading-5 text-stone-400">{hint}</p>
    </div>
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
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-medium transition",
        subtle
          ? "border border-white/10 bg-white/5 text-stone-200 hover:bg-white/10"
          : "bg-amber-300 text-stone-950 hover:bg-amber-200",
        disabled && "cursor-not-allowed opacity-45 hover:bg-inherit"
      )}
    >
      {label}
    </button>
  )
}

export function EnginePill({ name, state }: { name: string; state: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1",
        statusTone(state)
      )}
    >
      <span className="text-[10px] tracking-[0.18em] uppercase">{name}</span>
      <span className="text-xs">{state}</span>
    </span>
  )
}
