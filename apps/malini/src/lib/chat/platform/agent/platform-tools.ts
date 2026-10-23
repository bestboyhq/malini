import type { AgentReasoningEffort } from '$contract/agent';
import { CONTRACT_REFERENCE } from '$contract/contract-reference.generated';
import type {
	JobDefinitionRecord,
	JobRunsIn,
	JobTrigger,
	SaveJobDefinitionArgs,
} from '$contract/jobs';
import { isSkillNameList } from '$contract/skills';
import type { MaliniDatabase } from '$main/db/driver';
import type { CommandRegistry } from '$main/ipc/registry';
import { activeJobRunForSession } from '$lib/jobs/jobs.platform';
import { DEFAULT_AGENT_MODEL } from '$shared/providers/providers.platform';
import type { BridgePlatformRequest, PlatformAnswer } from './protocol';
import { isRecord, jsonEqual } from '$main/db/rows';
import { answeredApprovalsInRun } from '../interactions.repository';
import { jobsNamed } from './malini-approvals.service';
import { persistedBridgeSession, type PersistedBridgeSession } from './sessions';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies AgentReasoningEffort[];
const RUNS_IN = ['workstream', 'new-workstream'] as const satisfies JobRunsIn[];

export interface PlatformRequestDeps {
	readonly db: MaliniDatabase;
	readonly commands: CommandRegistry;
}

type Input = Readonly<Record<string, unknown>>;

export async function answerPlatformRequest(
	request: BridgePlatformRequest,
	deps: PlatformRequestDeps,
): Promise<PlatformAnswer> {
	try {
		return { ok: true, text: JSON.stringify(await runPlatformTool(request, deps)) };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

async function runPlatformTool(
	request: BridgePlatformRequest,
	{ db, commands }: PlatformRequestDeps,
): Promise<unknown> {
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
			const run = await commands.call('jobs.run', {
				definitionId: job.id,
				workstreamId: session.workstreamId,
				...(context === undefined ? {} : { context }),
				...(parent ? { parentRunId: parent.id } : {}),
				chatSessionId: request.sessionId,
				chatAfterRunId: request.runId,
			});
			return { id: run.id, job: run.title, status: run.status, workstreamId: run.workstreamId };
		}
		case 'events_list':
			return CONTRACT_REFERENCE.events;
		case 'pull_requests_open_draft': {
			const { workstreamId } = requestSession(db, request);
			const ship = await commands.call('pull-requests.open-draft', { workstreamId });
			return ship.pullRequestUrl
				? {
						pullRequest: ship.pullRequestUrl,
						status: 'Malini pushes this turn to the open pull request once the turn ends.',
					}
				: { status: 'Malini opens the draft pull request once this turn ends.' };
		}
	}
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

function oneOf<T extends string>(input: Input, key: string, values: readonly T[]): T | undefined {
	const value = input[key];
	if (value === undefined) return undefined;
	const match = values.find((candidate) => candidate === value);
	if (match === undefined) throw new Error(`\`${key}\` must be one of ${values.join(', ')}.`);
	return match;
}
