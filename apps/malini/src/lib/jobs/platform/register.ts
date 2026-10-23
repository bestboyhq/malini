import type { MainContext } from '$main/context';
import { nowIso8601 } from '$main/db/rows';
import type { JobsPlatform } from '../jobs.platform';
import { defineJobCommands, seedBuiltinJobs } from './commands';
import { settleInterruptedAgentActions } from './agent-actions.repository';
import type { SuggestWithJob } from './automatic-jobs.service';
import { checkCompatibilityAfterUpdates } from './compatibility-check';
import { JobExperiments } from './job-experiments.service';
import { JobRunner } from './job-runner.service';
import { startJobTriggers } from './job-triggers.service';
import { suggestJobsFromPrompts } from './suggestions.service';

export interface JobsOptions {
	readonly log?: (line: string) => void;
	readonly suggestTitle?: SuggestWithJob;
}

export function registerJobs(context: MainContext, options: JobsOptions = {}): JobsPlatform {
	const log = options.log ?? ((line: string) => console.error(line));
	const runner = new JobRunner(context, log);
	const experiments = new JobExperiments(
		context,
		options.suggestTitle ??
			(() => Promise.reject(new Error('Naming is not available in this Malini.'))),
		log,
	);
	seedBuiltinJobs(context.db);
	settleInterruptedAgentActions(context.db, nowIso8601());
	defineJobCommands(context, runner, experiments);
	const stopCompatibilityChecks = checkCompatibilityAfterUpdates(context, log);
	const triggers = startJobTriggers(context, log);
	const stopSuggesting = suggestJobsFromPrompts(context, log);
	return {
		start: () => runner.start(),
		dispose: () => {
			stopSuggesting();
			triggers.dispose();
			stopCompatibilityChecks();
			runner.dispose();
		},
	};
}
