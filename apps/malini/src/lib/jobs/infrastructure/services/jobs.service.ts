import type { CommandArgs, CommandName, CommandResult } from '$contract/commands';
import type {
	AgentActionRecord,
	ChatTurnRecord,
	JobDefinitionRecord,
	JobExperimentRecord,
	JobExperimentsRecord,
	JobOutputRecord,
	JobRunRecord,
	JobSetupRecord,
	JobSuggestionRecord,
	RunJobArgs,
	SaveJobDefinitionArgs,
	SaveJobExperimentArgs,
} from '$contract/jobs';
import { invoke } from '$shared/port/invoke';
import { JobFailureMapper } from '$lib/jobs/infrastructure/mappers/job-failure.mapper';

class JobsService {
	listDefinitions(): Promise<JobDefinitionRecord[]> {
		return this.#invoke('jobs.list-definitions', undefined);
	}

	saveDefinition(args: SaveJobDefinitionArgs): Promise<JobDefinitionRecord> {
		return this.#invoke('jobs.save-definition', args);
	}

	async deleteDefinition(definitionId: string): Promise<void> {
		await this.#invoke('jobs.delete-definition', { definitionId });
	}

	resetDefinition(definitionId: string): Promise<JobDefinitionRecord> {
		return this.#invoke('jobs.reset-definition', { definitionId });
	}

	listRuns(): Promise<JobRunRecord[]> {
		return this.#invoke('jobs.list-runs', undefined);
	}

	listAgentActions(): Promise<AgentActionRecord[]> {
		return this.#invoke('jobs.list-agent-actions', undefined);
	}

	listChatTurns(every: boolean): Promise<ChatTurnRecord[]> {
		return this.#invoke('jobs.list-chat-turns', { every });
	}

	run(args: RunJobArgs): Promise<JobRunRecord> {
		return this.#invoke('jobs.run', args);
	}

	confirmRun(jobRunId: string): Promise<JobRunRecord> {
		return this.#invoke('jobs.confirm-run', { jobRunId });
	}

	cancelRun(jobRunId: string): Promise<JobRunRecord> {
		return this.#invoke('jobs.cancel-run', { jobRunId });
	}

	listSuggestions(): Promise<JobSuggestionRecord[]> {
		return this.#invoke('jobs.list-suggestions', undefined);
	}

	acceptSuggestion(suggestionId: string): Promise<JobDefinitionRecord> {
		return this.#invoke('jobs.accept-suggestion', { suggestionId });
	}

	dismissSuggestion(suggestionId: string): Promise<JobSuggestionRecord> {
		return this.#invoke('jobs.dismiss-suggestion', { suggestionId });
	}

	listOutputs(definitionId: string, since: string): Promise<JobOutputRecord[]> {
		return this.#invoke('jobs.list-outputs', { definitionId, since });
	}

	listSetups(definitionId: string): Promise<JobSetupRecord[]> {
		return this.#invoke('jobs.list-setups', { definitionId });
	}

	openExperiments(definitionId: string): Promise<JobExperimentsRecord> {
		return this.#invoke('jobs.open-experiments', { definitionId });
	}

	saveExperiment(args: SaveJobExperimentArgs): Promise<JobExperimentRecord> {
		return this.#invoke('jobs.save-experiment', args);
	}

	async deleteExperiment(experimentId: string): Promise<void> {
		await this.#invoke('jobs.delete-experiment', { experimentId });
	}

	runExperiment(experimentId: string): Promise<JobExperimentRecord> {
		return this.#invoke('jobs.run-experiment', { experimentId });
	}

	useExperiment(experimentId: string): Promise<JobDefinitionRecord> {
		return this.#invoke('jobs.use-experiment', { experimentId });
	}

	async #invoke<Name extends CommandName>(
		command: Name,
		args: CommandArgs<Name>,
	): Promise<CommandResult<Name>> {
		try {
			return await invoke(command, args);
		} catch (error) {
			throw JobFailureMapper.fromRaw(error);
		}
	}
}

export const jobsService = new JobsService();
