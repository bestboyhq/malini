class LeadDecisionFocusStore {
	focusedId = $state<string | null>(null);
	asideIds = $state.raw<ReadonlySet<string>>(new Set());
	viewing = $state.raw<Readonly<{ decisionId: string; option: number }> | null>(null);
}

export const leadDecisionFocusStore = new LeadDecisionFocusStore();
