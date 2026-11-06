class AutomationExperimentSelectionStore {
	selected = $state.raw<Readonly<Record<string, string>>>({});

	select(definitionId: string, experimentId: string): void {
		this.selected = { ...this.selected, [definitionId]: experimentId };
	}
}

export const automationExperimentSelectionStore = new AutomationExperimentSelectionStore();

export function automationExperimentsActionId(definitionId: string): string {
	return `automations.experiments:${definitionId}`;
}
