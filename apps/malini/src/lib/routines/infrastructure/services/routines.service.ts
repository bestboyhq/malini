import type { RoutineDraft } from '$lib/routines/domain/routine-draft';
import type { Routine } from '$lib/routines/domain/routine';
import type { RoutineSuggestion } from '$lib/routines/domain/routine-suggestion';
import { invoke } from '$shared/port/invoke';
import { RoutineMapper } from '$lib/routines/infrastructure/mappers/routine.mapper';
import { RoutineSuggestionMapper } from '$lib/routines/infrastructure/mappers/routine-suggestion.mapper';

class RoutinesService {
	async list(): Promise<readonly Routine[]> {
		return RoutineMapper.fromRawList(await invoke('routines.list', undefined));
	}

	async createDraft(draft: RoutineDraft): Promise<Routine> {
		return RoutineMapper.fromRaw(
			await invoke('routines.create-draft', {
				label: draft.label,
				when: draft.when,
				run: draft.run,
				...(draft.origin === undefined ? {} : { origin: draft.origin }),
				...(draft.evidence === undefined ? {} : { evidence: draft.evidence }),
				...(draft.suggestionId === undefined ? {} : { suggestionId: draft.suggestionId }),
			}),
		);
	}

	async promote(routineId: string): Promise<Routine> {
		return RoutineMapper.fromRaw(await invoke('routines.promote', { routineId }));
	}

	async demote(routineId: string): Promise<Routine> {
		return RoutineMapper.fromRaw(await invoke('routines.demote', { routineId }));
	}

	async delete(routineId: string): Promise<void> {
		await invoke('routines.delete', { routineId });
	}

	async listSuggestions(): Promise<readonly RoutineSuggestion[]> {
		return RoutineSuggestionMapper.fromRawList(
			await invoke('routines.list-suggestions', undefined),
		);
	}

	async dismissSuggestion(suggestionId: string): Promise<RoutineSuggestion> {
		return RoutineSuggestionMapper.fromRaw(
			await invoke('routines.dismiss-suggestion', { suggestionId }),
		);
	}
}

export const routinesService = new RoutinesService();
