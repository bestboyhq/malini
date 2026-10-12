import type { RoutineSuggestion } from './routine-suggestion';

export type RoutineJob = Readonly<{ id: string; name: string }>;

export type RoutineJobDraft = Readonly<{ name: string; instructions: string }>;

const SUGGESTED_JOB_NAME_LENGTH = 60;

export function sortRoutineJobsByName(jobs: readonly RoutineJob[]): readonly RoutineJob[] {
	return [...jobs].sort(
		(left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
	);
}

export function suggestedRoutineJob(suggestion: RoutineSuggestion): RoutineJobDraft | null {
	const instructions = suggestion.evidence[0]?.text.trim() ?? '';
	if (!instructions) return null;
	return { name: summarizePrompt(instructions, SUGGESTED_JOB_NAME_LENGTH), instructions };
}

function summarizePrompt(prompt: string, length: number): string {
	const line = prompt.split('\n')[0]?.replaceAll(/\s+/gu, ' ').trim() ?? '';
	return line.length > length ? `${line.slice(0, length - 1).trimEnd()}…` : line;
}
