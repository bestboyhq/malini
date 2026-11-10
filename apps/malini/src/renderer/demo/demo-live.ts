import type { AgentEventEnvelope, AgentSessionSummary } from '$contract/agent';
import type { CreateWorkstreamArgs } from '$contract/commands';
import { runIdForPromptRequest } from '$contract/chat-identity';
import type { ShipButton, ShipStateRecord } from '$contract/pull-requests';
import type { WorkstreamDto } from '$contract/repositories';
import type { AgentEvent } from '$lib/chat/domain/events';
import type { DemoEmit } from './demo-bridge';
import { openPage } from './demo-browser';
import { DOCS_LIVE, DOCS_REPLIES, DOCS_WORKSTREAMS } from './demo-docs';
import { DEMO_PLAY } from './demo-play';
import {
	closingEvents,
	envelopesOf,
	OWNER,
	openingEvents,
	PROJECTS,
	sessionId,
	SETUP_WORKSTREAM,
	toolEvents,
	treeOf,
	workstreamDto,
	WORKSTREAMS,
	type DemoRun,
	type DemoWorkstream,
	type StartedWorkstream,
} from './demo-data';
import { TOUR_FEEDBACK, TOUR_STARTER, TOUR_THREAD_REPORT } from './demo-tour-data';

const DEMO_REPLY = [
	'- Changed: nothing, this chat runs in your browser on demo data',
	'- Next: download Malini and send this prompt to your own repository',
	'',
	'Outcome: This is the real Malini interface, running on demo data',
	'Needs: nothing',
].join('\n');

type StarterScript = Readonly<{
	prompt: string;
	name: string;
	plan: string;
	inFlight: string;
	split: string;
	started: readonly StartedWorkstream[];
	compare: string;
	report: string;
}>;

const STARTER_SCRIPTS: readonly StarterScript[] = [TOUR_STARTER];

const REPLIES: ReadonlyMap<string, string> = new Map([[TOUR_FEEDBACK, TOUR_THREAD_REPORT]]);

const listed: DemoWorkstream[] = [
	...(DEMO_PLAY === 'setup' ? [SETUP_WORKSTREAM] : []),
	...WORKSTREAMS,
	...(DEMO_PLAY === 'docs' ? DOCS_WORKSTREAMS : []),
];
const threads = new Map<string, Readonly<{ workstreamId: string; model: string; name: string }>>();
const statuses = new Map<string, AgentSessionSummary['status']>();
const transcripts = new Map<string, AgentEventEnvelope[]>();
const models = new Map<string, string>();

export function workstreams(): WorkstreamDto[] {
	return listed.map(workstreamDto);
}

export function workstreamOf(id: string): DemoWorkstream | undefined {
	return listed.find((workstream) => workstream.id === id);
}

export function sessionSummaries(workstreamId: string): AgentSessionSummary[] {
	const workstream = workstreamOf(workstreamId);
	const id = sessionId(workstreamId);
	if (!workstream) return [];
	const own: AgentSessionSummary[] =
		transcript(id).length === 0
			? []
			: [
					{
						id,
						workstreamId,
						displayName: workstream.name,
						provider: 'claude',
						model: models.get(id) ?? 'opus',
						status: statuses.get(id) ?? (workstream.runs.length > 0 ? 'completed' : 'idle'),
						startedAt: workstream.runs[0]?.startedAt ?? workstream.activeAt,
						origin: 'user',
						latestProfile: null,
					},
				];
	const pinned = [...threads].flatMap(([thread, about]): AgentSessionSummary[] =>
		about.workstreamId === workstreamId
			? [
					{
						id: thread,
						workstreamId,
						displayName: about.name,
						provider: 'claude',
						model: about.model,
						status: statuses.get(thread) ?? 'running',
						startedAt: NOW,
						origin: 'thread',
						latestProfile: null,
					},
				]
			: [],
	);
	return [...own, ...pinned];
}

export function startThread(
	emit: DemoEmit,
	workstreamId: string,
	prompt: string,
	model: string,
): string {
	const id = `thread-${workstreamId}-${threads.size + 1}`;
	threads.set(id, { workstreamId, model, name: prompt.split(/[.!?]/u)[0] ?? prompt });
	statuses.set(id, 'running');
	transcripts.set(id, []);
	sendPrompt(emit, id, prompt, undefined);
	return id;
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

function think(emit: DemoEmit, id: string, runId: string, contentId: string, text: string): Step[] {
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

const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
const running = new Map<string, string>();

function play(steps: readonly Step[], runId?: string): void {
	let delay = 0;
	const scheduled = steps.map(([wait, step]) => {
		delay += wait;
		return setTimeout(step, delay);
	});
	if (runId) timers.set(runId, scheduled);
}

function finish(id: string, runId: string): void {
	if (running.get(id) === runId) running.delete(id);
	timers.delete(runId);
	if (statuses.has(id)) statuses.set(id, 'completed');
}

export function cancelRun(emit: DemoEmit, id: string): void {
	const runId = running.get(id);
	if (!runId) return;
	for (const timer of timers.get(runId) ?? []) clearTimeout(timer);
	finish(id, runId);
	append(emit, id, runId, { type: 'run.failed', runId, error: 'cancelled' });
}

function reply(emit: DemoEmit, id: string, runId: string, text: string, streamed: boolean): Step[] {
	const contentId = `${runId}-reply`;
	const chunks = streamed ? text.split(/(?<=\s)/u) : [];
	return [
		...chunks.map((chunk): Step => [18, () => stream(emit, id, runId, contentId, chunk)]),
		[200, () => append(emit, id, runId, { type: 'assistant.message', runId, text, contentId })],
		[
			0,
			() => {
				finish(id, runId);
				append(emit, id, runId, { type: 'run.completed', runId, summary: '' });
			},
		],
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

export function createWorkstream(args: CreateWorkstreamArgs): string {
	const workstream: DemoWorkstream = {
		id: args.workstreamId,
		projectId: args.projectId,
		name: args.name,
		branch: `malini/${args.workstreamId}`,
		activeAt: new Date().toISOString(),
		files: [],
		tree: treeOf(args.projectId),
		runs: [],
		ship: null,
	};
	listed.push(workstream);
	return workstreamDto(workstream).path;
}

function rename(emit: DemoEmit, workstreamId: string, name: string): void {
	const index = listed.findIndex((workstream) => workstream.id === workstreamId);
	const workstream = listed[index];
	if (!workstream) return;
	listed[index] = { ...workstream, name };
	emit('repositories:workstream-renamed', { workstreamId, name });
}

function start(
	emit: DemoEmit,
	starterId: string,
	started: StartedWorkstream,
	done: () => void,
): void {
	const workstream: DemoWorkstream = {
		...started,
		startedBy: starterId,
		activeAt: new Date().toISOString(),
		runs: started.runs.map((run) => ({ ...run, from: starterId })),
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
	if (started.opens) {
		const url = started.opens;
		setTimeout(() => openPage(emit, workstream.id, url), started.workMs * 0.82);
	}
	if (run) play(work(emit, workstream.id, run, started.thought, started.workMs));
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
			startedBy: starterId,
		},
	});
	setTimeout(() => {
		statuses.set(id, 'completed');
		if (run) for (const event of closingEvents(run)) append(emit, id, run.id, event);
		done();
	}, started.workMs);
}

function work(
	emit: DemoEmit,
	workstreamId: string,
	run: Pick<DemoRun, 'id' | 'tools'>,
	thought: string | null,
	workMs: number,
): Step[] {
	const id = sessionId(workstreamId);
	const tools = toolEvents(workstreamId, run.id, run.tools, Date.now());
	const gap = workMs / (tools.length + 2);
	return [
		...(thought === null ? [] : think(emit, id, run.id, `${run.id}-plan`, thought)),
		...tools.flatMap((event, index): Step[] => {
			const wait = index === 0 ? gap : gap * (index % 2 === 0 ? 1.6 : 0.4);
			if (event.type === 'thinking.message') {
				return [[wait, () => undefined], ...think(emit, id, run.id, event.contentId, event.text)];
			}
			return [
				[
					wait,
					() => append(emit, id, run.id, 'ts' in event ? { ...event, ts: Date.now() } : event),
				],
			];
		}),
	];
}

function starterSteps(
	emit: DemoEmit,
	starterId: string,
	id: string,
	runId: string,
	script: StarterScript,
): Step[] {
	let waiting = script.started.length;
	const done = (): void => {
		if (--waiting > 0) return;
		play([
			[400, () => undefined],
			...think(emit, id, runId, `${runId}-compare`, script.compare),
			[300, () => undefined],
			...reply(emit, id, runId, script.report, false),
		]);
	};
	return [
		...think(emit, id, runId, `${runId}-plan`, script.plan),
		[100, () => rename(emit, starterId, script.name)],
		...tool(
			emit,
			id,
			runId,
			`${runId}-list`,
			'mcp__malini__workstreams_list',
			{ repository: `${OWNER}/malini` },
			script.inFlight,
			600,
		),
		[200, () => undefined],
		...think(emit, id, runId, `${runId}-split`, script.split),
		...script.started.flatMap((started): Step[] => {
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
						start(emit, starterId, started, done);
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
	steer = false,
): string {
	if (steer) cancelRun(emit, id);
	const runId = runIdForPromptRequest(clientRequestId) ?? `run-demo-${++runs}`;
	const scene = listed.find((workstream) => sessionId(workstream.id) === id);
	const docsReply = DOCS_REPLIES.get(prompt.trim());
	const script =
		scene && transcript(id).length === 0
			? STARTER_SCRIPTS.find((candidate) => candidate.prompt === prompt.trim())
			: undefined;
	const answer = REPLIES.get(prompt.trim());
	const steps =
		scene && script
			? starterSteps(emit, scene.id, id, runId, script)
			: scene && docsReply
				? [
						...work(emit, scene.id, { ...docsReply, id: runId }, null, docsReply.workMs),
						...reply(emit, id, runId, docsReply.report, true),
					]
				: answer
					? [
							...tool(
								emit,
								id,
								runId,
								`${runId}-read`,
								'Read',
								{ file_path: 'site/src/lib/Footer.svelte' },
								'ok',
								700,
							),
							...tool(
								emit,
								id,
								runId,
								`${runId}-edit`,
								'Edit',
								{ file_path: 'site/src/lib/Footer.svelte' },
								'ok',
								1_100,
							),
							...reply(emit, id, runId, answer, true),
						]
					: [
							...tool(
								emit,
								id,
								runId,
								`${runId}-read`,
								'Read',
								{ file_path: 'AGENTS.md' },
								'ok',
								900,
							),
							...reply(emit, id, runId, DEMO_REPLY, true),
						];
	running.set(id, runId);
	play(
		[...opening(emit, id, runId, prompt, clientRequestId), [700, () => undefined], ...steps],
		runId,
	);
	return runId;
}

function whenSeen(run: () => void): void {
	const observer = new IntersectionObserver(
		([entry]) => {
			if (!entry?.isIntersecting) return;
			observer.disconnect();
			run();
		},
		{ threshold: 0.5 },
	);
	observer.observe(document.documentElement);
}

export function playDocsScenes(emit: DemoEmit): void {
	if (DEMO_PLAY !== 'docs') return;
	for (const { workstreamId, run, workMs } of DOCS_LIVE) {
		const id = sessionId(workstreamId);
		transcript(id);
		statuses.set(id, 'running');
		running.set(id, run.id);
		for (const event of openingEvents(workstreamId, run)) append(emit, id, run.id, event);
		whenSeen(() =>
			play(
				[
					...work(emit, workstreamId, run, null, workMs),
					[
						workMs / 6,
						() => {
							finish(id, run.id);
							for (const event of closingEvents(run)) append(emit, id, run.id, event);
						},
					],
				],
				run.id,
			),
		);
	}
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
		checks: [],
		activeAutomationRunId: null,
		lastError: null,
		githubSaid: null,
		failures: 0,
		failedSince: null,
		nextAttemptAt: null,
		waitsFor: null,
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
