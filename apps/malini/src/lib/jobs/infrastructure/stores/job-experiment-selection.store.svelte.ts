class JobExperimentSelectionStore {
	selected = $state.raw<Readonly<Record<string, string>>>({});

	select(definitionId: string, experimentId: string): void {
		this.selected = { ...this.selected, [definitionId]: experimentId };
	}
}

export const jobExperimentSelectionStore = new JobExperimentSelectionStore();

export function jobExperimentsActionId(definitionId: string): string {
	return `jobs.experiments:${definitionId}`;
}
