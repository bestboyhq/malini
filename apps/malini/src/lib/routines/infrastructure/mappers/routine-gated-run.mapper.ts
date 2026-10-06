import type { RoutineGatedRunRecord as RawRoutineGatedRun } from '$contract/routines';
import type { RoutineGatedRun } from '$lib/routines/domain/routine-gated-run';

export class RoutineGatedRunMapper {
	static fromRawList(raws: readonly RawRoutineGatedRun[]): readonly RoutineGatedRun[] {
		return raws.map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawRoutineGatedRun): RoutineGatedRun {
		return {
			id: raw.id,
			routineId: raw.routineId,
			workstreamId: raw.workstreamId,
			runKey: raw.runKey,
			event: raw.event,
			payload: raw.payload,
			state: raw.state,
			createdAt: raw.createdAt,
			decidedAt: raw.decidedAt,
		};
	}
}
