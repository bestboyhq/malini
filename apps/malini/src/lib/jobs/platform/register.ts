import type { MainContext } from '$main/context';
import type { JobsPlatform } from '../jobs.platform';
import { defineJobCommands, seedBuiltinJobs } from './commands';
import { JobRunner } from './job-runner.service';

export interface JobsOptions {
	readonly log?: (line: string) => void;
}

export function registerJobs(context: MainContext, options: JobsOptions = {}): JobsPlatform {
	const runner = new JobRunner(context, options.log ?? ((line: string) => console.error(line)));
	seedBuiltinJobs(context.db);
	defineJobCommands(context, runner);
	return { start: () => runner.start(), dispose: () => runner.dispose() };
}
