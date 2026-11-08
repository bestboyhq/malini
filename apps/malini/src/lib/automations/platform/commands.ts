import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
	SCHEDULE_GRAMMAR,
	parseAutomationTrigger,
	scheduleWhen,
	type SchedulePlace,
} from '$contract/automation-trigger';
import {
	AUTOMATIONS_DEFINITION_CHANGED_CHANNEL,
	AUTOMATIONS_SUGGESTED_CHANNEL,
} from '$contract/events';
import {
	DEFAULT_AUTOMATION_BOUNDARY,
	NEW_AUTOMATION_BOUNDARY,
	isAgentlessAutomationBuiltin,
	isBrainAutomationBuiltin,
	type AutomationBoundary,
	type AutomationBuiltin,
	type AutomationDefinitionChangedEvent,
	type AutomationDefinitionRecord,
	type AutomationRunOrigin,
	type AutomationRunRecord,
	type AutomationSuggestedEvent,
	type AutomationSuggestionRecord,
	type AutomationTrigger,
	type SaveAutomationDefinitionArgs,
	type TimelineRecord,
	type TimelineWorkstream,
} from '$contract/automations';
import { isSkillNameList } from '$contract/skills';
import { chatTurnChainId, listChatTurns, listChatTurnsSince } from '$lib/chat/chat.platform';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import {
	DEFAULT_AGENT_MODEL,
	DEFAULT_PROVIDER_ID,
	isValidAgentModel,
	isValidProviderId,
} from '$shared/providers/providers.platform';
import {
	getWorkstream,
	listRepositoryCatalog,
	parseLeadScope,
	repositoryOwner,
	resolveConnectedRepository,
} from '$shared/repositories/repositories.platform';
import {
	BUILTIN_AUTOMATIONS,
	BUILTIN_AUTOMATION_KEYS,
	isRunnableAutomation,
	isTriggerableAutomation,
	takesThen,
} from '../domain/builtin-automations';
import {
	AUTOMATION_INSTRUCTIONS_MAX_LENGTH,
	AUTOMATION_NAME_MAX_LENGTH,
	isAutomationBoundary,
	isAutomationEffort,
	isAutomationRunMode,
	isAutomationRunsIn,
} from '../domain/automation-definition';
import {
	AUTOMATION_CHAIN_MAX_DEPTH,
	AUTOMATION_CHAIN_REPEAT_LIMIT,
	AUTOMATION_CONTEXT_MAX_BYTES,
	chainBudgetDetail,
	isFinishedAutomationRunStatus,
	isAutomationRunOrigin,
} from '../domain/automation-run';
import { listAgentActions } from './agent-actions.repository';
import type { OneShotAutomation } from './one-shot-automations.service';
import {
	countLoggedEventsSince,
	eventChainId,
	automationRunEventIds,
	linkAutomationRunEvent,
	listLoggedEventsSince,
} from './event-log.repository';
import { EVENT_LOG_KEEP_MS } from './event-log.service';
import {
	isOneShotAutomationDefinition,
	type OneShotAutomationDefinition,
	type AutomationExperiments,
} from './automation-experiments.service';
import { listAutomationOutputs, listAutomationSetups } from './automation-outputs.repository';
import {
	clearThenLinksTo,
	deleteAutomationDefinition,
	getBuiltinAutomationDefinition,
	getAutomationDefinition,
	insertAutomationDefinition,
	listAutomationDefinitions,
	updateAutomationDefinition,
} from './automation-definitions.repository';
import {
	countChainAutomationRuns,
	countStartedOrQueuedAutomationRuns,
	findPendingAutomationRun,
	getAutomationRun,
	automationRunChainDefinitionIds,
	automationRunChainId,
	listAutomationRunsSince,
	listRecentFinishedAutomationRuns,
	listUnfinishedAutomationRuns,
	listWaitingAutomationRuns,
} from './automation-runs.repository';
import {
	getSuggestion,
	listShownSuggestions,
	settleSuggestion,
} from './automation-suggestions.repository';
import type { AutomationRunner } from './automation-runner.service';
import {
	listAskingDecisions,
	listDecisions,
	listDecisionsSince,
} from './reconciler-decisions.repository';
import type { Reconciler } from './reconciler.service';

const RECENT_FINISHED_RUNS = 30;

const RECENT_DECISIONS = 60;

const TIMELINE_EVENTS = 2_000;

const TIMELINE_PAYLOAD_CHARS = 4_096;

const TRIGGER_GRAMMAR = `on <channel>, optionally followed by where <path> is <value> or where <path> is set, joined with and; or ${SCHEDULE_GRAMMAR}`;

export type AutomationErrorKind =
	'invalid-args' | 'not-found' | 'builtin' | 'not-builtin' | 'busy' | 'loop';

export class AutomationError extends Error {
	readonly kind: AutomationErrorKind;

	constructor(kind: AutomationErrorKind, message: string) {
		super(message);
		this.name = 'AutomationError';
		this.kind = kind;
	}
}

type AutomationDefinitionFields = Pick<
	AutomationDefinitionRecord,
	'name' | 'instructions' | 'provider' | 'model' | 'effort' | 'runsIn'
> &
	Readonly<{ skills: readonly string[] | null }>;

type BuiltinFields = Pick<
	AutomationDefinitionRecord,
	'name' | 'instructions' | 'provider' | 'model' | 'effort' | 'runsIn' | 'trigger'
>;

const CHAT_TURNS_SHOWN = 100;

export function seedBuiltinAutomations(db: MaliniDatabase): void {
	const now = nowIso8601();
	const inserted = BUILTIN_AUTOMATION_KEYS.flatMap((builtin) => {
		const definition: AutomationDefinitionRecord = {
			id: randomUUID(),
			...builtinFields(builtin),
			thenAutomationId: null,
			skills: [],
			builtin,
			boundary: builtinBoundary(builtin),
			createdAt: now,
			updatedAt: now,
		};
		return insertAutomationDefinition(db, definition) ? [{ builtin, definition }] : [];
	});
	for (const { builtin, definition } of inserted) {
		const thenAutomationId = defaultThen(db, builtin);
		if (thenAutomationId !== null)
			updateAutomationDefinition(db, { ...definition, thenAutomationId });
	}
}

export function defineAutomationCommands(
	context: MainContext,
	runner: AutomationRunner,
	experiments: AutomationExperiments,
	reconciler: Reconciler,
	brainWorkstream: () => Promise<string | null>,
): void {
	const { db, commands, events } = context;

	const definitionChanged = (
		definitionId: string,
		definition: AutomationDefinitionRecord | null,
	): void => {
		const payload: AutomationDefinitionChangedEvent = { definitionId, definition };
		events.emit(AUTOMATIONS_DEFINITION_CHANGED_CHANNEL, payload);
	};

	const skipWaitingRuns = async (definitionId: string): Promise<void> => {
		for (const waiting of listWaitingAutomationRuns(db, definitionId)) await runner.cancel(waiting);
	};

	const saveChanged = async (
		before: AutomationDefinitionRecord,
		after: AutomationDefinitionRecord,
	): Promise<AutomationDefinitionRecord> => {
		updateAutomationDefinition(db, after);
		definitionChanged(after.id, after);
		if (disarms(before.trigger, after.trigger)) await skipWaitingRuns(after.id);
		return after;
	};

	commands.define('automations.list-definitions', () => listAutomationDefinitions(db));

	const createDefinition = async (args: unknown): Promise<AutomationDefinitionRecord> => {
		const fields = definitionFields(args);
		const trigger = await triggerField(db, args);
		const now = nowIso8601();
		const created: AutomationDefinitionRecord = {
			id: randomUUID(),
			...fields,
			skills: fields.skills ?? [],
			builtin: null,
			trigger: trigger ?? null,
			thenAutomationId: thenAutomationField(db, args, null) ?? null,
			boundary: boundaryField(args) ?? NEW_AUTOMATION_BOUNDARY,
			createdAt: now,
			updatedAt: now,
		};
		insertAutomationDefinition(db, created);
		definitionChanged(created.id, created);
		return created;
	};

	commands.define('automations.save-definition', async (args: unknown) => {
		const id = optionalString(args, 'id');
		if (id === null) return createDefinition(args);
		const fields = definitionFields(args);
		const trigger = await triggerField(db, args);
		const now = nowIso8601();
		const existing = requireDefinition(db, id);
		const thenAutomationId = thenAutomationField(db, args, existing.id);
		if (!isTriggerableAutomation(existing) && (trigger || thenAutomationId)) {
			throw new AutomationError(
				'builtin',
				`${existing.name} is built in and Malini starts it, so it takes no When or Then.`,
			);
		}
		if (thenAutomationId && !takesThen(existing)) {
			throw new AutomationError(
				'builtin',
				`${existing.name} takes no Then: when its merge stops on conflicts, Resolve conflicts takes them on its own trigger.`,
			);
		}
		const agentless = isAgentlessAutomationBuiltin(existing.builtin);
		if (agentless && trigger && parseAutomationTrigger(trigger.when).kind === 'schedule') {
			throw new AutomationError(
				'builtin',
				`${existing.name} works on the changes of a workstream, so it runs after an event or another automation, never on a schedule.`,
			);
		}
		return saveChanged(existing, {
			...existing,
			name: fields.name,
			...(agentless
				? {}
				: {
						instructions: fields.instructions,
						provider: fields.provider,
						model: fields.model,
						effort: fields.effort,
						skills: fields.skills ?? existing.skills,
					}),
			runsIn: existing.builtin ? existing.runsIn : fields.runsIn,
			trigger: trigger === undefined ? existing.trigger : trigger,
			thenAutomationId:
				thenAutomationId === undefined ? existing.thenAutomationId : thenAutomationId,
			boundary: agentless ? existing.boundary : (boundaryField(args) ?? existing.boundary),
			updatedAt: now,
		});
	});

	commands.define('automations.delete-definition', async (args: unknown) => {
		const definition = requireDefinition(db, requireString(args, 'definitionId'));
		if (definition.builtin) {
			throw new AutomationError('builtin', `${definition.name} is built in. Reset it instead.`);
		}
		if (countStartedOrQueuedAutomationRuns(db, definition.id) > 0) {
			throw new AutomationError(
				'busy',
				`${definition.name} is queued or running. Cancel it first.`,
			);
		}
		await skipWaitingRuns(definition.id);
		for (const linkedId of clearThenLinksTo(db, definition.id)) {
			definitionChanged(linkedId, getAutomationDefinition(db, linkedId));
		}
		deleteAutomationDefinition(db, definition.id);
		definitionChanged(definition.id, null);
		return null;
	});

	commands.define('automations.reset-definition', (args: unknown) => {
		const definition = requireDefinition(db, requireString(args, 'definitionId'));
		const builtin: AutomationBuiltin | null = definition.builtin;
		if (builtin === null)
			throw new AutomationError('not-builtin', 'Only a built-in automation can be reset.');
		return saveChanged(definition, {
			...definition,
			...builtinFields(builtin),
			...(isBrainAutomationBuiltin(builtin) ? { trigger: definition.trigger } : {}),
			thenAutomationId: defaultThen(db, builtin),
			skills: [],
			boundary: builtinBoundary(builtin),
			updatedAt: nowIso8601(),
		});
	});

	commands.define('automations.list-agent-actions', () => listAgentActions(db));

	commands.define('automations.list-chat-turns', (args: unknown) =>
		listChatTurns(
			db,
			[...new Set(listAgentActions(db).map((action) => action.runId))],
			optionalFlag(args, 'every') ? CHAT_TURNS_SHOWN : 0,
		),
	);

	commands.define('automations.list-runs', () => {
		const askedAbout = listAskingDecisions(db).flatMap(({ subjectRunId }) => {
			const run = subjectRunId === null ? null : getAutomationRun(db, subjectRunId);
			return run ? [run] : [];
		});
		const runs = [
			...listUnfinishedAutomationRuns(db),
			...listRecentFinishedAutomationRuns(db, RECENT_FINISHED_RUNS),
			...askedAbout,
		];
		return [...new Map(runs.map((run) => [run.id, run])).values()].sort((left, right) =>
			right.createdAt.localeCompare(left.createdAt),
		);
	});

	commands.define('automations.run', async (args: unknown) => {
		const definition = requireDefinition(db, requireString(args, 'definitionId'));
		if (!isRunnableAutomation(definition)) {
			throw new AutomationError('builtin', `${definition.name} runs on its own.`);
		}
		const workstreamId = optionalString(args, 'workstreamId');
		const repositoryId = optionalString(args, 'repositoryId');
		const scope = optionalScope(args);
		const automationContext = optionalContext(args);
		const origin = optionalOrigin(args);
		const parentRunId = optionalString(args, 'parentRunId');
		const waitForYou = optionalFlag(args, 'waitForYou');
		const chatSessionId = optionalString(args, 'chatSessionId');
		const chatAfterRunId = chatSessionId === null ? null : optionalString(args, 'chatAfterRunId');
		const causeEventId = optionalEventId(args);
		if (parentRunId !== null) requireNoLoop(db, definition, parentRunId);
		const target = isBrainAutomationBuiltin(definition.builtin)
			? await brainTarget(brainWorkstream)
			: await runTarget(db, definition, origin, { workstreamId, repositoryId, scope });
		const folded =
			chatSessionId === null && origin !== 'merge-queue' && origin !== 'schedule'
				? foldIntoPending(definition, target, automationContext, origin === 'manual')
				: null;
		const asked =
			folded ??
			newRun(definition, target, origin, automationContext, waitForYou, {
				parentRunId,
				chatSessionId,
				chatAfterRunId,
				causeEventId,
			});
		if (causeEventId !== null) linkAutomationRunEvent(db, asked.id, causeEventId);
		return asked;
	});

	const foldIntoPending = (
		definition: AutomationDefinitionRecord,
		target: Pick<AutomationRunRecord, 'workstreamId' | 'repositoryId' | 'scope'>,
		automationContext: string | null,
		promote: boolean,
	): AutomationRunRecord | null => {
		const pending = findPendingAutomationRun(db, definition.id, target);
		return pending ? runner.fold(pending, automationContext, promote) : null;
	};

	const newRun = (
		definition: AutomationDefinitionRecord,
		target: Pick<AutomationRunRecord, 'workstreamId' | 'repositoryId' | 'scope'>,
		origin: AutomationRunOrigin,
		automationContext: string | null,
		waitForYou: boolean,
		links: Pick<AutomationRunRecord, 'parentRunId' | 'chatSessionId' | 'chatAfterRunId'> &
			Readonly<{ causeEventId: number | null }>,
	): AutomationRunRecord => {
		const id = randomUUID();
		const chainId = chainFor(db, links) ?? id;
		const repeats =
			origin === 'merge-queue'
				? 0
				: countChainAutomationRuns(db, chainId, definition.id, target, origin);
		const overBudget = repeats >= AUTOMATION_CHAIN_REPEAT_LIMIT;
		return runner.enqueue(
			{
				id,
				definitionId: definition.id,
				title: definition.name,
				...target,
				sessionId: null,
				agentRunId: null,
				origin,
				status: waitForYou || overBudget ? 'waiting' : 'queued',
				detail: overBudget ? chainBudgetDetail(repeats) : null,
				parentRunId: links.parentRunId,
				chatSessionId: links.chatSessionId,
				chatAfterRunId: links.chatAfterRunId,
				chainId,
				requests: 1,
				createdAt: nowIso8601(),
				startedAt: null,
				finishedAt: null,
			},
			automationContext,
		);
	};

	commands.define('automations.confirm-run', (args: unknown) =>
		runner.confirm(requireRun(db, args)),
	);

	commands.define('automations.cancel-run', (args: unknown) => {
		const automationRun = requireRun(db, args);
		return isFinishedAutomationRunStatus(automationRun.status)
			? automationRun
			: runner.cancel(automationRun);
	});

	commands.define('automations.list-suggestions', () => listShownSuggestions(db));

	commands.define('automations.accept-suggestion', async (args: unknown) => {
		const suggestion = requireSuggestion(db, args);
		if (suggestion.status !== 'open') throw invalid('this suggestion is already settled');
		const automation = await createDefinition(
			field(args, 'automation') ?? suggestedDefinition(suggestion),
		);
		const accepted = settleSuggestion(db, suggestion.id, 'accepted', automation.id, nowIso8601());
		const suggested: AutomationSuggestedEvent = { suggestion: accepted };
		events.emit(AUTOMATIONS_SUGGESTED_CHANNEL, suggested);
		return { suggestion: accepted, automation };
	});

	commands.define('automations.dismiss-suggestion', (args: unknown) => {
		const suggestion = requireSuggestion(db, args);
		if (suggestion.status !== 'open') throw invalid('this suggestion is already settled');
		const dismissed = settleSuggestion(db, suggestion.id, 'dismissed', null, nowIso8601());
		const suggested: AutomationSuggestedEvent = { suggestion: dismissed };
		events.emit(AUTOMATIONS_SUGGESTED_CHANNEL, suggested);
		return dismissed;
	});

	commands.define('automations.list-outputs', (args: unknown) => {
		const definition = requireDefinition(db, requireString(args, 'definitionId'));
		const since = requireString(args, 'since');
		if (Number.isNaN(Date.parse(since))) throw invalid('`since` must be an ISO 8601 time');
		return listAutomationOutputs(db, definition.id, new Date(since).toISOString());
	});

	commands.define('automations.list-setups', (args: unknown) =>
		listAutomationSetups(db, requireDefinition(db, requireString(args, 'definitionId')).id),
	);

	commands.define('automations.open-experiments', (args: unknown) =>
		experiments.open(requireAutomaticDefinition(db, args)),
	);

	commands.define('automations.save-experiment', (args: unknown) =>
		experiments.save(
			requireAutomaticDefinition(db, args),
			optionalString(args, 'experimentId'),
			experimentSetup(args),
		),
	);

	commands.define('automations.delete-experiment', (args: unknown) => {
		experiments.delete(requireString(args, 'experimentId'));
		return null;
	});

	commands.define('automations.run-experiment', (args: unknown) =>
		experiments.run(requireString(args, 'experimentId')),
	);

	commands.define('automations.use-experiment', async (args: unknown) => {
		const { definitionId, setup } = experiments.prepareUse(requireString(args, 'experimentId'));
		const definition = requireDefinition(db, definitionId);
		const saved = await saveChanged(definition, {
			...definition,
			provider: setup.provider,
			model: setup.model,
			instructions: setup.instructions,
			updatedAt: setup.createdAt,
		});
		experiments.finishUse(definitionId, setup);
		return saved;
	});

	commands.define('automations.list-decisions', () => listDecisions(db, RECENT_DECISIONS));

	commands.define('automations.decide', (args: unknown) =>
		reconciler.decide(requireString(args, 'decisionId'), requireIndex(args, 'candidate')),
	);

	commands.define('automations.list-timeline', (args: unknown) => timeline(db, requireSince(args)));
}

async function timeline(db: MaliniDatabase, since: string): Promise<TimelineRecord> {
	const runs = listAutomationRunsSince(db, since);
	const links = automationRunEventIds(
		db,
		runs.map((run) => run.id),
	);
	const events = listLoggedEventsSince(db, since, TIMELINE_EVENTS, TIMELINE_PAYLOAD_CHARS);
	const turns = listChatTurnsSince(db, since);
	const decisions = listDecisionsSince(db, since);
	const ids = new Set(
		[
			...events.map((event) => event.workstreamId),
			...runs.map((run) => run.workstreamId),
			...turns.map((turn) => turn.workstreamId),
			...decisions.map((decision) => decision.workstreamId),
		].filter((id): id is string => id !== null),
	);
	return {
		since,
		until: nowIso8601(),
		events,
		channelCounts: countLoggedEventsSince(db, since),
		runs: runs.map((run) => ({ ...run, eventIds: links.get(run.id) ?? [] })),
		turns,
		decisions,
		workstreams: await timelineWorkstreams(db, ids),
	};
}

async function timelineWorkstreams(
	db: MaliniDatabase,
	ids: ReadonlySet<string>,
): Promise<TimelineWorkstream[]> {
	const repositories = new Map(
		(await listRepositoryCatalog(db)).flatMap((repository) =>
			repository.projectIds.map((projectId) => [projectId, repository.fullName] as const),
		),
	);
	const seen = new Set<string>();
	const found: TimelineWorkstream[] = [];
	const visit = (id: string): void => {
		if (seen.has(id)) return;
		seen.add(id);
		const workstream = getWorkstream(db, id);
		if (!workstream) return;
		found.push({
			id: workstream.id,
			name: workstream.name,
			repository:
				workstream.scope === null ? (repositories.get(workstream.projectId) ?? null) : null,
			startedBy: workstream.startedBy,
		});
		if (workstream.startedBy !== null) visit(workstream.startedBy);
	};
	for (const id of ids) visit(id);
	return found;
}

function builtinFields(builtin: AutomationBuiltin): BuiltinFields {
	const {
		name,
		instructions,
		model,
		effort,
		runsIn = 'workstream',
		trigger = null,
	} = BUILTIN_AUTOMATIONS[builtin];
	return { name, instructions, provider: DEFAULT_PROVIDER_ID, model, effort, runsIn, trigger };
}

function builtinBoundary(builtin: AutomationBuiltin): AutomationBoundary {
	return BUILTIN_AUTOMATIONS[builtin].boundary ?? DEFAULT_AUTOMATION_BOUNDARY;
}

function defaultThen(db: MaliniDatabase, builtin: AutomationBuiltin): string | null {
	const then = BUILTIN_AUTOMATIONS[builtin].then;
	return then === undefined ? null : (getBuiltinAutomationDefinition(db, then)?.id ?? null);
}

function disarms(before: AutomationTrigger | null, after: AutomationTrigger | null): boolean {
	return before !== null && (after === null || after.mode === 'off' || after.when !== before.when);
}

function definitionFields(args: unknown): AutomationDefinitionFields {
	const name = requireString(args, 'name').trim();
	if (name.length === 0 || name.length > AUTOMATION_NAME_MAX_LENGTH) {
		throw invalid(`\`name\` must be 1 to ${AUTOMATION_NAME_MAX_LENGTH} characters`);
	}
	const instructions = requireString(args, 'instructions').trim();
	if (instructions.length === 0 || instructions.length > AUTOMATION_INSTRUCTIONS_MAX_LENGTH) {
		throw invalid(`\`instructions\` must be 1 to ${AUTOMATION_INSTRUCTIONS_MAX_LENGTH} characters`);
	}
	const provider = field(args, 'provider') ?? DEFAULT_PROVIDER_ID;
	if (!isValidProviderId(provider)) throw invalid('`provider` must be a provider id');
	const model = field(args, 'model');
	if (!isValidAgentModel(model)) throw invalid('`model` must be a model id');
	const effort = field(args, 'effort');
	if (!isAutomationEffort(effort))
		throw invalid('`effort` must be low, medium, high, xhigh or max');
	const runsIn = field(args, 'runsIn');
	if (!isAutomationRunsIn(runsIn)) throw invalid('`runsIn` must be workstream or new-workstream');
	const skills = field(args, 'skills');
	if (skills !== undefined && !isSkillNameList(skills)) {
		throw invalid('`skills` must be a list of skill names');
	}
	return {
		name,
		instructions,
		provider,
		model,
		effort,
		runsIn,
		skills: skills === undefined ? null : [...new Set(skills.map((skill) => skill.trim()))],
	};
}

function requireAutomaticDefinition(
	db: MaliniDatabase,
	args: unknown,
): OneShotAutomationDefinition {
	const definition = requireDefinition(db, requireString(args, 'definitionId'));
	if (!isOneShotAutomationDefinition(definition)) {
		throw new AutomationError('builtin', `${definition.name} takes no experiments.`);
	}
	return definition;
}

function experimentSetup(args: unknown): OneShotAutomation {
	const instructions = requireString(args, 'instructions').trim();
	if (instructions.length === 0 || instructions.length > AUTOMATION_INSTRUCTIONS_MAX_LENGTH) {
		throw invalid(`\`instructions\` must be 1 to ${AUTOMATION_INSTRUCTIONS_MAX_LENGTH} characters`);
	}
	const provider = field(args, 'provider') ?? DEFAULT_PROVIDER_ID;
	if (!isValidProviderId(provider)) throw invalid('`provider` must be a provider id');
	const model = field(args, 'model');
	if (!isValidAgentModel(model)) throw invalid('`model` must be a model id');
	return { provider, model, instructions };
}

async function triggerField(
	db: MaliniDatabase,
	args: unknown,
): Promise<AutomationTrigger | null | undefined> {
	const value = field(args, 'trigger');
	if (value === undefined || value === null) return value;
	if (!isRecord(value)) throw invalid('`trigger` must be { when, mode } or null');
	const mode = value['mode'];
	if (!isAutomationRunMode(mode)) throw invalid('`trigger.mode` must be off, ask or auto');
	return { when: await triggerWhen(db, value['when']), mode };
}

async function triggerWhen(db: MaliniDatabase, value: unknown): Promise<string> {
	const when = typeof value === 'string' ? value.trim() : '';
	let reason = '';
	try {
		const trigger = parseAutomationTrigger(when);
		if (trigger.kind === 'event') return when;
		if (trigger.kind === 'schedule') {
			return scheduleWhen({ ...trigger, place: await knownPlace(db, trigger.place) });
		}
	} catch (error) {
		if (error instanceof AutomationError) throw error;
		if (/^(?:on\s+\S+:|every\s)/iu.test(when)) reason = ` (${describeError(error)})`;
	}
	throw invalid(`\`trigger.when\` must read ${TRIGGER_GRAMMAR}${reason}`);
}

async function knownPlace(db: MaliniDatabase, place: SchedulePlace): Promise<SchedulePlace> {
	if (place.kind === 'home') return place;
	const names = (await listRepositoryCatalog(db)).map((repository) => repository.fullName);
	if (place.kind === 'repository') {
		const wanted = place.repository.toLocaleLowerCase();
		const repository = names.find((name) => name.toLocaleLowerCase() === wanted);
		if (repository) return { kind: 'repository', repository };
		throw new AutomationError(
			'not-found',
			`No repository in Malini is \`${place.repository}\`. Add it first, or schedule the automation in its organization or at Home.`,
		);
	}
	const wanted = place.owner.toLocaleLowerCase();
	const owner = names
		.map(repositoryOwner)
		.find((candidate) => candidate?.toLocaleLowerCase() === wanted);
	if (owner) return { kind: 'owner', owner };
	throw new AutomationError(
		'not-found',
		`No repository in Malini belongs to \`${place.owner}\`. Add one of its repositories first, or schedule the automation at Home.`,
	);
}

function boundaryField(args: unknown): AutomationBoundary | undefined {
	const value = field(args, 'boundary');
	if (value === undefined) return undefined;
	if (!isAutomationBoundary(value)) {
		throw invalid(
			'`boundary` must be { event: facts|full, before, chats: none|starter|all, attachments, internet }',
		);
	}
	return {
		event: value.event,
		before: value.before,
		chats: value.chats,
		attachments: value.attachments,
		internet: value.internet,
	};
}

function thenAutomationField(
	db: MaliniDatabase,
	args: unknown,
	automationId: string | null,
): string | null | undefined {
	const value = field(args, 'thenAutomationId');
	if (value === undefined || value === null) return value;
	if (typeof value !== 'string' || value.length === 0) {
		throw invalid('`thenAutomationId` must be an automation id or null');
	}
	const next = requireDefinition(db, value);
	if (!isRunnableAutomation(next)) {
		throw new AutomationError(
			'builtin',
			`${next.name} runs on its own, never after another automation.`,
		);
	}
	if (value === automationId) throw invalid('an automation cannot run after itself');
	if (automationId !== null && thenChainReaches(db, value, automationId)) {
		throw new AutomationError(
			'loop',
			`${next.name} already leads back to this automation, so they would loop.`,
		);
	}
	return value;
}

function thenChainReaches(db: MaliniDatabase, from: string, target: string): boolean {
	const seen = new Set<string>();
	for (
		let id: string | null = from;
		id !== null && !seen.has(id);
		id = getAutomationDefinition(db, id)?.thenAutomationId ?? null
	) {
		if (id === target) return true;
		seen.add(id);
	}
	return false;
}

function requireNoLoop(
	db: MaliniDatabase,
	definition: AutomationDefinitionRecord,
	parentRunId: string,
): void {
	const chain = automationRunChainDefinitionIds(db, parentRunId, AUTOMATION_CHAIN_MAX_DEPTH);
	if (chain.length === 0)
		throw new AutomationError('not-found', `Automation run \`${parentRunId}\` not found.`);
	if (chain.includes(definition.id)) {
		throw new AutomationError(
			'loop',
			`${definition.name} already ran earlier in this chain of automations, so it does not run again.`,
		);
	}
}

function chainFor(
	db: MaliniDatabase,
	links: Pick<AutomationRunRecord, 'parentRunId' | 'chatAfterRunId'> &
		Readonly<{ causeEventId: number | null }>,
): string | null {
	return (
		(links.parentRunId === null ? null : automationRunChainId(db, links.parentRunId)) ??
		(links.causeEventId === null ? null : eventChainId(db, links.causeEventId)) ??
		(links.chatAfterRunId === null ? null : chatTurnChainId(db, links.chatAfterRunId))
	);
}

function suggestedDefinition({
	name,
	instructions,
	when,
}: AutomationSuggestionRecord): Omit<SaveAutomationDefinitionArgs, 'id'> {
	return {
		name,
		instructions,
		provider: DEFAULT_PROVIDER_ID,
		model: DEFAULT_AGENT_MODEL,
		effort: 'high',
		runsIn: 'new-workstream',
		trigger: { when, mode: 'ask' },
	};
}

function requireDefinition(db: MaliniDatabase, definitionId: string): AutomationDefinitionRecord {
	const definition = getAutomationDefinition(db, definitionId);
	if (!definition)
		throw new AutomationError('not-found', `Automation \`${definitionId}\` not found.`);
	return definition;
}

function requireRun(db: MaliniDatabase, args: unknown): AutomationRunRecord {
	const automationRunId = requireString(args, 'automationRunId');
	const automationRun = getAutomationRun(db, automationRunId);
	if (!automationRun)
		throw new AutomationError('not-found', `Automation run \`${automationRunId}\` not found.`);
	return automationRun;
}

function requireSuggestion(db: MaliniDatabase, args: unknown): AutomationSuggestionRecord {
	const suggestionId = requireString(args, 'suggestionId');
	const suggestion = getSuggestion(db, suggestionId);
	if (!suggestion)
		throw new AutomationError('not-found', `Suggestion \`${suggestionId}\` not found.`);
	return suggestion;
}

function requireWorkstream(db: MaliniDatabase, workstreamId: string | null): string {
	if (workstreamId === null) throw invalid('`workstreamId` is required for this automation');
	if (!getWorkstream(db, workstreamId)) {
		throw new AutomationError('not-found', `Workstream \`${workstreamId}\` not found.`);
	}
	return workstreamId;
}

function repositoryOfWorkstream(db: MaliniDatabase, workstreamId: string | null): string | null {
	return workstreamId === null ? null : (getWorkstream(db, workstreamId)?.projectId ?? null);
}

async function requireRepository(db: MaliniDatabase, repositoryId: string | null): Promise<string> {
	if (repositoryId === null) throw invalid('`repositoryId` is required for this automation');
	if (!(await resolveConnectedRepository(db, repositoryId))) {
		throw new AutomationError('not-found', `Repository \`${repositoryId}\` not found.`);
	}
	return repositoryId;
}

type RunTarget = Pick<AutomationRunRecord, 'workstreamId' | 'repositoryId' | 'scope'>;

async function brainTarget(brainWorkstream: () => Promise<string | null>): Promise<RunTarget> {
	const workstreamId = await brainWorkstream();
	if (workstreamId === null) {
		throw new AutomationError('not-found', 'Set up the brain first in Settings, Brain.');
	}
	return { workstreamId, repositoryId: null, scope: null };
}

async function runTarget(
	db: MaliniDatabase,
	definition: AutomationDefinitionRecord,
	origin: AutomationRunOrigin,
	{ workstreamId, repositoryId, scope }: RunTarget,
): Promise<RunTarget> {
	const scheduled = origin === 'schedule' && !isAgentlessAutomationBuiltin(definition.builtin);
	if (scheduled && workstreamId === null && scope !== null) {
		return { workstreamId: null, repositoryId: null, scope };
	}
	if (scheduled && workstreamId === null) {
		return {
			workstreamId: null,
			repositoryId: await requireRepository(db, repositoryId),
			scope: null,
		};
	}
	if (scheduled) {
		return { workstreamId: requireWorkstream(db, workstreamId), repositoryId: null, scope };
	}
	if (definition.runsIn === 'workstream' || origin === 'then' || origin === 'schedule') {
		return { workstreamId: requireWorkstream(db, workstreamId), repositoryId: null, scope: null };
	}
	return {
		workstreamId: null,
		repositoryId: await requireRepository(
			db,
			repositoryId ?? repositoryOfWorkstream(db, workstreamId),
		),
		scope: null,
	};
}

function optionalScope(args: unknown): string | null {
	const scope = optionalString(args, 'scope');
	if (scope !== null && parseLeadScope(scope) === null) {
		throw invalid('`scope` must be home or owner:<owner>');
	}
	return scope;
}

function optionalContext(args: unknown): string | null {
	const value = field(args, 'context');
	if (value === undefined || value === null || value === '') return null;
	if (
		typeof value !== 'string' ||
		Buffer.byteLength(value, 'utf8') > AUTOMATION_CONTEXT_MAX_BYTES
	) {
		throw invalid(`\`context\` must be a string of at most ${AUTOMATION_CONTEXT_MAX_BYTES} bytes`);
	}
	return value;
}

function optionalOrigin(args: unknown): AutomationRunOrigin {
	const value = field(args, 'origin');
	if (value === undefined || value === null) return 'manual';
	if (!isAutomationRunOrigin(value))
		throw invalid(
			'`origin` must be merge-queue, manual, trigger, then, schedule, reconciler or compatibility',
		);
	return value;
}

function optionalEventId(args: unknown): number | null {
	const value = field(args, 'causeEventId');
	if (value === undefined || value === null) return null;
	if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1) {
		throw invalid('`causeEventId` must be the id of a logged event when present');
	}
	return value;
}

function requireIndex(args: unknown, key: string): number {
	const value = field(args, key);
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw invalid(`\`${key}\` must be the index of a choice`);
	}
	return value;
}

function requireSince(args: unknown): string {
	const since = requireString(args, 'since');
	const at = Date.parse(since);
	if (Number.isNaN(at)) throw invalid('`since` must be an ISO 8601 time');
	return new Date(Math.max(at, Date.now() - EVENT_LOG_KEEP_MS)).toISOString();
}

function optionalFlag(args: unknown, key: string): boolean {
	const value = field(args, key);
	if (value === undefined || value === null) return false;
	if (typeof value !== 'boolean') throw invalid(`\`${key}\` must be true or false when present`);
	return value;
}

function field(args: unknown, key: string): unknown {
	return isRecord(args) ? args[key] : undefined;
}

function requireString(args: unknown, key: string): string {
	const value = field(args, key);
	if (typeof value !== 'string') throw invalid(`\`${key}\` must be a string`);
	return value;
}

function optionalString(args: unknown, key: string): string | null {
	const value = field(args, key);
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || value.length === 0) {
		throw invalid(`\`${key}\` must be a non-empty string when present`);
	}
	return value;
}

function invalid(message: string): AutomationError {
	return new AutomationError('invalid-args', `invalid args: ${message}`);
}
