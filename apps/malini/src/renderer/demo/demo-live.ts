import type { AgentEventEnvelope, AgentSessionSummary } from '$contract/agent';
import type { CreateLeadArgs } from '$contract/commands';
import { runIdForPromptRequest } from '$contract/chat-identity';
import type { ShipButton, ShipStateRecord } from '$contract/pull-requests';
import type { WorkstreamDto } from '$contract/repositories';
import type { AgentEvent } from '$lib/chat/domain/events';
import type { DemoEmit } from './demo-bridge';
import {
	closingEvents,
	envelopesOf,
	LEAD_PROMPT,
	LEAD_WORKSTREAM,
	LEAD_REPORT,
	OWNER,
	openingEvents,
	PROJECTS,
	sessionId,
	STARTED,
	toolEvents,
	workstreamDto,
	WORKSTREAMS,
	type DemoWorkstream,
	type StartedWorkstream,
} from './demo-data';

const DEMO_REPLY = [
	'- Changed: nothing, this chat runs in your browser on demo data',
	'- Next: download Malini and send this prompt to your own repository',
	'',
	'Outcome: This is the real Malini interface, running on demo data',
	'Needs: nothing',
].join('\n');

const listed: DemoWorkstream[] = [
	{ ...LEAD_WORKSTREAM, name: 'New chat', runs: [] },
	...WORKSTREAMS,
];
const statuses = new Map<string, AgentSessionSummary['status']>();
const transcripts = new Map<string, AgentEventEnvelope[]>();
const models = new Map<string, string>();
let leadReported: () => void = () => {};
export const leadReport = new Promise<void>((resolve) => (leadReported = resolve));

export function workstreams(): WorkstreamDto[] {
	return listed.map(workstreamDto);
}

export function workstreamOf(id: string): DemoWorkstream | undefined {
	return listed.find((workstream) => workstream.id === id);
}

export function sessionSummaries(workstreamId: string): AgentSessionSummary[] {
	const workstream = workstreamOf(workstreamId);
	const id = sessionId(workstreamId);
	if (!workstream || transcript(id).length === 0) return [];
	return [
		{
			id,
			workstreamId,
			displayName: workstream.name,
			model: models.get(id) ?? 'opus',
			status: statuses.get(id) ?? (workstream.runs.length > 0 ? 'completed' : 'idle'),
			startedAt: workstream.runs[0]?.startedAt ?? workstream.activeAt,
			origin: 'user',
		},
	];
}

export function startSession(workstreamId: string, model: string | undefined): string {
	const id = sessionId(workstreamId);
	if (model && !models.has(id)) models.set(id, model);
	return id;
}

export function transcript(id: string): AgentEventEnvelope[] {
	let envelopes = transcripts.get(id);
	if (!envelopes) {
		const workstream = listed.find((candidate) => sessionId(candidate.id) === id);
		envelopes = workstream ? envelopesOf(workstream) : [];
		transcripts.set(id, envelopes);
	}
	return envelopes;
}

function append(emit: DemoEmit, id: string, runId: string, event: AgentEvent): void {
	const envelopes = transcript(id);
	const envelope = { sessionId: id, runId, seq: envelopes.length + 1, event };
	envelopes.push(envelope);
	emit('chat:agent-event', envelope);
}

function stream(emit: DemoEmit, id: string, runId: string, contentId: string, text: string): void {
	emit('chat:agent-event', {
		sessionId: id,
		runId,
		seq: -1,
		event: { type: 'assistant.delta', runId, contentId, text },
		ephemeral: true,
	});
}

function think(emit: DemoEmit, id: string, runId: string, key: string, text: string): Step[] {
	const contentId = `${runId}-${key}`;
	const words = text.split(/(?<=\s)/u);
	return [
		...words.map((chunk): Step => [
			18 + Math.random() * 24,
			() =>
				emit('chat:agent-event', {
					sessionId: id,
					runId,
					seq: -1,
					event: { type: 'thinking.delta', runId, contentId, text: chunk },
					ephemeral: true,
				}),
		]),
		[150, () => append(emit, id, runId, { type: 'thinking.message', runId, contentId, text })],
	];
}

type Step = readonly [number, () => void];

function play(steps: readonly Step[]): void {
	let delay = 0;
	for (const [wait, step] of steps) {
		delay += wait;
		setTimeout(step, delay);
	}
}

function reply(emit: DemoEmit, id: string, runId: string, text: string, streamed: boolean): Step[] {
	const contentId = `${runId}-reply`;
	const chunks = streamed ? text.split(/(?<=\s)/u) : [];
	return [
		...chunks.map((chunk): Step => [18, () => stream(emit, id, runId, contentId, chunk)]),
		[200, () => append(emit, id, runId, { type: 'assistant.message', runId, text, contentId })],
		[0, () => append(emit, id, runId, { type: 'run.completed', runId, summary: '' })],
	];
}

function opening(
	emit: DemoEmit,
	id: string,
	runId: string,
	prompt: string,
	clientRequestId: string | undefined,
): Step[] {
	return [
		[0, () => append(emit, id, runId, { type: 'run.started', runId, sessionId: id })],
		[
			0,
			() =>
				append(emit, id, runId, {
					type: 'user.message',
					runId,
					text: prompt,
					...(clientRequestId ? { clientRequestId } : {}),
				}),
		],
	];
}

function tool(
	emit: DemoEmit,
	id: string,
	runId: string,
	toolCallId: string,
	name: string,
	input: Record<string, unknown>,
	output: string,
	ms: number,
): Step[] {
	return [
		[0, () => append(emit, id, runId, { type: 'tool.started', runId, name, input, toolCallId })],
		[
			ms,
			() => append(emit, id, runId, { type: 'tool.completed', runId, name, output, toolCallId }),
		],
	];
}

export function createLead(args: CreateLeadArgs): WorkstreamDto {
	const lead: DemoWorkstream = {
		id: args.workstreamId,
		projectId: 'malini-lead-space',
		name: args.name,
		branch: 'main',
		activeAt: new Date().toISOString(),
		files: [],
		tree: [],
		runs: [],
		ship: null,
		scope: args.scope,
	};
	listed.unshift(lead);
	return workstreamDto(lead);
}

function rename(emit: DemoEmit, workstreamId: string, name: string): void {
	const index = listed.findIndex((workstream) => workstream.id === workstreamId);
	const workstream = listed[index];
	if (!workstream) return;
	listed[index] = { ...workstream, name };
	emit('repositories:workstream-renamed', { workstreamId, name });
}

function start(emit: DemoEmit, leadId: string, started: StartedWorkstream, done: () => void): void {
	const workstream: DemoWorkstream = {
		...started,
		startedBy: leadId,
		activeAt: new Date().toISOString(),
		runs: started.runs.map((run) => ({ ...run, from: leadId })),
	};
	const id = sessionId(workstream.id);
	const run = workstream.runs[0];
	statuses.set(id, 'running');
	transcripts.set(
		id,
		run
			? openingEvents(workstream.id, run).map((event, index) => ({
					sessionId: id,
					runId: run.id,
					seq: index + 1,
					event,
				}))
			: [],
	);
	if (run) {
		const tools = toolEvents(workstream.id, run.id, run.tools, Date.now());
		const gap = started.workMs / (tools.length + 2);
		play([
			...think(emit, id, run.id, 'plan', started.thought),
			...tools.map((event, index): Step => [
				index === 0 ? gap : gap * (index % 2 === 0 ? 1.6 : 0.4),
				() => append(emit, id, run.id, event),
			]),
		]);
	}
	listed.push(workstream);
	const project = PROJECTS.find((candidate) => candidate.id === workstream.projectId);
	const dto = workstreamDto(workstream);
	emit('repositories:workstream-created', {
		workstreamId: workstream.id,
		project: {
			id: workstream.projectId,
			name: project?.name ?? workstream.projectId,
			repoPath: project?.repoPath ?? '',
			defaultBranch: 'main',
			createdAt: project?.createdAt ?? dto.createdAt,
		},
		workstream: {
			id: dto.id,
			projectId: dto.projectId,
			name: dto.name,
			path: dto.path,
			branch: dto.branch,
			baseBranch: dto.baseBranch,
			status: dto.status,
			createdAt: dto.createdAt,
			scope: null,
			startedBy: leadId,
		},
	});
	setTimeout(() => {
		statuses.set(id, 'completed');
		if (run) for (const event of closingEvents(run)) append(emit, id, run.id, event);
		done();
	}, started.workMs);
}

function leadSteps(emit: DemoEmit, leadId: string, id: string, runId: string): Step[] {
	let waiting = STARTED.length;
	const done = (): void => {
		if (--waiting > 0) return;
		play([
			[400, () => undefined],
			...think(
				emit,
				id,
				runId,
				'compare',
				'All three are back with the same three directions. I will show them on Malini.',
			),
			[300, () => undefined],
			...reply(emit, id, runId, LEAD_REPORT, false),
			[0, () => leadReported()],
		]);
	};
	return [
		...think(
			emit,
			id,
			runId,
			'plan',
			'Open Graph directions for every Bestboy site. First, what is already in flight.',
		),
		[100, () => rename(emit, leadId, 'OG image directions')],
		...tool(
			emit,
			id,
			runId,
			`${runId}-list`,
			'mcp__malini__workstreams_list',
			{ repository: OWNER },
			'[{"name":"Show the words in the hero","repository":"bestboyhq/tony","working":false}]',
			600,
		),
		[200, () => undefined],
		...think(
			emit,
			id,
			runId,
			'split',
			'One workstream per site, each prototyping the same three directions.',
		),
		...STARTED.flatMap((started): Step[] => {
			const toolCallId = `${runId}-start-${started.id}`;
			const name = 'mcp__malini__workstreams_create';
			const repository = `${OWNER}/${started.projectId}`;
			const input = { repository, prompt: started.runs[0]?.prompt ?? '' };
			const output = JSON.stringify({
				id: started.id,
				name: started.name,
				repository,
				branch: started.branch,
				baseBranch: 'main',
				chat: sessionId(started.id),
			});
			return [
				[
					250,
					() => append(emit, id, runId, { type: 'tool.started', runId, name, input, toolCallId }),
				],
				[
					350,
					() => {
						start(emit, leadId, started, done);
						append(emit, id, runId, { type: 'tool.completed', runId, name, toolCallId, output });
					},
				],
			];
		}),
	];
}

let runs = 0;

export function sendPrompt(
	emit: DemoEmit,
	id: string,
	prompt: string,
	clientRequestId: string | undefined,
): string {
	const runId = runIdForPromptRequest(clientRequestId) ?? `run-demo-${++runs}`;
	const lead = listed.find((workstream) => sessionId(workstream.id) === id && workstream.scope);
	const scripted = lead && prompt.trim() === LEAD_PROMPT && transcript(id).length === 0;
	const work = scripted
		? leadSteps(emit, lead.id, id, runId)
		: [
				...tool(emit, id, runId, `${runId}-read`, 'Read', { file_path: 'AGENTS.md' }, 'ok', 900),
				...reply(emit, id, runId, DEMO_REPLY, true),
			];
	play([...opening(emit, id, runId, prompt, clientRequestId), [700, () => undefined], ...work]);
	return runId;
}

const NOW = new Date().toISOString();

const ships = new Map<string, ShipStateRecord>(
	WORKSTREAMS.flatMap((workstream) =>
		workstream.ship ? [[workstream.id, shipState(workstream.id, workstream.ship)] as const] : [],
	),
);

export function pullRequestUrl(workstreamId: string, number: number): string {
	return `https://github.com/${OWNER}/${workstreamOf(workstreamId)?.projectId ?? 'malini'}/pull/${number}`;
}

function shipState(
	workstreamId: string,
	ship: Pick<ShipStateRecord, 'phase' | 'step' | 'pullRequestNumber'>,
): ShipStateRecord {
	return {
		workstreamId,
		...ship,
		keep: false,
		pullRequestUrl:
			ship.pullRequestNumber === null ? null : pullRequestUrl(workstreamId, ship.pullRequestNumber),
		needsYou: null,
		queuedAt: ship.phase === 'queued' ? NOW : null,
		attempts: 0,
		activeJobRunId: null,
		lastError: null,
		githubSaid: null,
		failures: 0,
		failedSince: null,
		nextAttemptAt: null,
		updatedAt: NOW,
	};
}

export function shipStates(): ShipStateRecord[] {
	return [...ships.values()];
}

export function shipOf(workstreamId: string): ShipStateRecord | null {
	return ships.get(workstreamId) ?? null;
}

const PULL_REQUEST_NUMBER = 118;

const MERGING_MS = 5_600;
const MERGED_MS = 1_800;

const merged = new Map<string, number>();

export function mergedPullRequest(workstreamId: string): number | null {
	return merged.get(workstreamId) ?? null;
}

function setShip(emit: DemoEmit, workstreamId: string, state: ShipStateRecord | null): void {
	if (state) ships.set(workstreamId, state);
	else ships.delete(workstreamId);
	emit('pull-requests:ship-changed', { workstreamId, state });
}

function land(emit: DemoEmit, workstreamId: string, number: number): void {
	setShip(
		emit,
		workstreamId,
		shipState(workstreamId, { phase: 'queued', step: 'merging', pullRequestNumber: number }),
	);
	setTimeout(() => {
		merged.set(workstreamId, number);
		ships.delete(workstreamId);
		emit('pull-requests:ship-changed', {
			workstreamId,
			state: null,
			merged: { pullRequestNumber: number, pullRequestUrl: pullRequestUrl(workstreamId, number) },
		});
	}, MERGED_MS);
}

export function clickShipButton(
	emit: DemoEmit,
	workstreamId: string,
	button: ShipButton,
): ShipStateRecord | null {
	const number = ships.get(workstreamId)?.pullRequestNumber ?? PULL_REQUEST_NUMBER;
	const next =
		button === 'draft'
			? shipState(workstreamId, { phase: 'draft', step: null, pullRequestNumber: number })
			: button === 'merge'
				? shipState(workstreamId, {
						phase: 'queued',
						step: 'waiting-for-checks',
						pullRequestNumber: number,
					})
				: null;
	setShip(emit, workstreamId, next);
	if (button === 'merge') setTimeout(() => land(emit, workstreamId, number), MERGING_MS);
	return next;
}
