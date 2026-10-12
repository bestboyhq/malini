import type { JobDefinitionRecord as RawRoutineJob } from '$contract/jobs';
import type { RoutineJob } from '$lib/routines/domain/routine-job';

export class RoutineJobMapper {
	static fromRawList(raws: readonly RawRoutineJob[]): readonly RoutineJob[] {
		return raws.map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawRoutineJob): RoutineJob {
		return { id: raw.id, name: raw.name };
	}
}
