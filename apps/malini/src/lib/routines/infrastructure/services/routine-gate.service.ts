import type { RoutineGatedRun } from '$lib/routines/domain/routine-gated-run';
import { RoutineGatedRunMapper } from '$lib/routines/infrastructure/mappers/routine-gated-run.mapper';
import { invoke } from '$shared/port/invoke';

class RoutineGateService {
	async listPending(): Promise<readonly RoutineGatedRun[]> {
		return RoutineGatedRunMapper.fromRawList(
			await invoke('routines.list-gated-runs', { state: 'pending' }),
		);
	}

	async confirm(gatedRunId: string): Promise<RoutineGatedRun> {
		return RoutineGatedRunMapper.fromRaw(await invoke('routines.confirm-run', { gatedRunId }));
	}

	async reject(gatedRunId: string): Promise<RoutineGatedRun> {
		return RoutineGatedRunMapper.fromRaw(await invoke('routines.reject-run', { gatedRunId }));
	}
}

export const routineGateService = new RoutineGateService();
