import type { RoutineJob, RoutineJobDraft } from '$lib/routines/domain/routine-job';
import { RoutineJobMapper } from '$lib/routines/infrastructure/mappers/routine-job.mapper';
import { invoke } from '$shared/port/invoke';

class RoutineJobsService {
	async list(): Promise<readonly RoutineJob[]> {
		return RoutineJobMapper.fromRawList(await invoke('jobs.list-definitions', undefined));
	}

	async create(draft: RoutineJobDraft): Promise<RoutineJob> {
		return RoutineJobMapper.fromRaw(
			await invoke('jobs.save-definition', {
				name: draft.name,
				instructions: draft.instructions,
				model: 'default',
				effort: 'medium',
				runsIn: 'workstream',
				output: 'none',
			}),
		);
	}

	async remove(definitionId: string): Promise<void> {
		await invoke('jobs.delete-definition', { definitionId });
	}
}

export const routineJobsService = new RoutineJobsService();
