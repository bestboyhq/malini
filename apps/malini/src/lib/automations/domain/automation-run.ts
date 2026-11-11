import {
	ACTIVE_AUTOMATION_RUN_STATUSES,
	DEFAULT_AUTOMATIONS_MAX_CONCURRENT,
	AUTOMATIONS_MAX_CONCURRENT_RANGE,
	PENDING_AUTOMATION_RUN_STATUSES,
	UNFINISHED_AUTOMATION_RUN_STATUSES,
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
	return !UNFINISHED_AUTOMATION_RUN_STATUSES.includes(status);
}

export function isActiveAutomationRunStatus(status: AutomationRunStatus): boolean {
	return ACTIVE_AUTOMATION_RUN_STATUSES.includes(status);
}

export function isPendingAutomationRunStatus(status: AutomationRunStatus): boolean {
	return PENDING_AUTOMATION_RUN_STATUSES.includes(status);
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
	const parsed = Number(setting ?? '');
	if (!setting?.trim() || !Number.isFinite(parsed)) return DEFAULT_AUTOMATIONS_MAX_CONCURRENT;
	const { min, max } = AUTOMATIONS_MAX_CONCURRENT_RANGE;
	return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function workstreamWasBusy(error: unknown): boolean {
	return error instanceof Error && isAlreadyActiveError(error.message);
}

export function agentRunWasAlreadyGone(error: unknown): boolean {
	return error instanceof Error && isCancelRaceError(error.message);
}
