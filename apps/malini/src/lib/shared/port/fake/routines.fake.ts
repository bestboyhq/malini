import type {
	RoutineGatedRunRecord,
	RoutineRecord,
	RoutineSuggestionRecord,
} from '$contract/routines';
import type { FakeBridge } from './fake-bridge';

const FAKE_ROUTINE_TIME = '2026-01-01T00:00:00.000Z';

export function installRoutinesFake(bridge: FakeBridge): void {
	const routines = new Map<string, RoutineRecord>();
	const gatedRuns = new Map<string, RoutineGatedRunRecord>();
	const suggestions = new Map<string, RoutineSuggestionRecord>();
	let nextRoutine = 1;

	bridge.onReset(() => {
		routines.clear();
		gatedRuns.clear();
		suggestions.clear();
		nextRoutine = 1;
	});

	bridge.define('routines.list', async () => [...routines.values()]);

	bridge.define('routines.create-draft', async (input) => {
		const id = `fake-routine-${nextRoutine}`;
		nextRoutine += 1;
		const routine: RoutineRecord = {
			id,
			status: 'draft',
			origin: input.origin ?? 'user',
			label: input.label,
			when: input.when,
			run: input.run,
			evidence: input.evidence ?? [],
			createdAt: FAKE_ROUTINE_TIME,
			updatedAt: FAKE_ROUTINE_TIME,
		};
		routines.set(id, routine);
		if (input.suggestionId) suggestions.delete(input.suggestionId);
		return routine;
	});

	bridge.define('routines.promote', async (input) =>
		restatus(routines, input.routineId, 'routine'),
	);

	bridge.define('routines.demote', async (input) =>
		restatus(routines, input.routineId, 'candidate'),
	);

	bridge.define('routines.delete', async (input) => {
		routines.delete(input.routineId);
		return null;
	});

	bridge.define('routines.list-suggestions', async () => [...suggestions.values()]);

	bridge.define('routines.dismiss-suggestion', async (input) => {
		const suggestion = suggestions.get(input.suggestionId);
		if (!suggestion) throw new Error(`Unknown fake routine suggestion: ${input.suggestionId}`);
		const dismissed: RoutineSuggestionRecord = { ...suggestion, status: 'dismissed' };
		suggestions.set(dismissed.id, dismissed);
		return dismissed;
	});

	bridge.define('routines.list-gated-runs', async (input) =>
		[...gatedRuns.values()].filter(
			(run) =>
				(!input.workstreamId || run.workstreamId === input.workstreamId) &&
				(!input.state || run.state === input.state),
		),
	);

	bridge.define('routines.record-gated-run', async (input) => {
		const run: RoutineGatedRunRecord = {
			id: input.id,
			routineId: input.routineId,
			workstreamId: input.workstreamId,
			runKey: input.runKey,
			event: input.event,
			payload: input.payload,
			state: 'pending',
			createdAt: FAKE_ROUTINE_TIME,
			decidedAt: null,
		};
		gatedRuns.set(run.id, run);
		return run;
	});

	bridge.define('routines.confirm-run', async (input) =>
		decideGatedRun(gatedRuns, input.gatedRunId, 'confirmed'),
	);

	bridge.define('routines.reject-run', async (input) =>
		decideGatedRun(gatedRuns, input.gatedRunId, 'rejected'),
	);
}

function restatus(
	routines: Map<string, RoutineRecord>,
	routineId: string,
	status: RoutineRecord['status'],
): RoutineRecord {
	const routine = routines.get(routineId);
	if (!routine) throw new Error(`Unknown fake routine: ${routineId}`);
	const next: RoutineRecord = { ...routine, status, updatedAt: FAKE_ROUTINE_TIME };
	routines.set(routineId, next);
	return next;
}

function decideGatedRun(
	gatedRuns: Map<string, RoutineGatedRunRecord>,
	gatedRunId: string,
	state: 'confirmed' | 'rejected',
): RoutineGatedRunRecord {
	const run = gatedRuns.get(gatedRunId);
	if (!run) throw new Error(`Unknown fake gated run: ${gatedRunId}`);
	const next: RoutineGatedRunRecord = { ...run, state, decidedAt: FAKE_ROUTINE_TIME };
	gatedRuns.set(gatedRunId, next);
	return next;
}
