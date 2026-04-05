import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import type { GetJobsResponse } from "@/lib/job-actions"

async function getInitialJobsState(): Promise<GetJobsResponse> {
  const response = await fetch("/api/jobs", {
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error("Failed to load jobs from internal API")
  }

  return (await response.json()) as GetJobsResponse
}

export default async function Page() {
  const initialState = await getInitialJobsState()

  return <DashboardShell initialState={initialState} />
}
