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
