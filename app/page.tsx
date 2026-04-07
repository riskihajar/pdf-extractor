import { Dashboard } from "@/components/dashboard/dashboard"
import { getJobs, type GetJobsResponse } from "@/lib/job-actions"

async function getInitialJobsState(): Promise<GetJobsResponse> {
  return getJobs()
}

export default async function Page() {
  const initialState = await getInitialJobsState()

  return <Dashboard initialState={initialState} />
}
