import type { AutomaticJobBuiltin } from '$contract/jobs';
import { BUILTIN_JOBS } from '$lib/jobs/domain/builtin-jobs';

export type JobOutputNoun = Readonly<{ one: string; many: string; gives: string }>;

export const JOB_OUTPUT_NOUN: Readonly<Record<AutomaticJobBuiltin, JobOutputNoun>> = {
	'name-chats': { one: 'name', many: 'names', gives: 'every name it gives' },
	'name-services': { one: 'name', many: 'names', gives: 'every name it gives' },
	reconcile: { one: 'pick', many: 'picks', gives: 'every pick it makes' },
};

export function percent(rate: number): string {
	return `${Math.round(rate * 100)}%`;
}

export function instructionsLabel(builtin: AutomaticJobBuiltin, instructions: string): string {
	return instructions.trim() === BUILTIN_JOBS[builtin].instructions.trim()
		? 'default instructions'
		: 'edited instructions';
}

export function shortDay(date: Date): string {
	return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function weekdayTime(iso: string): string {
	return new Date(iso).toLocaleString(undefined, {
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
	});
}
