import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
	SCHEDULE_GRAMMAR,
	parseAutomationTrigger,
	scheduleWhen,
	type SchedulePlace,
} from '$contract/automation-trigger';
import { JOBS_DEFINITION_CHANGED_CHANNEL } from '$contract/events';
import {
	isAgentlessJobBuiltin,
	type JobBuiltin,
	type JobDefinitionChangedEvent,
	type JobDefinitionRecord,
	type JobRunOrigin,
	type JobRunRecord,
	type JobSuggestionRecord,
	type JobTrigger,
	type TimelineRecord,
	type TimelineWorkstream,
} from '$contract/jobs';
import { isSkillNameList } from '$contract/skills';
import { chatTurnChainId, listChatTurns, listChatTurnsSince } from '$lib/chat/chat.platform';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { describeError } from '$main/errors';
import { DEFAULT_AGENT_MODEL, isValidAgentModel } from '$shared/providers/providers.platform';
import {
	getWorkstream,
	listRepositoryCatalog,
	parseLeadScope,
	repositoryOwner,
	resolveConnectedRepository,
} from '$shared/repositories/repositories.platform';
import {
	BUILTIN_JOBS,
	BUILTIN_JOB_KEYS,
	isRunnableJob,
	isTriggerableJob,
} from '../domain/builtin-jobs';
import {
	JOB_INSTRUCTIONS_MAX_LENGTH,
	JOB_NAME_MAX_LENGTH,
	isJobEffort,
	isJobRunMode,
	isJobRunsIn,
	suggestedJobName,
} from '../domain/job-definition';
import {
	JOB_CHAIN_MAX_DEPTH,
	JOB_CHAIN_REPEAT_LIMIT,
	JOB_CONTEXT_MAX_BYTES,
	chainBudgetDetail,
	isFinishedJobRunStatus,
	isJobRunOrigin,
} from '../domain/job-run';
import { listAgentActions } from './agent-actions.repository';
import type { AutomaticJob } from './automatic-jobs.service';
import {
	countLoggedEventsSince,
	eventChainId,
	jobRunEventIds,
	linkJobRunEvent,
	listLoggedEventsSince,
} from './event-log.repository';
import { EVENT_LOG_KEEP_MS } from './event-log.service';
import {
	isAutomaticJobDefinition,
	type AutomaticJobDefinition,
	type JobExperiments,
} from './job-experiments.service';
import { listJobOutputs, listJobSetups } from './job-outputs.repository';
import {
	clearThenLinksTo,
	deleteJobDefinition,
	getBuiltinJobDefinition,
	getJobDefinition,
	insertJobDefinition,
	listJobDefinitions,
	updateJobDefinition,
} from './job-definitions.repository';
import {
	countChainJobRuns,
	countStartedOrQueuedJobRuns,
	findPendingJobRun,
	getJobRun,
	jobRunChainDefinitionIds,
	jobRunChainId,
	listJobRunsSince,
	listRecentFinishedJobRuns,
	listUnfinishedJobRuns,
	listWaitingJobRuns,
} from './job-runs.repository';
import { getSuggestion, listSuggestions, setSuggestionStatus } from './job-suggestions.repository';
import type { JobRunner } from './job-runner.service';
import { PROMPT_CLUSTER_MIN_PROMPT_TOKENS, promptTokenSet } from './prompt-clustering.service';
import { listDecisions, listDecisionsSince } from './reconciler-decisions.repository';
import type { Reconciler } from './reconciler.service';

const RECENT_FINISHED_RUNS = 30;

const RECENT_DECISIONS = 60;

const TIMELINE_EVENTS = 2_000;

const TIMELINE_PAYLOAD_CHARS = 4_096;

const TRIGGER_GRAMMAR = `on <channel>, optionally followed by where <path> is <value> or where <path> is set, joined with and; or ${SCHEDULE_GRAMMAR}`;

export type JobErrorKind =
	'invalid-args' | 'not-found' | 'builtin' | 'not-builtin' | 'busy' | 'loop';

export class JobError extends Error {
	readonly kind: JobErrorKind;

	constructor(kind: JobErrorKind, message: string) {
		super(message);
		this.name = 'JobError';
		this.kind = kind;
	}
}

type JobDefinitionFields = Pick<
	JobDefinitionRecord,
	'name' | 'instructions' | 'model' | 'effort' | 'runsIn'
> &
	Readonly<{ skills: readonly string[] | null }>;

type BuiltinFields = Pick<
	JobDefinitionRecord,
	'name' | 'instructions' | 'model' | 'effort' | 'runsIn' | 'trigger'
>;

const CHAT_TURNS_SHOWN = 100;

export function seedBuiltinJobs(db: MaliniDatabase): void {
	const now = nowIso8601();
	const inserted = BUILTIN_JOB_KEYS.flatMap((builtin) => {
		const definition: JobDefinitionRecord = {
			id: randomUUID(),
			...builtinFields(builtin),
			thenJobId: null,
			skills: [],
			builtin,
			createdAt: now,
			updatedAt: now,
		};
		return insertJobDefinition(db, definition) ? [{ builtin, definition }] : [];
	});
	for (const { builtin, definition } of inserted) {
		const thenJobId = defaultThen(db, builtin);
		if (thenJobId !== null) updateJobDefinition(db, { ...definition, thenJobId });
	}
}

export function defineJobCommands(
	context: MainContext,
	runner: JobRunner,
	experiments: JobExperiments,
	reconciler: Reconciler,
): void {
	const { db, commands, events } = context;

	const definitionChanged = (
		definitionId: string,
		definition: JobDefinitionRecord | null,
	): void => {
		const payload: JobDefinitionChangedEvent = { definitionId, definition };
		events.emit(JOBS_DEFINITION_CHANGED_CHANNEL, payload);
	};

	const skipWaitingRuns = async (definitionId: string): Promise<void> => {
		for (const waiting of listWaitingJobRuns(db, definitionId)) await runner.cancel(waiting);
	};

	const saveChanged = async (
		before: JobDefinitionRecord,
		after: JobDefinitionRecord,
	): Promise<JobDefinitionRecord> => {
		updateJobDefinition(db, after);
		definitionChanged(after.id, after);
		if (disarms(before.trigger, after.trigger)) await skipWaitingRuns(after.id);
		return after;
	};

	commands.define('jobs.list-definitions', () => listJobDefinitions(db));

	commands.define('jobs.save-definition', async (args: unknown) => {
		const id = optionalString(args, 'id');
		const fields = definitionFields(args);
		const trigger = await triggerField(db, args);
		const now = nowIso8601();
		if (id === null) {
			const created: JobDefinitionRecord = {
				id: randomUUID(),
				...fields,
				skills: fields.skills ?? [],
				builtin: null,
				trigger: trigger ?? null,
				thenJobId: thenJobField(db, args, null) ?? null,
				createdAt: now,
				updatedAt: now,
			};
			insertJobDefinition(db, created);
			definitionChanged(created.id, created);
			return created;
		}
		const existing = requireDefinition(db, id);
		const thenJobId = thenJobField(db, args, existing.id);
		if (!isTriggerableJob(existing) && (trigger || thenJobId)) {
			throw new JobError(
				'builtin',
				`${existing.name} is built in and Malini starts it, so it takes no When or Then.`,
			);
		}
		const agentless = isAgentlessJobBuiltin(existing.builtin);
		if (agentless && trigger && parseAutomationTrigger(trigger.when).kind === 'schedule') {
			throw new JobError(
				'builtin',
				`${existing.name} works on the changes of a workstream, so it runs after an event or another job, never on a schedule.`,
			);
		}
		return saveChanged(existing, {
			...existing,
			name: fields.name,
			...(agentless
				? {}
				: {
						instructions: fields.instructions,
						model: fields.model,
						effort: fields.effort,
						skills: fields.skills ?? existing.skills,
					}),
			runsIn: existing.builtin ? existing.runsIn : fields.runsIn,
			trigger: trigger === undefined ? existing.trigger : trigger,
			thenJobId: thenJobId === undefined ? existing.thenJobId : thenJobId,
			updatedAt: now,
		});
	});

	commands.define('jobs.delete-definition', async (args: unknown) => {
		const definition = requireDefinition(db, requireString(args, 'definitionId'));
		if (definition.builtin) {
			throw new JobError('builtin', `${definition.name} is built in. Reset it instead.`);
		}
		if (countStartedOrQueuedJobRuns(db, definition.id) > 0) {
			throw new JobError('busy', `${definition.name} is queued or running. Cancel it first.`);
		}
		await skipWaitingRuns(definition.id);
		for (const linkedId of clearThenLinksTo(db, definition.id)) {
			definitionChanged(linkedId, getJobDefinition(db, linkedId));
		}
		deleteJobDefinition(db, definition.id);
		definitionChanged(definition.id, null);
		return null;
	});

	commands.define('jobs.reset-definition', (args: unknown) => {
		const definition = requireDefinition(db, requireString(args, 'definitionId'));
		const builtin: JobBuiltin | null = definition.builtin;
		if (builtin === null) throw new JobError('not-builtin', 'Only a built-in job can be reset.');
		return saveChanged(definition, {
			...definition,
			...builtinFields(builtin),
			thenJobId: defaultThen(db, builtin),
			skills: [],
			updatedAt: nowIso8601(),
		});
	});

	commands.define('jobs.list-agent-actions', () => listAgentActions(db));

	commands.define('jobs.list-chat-turns', (args: unknown) =>
		listChatTurns(
			db,
			[...new Set(listAgentActions(db).map((action) => action.runId))],
			optionalFlag(args, 'every') ? CHAT_TURNS_SHOWN : 0,
		),
	);

	commands.define('jobs.list-runs', () =>
		[...listUnfinishedJobRuns(db), ...listRecentFinishedJobRuns(db, RECENT_FINISHED_RUNS)].sort(
			(left, right) => right.createdAt.localeCompare(left.createdAt),
		),
	);

	commands.define('jobs.run', async (args: unknown) => {
		const definition = requireDefinition(db, requireString(args, 'definitionId'));
		if (!isRunnableJob(definition)) {
			throw new JobError(
				'builtin',
				`${definition.name} runs on its own when you send the first message in a chat.`,
			);
		}
		const workstreamId = optionalString(args, 'workstreamId');
		const repositoryId = optionalString(args, 'repositoryId');
		const scope = optionalScope(args);
		const jobContext = optionalContext(args);
		const origin = optionalOrigin(args);
		const parentRunId = optionalString(args, 'parentRunId');
		const waitForYou = optionalFlag(args, 'waitForYou');
		const chatSessionId = optionalString(args, 'chatSessionId');
		const chatAfterRunId = chatSessionId === null ? null : optionalString(args, 'chatAfterRunId');
		const causeEventId = optionalEventId(args);
		if (parentRunId !== null) requireNoLoop(db, definition, parentRunId);
		const target = await runTarget(db, definition, origin, { workstreamId, repositoryId, scope });
		const folded =
			chatSessionId === null && origin !== 'merge-queue' && origin !== 'schedule'
				? foldIntoPending(definition, target, jobContext, origin === 'manual')
				: null;
		const asked =
			folded ??
			newRun(definition, target, origin, jobContext, waitForYou, {
				parentRunId,
				chatSessionId,
				chatAfterRunId,
				causeEventId,
			});
		if (causeEventId !== null) linkJobRunEvent(db, asked.id, causeEventId);
		return asked;
	});

	const foldIntoPending = (
		definition: JobDefinitionRecord,
		target: Pick<JobRunRecord, 'workstreamId' | 'repositoryId' | 'scope'>,
		jobContext: string | null,
		promote: boolean,
	): JobRunRecord | null => {
		const pending = findPendingJobRun(db, definition.id, target);
		return pending ? runner.fold(pending, jobContext, promote) : null;
	};

	const newRun = (
		definition: JobDefinitionRecord,
		target: Pick<JobRunRecord, 'workstreamId' | 'repositoryId' | 'scope'>,
		origin: JobRunOrigin,
		jobContext: string | null,
		waitForYou: boolean,
		links: Pick<JobRunRecord, 'parentRunId' | 'chatSessionId' | 'chatAfterRunId'> &
			Readonly<{ causeEventId: number | null }>,
	): JobRunRecord => {
		const id = randomUUID();
		const chainId = chainFor(db, links) ?? id;
		const repeats =
			origin === 'merge-queue' ? 0 : countChainJobRuns(db, chainId, definition.id, target, origin);
		const overBudget = repeats >= JOB_CHAIN_REPEAT_LIMIT;
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
			jobContext,
		);
	};

	commands.define('jobs.confirm-run', (args: unknown) => runner.confirm(requireRun(db, args)));

	commands.define('jobs.cancel-run', (args: unknown) => {
		const jobRun = requireRun(db, args);
		return isFinishedJobRunStatus(jobRun.status) ? jobRun : runner.cancel(jobRun);
	});

	commands.define('jobs.list-suggestions', () => listSuggestions(db).filter(isTaskSuggestion));

	commands.define('jobs.accept-suggestion', (args: unknown) => {
		const suggestion = requireSuggestion(db, args);
		if (suggestion.status === 'accepted') {
			throw invalid('this suggestion is already a job');
		}
		const prompt = suggestion.evidence[0]?.text.trim() ?? '';
		if (prompt.length === 0) throw invalid('this suggestion has no prompt to make a job from');
		const now = nowIso8601();
		const created: JobDefinitionRecord = {
			id: randomUUID(),
			name: suggestedJobName(prompt),
			instructions: prompt.slice(0, JOB_INSTRUCTIONS_MAX_LENGTH),
			model: DEFAULT_AGENT_MODEL,
			effort: 'high',
			runsIn: 'workstream',
			skills: [],
			builtin: null,
			trigger: null,
			thenJobId: null,
			createdAt: now,
			updatedAt: now,
		};
		insertJobDefinition(db, created);
		setSuggestionStatus(db, suggestion.id, 'accepted', now);
		definitionChanged(created.id, created);
		return created;
	});

	commands.define('jobs.dismiss-suggestion', (args: unknown) =>
		setSuggestionStatus(db, requireSuggestion(db, args).id, 'dismissed', nowIso8601()),
	);

	commands.define('jobs.list-outputs', (args: unknown) => {
		const definition = requireDefinition(db, requireString(args, 'definitionId'));
		const since = requireString(args, 'since');
		if (Number.isNaN(Date.parse(since))) throw invalid('`since` must be an ISO 8601 time');
		return listJobOutputs(db, definition.id, new Date(since).toISOString());
	});

	commands.define('jobs.list-setups', (args: unknown) =>
		listJobSetups(db, requireDefinition(db, requireString(args, 'definitionId')).id),
	);

	commands.define('jobs.open-experiments', (args: unknown) =>
		experiments.open(requireAutomaticDefinition(db, args)),
	);

	commands.define('jobs.save-experiment', (args: unknown) =>
		experiments.save(
			requireAutomaticDefinition(db, args),
			optionalString(args, 'experimentId'),
			experimentSetup(args),
		),
	);

	commands.define('jobs.delete-experiment', (args: unknown) => {
		experiments.delete(requireString(args, 'experimentId'));
		return null;
	});

	commands.define('jobs.run-experiment', (args: unknown) =>
		experiments.run(requireString(args, 'experimentId')),
	);

	commands.define('jobs.use-experiment', async (args: unknown) => {
		const { definitionId, setup } = experiments.prepareUse(requireString(args, 'experimentId'));
		const definition = requireDefinition(db, definitionId);
		const saved = await saveChanged(definition, {
			...definition,
			model: setup.model,
			instructions: setup.instructions,
			updatedAt: setup.createdAt,
		});
		experiments.finishUse(definitionId, setup);
		return saved;
	});

	commands.define('jobs.list-decisions', () => listDecisions(db, RECENT_DECISIONS));

	commands.define('jobs.decide', (args: unknown) =>
		reconciler.decide(requireString(args, 'decisionId'), requireIndex(args, 'candidate')),
	);

	commands.define('jobs.list-timeline', (args: unknown) => timeline(db, requireSince(args)));
}

async function timeline(db: MaliniDatabase, since: string): Promise<TimelineRecord> {
	const runs = listJobRunsSince(db, since);
	const links = jobRunEventIds(
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

function builtinFields(builtin: JobBuiltin): BuiltinFields {
	const { name, instructions, model, effort, runsIn = 'workstream' } = BUILTIN_JOBS[builtin];
	return { name, instructions, model, effort, runsIn, trigger: null };
}

function defaultThen(db: MaliniDatabase, builtin: JobBuiltin): string | null {
	const then = BUILTIN_JOBS[builtin].then;
	return then === undefined ? null : (getBuiltinJobDefinition(db, then)?.id ?? null);
}

function disarms(before: JobTrigger | null, after: JobTrigger | null): boolean {
	return before !== null && (after === null || after.mode === 'off' || after.when !== before.when);
}

function definitionFields(args: unknown): JobDefinitionFields {
	const name = requireString(args, 'name').trim();
	if (name.length === 0 || name.length > JOB_NAME_MAX_LENGTH) {
		throw invalid(`\`name\` must be 1 to ${JOB_NAME_MAX_LENGTH} characters`);
	}
	const instructions = requireString(args, 'instructions').trim();
	if (instructions.length === 0 || instructions.length > JOB_INSTRUCTIONS_MAX_LENGTH) {
		throw invalid(`\`instructions\` must be 1 to ${JOB_INSTRUCTIONS_MAX_LENGTH} characters`);
	}
	const model = field(args, 'model');
	if (!isValidAgentModel(model)) throw invalid('`model` must be a model id');
	const effort = field(args, 'effort');
	if (!isJobEffort(effort)) throw invalid('`effort` must be low, medium, high, xhigh or max');
	const runsIn = field(args, 'runsIn');
	if (!isJobRunsIn(runsIn)) throw invalid('`runsIn` must be workstream or new-workstream');
	const skills = field(args, 'skills');
	if (skills !== undefined && !isSkillNameList(skills)) {
		throw invalid('`skills` must be a list of skill names');
	}
	return {
		name,
		instructions,
		model,
		effort,
		runsIn,
		skills: skills === undefined ? null : [...new Set(skills.map((skill) => skill.trim()))],
	};
}

function requireAutomaticDefinition(db: MaliniDatabase, args: unknown): AutomaticJobDefinition {
	const definition = requireDefinition(db, requireString(args, 'definitionId'));
	if (!isAutomaticJobDefinition(definition)) {
		throw new JobError('builtin', `${definition.name} takes no experiments.`);
	}
	return definition;
}

function experimentSetup(args: unknown): AutomaticJob {
	const instructions = requireString(args, 'instructions').trim();
	if (instructions.length === 0 || instructions.length > JOB_INSTRUCTIONS_MAX_LENGTH) {
		throw invalid(`\`instructions\` must be 1 to ${JOB_INSTRUCTIONS_MAX_LENGTH} characters`);
	}
	const model = field(args, 'model');
	if (!isValidAgentModel(model)) throw invalid('`model` must be a model id');
	return { model, instructions };
}

async function triggerField(
	db: MaliniDatabase,
	args: unknown,
): Promise<JobTrigger | null | undefined> {
	const value = field(args, 'trigger');
	if (value === undefined || value === null) return value;
	if (!isRecord(value)) throw invalid('`trigger` must be { when, mode } or null');
	const mode = value['mode'];
	if (!isJobRunMode(mode)) throw invalid('`trigger.mode` must be off, ask or auto');
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
		if (error instanceof JobError) throw error;
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
		throw new JobError(
			'not-found',
			`No repository in Malini is \`${place.repository}\`. Add it first, or schedule the job in its organization or at Home.`,
		);
	}
	const wanted = place.owner.toLocaleLowerCase();
	const owner = names
		.map(repositoryOwner)
		.find((candidate) => candidate?.toLocaleLowerCase() === wanted);
	if (owner) return { kind: 'owner', owner };
	throw new JobError(
		'not-found',
		`No repository in Malini belongs to \`${place.owner}\`. Add one of its repositories first, or schedule the job at Home.`,
	);
}

function thenJobField(
	db: MaliniDatabase,
	args: unknown,
	jobId: string | null,
): string | null | undefined {
	const value = field(args, 'thenJobId');
	if (value === undefined || value === null) return value;
	if (typeof value !== 'string' || value.length === 0) {
		throw invalid('`thenJobId` must be a job id or null');
	}
	const next = requireDefinition(db, value);
	if (!isRunnableJob(next)) {
		throw new JobError('builtin', `${next.name} runs on its own, never after another job.`);
	}
	if (value === jobId) throw invalid('a job cannot run after itself');
	if (jobId !== null && thenChainReaches(db, value, jobId)) {
		throw new JobError('loop', `${next.name} already leads back to this job, so they would loop.`);
	}
	return value;
}

function thenChainReaches(db: MaliniDatabase, from: string, target: string): boolean {
	const seen = new Set<string>();
	for (
		let id: string | null = from;
		id !== null && !seen.has(id);
		id = getJobDefinition(db, id)?.thenJobId ?? null
	) {
		if (id === target) return true;
		seen.add(id);
	}
	return false;
}

function requireNoLoop(
	db: MaliniDatabase,
	definition: JobDefinitionRecord,
	parentRunId: string,
): void {
	const chain = jobRunChainDefinitionIds(db, parentRunId, JOB_CHAIN_MAX_DEPTH);
	if (chain.length === 0) throw new JobError('not-found', `Job run \`${parentRunId}\` not found.`);
	if (chain.includes(definition.id)) {
		throw new JobError(
			'loop',
			`${definition.name} already ran earlier in this chain of jobs, so it does not run again.`,
		);
	}
}

function chainFor(
	db: MaliniDatabase,
	links: Pick<JobRunRecord, 'parentRunId' | 'chatAfterRunId'> &
		Readonly<{ causeEventId: number | null }>,
): string | null {
	return (
		(links.parentRunId === null ? null : jobRunChainId(db, links.parentRunId)) ??
		(links.causeEventId === null ? null : eventChainId(db, links.causeEventId)) ??
		(links.chatAfterRunId === null ? null : chatTurnChainId(db, links.chatAfterRunId))
	);
}

function isTaskSuggestion({ evidence }: JobSuggestionRecord): boolean {
	return evidence.every(
		({ text }) => promptTokenSet(text).size >= PROMPT_CLUSTER_MIN_PROMPT_TOKENS,
	);
}

function requireDefinition(db: MaliniDatabase, definitionId: string): JobDefinitionRecord {
	const definition = getJobDefinition(db, definitionId);
	if (!definition) throw new JobError('not-found', `Job \`${definitionId}\` not found.`);
	return definition;
}

function requireRun(db: MaliniDatabase, args: unknown): JobRunRecord {
	const jobRunId = requireString(args, 'jobRunId');
	const jobRun = getJobRun(db, jobRunId);
	if (!jobRun) throw new JobError('not-found', `Job run \`${jobRunId}\` not found.`);
	return jobRun;
}

function requireSuggestion(db: MaliniDatabase, args: unknown): JobSuggestionRecord {
	const suggestionId = requireString(args, 'suggestionId');
	const suggestion = getSuggestion(db, suggestionId);
	if (!suggestion) throw new JobError('not-found', `Suggestion \`${suggestionId}\` not found.`);
	return suggestion;
}

function requireWorkstream(db: MaliniDatabase, workstreamId: string | null): string {
	if (workstreamId === null) throw invalid('`workstreamId` is required for this job');
	if (!getWorkstream(db, workstreamId)) {
		throw new JobError('not-found', `Workstream \`${workstreamId}\` not found.`);
	}
	return workstreamId;
}

function repositoryOfWorkstream(db: MaliniDatabase, workstreamId: string | null): string | null {
	return workstreamId === null ? null : (getWorkstream(db, workstreamId)?.projectId ?? null);
}

async function requireRepository(db: MaliniDatabase, repositoryId: string | null): Promise<string> {
	if (repositoryId === null) throw invalid('`repositoryId` is required for this job');
	if (!(await resolveConnectedRepository(db, repositoryId))) {
		throw new JobError('not-found', `Repository \`${repositoryId}\` not found.`);
	}
	return repositoryId;
}

type RunTarget = Pick<JobRunRecord, 'workstreamId' | 'repositoryId' | 'scope'>;

async function runTarget(
	db: MaliniDatabase,
	definition: JobDefinitionRecord,
	origin: JobRunOrigin,
	{ workstreamId, repositoryId, scope }: RunTarget,
): Promise<RunTarget> {
	const scheduled = origin === 'schedule' && !isAgentlessJobBuiltin(definition.builtin);
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
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > JOB_CONTEXT_MAX_BYTES) {
		throw invalid(`\`context\` must be a string of at most ${JOB_CONTEXT_MAX_BYTES} bytes`);
	}
	return value;
}

function optionalOrigin(args: unknown): JobRunOrigin {
	const value = field(args, 'origin');
	if (value === undefined || value === null) return 'manual';
	if (!isJobRunOrigin(value))
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

function invalid(message: string): JobError {
	return new JobError('invalid-args', `invalid args: ${message}`);
}
