import type { CommandArgs, CommandName, CommandResult } from '$contract/commands';
import type {
	JobDefinitionRecord,
	JobRunRecord,
	RunJobArgs,
	SaveJobDefinitionArgs,
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

	run(args: RunJobArgs): Promise<JobRunRecord> {
		return this.#invoke('jobs.run', args);
	}

	cancelRun(jobRunId: string): Promise<JobRunRecord> {
		return this.#invoke('jobs.cancel-run', { jobRunId });
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
