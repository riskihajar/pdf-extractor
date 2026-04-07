import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { getJobs, type GetJobsResponse } from "@/lib/job-actions"

async function getInitialJobsState(): Promise<GetJobsResponse> {
  return getJobs()
}

export default async function Page() {
  const initialState = await getInitialJobsState()

  return <DashboardShell initialState={initialState} />
}
