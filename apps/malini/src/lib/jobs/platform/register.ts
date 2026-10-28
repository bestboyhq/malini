import type { AutomaticJobBuiltin } from '$contract/jobs';
import type { MainContext } from '$main/context';
import { nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import type { JobsPlatform } from '../jobs.platform';
import { pickOutput, promptCandidates } from '../domain/reconciler';
import { defineJobCommands, seedBuiltinJobs } from './commands';
import { settleInterruptedAgentActions } from './agent-actions.repository';
import type { AutomaticJob, ChooseWithJob, SuggestWithJob } from './automatic-jobs.service';
import { checkCompatibility } from './compatibility-check';
import { pruneEvents, startEventLog, type DispatchedEvent } from './event-log.service';
import { JobExperiments } from './job-experiments.service';
import { JobRunner } from './job-runner.service';
import { createJobSchedules } from './job-schedules.service';
import { startJobTriggers } from './job-triggers.service';
import { pruneDecisions } from './reconciler-decisions.repository';
import { Reconciler, type DeliverWake } from './reconciler.service';
import { suggestJobsFromPrompts } from './suggestions.service';

const HOUSEKEEPING_MS = 60 * 60 * 1_000;

const DECISIONS_KEEP_MS = 30 * 24 * 60 * 60 * 1_000;

export interface JobsOptions {
	readonly log?: (line: string) => void;
	readonly suggestTitle?: SuggestWithJob;
	readonly choose?: ChooseWithJob;
	readonly shipping?: (event: DispatchedEvent) => Promise<void>;
	readonly resume?: (event: DispatchedEvent) => Promise<void>;
	readonly deliveries?: (event: DispatchedEvent) => Promise<void>;
	readonly deliver?: DeliverWake;
}

const NO_RULE = (): Promise<void> => Promise.resolve();

export function registerJobs(context: MainContext, options: JobsOptions = {}): JobsPlatform {
	const log = options.log ?? ((line: string) => console.error(line));
	const suggestTitle =
		options.suggestTitle ??
		(() => Promise.reject(new Error('Naming is not available in this Malini.')));
	const choose =
		options.choose ??
		(() => Promise.reject(new Error('Choosing is not available in this Malini.')));
	const runner = new JobRunner(context, log);
	const experiments = new JobExperiments(
		context,
		(builtin, task, job) => replay(builtin, task, job, suggestTitle, choose),
		log,
	);
	seedBuiltinJobs(context.db);
	settleInterruptedAgentActions(context.db, nowIso8601());
	const triggers = startJobTriggers(context, log);
	const schedules = createJobSchedules(context, log);
	const reconciler = new Reconciler(
		context,
		log,
		choose,
		{
			triggers: (event) => triggers.handle(event),
			thens: (event) => runner.startThen(event),
			shipping: options.shipping ?? NO_RULE,
			resume: options.resume ?? NO_RULE,
			deliveries: options.deliveries ?? NO_RULE,
			schedules: (event) => schedules.handle(event),
			compatibility: (event) => checkCompatibility(context, event, log),
		},
		options.deliver ??
			(() => Promise.reject(new Error('Delivering prompts is not available in this Malini.'))),
	);
	defineJobCommands(context, runner, experiments, reconciler);
	const eventLog = startEventLog(context, log, (event) => reconciler.handle(event));
	const stopSuggesting = suggestJobsFromPrompts(context, log);
	const prune = (): void => {
		try {
			pruneEvents(context.db);
			pruneDecisions(context.db, new Date(Date.now() - DECISIONS_KEEP_MS).toISOString());
		} catch (error) {
			log(`jobs: could not prune the event log: ${describeError(error)}`);
		}
	};
	let housekeeping: NodeJS.Timeout | null = null;
	return {
		start: () => {
			runner.start();
			reconciler.start();
			schedules.start();
			prune();
			housekeeping ??= setInterval(prune, HOUSEKEEPING_MS).unref();
		},
		dispose: () => {
			if (housekeeping) clearInterval(housekeeping);
			eventLog.dispose();
			stopSuggesting();
			schedules.dispose();
			triggers.dispose();
			reconciler.dispose();
			runner.dispose();
		},
	};
}

async function replay(
	builtin: AutomaticJobBuiltin,
	task: string,
	job: AutomaticJob,
	suggestTitle: SuggestWithJob,
	choose: ChooseWithJob,
): Promise<string> {
	if (builtin !== 'reconcile') return suggestTitle(task, job);
	const labels = promptCandidates(task);
	if (labels.length < 2) throw new Error('This decision has no candidates to pick from.');
	return pickOutput(labels, await choose(task, job, labels.length));
}
