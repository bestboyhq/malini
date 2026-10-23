import type { AutomaticJobBuiltin } from '$contract/jobs';
import { BUILTIN_JOBS } from '$lib/jobs/domain/builtin-jobs';

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
