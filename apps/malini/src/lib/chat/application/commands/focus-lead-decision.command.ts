import { leadDecisionFocusStore } from '$lib/chat/infrastructure/stores/lead-decision-focus.store.svelte';

export function focusLeadDecisionCommand(decisionId: string | null): void {
	leadDecisionFocusStore.focusedId = decisionId;
	if (decisionId !== null) leadDecisionFocusStore.asideIds = new Set();
}

export function setLeadDecisionsAsideCommand(decisionIds: readonly string[]): void {
	leadDecisionFocusStore.asideIds = new Set(decisionIds);
	leadDecisionFocusStore.focusedId = null;
}

export function viewLeadDecisionCommand(decisionId: string, option: number): void {
	leadDecisionFocusStore.viewing = { decisionId, option };
}

export function closeLeadDecisionViewerCommand(): void {
	leadDecisionFocusStore.viewing = null;
}
