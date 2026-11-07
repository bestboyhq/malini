import type { OneShotAutomationBuiltin } from '$contract/automations';
import { BUILTIN_AUTOMATIONS } from '$lib/automations/domain/builtin-automations';

export type AutomationOutputNoun = Readonly<{ one: string; many: string; gives: string }>;

export const AUTOMATION_OUTPUT_NOUN: Readonly<
	Record<OneShotAutomationBuiltin, AutomationOutputNoun>
> = {
	'name-chats': { one: 'name', many: 'names', gives: 'every name it gives' },
	'name-services': { one: 'name', many: 'names', gives: 'every name it gives' },
	reconcile: { one: 'pick', many: 'picks', gives: 'every pick it makes' },
	'suggest-automations': { one: 'answer', many: 'answers', gives: 'every answer it gives' },
};

export function percent(rate: number): string {
	return `${Math.round(rate * 100)}%`;
}

export function instructionsLabel(builtin: OneShotAutomationBuiltin, instructions: string): string {
	return instructions.trim() === BUILTIN_AUTOMATIONS[builtin].instructions.trim()
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
