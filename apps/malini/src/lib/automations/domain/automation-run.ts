import {
	DEFAULT_AUTOMATIONS_MAX_CONCURRENT,
	AUTOMATIONS_MAX_CONCURRENT_RANGE,
	type AutomationRunOrigin,
	type AutomationRunRecord,
	type AutomationRunStatus,
} from '$contract/automations';
import { isAlreadyActiveError, isCancelRaceError } from '$lib/chat/domain/prompt-dispatch-failure';

export const AUTOMATION_CONTEXT_MAX_BYTES = 64 * 1024;

export const AUTOMATION_CHAIN_MAX_DEPTH = 32;

export const AUTOMATION_CHAIN_REPEAT_LIMIT = 3;

export function chainBudgetDetail(runs: number): string {
	return `It already ran ${runs} times in one chain of events, so Malini asks before it runs again.`;
}

export function foldedAutomationContext(
	existing: string | null,
	added: string | null,
): string | null {
	if (added === null) return existing;
	return truncateAutomationContext(existing === null ? added : `${existing}\n\n${added}`);
}

export function isFinishedAutomationRunStatus(status: AutomationRunStatus): boolean {
	return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export function automationRunLastActivityAt(
	run: Pick<AutomationRunRecord, 'createdAt' | 'startedAt' | 'finishedAt'>,
): string {
	return run.finishedAt ?? run.startedAt ?? run.createdAt;
}

export function isAutomationRunOrigin(value: unknown): value is AutomationRunOrigin {
	return (
		value === 'merge-queue' ||
		value === 'manual' ||
		value === 'trigger' ||
		value === 'then' ||
		value === 'schedule' ||
		value === 'reconciler' ||
		value === 'compatibility'
	);
}

export function automationPrompt(instructions: string, context: string | null): string {
	return context ? `${instructions}\n\n${context}` : instructions;
}

export function truncateAutomationContext(text: string): string {
	const { read } = new TextEncoder().encodeInto(text, new Uint8Array(AUTOMATION_CONTEXT_MAX_BYTES));
	return text.slice(0, read);
}

export function automationsMaxConcurrent(setting: string | null | undefined): number {
	const parsed = Number.parseInt(setting ?? '', 10);
	if (Number.isNaN(parsed)) return DEFAULT_AUTOMATIONS_MAX_CONCURRENT;
	return Math.min(
		AUTOMATIONS_MAX_CONCURRENT_RANGE.max,
		Math.max(AUTOMATIONS_MAX_CONCURRENT_RANGE.min, parsed),
	);
}

export function workstreamWasBusy(error: unknown): boolean {
	return error instanceof Error && isAlreadyActiveError(error.message);
}

export function agentRunWasAlreadyGone(error: unknown): boolean {
	return error instanceof Error && isCancelRaceError(error.message);
}
