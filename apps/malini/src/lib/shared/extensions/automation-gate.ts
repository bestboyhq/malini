import type { RoutineGatedRunRecord } from '$contract/routines';
import { invoke } from '$shared/port/invoke';

export interface WorkstreamRoutineGateStore {
	hold(run: RoutineGatedRunRecord): Promise<RoutineGatedRunRecord>;
	settle(gatedRunId: string, state: 'confirmed' | 'rejected'): Promise<void>;
	listPending(workstreamId: string): Promise<readonly RoutineGatedRunRecord[]>;
}

export function createMemoryRoutineGateStore(): WorkstreamRoutineGateStore & {
	readonly records: ReadonlyMap<string, RoutineGatedRunRecord>;
} {
	const records = new Map<string, RoutineGatedRunRecord>();
	return {
		records,
		hold(run) {
			const existing = [...records.values()].find(({ runKey }) => runKey === run.runKey);
			if (existing) return Promise.resolve(existing);
			records.set(run.id, run);
			return Promise.resolve(run);
		},
		settle(gatedRunId, state) {
			const existing = records.get(gatedRunId);
			if (!existing) return Promise.reject(new Error(`gated run \`${gatedRunId}\` not found`));
			if (existing.state === state) return Promise.resolve();
			if (existing.state !== 'pending') {
				return Promise.reject(
					new Error(`gated run \`${gatedRunId}\` is already ${existing.state}`),
				);
			}
			records.set(gatedRunId, { ...existing, state, decidedAt: new Date().toISOString() });
			return Promise.resolve();
		},
		listPending(workstreamId) {
			return Promise.resolve(
				[...records.values()].filter(
					(record) => record.workstreamId === workstreamId && record.state === 'pending',
				),
			);
		},
	};
}

export function createPlatformRoutineGateStore(): WorkstreamRoutineGateStore {
	return {
		hold: (run) =>
			invoke('routines.record-gated-run', {
				id: run.id,
				routineId: run.routineId,
				workstreamId: run.workstreamId,
				runKey: run.runKey,
				event: run.event,
				payload: run.payload,
			}),
		settle: async (gatedRunId, state) => {
			await invoke(state === 'confirmed' ? 'routines.confirm-run' : 'routines.reject-run', {
				gatedRunId,
			});
		},
		listPending: (workstreamId) =>
			invoke('routines.list-gated-runs', { workstreamId, state: 'pending' }),
	};
}
