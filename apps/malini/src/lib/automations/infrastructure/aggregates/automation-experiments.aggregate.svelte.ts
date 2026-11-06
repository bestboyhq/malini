import type {
	AutomationExperimentRecord,
	AutomationExperimentsRecord,
} from '$contract/automations';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';

class AutomationExperimentsAggregate {
	sessions = $state.raw<Readonly<Record<string, AutomationExperimentsRecord>>>({});
	loadErrors = $state.raw<Readonly<Record<string, string>>>({});

	async open(definitionId: string): Promise<void> {
		try {
			const session = await automationsService.openExperiments(definitionId);
			this.sessions = { ...this.sessions, [definitionId]: session };
			this.loadErrors = Object.fromEntries(
				Object.entries(this.loadErrors).filter(([key]) => key !== definitionId),
			);
		} catch (error) {
			this.loadErrors = {
				...this.loadErrors,
				[definitionId]: error instanceof Error ? error.message : String(error),
			};
		}
	}

	apply(experiment: AutomationExperimentRecord): void {
		const session = this.sessions[experiment.definitionId];
		if (!session) return;
		const known = session.experiments.some((existing) => existing.id === experiment.id);
		this.sessions = {
			...this.sessions,
			[experiment.definitionId]: {
				...session,
				experiments: known
					? session.experiments.map((existing) =>
							existing.id === experiment.id ? experiment : existing,
						)
					: [...session.experiments, experiment],
			},
		};
	}

	remove(definitionId: string, experimentId: string): void {
		const session = this.sessions[definitionId];
		if (!session) return;
		this.sessions = {
			...this.sessions,
			[definitionId]: {
				...session,
				experiments: session.experiments.filter((experiment) => experiment.id !== experimentId),
			},
		};
	}

	close(definitionId: string): void {
		this.sessions = Object.fromEntries(
			Object.entries(this.sessions).filter(([key]) => key !== definitionId),
		);
	}
}

export const automationExperimentsAggregate = new AutomationExperimentsAggregate();
