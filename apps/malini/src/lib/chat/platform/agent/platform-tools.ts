import type { AgentReasoningEffort } from '$contract/agent';
import { CONTRACT_REFERENCE } from '$contract/contract-reference.generated';
import type {
	JobDefinitionRecord,
	JobOutput,
	JobRunsIn,
	SaveJobDefinitionArgs,
} from '$contract/jobs';
import type { RoutineRecord, RoutineRun } from '$contract/routines';
import { isSkillNameList } from '$contract/skills';
import type { MaliniDatabase } from '$main/db/driver';
import type { CommandRegistry } from '$main/ipc/registry';
import { DEFAULT_AGENT_MODEL } from '$shared/providers/providers.platform';
import type { BridgePlatformRequest, PlatformAnswer } from './protocol';
import { isRecord, jsonEqual } from '$main/db/rows';
import { answeredApprovalsInRun } from '../interactions.repository';
import { jobsNamed } from './malini-approvals.service';
import { persistedBridgeSession, type PersistedBridgeSession } from './sessions';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies AgentReasoningEffort[];
const RUNS_IN = ['workstream', 'new-workstream'] as const satisfies JobRunsIn[];
const OUTPUTS = ['none', 'draft', 'merge'] as const satisfies JobOutput[];

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
			const run = await commands.call('jobs.run', {
				definitionId: job.id,
				workstreamId: session.workstreamId,
				...(context === undefined ? {} : { context }),
				chatSessionId: request.sessionId,
				chatAfterRunId: request.runId,
			});
			return { id: run.id, job: run.title, status: run.status, workstreamId: run.workstreamId };
		}
		case 'routines_list':
			return (await commands.call('routines.list', undefined)).map(routineSummary);
		case 'routines_save':
			return reviewed(db, request, routineSummary(await saveRoutine(input, commands)));
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
	const { id, name, runsIn, output, model, effort, skills, builtin, instructions } = job;
	return { id, name, runsIn, output, model, effort, skills, builtin, instructions };
}

function routineSummary(routine: RoutineRecord): Readonly<Record<string, unknown>> {
	const { id, status, label, when, steps } = routine;
	return { id, status, label, when, steps };
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
	const output = oneOf(input, 'output', OUTPUTS);
	const skills = input['skills'];
	if (skills !== undefined && !isSkillNameList(skills)) {
		throw new Error('`skills` must be a list of skill names.');
	}
	const withSkills = skills === undefined ? {} : { skills };
	if (id === undefined) {
		if (name === undefined || instructions === undefined) {
			throw new Error('To create a job, pass its name and instructions.');
		}
		return {
			name,
			instructions,
			model: model ?? DEFAULT_AGENT_MODEL,
			effort: effort ?? 'high',
			runsIn: runsIn ?? 'workstream',
			output: output ?? 'none',
			...withSkills,
		};
	}
	const existing = definitions.find((definition) => definition.id === id);
	if (!existing) throw new Error(`No job has the id \`${id}\`. Call jobs_list for the ids.`);
	return {
		id,
		name: name ?? existing.name,
		instructions: instructions ?? existing.instructions,
		model: model ?? existing.model,
		effort: effort ?? existing.effort,
		runsIn: runsIn ?? existing.runsIn,
		output: output ?? existing.output,
		...withSkills,
	};
}

async function saveRoutine(input: Input, commands: CommandRegistry): Promise<RoutineRecord> {
	const id = text(input, 'id');
	const label = text(input, 'label');
	const when = text(input, 'when');
	const steps = input['steps'] === undefined ? undefined : await jobSteps(input['steps'], commands);
	if (id === undefined) {
		if (label === undefined || when === undefined || steps === undefined) {
			throw new Error('To create a routine, pass its label, when and steps.');
		}
		return commands.call('routines.create-draft', { label, when, steps, origin: 'user' });
	}
	return commands.call('routines.update', {
		routineId: id,
		...(label === undefined ? {} : { label }),
		...(when === undefined ? {} : { when }),
		...(steps === undefined ? {} : { steps }),
	});
}

async function jobSteps(value: unknown, commands: CommandRegistry): Promise<RoutineRun[]> {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error('`steps` must list at least one job id or name.');
	}
	const definitions = await jobs(commands);
	return value.map((step) => {
		if (typeof step !== 'string') throw new Error('Each step must be a job id or name.');
		return { job: findJob(definitions, step).id };
	});
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
