import { invoke } from '$shared/port/invoke';

class JobRunsService {
	async sessionFor(jobRunId: string): Promise<string | null> {
		const runs = await invoke('jobs.list-runs', undefined);
		return runs.find((run) => run.id === jobRunId)?.sessionId ?? null;
	}
}

export const jobRunsService = new JobRunsService();
