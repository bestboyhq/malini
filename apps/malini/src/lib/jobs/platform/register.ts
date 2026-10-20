import type { MainContext } from '$main/context';
import type { JobsPlatform } from '../jobs.platform';
import { defineJobCommands, seedBuiltinJobs } from './commands';
import { checkCompatibilityAfterUpdates } from './compatibility-check';
import { JobRunner } from './job-runner.service';

export interface JobsOptions {
	readonly log?: (line: string) => void;
}

export function registerJobs(context: MainContext, options: JobsOptions = {}): JobsPlatform {
	const log = options.log ?? ((line: string) => console.error(line));
	const runner = new JobRunner(context, log);
	seedBuiltinJobs(context.db);
	defineJobCommands(context, runner);
	const stopCompatibilityChecks = checkCompatibilityAfterUpdates(context, log);
	return {
		start: () => runner.start(),
		dispose: () => {
			stopCompatibilityChecks();
			runner.dispose();
		},
	};
}
