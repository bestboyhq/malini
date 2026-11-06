import type { CommandArgs, CommandName, CommandResult } from '$contract/commands';
import type {
	AcceptedAutomationSuggestion,
	AgentActionRecord,
	ChatTurnRecord,
	AutomationDefinitionRecord,
	AutomationExperimentRecord,
	AutomationExperimentsRecord,
	AutomationOutputRecord,
	AutomationRunRecord,
	AutomationSetupRecord,
	AutomationSuggestionRecord,
	ReconcilerDecisionRecord,
	RunAutomationArgs,
	SaveAutomationDefinitionArgs,
	SaveAutomationExperimentArgs,
	TimelineRecord,
} from '$contract/automations';
import { invoke } from '$shared/port/invoke';
import { AutomationFailureMapper } from '$lib/automations/infrastructure/mappers/automation-failure.mapper';

class AutomationsService {
	listDefinitions(): Promise<AutomationDefinitionRecord[]> {
		return this.#invoke('automations.list-definitions', undefined);
	}

	saveDefinition(args: SaveAutomationDefinitionArgs): Promise<AutomationDefinitionRecord> {
		return this.#invoke('automations.save-definition', args);
	}

	async deleteDefinition(definitionId: string): Promise<void> {
		await this.#invoke('automations.delete-definition', { definitionId });
	}

	resetDefinition(definitionId: string): Promise<AutomationDefinitionRecord> {
		return this.#invoke('automations.reset-definition', { definitionId });
	}

	listRuns(): Promise<AutomationRunRecord[]> {
		return this.#invoke('automations.list-runs', undefined);
	}

	listAgentActions(): Promise<AgentActionRecord[]> {
		return this.#invoke('automations.list-agent-actions', undefined);
	}

	listChatTurns(every: boolean): Promise<ChatTurnRecord[]> {
		return this.#invoke('automations.list-chat-turns', { every });
	}

	run(args: RunAutomationArgs): Promise<AutomationRunRecord> {
		return this.#invoke('automations.run', args);
	}

	confirmRun(automationRunId: string): Promise<AutomationRunRecord> {
		return this.#invoke('automations.confirm-run', { automationRunId });
	}

	cancelRun(automationRunId: string): Promise<AutomationRunRecord> {
		return this.#invoke('automations.cancel-run', { automationRunId });
	}

	listSuggestions(): Promise<AutomationSuggestionRecord[]> {
		return this.#invoke('automations.list-suggestions', undefined);
	}

	acceptSuggestion(
		suggestionId: string,
		automation?: Omit<SaveAutomationDefinitionArgs, 'id'>,
	): Promise<AcceptedAutomationSuggestion> {
		return this.#invoke(
			'automations.accept-suggestion',
			automation ? { suggestionId, automation } : { suggestionId },
		);
	}

	dismissSuggestion(suggestionId: string): Promise<AutomationSuggestionRecord> {
		return this.#invoke('automations.dismiss-suggestion', { suggestionId });
	}

	listOutputs(definitionId: string, since: string): Promise<AutomationOutputRecord[]> {
		return this.#invoke('automations.list-outputs', { definitionId, since });
	}

	listSetups(definitionId: string): Promise<AutomationSetupRecord[]> {
		return this.#invoke('automations.list-setups', { definitionId });
	}

	openExperiments(definitionId: string): Promise<AutomationExperimentsRecord> {
		return this.#invoke('automations.open-experiments', { definitionId });
	}

	saveExperiment(args: SaveAutomationExperimentArgs): Promise<AutomationExperimentRecord> {
		return this.#invoke('automations.save-experiment', args);
	}

	async deleteExperiment(experimentId: string): Promise<void> {
		await this.#invoke('automations.delete-experiment', { experimentId });
	}

	runExperiment(experimentId: string): Promise<AutomationExperimentRecord> {
		return this.#invoke('automations.run-experiment', { experimentId });
	}

	useExperiment(experimentId: string): Promise<AutomationDefinitionRecord> {
		return this.#invoke('automations.use-experiment', { experimentId });
	}

	listDecisions(): Promise<ReconcilerDecisionRecord[]> {
		return this.#invoke('automations.list-decisions', undefined);
	}

	decide(decisionId: string, candidate: number): Promise<ReconcilerDecisionRecord> {
		return this.#invoke('automations.decide', { decisionId, candidate });
	}

	listTimeline(since: string): Promise<TimelineRecord> {
		return this.#invoke('automations.list-timeline', { since });
	}

	async #invoke<Name extends CommandName>(
		command: Name,
		args: CommandArgs<Name>,
	): Promise<CommandResult<Name>> {
		try {
			return await invoke(command, args);
		} catch (error) {
			throw AutomationFailureMapper.fromRaw(error);
		}
	}
}

export const automationsService = new AutomationsService();
