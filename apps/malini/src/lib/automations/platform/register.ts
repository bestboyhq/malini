import { setTimeout as delay } from 'node:timers/promises';
import { REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL } from '$contract/events';
import type { OneShotAutomationBuiltin } from '$contract/automations';
import type { MainContext } from '$main/context';
import { nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import type { AutomationsPlatform, ShippingRule } from '../automations.platform';
import { pickOutput, promptCandidates } from '../domain/reconciler';
import { defineAutomationCommands, seedBuiltinAutomations } from './commands';
import { settleInterruptedAgentActions } from './agent-actions.repository';
import type {
	AnswerWithAutomation,
	ChooseWithAutomation,
	OneShotAutomation,
	SuggestWithAutomation,
} from './one-shot-automations.service';
import { BackgroundWork } from './background-work';
import { checkCompatibility } from './compatibility-check';
import { pruneEvents, startEventLog, type DispatchedEvent } from './event-log.service';
import { AutomationExperiments } from './automation-experiments.service';
import { AutomationRunner } from './automation-runner.service';
import { createAutomationSchedules } from './automation-schedules.service';
import { startAutomationTriggers } from './automation-triggers.service';
import { pruneDecisions } from './reconciler-decisions.repository';
import { Reconciler, type DeliverWake } from './reconciler.service';
import {
	forgetUnsuggestedAsks,
	HABIT_SCHEMA,
	suggestAutomationsAfterMerges,
} from './suggestions.service';

const HOUSEKEEPING_MS = 60 * 60 * 1_000;

const DECISIONS_KEEP_MS = 30 * 24 * 60 * 60 * 1_000;

const SETTLE_BUDGET_MS = 5_000;

export interface AutomationsOptions {
	readonly log?: (line: string) => void;
	readonly suggestTitle?: SuggestWithAutomation;
	readonly choose?: ChooseWithAutomation;
	readonly answer?: AnswerWithAutomation;
	readonly shipping?: ShippingRule;
	readonly resume?: (event: DispatchedEvent) => Promise<void>;
	readonly deliveries?: (event: DispatchedEvent) => Promise<void>;
	readonly deliver?: DeliverWake;
	readonly brainWorkstream?: () => Promise<string | null>;
}

const NO_RULE = (): Promise<void> => Promise.resolve();

const NO_SHIPPING: ShippingRule = {
	hear: () => Promise.resolve([]),
	decide: () => Promise.resolve(null),
	merging: () => false,
	triggered: () => Promise.resolve(false),
};

export function registerAutomations(
	context: MainContext,
	options: AutomationsOptions = {},
): AutomationsPlatform {
	const log = options.log ?? ((line: string) => console.error(line));
	const suggestTitle =
		options.suggestTitle ??
		(() => Promise.reject(new Error('Naming is not available in this Malini.')));
	const choose =
		options.choose ??
		(() => Promise.reject(new Error('Choosing is not available in this Malini.')));
	const answer =
		options.answer ??
		(() => Promise.reject(new Error('Answering is not available in this Malini.')));
	const work = new BackgroundWork(log);
	const runner = new AutomationRunner(context, log, work);
	const experiments = new AutomationExperiments(
		context,
		(builtin, task, automation) =>
			replay(builtin, task, automation, { suggestTitle, choose, answer }),
		log,
		work,
	);
	seedBuiltinAutomations(context.db);
	settleInterruptedAgentActions(context.db, nowIso8601());
	const shipping = options.shipping ?? NO_SHIPPING;
	const triggers = startAutomationTriggers(context, log, shipping);
	const schedules = createAutomationSchedules(context, log);
	const reconciler = new Reconciler(
		context,
		log,
		choose,
		{
			triggers: (event) => triggers.handle(event),
			thens: (event) => runner.startThen(event),
			shipping,
			resume: options.resume ?? NO_RULE,
			deliveries: options.deliveries ?? NO_RULE,
			schedules: async (event) => {
				await runner.recovered();
				await schedules.handle(event);
			},
			compatibility: (event) => checkCompatibility(context, event, log),
		},
		options.deliver ??
			(() => Promise.reject(new Error('Delivering prompts is not available in this Malini.'))),
		work,
	);
	defineAutomationCommands(
		context,
		runner,
		experiments,
		reconciler,
		options.brainWorkstream ?? (() => Promise.resolve(null)),
	);
	const eventLog = startEventLog(context, log, (event) => reconciler.handle(event), work);
	const stopSuggesting = suggestAutomationsAfterMerges(context, answer, log, work);
	const stopClosing = context.events.subscribe(
		REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
		({ workstreamId }) => {
			reconciler.close(workstreamId);
			void runner
				.close(workstreamId)
				.catch((error: unknown) =>
					log(
						`automations: could not cancel the automations of \`${workstreamId}\`: ${describeError(error)}`,
					),
				);
		},
	);
	const prune = (): void => {
		try {
			pruneEvents(context.db);
			pruneDecisions(context.db, new Date(Date.now() - DECISIONS_KEEP_MS).toISOString());
			forgetUnsuggestedAsks(context.db);
		} catch (error) {
			log(`automations: could not prune the event log: ${describeError(error)}`);
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
			stopClosing();
			schedules.dispose();
			triggers.dispose();
			reconciler.dispose();
			runner.dispose();
		},
		settled: async () => {
			const late = await Promise.race([
				work.settled(),
				delay(SETTLE_BUDGET_MS, 'late', { ref: false }),
			]);
			// ponytail: work past the budget meets a closed database; abort each job if that shows up
			if (late === 'late') log('automations: Malini closed before its work finished');
		},
	};
}

type OneShotAnswers = Readonly<{
	suggestTitle: SuggestWithAutomation;
	choose: ChooseWithAutomation;
	answer: AnswerWithAutomation;
}>;

async function replay(
	builtin: OneShotAutomationBuiltin,
	task: string,
	automation: OneShotAutomation,
	{ suggestTitle, choose, answer }: OneShotAnswers,
): Promise<string> {
	if (builtin === 'suggest-automations') {
		return JSON.stringify(await answer(task, automation, HABIT_SCHEMA));
	}
	if (builtin !== 'reconcile') return suggestTitle(task, automation);
	const labels = promptCandidates(task);
	if (labels.length < 2) throw new Error('This decision has no candidates to pick from.');
	return pickOutput(labels, await choose(task, automation, labels.length));
}
