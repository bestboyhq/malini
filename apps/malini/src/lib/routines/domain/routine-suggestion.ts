import type { RoutinePromptEvidence } from './routine';

export type RoutineSuggestionStatus = 'open' | 'dismissed' | 'accepted';

export type RoutineSuggestion = Readonly<{
	id: string;
	clusterKey: string;
	status: RoutineSuggestionStatus;
	evidence: readonly RoutinePromptEvidence[];
	createdAt: string;
	updatedAt: string;
}>;

export function sortSuggestionsNewestFirst(
	suggestions: readonly RoutineSuggestion[],
): readonly RoutineSuggestion[] {
	return [...suggestions].sort(
		(left, right) =>
			right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
	);
}
