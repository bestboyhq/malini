import type { RoutineSuggestionRecord as RawRoutineSuggestion } from '$contract/routines';
import type { RoutineSuggestion } from '$lib/routines/domain/routine-suggestion';
import { RoutineMapper } from './routine.mapper';

export class RoutineSuggestionMapper {
	static fromRawList(raws: readonly RawRoutineSuggestion[]): readonly RoutineSuggestion[] {
		return raws.map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawRoutineSuggestion): RoutineSuggestion {
		return {
			id: raw.id,
			clusterKey: raw.clusterKey,
			status: raw.status,
			evidence: raw.evidence.map((entry) => RoutineMapper.promptEvidenceFromRaw(entry)),
			createdAt: raw.createdAt,
			updatedAt: raw.updatedAt,
		};
	}
}
