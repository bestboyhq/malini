import type { AgentReasoningEffort } from '$contract/agent';
import { CONTRACT_REFERENCE } from '$contract/contract-reference.generated';
import type {
	AgentActionApproval,
	JobDefinitionRecord,
	JobRunsIn,
	JobTrigger,
	SaveJobDefinitionArgs,
} from '$contract/jobs';
import type { MergedPullRequest, Workstream } from '$contract/repositories';
import { isSkillNameList } from '$contract/skills';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import type { CommandRegistry } from '$main/ipc/registry';
import { isRecord, jsonEqual } from '$main/db/rows';
import { describeError } from '$main/errors';
import {
	activeJobRunForSession,
	finishAgentAction,
	recordAgentAction,
} from '$lib/jobs/jobs.platform';
import { openFileForUser } from '$lib/extensions/extensions.platform';
import type { SecretsPlatform } from '$lib/secrets/secrets.platform';
import { DEFAULT_AGENT_MODEL, DEFAULT_PROVIDER_ID } from '$shared/providers/providers.platform';
import {
	clonePlannedRepository,
	createPlannedWorkstream,
	listArchivedWorkstreams,
	listRepositoryCatalog,
	listWorkstreams,
	mergedPullRequestOf,
	planRepositoryWorkstream,
	prepareStartedWorkstream,
	workstreamRepositoryName,
	type CatalogRepository,
} from '$shared/repositories/repositories.platform';
import { latestWorkstreamTurn, workstreamHasWorkingRun } from '../events.repository';
import type { ChatDeliveries } from '../deliveries.service';
import { promptsSentInChain } from '../deliveries.repository';
import { answeredApprovalsInRun } from '../interactions.repository';
import {
	askLeadDecision,
	recordLeadDecisionAnswer,
	writeLeadPlan,
} from '../lead-decisions.service';
import { MALINI_TOOL_PREFIX } from '../permissions.service';
import { chatTurnChainId, storedRunProfile } from '../runs.repository';
import { latestSessionForWorkstream } from '../sessions.repository';
import { parseRunProfile, type PromptsInFlight } from './commands';
import { jobsNamed } from './malini-approvals.service';
import type { BridgePlatformRequest, PlatformAnswer } from './protocol';
import { persistedBridgeSession, worktreePath, type PersistedBridgeSession } from './sessions';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies AgentReasoningEffort[];
const RUNS_IN = ['workstream', 'new-workstream'] as const satisfies JobRunsIn[];
const CLONE_WAIT_MS = 40_000;
const GITHUB_FULL_NAME = /^[\w.-]+\/[\w.-]+$/u;
const CLONE_URL = /^(?:https:\/\/|ssh:\/\/|file:\/\/|git@[\w.-]+:)\S+$/u;

export type PlatformRequestDeps = Pick<MainContext, 'db' | 'commands' | 'events' | 'appDataRoot'> &
	Readonly<{
		sending: PromptsInFlight;
		deliveries: ChatDeliveries;
		secrets?: SecretsPlatform;
		log: (line: string) => void;
	}>;

export const SENDS_PER_CHAIN = 6;

type Input = Readonly<Record<string, unknown>>;

export async function answerPlatformRequest(
	request: BridgePlatformRequest,
	deps: PlatformRequestDeps,
): Promise<PlatformAnswer> {
	const action = recordAgentAction(deps, {
		sessionId: request.sessionId,
		runId: request.runId,
		workstreamId: persistedBridgeSession(deps.db, request.sessionId)?.workstreamId ?? null,
		tool: request.tool,
		input: request.input,
		status: 'running',
		approval: approvalOf(deps, request),
		output: null,
	});
	try {
		const text = JSON.stringify(await runPlatformTool(request, deps));
		finishAgentAction(deps, action.id, 'succeeded', text);
		return { ok: true, text };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		finishAgentAction(deps, action.id, 'failed', message);
		return { ok: false, error: message };
	}
}

function approvalOf(
	{ db }: PlatformRequestDeps,
	request: BridgePlatformRequest,
): AgentActionApproval {
	const toolName = `${MALINI_TOOL_PREFIX}${request.tool}`;
	const answers = answeredApprovalsInRun(db, request.sessionId, request.runId).filter(
		({ requestPayload, response }) =>
			isRecord(requestPayload) &&
			requestPayload['toolName'] === toolName &&
			isRecord(response) &&
			response['decision'] === 'allow',
	);
	const exact = answers.filter(
		({ requestPayload, response }) =>
			(isRecord(requestPayload) && jsonEqual(requestPayload['input'], request.input)) ||
			(isRecord(response) && jsonEqual(response['updatedInput'], request.input)),
	);
	const answer = exact.at(-1) ?? answers.at(-1);
	if (!answer || (isRecord(answer.response) && answer.response['tree'] === true)) {
		return 'not-needed';
	}
	return isRecord(answer.response) && answer.response['scope'] === 'once'
		? 'allowed'
		: 'always-allowed';
}

async function runPlatformTool(
	request: BridgePlatformRequest,
	deps: PlatformRequestDeps,
): Promise<unknown> {
	const { db, commands } = deps;
	const { input } = request;
	switch (request.tool) {
		case 'jobs_list':
			return (await jobs(commands)).map(jobSummary);
		case 'jobs_save': {
			const args = jobDefinition(input, await jobs(commands));
			return reviewed(db, request, jobSummary(await commands.call('jobs.save-definition', args)));
		}
		case 'jobs_run': {
			const session = requestSession(db, request);
			const job = findJob(await jobs(commands), requiredText(input, 'job'));
			const context = text(input, 'context');
			const parent = activeJobRunForSession(db, request.sessionId);
			const workstream = text(input, 'workstream');
			const run = await commands.call('jobs.run', {
				definitionId: job.id,
				workstreamId:
					workstream === undefined
						? session.workstreamId
						: findWorkstream(listWorkstreams(db), workstream).id,
				...(context === undefined ? {} : { context }),
				...(parent ? { parentRunId: parent.id } : {}),
				chatSessionId: request.sessionId,
				chatAfterRunId: request.runId,
			});
			return { id: run.id, job: run.title, status: run.status, workstreamId: run.workstreamId };
		}
		case 'events_list':
			return CONTRACT_REFERENCE.events;
		case 'repositories_list':
			return (await listRepositoryCatalog(db)).map(repositorySummary);
		case 'repositories_clone':
			return cloneRepository(deps, requiredText(input, 'repository'));
		case 'repositories_hide': {
			const repository = findRepository(
				await listRepositoryCatalog(db),
				requiredText(input, 'repository'),
			);
			await commands.call('repositories.set-hidden', { repoId: repository.id, hidden: true });
			return { ...repositorySummary(repository), hidden: true };
		}
		case 'workstreams_list': {
			const { workstreamId } = requestSession(db, request);
			const catalog = await listRepositoryCatalog(db);
			const reference = text(input, 'repository');
			const only = reference === undefined ? null : findRepository(catalog, reference);
			const listed = (workstream: Workstream): boolean =>
				workstream.scope === null &&
				(only === null || only.projectIds.includes(workstream.projectId));
			const open = listWorkstreams(db)
				.filter(listed)
				.map((workstream) => ({
					...workstreamSummary(workstream, catalog),
					current: workstream.id === workstreamId,
					...workstreamStanding(db, workstream.id),
				}));
			const finished = listArchivedWorkstreams(db)
				.filter((workstream) => workstream.startedBy === workstreamId && listed(workstream))
				.map((workstream) => ({
					...workstreamSummary(workstream, catalog),
					archived: true,
					merged: workstream.mergedPullRequest,
				}));
			return [...open, ...finished];
		}
		case 'workstreams_create':
			return createWorkstream(deps, request);
		case 'workstreams_send':
			return sendToWorkstream(deps, request);
		case 'workstreams_archive': {
			const { workstreamId } = requestSession(db, request);
			const workstream = findWorkstream(listWorkstreams(db), requiredText(input, 'workstream'));
			if (workstream.id === workstreamId) {
				throw new Error(
					'This chat runs in that workstream, so you cannot archive it. The user archives it from the sidebar.',
				);
			}
			const { savedWork } = await commands.call('repositories.archive-workstream', {
				workstreamId: workstream.id,
			});
			return { id: workstream.id, name: workstream.name, archived: true, savedWork };
		}
		case 'decisions_ask':
			return askLeadDecision(deps, request.sessionId, input);
		case 'decisions_answer':
			return recordLeadDecisionAnswer(deps, request.sessionId, input);
		case 'plan_write':
			return writeLeadPlan(deps, request.sessionId, input);
		case 'files_open': {
			const { workstreamId } = requestSession(db, request);
			return openFileForUser(deps, {
				workstreamId,
				worktree: worktreePath(deps.appDataRoot, workstreamId),
				path: requiredText(input, 'path'),
				line: lineNumber(input, 'line'),
			});
		}
		case 'secrets_request': {
			const { secrets } = deps;
			if (!secrets) throw new Error('Malini cannot keep secrets in this build.');
			const { workstreamId } = requestSession(db, request);
			return secrets.request({
				sessionId: request.sessionId,
				repository: await workstreamRepositoryName(db, workstreamId),
				names: input['names'],
				why: input['why'],
			});
		}
	}
}

async function cloneRepository(
	{ db, commands }: PlatformRequestDeps,
	reference: string,
): Promise<unknown> {
	const { repository } = await commands.call('repositories.connect', {
		source: { kind: 'clone-url', url: cloneUrl(reference) },
	});
	const plan = await planRepositoryWorkstream(db, repository.id);
	if (!plan) throw new Error(`${repository.fullName} is no longer in Malini.`);
	const cloned = await settledWithin(clonePlannedRepository(commands, plan), CLONE_WAIT_MS);
	return {
		id: repository.id,
		name: repository.fullName,
		defaultBranch: repository.defaultBranch,
		cloned: cloned !== null,
		hidden: false,
	};
}

async function createWorkstream(
	deps: PlatformRequestDeps,
	request: BridgePlatformRequest,
): Promise<unknown> {
	const { db, commands, sending, deliveries, log } = deps;
	const { input } = request;
	const prompt = requiredText(input, 'prompt');
	const base = text(input, 'base') ?? null;
	const source = requestSession(db, request);
	const repository = findRepository(
		await listRepositoryCatalog(db),
		requiredText(input, 'repository'),
	);
	const plan = await planRepositoryWorkstream(db, repository.id);
	if (!plan) throw new Error(`${repository.fullName} is no longer in Malini.`);
	const projectRepoPath = await settledWithin(
		clonePlannedRepository(commands, plan),
		CLONE_WAIT_MS,
	);
	if (projectRepoPath === null) {
		throw new Error(
			`Malini is still cloning ${repository.fullName}. Call repositories_clone to wait for it, then workstreams_create again.`,
		);
	}
	await createPlannedWorkstream(commands, plan, projectRepoPath, base, source.workstreamId);
	const { workstreamId } = plan;
	const settingUp = prepareStartedWorkstream(deps, workstreamId, (line) => log(`agent: ${line}`));
	let chat: string;
	try {
		chat = await commands.call('chat.start-session', {
			workstreamId,
			origin: 'user',
			...(source.model === null ? {} : { model: source.model }),
		});
	} catch (error) {
		throw new Error(
			`Malini started the workstream “${plan.name}” (\`${workstreamId}\`) but could not start its chat, so it did not send the prompt: ${describeError(error)}. Do not start it again.`,
		);
	}
	const sessionId = chat;
	deliveries.hold(sessionId);
	await deliveries.deliver({
		sessionId,
		kind: 'prompt',
		prompt,
		fromSessionId: request.sessionId,
		fromWorkstreamId: source.workstreamId,
		profile: parseRunProfile(storedRunProfile(db, request.runId)),
		chainId: chatTurnChainId(db, request.runId),
	});
	void sending.during(workstreamId, async () => {
		await settingUp;
		try {
			await deliveries.release(sessionId);
		} catch (error) {
			log(`agent: could not send the first prompt in \`${workstreamId}\`: ${describeError(error)}`);
		}
	});
	return {
		id: workstreamId,
		name: plan.name,
		repository: repository.fullName,
		branch: plan.branch,
		baseBranch: plan.baseBranch,
		...(base === null ? {} : { base }),
		chat,
	};
}

async function sendToWorkstream(
	{ db, deliveries }: PlatformRequestDeps,
	request: BridgePlatformRequest,
): Promise<unknown> {
	const { input } = request;
	const prompt = requiredText(input, 'prompt');
	const source = requestSession(db, request);
	const workstream = findWorkstream(listWorkstreams(db), requiredText(input, 'workstream'));
	if (workstream.startedBy !== source.workstreamId) {
		throw new Error(
			`This chat did not start “${workstream.name}”, so it sends no prompt there. Send prompts only to the workstreams this chat started, as workstreams_list shows in startedBy.`,
		);
	}
	const chat = latestSessionForWorkstream(db, workstream.id);
	if (!chat) throw new Error(`“${workstream.name}” has no chat to send the prompt to.`);
	const chainId = chatTurnChainId(db, request.runId);
	if (
		chainId !== null &&
		promptsSentInChain(db, request.sessionId, chat.id, chainId) >= SENDS_PER_CHAIN
	) {
		throw new Error(
			`You already sent “${workstream.name}” ${SENDS_PER_CHAIN} prompts since the user last wrote, so Malini did not send this one. Ask the user with decisions_ask whether to keep going, or put it in your Needs line.`,
		);
	}
	const delivery = await deliveries.deliver({
		sessionId: chat.id,
		kind: 'prompt',
		prompt,
		fromSessionId: request.sessionId,
		fromWorkstreamId: source.workstreamId,
		chainId,
	});
	return {
		id: workstream.id,
		name: workstream.name,
		chat: chat.id,
		delivery: {
			id: delivery.id,
			status: delivery.status,
			...(delivery.detail ? { detail: delivery.detail } : {}),
		},
	};
}

function workstreamStanding(
	db: MaliniDatabase,
	workstreamId: string,
): Readonly<{
	working: boolean;
	outcome: string | null;
	needs: string | null;
	merged: MergedPullRequest | null;
}> {
	const turn = latestWorkstreamTurn(db, workstreamId);
	return {
		working: workstreamHasWorkingRun(db, workstreamId),
		outcome: turn?.outcome ?? null,
		needs: turn?.need ?? null,
		merged: mergedPullRequestOf(db, workstreamId),
	};
}

function cloneUrl(reference: string): string {
	if (GITHUB_FULL_NAME.test(reference)) return `https://github.com/${reference}.git`;
	if (CLONE_URL.test(reference)) return reference;
	throw new Error(
		'`repository` must be owner/name, or a git URL that starts with https://, ssh://, file:// or git@.',
	);
}

async function settledWithin<T>(work: Promise<T>, ms: number): Promise<T | null> {
	work.catch(() => undefined);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), ms);
	});
	try {
		return await Promise.race([work, late]);
	} finally {
		clearTimeout(timer);
	}
}

function repositorySummary(repository: CatalogRepository): Readonly<Record<string, unknown>> {
	return {
		id: repository.id,
		name: repository.fullName,
		defaultBranch: repository.defaultBranch,
		cloned: repository.projectIds.length > 0,
		hidden: repository.hidden,
	};
}

function workstreamSummary(
	workstream: Workstream,
	catalog: readonly CatalogRepository[],
): Readonly<Record<string, unknown>> {
	return {
		id: workstream.id,
		name: workstream.name,
		repository:
			catalog.find((repository) => repository.projectIds.includes(workstream.projectId))
				?.fullName ?? null,
		branch: workstream.branch,
		baseBranch: workstream.baseBranch,
		startedBy: workstream.startedBy,
	};
}

function findRepository(
	catalog: readonly CatalogRepository[],
	reference: string,
): CatalogRepository {
	const wanted = reference.trim().toLocaleLowerCase();
	const found = catalog.find(
		(repository) =>
			repository.id === reference || repository.fullName.toLocaleLowerCase() === wanted,
	);
	if (found) return found;
	throw new Error(
		`No repository in Malini is \`${reference}\`. Call repositories_list for them, or repositories_clone to add it.`,
	);
}

export function findWorkstream(workstreams: readonly Workstream[], reference: string): Workstream {
	const byId = workstreams.find((workstream) => workstream.id === reference);
	if (byId) return byId;
	const wanted = reference.trim().toLocaleLowerCase();
	const named = workstreams.filter((workstream) => workstream.name.toLocaleLowerCase() === wanted);
	const [only] = named;
	if (only && named.length === 1) return only;
	throw new Error(
		named.length > 1
			? `Several workstreams are named “${reference}”. Pass the id from workstreams_list instead.`
			: `No workstream is named or has the id “${reference}”. Call workstreams_list for them.`,
	);
}

const REVIEWED =
	'The user reviewed your change and saved the version above. Where it differs from what you sent, the user rejected or rewrote that part: keep it as saved, and do not propose it again unless they ask.';

function reviewed(
	db: MaliniDatabase,
	request: BridgePlatformRequest,
	saved: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const toolName = `mcp__malini__${request.tool}`;
	const byUser = answeredApprovalsInRun(db, request.sessionId, request.runId).some(
		({ requestPayload, response }) =>
			isRecord(requestPayload) &&
			requestPayload['toolName'] === toolName &&
			isRecord(response) &&
			response['decision'] === 'allow' &&
			isRecord(response['updatedInput']) &&
			jsonEqual(response['updatedInput'], request.input),
	);
	return byUser ? { ...saved, reviewedByUser: REVIEWED } : saved;
}

function requestSession(
	db: MaliniDatabase,
	request: BridgePlatformRequest,
): PersistedBridgeSession {
	const session = persistedBridgeSession(db, request.sessionId);
	if (!session) throw new Error(`Agent session \`${request.sessionId}\` is unknown.`);
	return session;
}

function jobs(commands: CommandRegistry): Promise<JobDefinitionRecord[]> {
	return commands.call('jobs.list-definitions', undefined);
}

function jobSummary(job: JobDefinitionRecord): Readonly<Record<string, unknown>> {
	const { id, name, instructions, runsIn, model, effort, skills, builtin, trigger, thenJobId } =
		job;
	return {
		id,
		name,
		instructions,
		runsIn,
		model,
		effort,
		skills,
		builtin,
		when: trigger?.when ?? null,
		mode: trigger?.mode ?? null,
		then: thenJobId,
	};
}

function jobDefinition(
	input: Input,
	definitions: readonly JobDefinitionRecord[],
): SaveJobDefinitionArgs {
	const id = text(input, 'id');
	const name = text(input, 'name');
	const instructions = text(input, 'instructions');
	const model = text(input, 'model');
	const effort = oneOf(input, 'effort', EFFORTS);
	const runsIn = oneOf(input, 'runsIn', RUNS_IN);
	const when = nullableText(input, 'when');
	const then = nullableText(input, 'then');
	const skills = input['skills'];
	if (skills !== undefined && !isSkillNameList(skills)) {
		throw new Error('`skills` must be a list of skill names.');
	}
	const existing =
		id === undefined ? undefined : definitions.find((definition) => definition.id === id);
	if (id !== undefined && !existing) {
		throw new Error(`No job has the id \`${id}\`. Call jobs_list for the ids.`);
	}
	const links = {
		...(skills === undefined ? {} : { skills }),
		...(when === undefined ? {} : { trigger: trigger(when, existing?.trigger ?? null) }),
		...(then === undefined ? {} : { thenJobId: then && findJob(definitions, then).id }),
	};
	if (!existing) {
		if (name === undefined || instructions === undefined) {
			throw new Error('To create a job, pass its name and instructions.');
		}
		return {
			name,
			instructions,
			provider: DEFAULT_PROVIDER_ID,
			model: model ?? DEFAULT_AGENT_MODEL,
			effort: effort ?? 'high',
			runsIn: runsIn ?? 'workstream',
			...links,
		};
	}
	return {
		id: existing.id,
		name: name ?? existing.name,
		instructions: instructions ?? existing.instructions,
		provider: existing.provider,
		model: model ?? existing.model,
		effort: effort ?? existing.effort,
		runsIn: runsIn ?? existing.runsIn,
		...links,
	};
}

function trigger(when: string | null, current: JobTrigger | null): JobTrigger | null {
	return when === null ? null : { when, mode: current?.mode ?? 'off' };
}

function findJob(
	definitions: readonly JobDefinitionRecord[],
	reference: string,
): JobDefinitionRecord {
	const named = jobsNamed(definitions, reference);
	const [only] = named;
	if (only && named.length === 1) return only;
	throw new Error(
		named.length > 1
			? `Several jobs are named “${reference}”. Pass the id from jobs_list instead.`
			: `No job is named or has the id “${reference}”. Call jobs_list for the jobs.`,
	);
}

function text(input: Input, key: string): string | undefined {
	const value = input[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'string') throw new Error(`\`${key}\` must be a string.`);
	return value;
}

function nullableText(input: Input, key: string): string | null | undefined {
	return input[key] === null ? null : text(input, key);
}

function requiredText(input: Input, key: string): string {
	const value = text(input, key);
	if (value === undefined) throw new Error(`\`${key}\` is required.`);
	return value;
}

function lineNumber(input: Input, key: string): number | null {
	const value = input[key];
	if (value === undefined) return null;
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
		throw new Error(`\`${key}\` must be a line number from 1.`);
	}
	return value;
}

function oneOf<T extends string>(input: Input, key: string, values: readonly T[]): T | undefined {
	const value = input[key];
	if (value === undefined) return undefined;
	const match = values.find((candidate) => candidate === value);
	if (match === undefined) throw new Error(`\`${key}\` must be one of ${values.join(', ')}.`);
	return match;
}
