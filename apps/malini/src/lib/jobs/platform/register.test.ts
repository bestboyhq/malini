import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEventEnvelope } from '$contract/agent';
import { PAUSED_FOR_EXIT_ERROR } from '$contract/agent-state-machine';
import { CHAT_AGENT_EVENT_CHANNEL, JOBS_DEFINITION_CHANGED_CHANNEL } from '$contract/events';
import type { CommandFailure } from '$contract/ipc';
import {
	JOBS_MAX_CONCURRENT_SETTING,
	type JobBuiltin,
	type JobDefinitionRecord,
	type JobRunRecord,
	type JobRunStatus,
	type SaveJobDefinitionArgs,
} from '$contract/jobs';
import type { ShipStateRecord } from '$contract/pull-requests';
import type { WorktreeStatus } from '$contract/repositories';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { addressedReviewThreadIds } from '$lib/pull-requests/domain/pull-request-fix-prompt';
import {
	upsertConnectedRepository,
	upsertProject,
	upsertWorkstream,
} from '$shared/repositories/repositories.platform';
import type { JobsPlatform } from '../jobs.platform';
import { updateFromMainJobContext } from '../domain/update-from-main-context';
import { BUSY_RETRY_MS } from './job-runner.service';
import { insertJobRun } from './job-runs.repository';
import { registerJobs } from './register';
import { skillsForRun } from '$lib/skills/skills.platform';
import { insertSkillPreset } from '$lib/skills/platform/skill-presets.repository';

const NOW = '2026-10-11T00:00:00.000Z';

let db: MaliniDatabase;
let context: MainContext;
let jobs: JobsPlatform;
let settings: Record<string, string>;
let openRuns: Set<string>;
let sessionEvents: Map<string, AgentEventEnvelope[]>;
let definitionEvents: unknown[];
let fakes: ReturnType<typeof createFakes>;
let seq = 0;

function createFakes() {
	let sessions = 0;
	let agentRuns = 0;
	return {
		startSession: vi.fn((_args: unknown): string => `session-${++sessions}`),
		sendPrompt: vi.fn((_args: unknown): string => `agent-run-${++agentRuns}`),
		cancelRun: vi.fn((_args: unknown): undefined => undefined),
		openDraft: vi.fn((_args: unknown): Promise<ShipStateRecord> => Promise.resolve(shipState())),
		queueMerge: vi.fn((_args: unknown): Promise<ShipStateRecord> => Promise.resolve(shipState())),
		createWorkstream: vi.fn((_args: unknown): string => '/tmp/new-workstream'),
		syncBase: vi.fn((_args: unknown) => 'current' as const),
		provision: vi.fn((_args: unknown) => 'succeeded' as const),
		workstreamStatus: vi.fn((_args: unknown): WorktreeStatus => worktree()),
		countBehind: vi.fn((_args: unknown): number | Promise<number> => 0),
		pull: vi.fn((_args: unknown): string => 'abc1234'),
	};
}

function harness(database: MaliniDatabase): MainContext {
	const events = createEventBus({ forwardToWindows: false });
	const commands = new CommandRegistry();
	fakes = createFakes();
	events.subscribe(JOBS_DEFINITION_CHANGED_CHANNEL, (payload) => definitionEvents.push(payload));
	commands.define('app.list-settings', () => settings);
	commands.define('chat.workstream-has-open-run', (args: unknown) =>
		openRuns.has(String(Reflect.get(Object(args), 'workstreamId'))),
	);
	commands.define('chat.start-session', fakes.startSession);
	commands.define('chat.send-prompt', fakes.sendPrompt);
	commands.define('chat.cancel-run', fakes.cancelRun);
	commands.define('chat.list-events', (args: unknown) => [
		...(sessionEvents.get(String(Reflect.get(Object(args), 'sessionId'))) ?? []),
	]);
	commands.define('chat.decide-approval', () => ({
		decision: 'allow',
		scope: 'once',
		remembered: false,
	}));
	commands.define('chat.answer-question', () => undefined);
	commands.define('pull-requests.open-draft', fakes.openDraft);
	commands.define('pull-requests.queue-merge', fakes.queueMerge);
	commands.define('repositories.create-workstream', fakes.createWorkstream);
	commands.define('repositories.sync-workstream-base', fakes.syncBase);
	commands.define('repositories.provision-dependencies', fakes.provision);
	commands.define('repositories.workstream-status', fakes.workstreamStatus);
	commands.define('repositories.count-behind-base', fakes.countBehind);
	commands.define('repositories.pull-workstream', fakes.pull);
	return {
		db: database,
		commands,
		events,
		appDataRoot: '/tmp/jobs-test',
		resourcesRoot: '/tmp/jobs-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
}

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	settings = {};
	openRuns = new Set();
	sessionEvents = new Map();
	definitionEvents = [];
	for (const workstreamId of ['ws-a', 'ws-b', 'ws-c', 'ws-d']) seedWorkstream(workstreamId);
	context = harness(db);
	jobs = registerJobs(context, { log: () => {} });
	jobs.start();
});

afterEach(() => {
	vi.useRealTimers();
	jobs.dispose();
	db.close();
});

function shipState(): ShipStateRecord {
	return {
		workstreamId: 'ws-a',
		phase: 'draft',
		step: null,
		pullRequestNumber: null,
		pullRequestUrl: null,
		needsYou: null,
		queuedAt: null,
		attempts: 0,
		activeJobRunId: null,
		lastError: null,
		nextAttemptAt: null,
		updatedAt: NOW,
	};
}

function worktree(overrides: Partial<WorktreeStatus> = {}): WorktreeStatus {
	return {
		branch: 'malini/ws-a',
		dirtyPaths: [],
		conflictedPaths: [],
		conflictMarkerPaths: [],
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		mergeInProgress: false,
		operationInProgress: null,
		headSha: 'a'.repeat(40),
		...overrides,
	};
}

function conflictedMerge(): WorktreeStatus {
	return worktree({
		dirtyPaths: ['src/shared.ts'],
		conflictedPaths: ['src/shared.ts'],
		conflictMarkerPaths: ['src/shared.ts'],
		mergeInProgress: true,
		operationInProgress: 'merge',
	});
}

function seedWorkstream(workstreamId: string): void {
	upsertProject(db, {
		id: 'project',
		name: 'project',
		repoPath: '/tmp/project',
		defaultBranch: 'main',
		createdAt: NOW,
	});
	upsertWorkstream(db, {
		id: workstreamId,
		projectId: 'project',
		name: workstreamId,
		path: `/tmp/${workstreamId}`,
		branch: `malini/${workstreamId}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
	});
}

function agentEvent(sessionId: string, runId: string, event: Record<string, unknown>): void {
	seq += 1;
	context.events.emit(CHAT_AGENT_EVENT_CHANNEL, {
		sessionId,
		runId,
		seq,
		event: { runId, ...event },
	});
}

async function builtin(key: JobBuiltin): Promise<JobDefinitionRecord> {
	const definitions = await context.commands.call('jobs.list-definitions', undefined);
	const found = definitions.find((definition) => definition.builtin === key);
	if (!found) throw new Error(`missing built-in ${key}`);
	return found;
}

function saveDefinition(
	overrides: Partial<SaveJobDefinitionArgs> = {},
): Promise<JobDefinitionRecord> {
	return context.commands.call('jobs.save-definition', {
		name: 'Write changelog',
		instructions: 'Write the changelog entry.',
		model: 'default',
		effort: 'low',
		runsIn: 'workstream',
		output: 'none',
		...overrides,
	});
}

async function runFixChecks(workstreamId: string): Promise<JobRunRecord> {
	const definition = await builtin('fix-checks');
	return context.commands.call('jobs.run', { definitionId: definition.id, workstreamId });
}

async function jobRun(id: string): Promise<JobRunRecord> {
	const found = (await context.commands.call('jobs.list-runs', undefined)).find(
		(entry) => entry.id === id,
	);
	if (!found) throw new Error(`missing job run ${id}`);
	return found;
}

async function until(id: string, status: JobRunStatus): Promise<JobRunRecord> {
	await vi.waitFor(async () => expect((await jobRun(id)).status).toBe(status));
	return jobRun(id);
}

async function session(id: string): Promise<string> {
	await vi.waitFor(async () =>
		expect(await jobRun(id)).toMatchObject({
			status: 'running',
			sessionId: expect.any(String),
			agentRunId: expect.any(String),
		}),
	);
	const { sessionId } = await jobRun(id);
	if (sessionId === null) throw new Error(`job run ${id} has no session`);
	return sessionId;
}

function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 20));
}

async function failure(command: string, args: unknown): Promise<CommandFailure> {
	const reply = await context.commands.handle({ command, args });
	if (reply.ok) throw new Error(`${command} unexpectedly succeeded`);
	return reply.failure;
}

describe('job definitions', () => {
	it('seeds the four built-in jobs once, with their defaults', async () => {
		const second = registerJobs(harness(db), { log: () => {} });
		second.dispose();

		const definitions = await context.commands.call('jobs.list-definitions', undefined);
		expect(
			definitions.map(({ builtin: key, name, effort, model, runsIn, output }) => ({
				key,
				name,
				effort,
				model,
				runsIn,
				output,
			})),
		).toEqual([
			{
				key: 'name-chats',
				name: 'Name chats',
				effort: 'low',
				model: 'haiku',
				runsIn: 'workstream',
				output: 'none',
			},
			{
				key: 'fix-checks',
				name: 'Fix checks',
				effort: 'high',
				model: 'default',
				runsIn: 'workstream',
				output: 'none',
			},
			{
				key: 'update-from-main',
				name: 'Update from main',
				effort: 'high',
				model: 'default',
				runsIn: 'workstream',
				output: 'none',
			},
			{
				key: 'address-review',
				name: 'Address bot review',
				effort: 'medium',
				model: 'default',
				runsIn: 'workstream',
				output: 'none',
			},
		]);
	});

	it('tells the review job to list resolved threads the way the merge queue reads them', async () => {
		const { instructions } = await builtin('address-review');
		const template = /`(Resolved: <thread id>)`/u.exec(instructions)?.[1];
		if (!template) throw new Error('the address-review job no longer names the resolved format');
		const prompt = `${instructions}\n\nREMOTE_RECORD {"kind":"review_thread","id":"PRRT_kw1"}`;
		const reply = `Renamed the helper as the bot asked.\n${template.replace('<thread id>', 'PRRT_kw1')}`;

		expect(addressedReviewThreadIds(prompt, reply)).toEqual(['PRRT_kw1']);
	});

	it('saves custom jobs, keeps where a built-in runs and what it produces, and resets it', async () => {
		const custom = await saveDefinition({
			name: '  Write changelog  ',
			runsIn: 'new-workstream',
			output: 'draft',
		});
		expect(custom).toMatchObject({
			name: 'Write changelog',
			runsIn: 'new-workstream',
			output: 'draft',
			builtin: null,
		});

		const fixChecks = await builtin('fix-checks');
		const edited = await saveDefinition({
			id: fixChecks.id,
			name: 'Fix CI',
			effort: 'max',
			runsIn: 'new-workstream',
			output: 'merge',
		});
		expect(edited).toMatchObject({
			name: 'Fix CI',
			effort: 'max',
			runsIn: 'workstream',
			output: 'none',
			builtin: 'fix-checks',
		});

		const reset = await context.commands.call('jobs.reset-definition', {
			definitionId: fixChecks.id,
		});
		expect(reset).toMatchObject({
			name: 'Fix checks',
			effort: 'high',
			instructions: fixChecks.instructions,
		});

		expect(await failure('jobs.delete-definition', { definitionId: fixChecks.id })).toMatchObject({
			kind: 'builtin',
		});
		expect(await failure('jobs.reset-definition', { definitionId: custom.id })).toMatchObject({
			kind: 'not-builtin',
		});
		await context.commands.call('jobs.delete-definition', { definitionId: custom.id });
		const remaining = await context.commands.call('jobs.list-definitions', undefined);
		expect(remaining.map((definition) => definition.id)).not.toContain(custom.id);
		expect(definitionEvents).toContainEqual({ definitionId: custom.id, definition: null });
	});

	it('refuses to delete a job that is still queued or running', async () => {
		const custom = await saveDefinition();
		openRuns.add('ws-a');
		await context.commands.call('jobs.run', { definitionId: custom.id, workstreamId: 'ws-a' });

		expect(await failure('jobs.delete-definition', { definitionId: custom.id })).toMatchObject({
			kind: 'busy',
		});
	});

	it('rejects invalid definitions and run requests from the renderer', async () => {
		const valid = {
			name: 'Job',
			instructions: 'Do it.',
			model: 'default',
			effort: 'low',
			runsIn: 'workstream',
			output: 'none',
		};
		const fixChecks = await builtin('fix-checks');
		const nameChats = await builtin('name-chats');
		const fresh = await saveDefinition({ runsIn: 'new-workstream' });
		const cases: ReadonlyArray<readonly [string, unknown, string]> = [
			['jobs.run', { definitionId: nameChats.id, workstreamId: 'ws-a' }, 'builtin'],
			[
				'jobs.run',
				{ definitionId: fixChecks.id, workstreamId: 'ws-a', chatSessionId: '' },
				'invalid-args',
			],
			['jobs.list-chat-runs', {}, 'invalid-args'],
			['jobs.save-definition', { ...valid, name: '   ' }, 'invalid-args'],
			['jobs.save-definition', { ...valid, name: 'x'.repeat(81) }, 'invalid-args'],
			['jobs.save-definition', { ...valid, instructions: '' }, 'invalid-args'],
			['jobs.save-definition', { ...valid, instructions: 'x'.repeat(20_001) }, 'invalid-args'],
			['jobs.save-definition', { ...valid, model: 'Not A Model!' }, 'invalid-args'],
			['jobs.save-definition', { ...valid, effort: 'extreme' }, 'invalid-args'],
			['jobs.save-definition', { ...valid, runsIn: 'nowhere' }, 'invalid-args'],
			['jobs.save-definition', { ...valid, output: 'ship' }, 'invalid-args'],
			['jobs.save-definition', { ...valid, id: 'missing' }, 'not-found'],
			['jobs.run', { definitionId: 'missing', workstreamId: 'ws-a' }, 'not-found'],
			['jobs.run', { definitionId: fixChecks.id }, 'invalid-args'],
			['jobs.run', { definitionId: fixChecks.id, workstreamId: 'ws-gone' }, 'not-found'],
			['jobs.run', { definitionId: fresh.id }, 'invalid-args'],
			['jobs.run', { definitionId: fresh.id, repositoryId: 'repo-gone' }, 'not-found'],
			[
				'jobs.run',
				{ definitionId: fixChecks.id, workstreamId: 'ws-a', context: 'x'.repeat(64 * 1024 + 1) },
				'invalid-args',
			],
			[
				'jobs.run',
				{ definitionId: fixChecks.id, workstreamId: 'ws-a', origin: 'cron' },
				'invalid-args',
			],
			['jobs.cancel-run', { jobRunId: 'missing' }, 'not-found'],
		];

		for (const [command, args, kind] of cases) {
			expect(
				await failure(command, args),
				`${command} ${JSON.stringify(args).slice(0, 80)}`,
			).toMatchObject({ kind });
		}
		expect(await context.commands.call('jobs.list-runs', undefined)).toEqual([]);
	});

	it('keeps the chat a job was run from, for its transcript', async () => {
		const fixChecks = await builtin('fix-checks');
		const fromChat = await context.commands.call('jobs.run', {
			definitionId: fixChecks.id,
			workstreamId: 'ws-a',
			chatSessionId: 'chat-1',
			chatAfterRunId: 'agent-run-9',
		});
		const elsewhere = await context.commands.call('jobs.run', {
			definitionId: fixChecks.id,
			workstreamId: 'ws-b',
		});

		expect(fromChat).toMatchObject({ chatSessionId: 'chat-1', chatAfterRunId: 'agent-run-9' });
		expect(elsewhere).toMatchObject({ chatSessionId: null, chatAfterRunId: null });
		expect(
			(await context.commands.call('jobs.list-chat-runs', { chatSessionId: 'chat-1' })).map(
				({ id }) => id,
			),
		).toEqual([fromChat.id]);
	});
});

describe('scheduling', () => {
	it('runs jobs first in first out, one per workstream, within the global cap', async () => {
		settings[JOBS_MAX_CONCURRENT_SETTING] = '2';
		const first = await runFixChecks('ws-a');
		const second = await runFixChecks('ws-a');
		const third = await runFixChecks('ws-b');
		const fourth = await runFixChecks('ws-c');

		const firstSession = await session(first.id);
		await until(third.id, 'running');
		await settle();
		expect((await jobRun(second.id)).status).toBe('queued');
		expect((await jobRun(fourth.id)).status).toBe('queued');
		const { instructions } = await builtin('fix-checks');
		expect(fakes.startSession).toHaveBeenCalledWith({
			workstreamId: 'ws-a',
			model: 'default',
			origin: 'job',
			displayName: 'Fix checks',
		});
		expect(fakes.sendPrompt).toHaveBeenCalledWith({
			sessionId: firstSession,
			prompt: instructions,
			profile: { effort: 'high', mode: 'agent', access: 'auto' },
			automated: true,
		});

		agentEvent(firstSession, 'agent-run-1', { type: 'run.completed', summary: 'Fixed the lint.' });

		expect(await until(first.id, 'succeeded')).toMatchObject({ detail: 'Fixed the lint.' });
		await until(second.id, 'running');
		await settle();
		expect((await jobRun(fourth.id)).status).toBe('queued');
	});

	it('appends the run context to the instructions', async () => {
		const definition = await builtin('fix-checks');
		const queued = await context.commands.call('jobs.run', {
			definitionId: definition.id,
			workstreamId: 'ws-a',
			context: 'Failing: lint',
			origin: 'merge-queue',
		});
		expect(queued).toMatchObject({ origin: 'merge-queue', title: 'Fix checks' });

		await session(queued.id);
		expect(fakes.sendPrompt.mock.calls[0]?.[0]).toMatchObject({
			prompt: `${definition.instructions}\n\nFailing: lint`,
		});
	});

	it('runs a job with its skill preset, and with the workstream skills when it has none', async () => {
		const presetDefinition = await saveDefinition({ name: 'Copy pass', skillPresetId: 'marketer' });
		const plainDefinition = await saveDefinition({ name: 'Plain pass' });
		insertSkillPreset(db, {
			id: 'marketer',
			name: 'Marketer',
			skills: ['humanizer'],
			isDefault: false,
			createdAt: NOW,
			updatedAt: NOW,
		});
		expect(presetDefinition.skillPresetId).toBe('marketer');
		expect(plainDefinition.skillPresetId).toBeNull();

		const withPreset = await context.commands.call('jobs.run', {
			definitionId: presetDefinition.id,
			workstreamId: 'ws-a',
		});
		const withPresetSession = await session(withPreset.id);
		await until(withPreset.id, 'running');
		const plain = await context.commands.call('jobs.run', {
			definitionId: plainDefinition.id,
			workstreamId: 'ws-b',
		});
		const plainSession = await session(plain.id);

		expect(skillsForRun(db, 'ws-a', withPresetSession)).toEqual(['humanizer']);
		expect(skillsForRun(db, 'ws-b', plainSession)).toBeNull();
	});

	it("waits for the user's own run in that workstream to end", async () => {
		openRuns.add('ws-a');
		const queued = await runFixChecks('ws-a');
		await settle();
		expect((await jobRun(queued.id)).status).toBe('queued');

		openRuns.delete('ws-a');
		agentEvent('user-session', 'user-run', { type: 'run.completed', summary: 'Done.' });

		await until(queued.id, 'running');
	});

	it('counts a job waiting for you toward its workstream only', async () => {
		settings[JOBS_MAX_CONCURRENT_SETTING] = '1';
		const waiting = await runFixChecks('ws-a');
		const waitingSession = await session(waiting.id);
		const sameWorkstream = await runFixChecks('ws-a');
		const otherWorkstream = await runFixChecks('ws-b');
		await settle();
		expect((await jobRun(otherWorkstream.id)).status).toBe('queued');

		agentEvent(waitingSession, 'agent-run-1', {
			type: 'approval.requested',
			sessionId: waitingSession,
			approvalId: 'approval-1',
			reason: 'Run pnpm test?',
		});

		await until(waiting.id, 'needs-you');
		await until(otherWorkstream.id, 'running');
		expect((await jobRun(sameWorkstream.id)).status).toBe('queued');

		await context.commands.handle({
			command: 'chat.decide-approval',
			args: {
				sessionId: waitingSession,
				runId: 'agent-run-1',
				approvalId: 'approval-1',
				decision: 'allow',
				scope: 'once',
			},
		});
		await until(waiting.id, 'running');
	});

	it('retries a job while the workstream is still wrapping up its last run', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		fakes.sendPrompt.mockImplementationOnce(() => {
			throw new Error('`ws-a` already has an active run');
		});
		const queued = await runFixChecks('ws-a');
		await vi.waitFor(() => expect(fakes.sendPrompt).toHaveBeenCalledTimes(1));
		const requeued = await until(queued.id, 'queued');
		expect(requeued.sessionId).toBe('session-1');

		agentEvent('user-session', 'user-run', { type: 'run.completed', summary: '' });
		await settle();
		expect(fakes.sendPrompt).toHaveBeenCalledTimes(1);

		vi.setSystemTime(Date.now() + BUSY_RETRY_MS + 1);
		agentEvent('user-session', 'user-run', { type: 'run.completed', summary: '' });

		await session(queued.id);
		expect(fakes.startSession).toHaveBeenCalledTimes(1);
		expect(fakes.sendPrompt).toHaveBeenCalledTimes(2);
	});

	it('fails the job with a readable reason when it cannot start', async () => {
		fakes.startSession.mockImplementationOnce(() => {
			throw new Error('bridge unavailable: the agent bridge exited');
		});
		const queued = await runFixChecks('ws-a');

		expect(await until(queued.id, 'failed')).toMatchObject({
			detail: 'Could not start the job: bridge unavailable: the agent bridge exited',
		});
	});

	it('creates a fresh workstream for a job that runs in a new one', async () => {
		upsertProject(db, {
			id: 'local__acme__app',
			name: 'acme__app',
			repoPath: '/tmp/acme-app',
			defaultBranch: 'main',
			createdAt: NOW,
		});
		upsertConnectedRepository(db, {
			id: 'repo-1',
			fullName: 'acme/app',
			defaultBranch: 'trunk',
			localPath: null,
			remoteUrl: 'https://github.com/acme/app.git',
			createdAt: NOW,
		});
		const definition = await saveDefinition({ runsIn: 'new-workstream' });
		const queued = await context.commands.call('jobs.run', {
			definitionId: definition.id,
			repositoryId: 'repo-1',
		});

		await session(queued.id);
		const created = fakes.createWorkstream.mock.calls[0]?.[0];
		expect(created).toMatchObject({
			projectRepoPath: '/tmp/acme-app',
			projectId: 'local__acme__app',
			baseBranch: 'trunk',
		});
		const workstreamId = Reflect.get(Object(created), 'workstreamId');
		expect((await jobRun(queued.id)).workstreamId).toBe(workstreamId);
		expect(fakes.syncBase).toHaveBeenCalledWith({ workstreamId });
		expect(fakes.provision).toHaveBeenCalledWith({ workstreamId });
		expect(fakes.startSession).toHaveBeenCalledWith(
			expect.objectContaining({ workstreamId, displayName: 'Write changelog' }),
		);
	});

	it('starts a new-workstream job from a routine step in the repository of that step', async () => {
		upsertProject(db, {
			id: 'local__acme__app',
			name: 'acme__app',
			repoPath: '/tmp/acme-app',
			defaultBranch: 'main',
			createdAt: NOW,
		});
		upsertConnectedRepository(db, {
			id: 'repo-1',
			fullName: 'acme/app',
			defaultBranch: 'main',
			localPath: null,
			remoteUrl: 'https://github.com/acme/app.git',
			createdAt: NOW,
		});
		upsertWorkstream(db, {
			id: 'ws-acme',
			projectId: 'local__acme__app',
			name: 'ws-acme',
			path: '/tmp/ws-acme',
			branch: 'malini/ws-acme',
			baseBranch: 'main',
			status: 'active',
			createdAt: NOW,
		});
		const definition = await saveDefinition({ runsIn: 'new-workstream' });
		const queued = await context.commands.call('jobs.run', {
			definitionId: definition.id,
			workstreamId: 'ws-acme',
			origin: 'routine',
		});

		expect(queued).toMatchObject({ workstreamId: null, repositoryId: 'local__acme__app' });
		await session(queued.id);
		expect(fakes.createWorkstream.mock.calls[0]?.[0]).toMatchObject({
			projectRepoPath: '/tmp/acme-app',
			projectId: 'local__acme__app',
		});
	});
});

describe('update from main', () => {
	async function runUpdate(jobContext?: string): Promise<JobRunRecord> {
		const definition = await builtin('update-from-main');
		return context.commands.call('jobs.run', {
			definitionId: definition.id,
			workstreamId: 'ws-a',
			...(jobContext === undefined ? {} : { context: jobContext }),
		});
	}

	const conflictContext = updateFromMainJobContext({
		branch: 'malini/ws-a',
		baseBranch: 'main',
		conflictedPaths: ['src/shared.ts'],
		conflictMarkerPaths: ['src/shared.ts'],
	});

	it('merges a clean base branch itself and finishes without an agent', async () => {
		fakes.countBehind.mockReturnValueOnce(3);
		const queued = await runUpdate();

		expect(await until(queued.id, 'succeeded')).toMatchObject({
			detail: 'Merged 3 commits from main',
		});
		expect(fakes.countBehind).toHaveBeenCalledWith({ workstreamId: 'ws-a', baseBranch: 'main' });
		expect(fakes.pull).toHaveBeenCalledWith({ workstreamId: 'ws-a', baseBranch: 'main' });
		expect(fakes.startSession).not.toHaveBeenCalled();
	});

	it('finishes at once when the workstream already has every base commit', async () => {
		const queued = await runUpdate();

		expect(await until(queued.id, 'succeeded')).toMatchObject({
			detail: 'Already up to date with main',
		});
		expect(fakes.pull).not.toHaveBeenCalled();
		expect(fakes.startSession).not.toHaveBeenCalled();
	});

	it('starts the agent on the conflicts a merge left, after the context the run carries', async () => {
		fakes.countBehind.mockReturnValueOnce(1);
		fakes.workstreamStatus.mockReturnValueOnce(worktree()).mockReturnValueOnce(conflictedMerge());
		const queued = await runUpdate('Pull request: #7');

		await session(queued.id);
		const { instructions } = await builtin('update-from-main');
		expect(fakes.pull).toHaveBeenCalledTimes(1);
		expect(fakes.sendPrompt.mock.calls[0]?.[0]).toMatchObject({
			prompt: `${instructions}\n\nPull request: #7\n\n${conflictContext}`,
		});
	});

	it('hands a merge already stopped on conflicts straight to the agent', async () => {
		fakes.workstreamStatus.mockReturnValueOnce(conflictedMerge());
		const queued = await runUpdate();

		await session(queued.id);
		const { instructions } = await builtin('update-from-main');
		expect(fakes.countBehind).not.toHaveBeenCalled();
		expect(fakes.pull).not.toHaveBeenCalled();
		expect(fakes.sendPrompt.mock.calls[0]?.[0]).toMatchObject({
			prompt: `${instructions}\n\n${conflictContext}`,
		});
	});

	it.each([
		[
			'uncommitted changes',
			worktree({ dirtyPaths: ['notes.md'] }),
			'Commit or discard the uncommitted changes, then update from main again.',
		],
		[
			'a stopped rebase',
			worktree({ mergeInProgress: true, operationInProgress: 'rebase' }),
			'A rebase is in progress in this workstream. Finish or abort it first.',
		],
	])('refuses to merge over %s', async (_label, status, detail) => {
		fakes.workstreamStatus.mockReturnValueOnce(status);
		const queued = await runUpdate();

		expect(await until(queued.id, 'failed')).toMatchObject({ detail });
		expect(fakes.countBehind).not.toHaveBeenCalled();
		expect(fakes.pull).not.toHaveBeenCalled();
		expect(fakes.startSession).not.toHaveBeenCalled();
	});

	it('neither merges nor starts the agent once cancelled mid-update', async () => {
		let behind: (count: number) => void = () => {};
		fakes.countBehind.mockImplementationOnce(
			() => new Promise<number>((resolve) => (behind = resolve)),
		);
		const queued = await runUpdate();
		await vi.waitFor(() => expect(fakes.countBehind).toHaveBeenCalled());

		await context.commands.call('jobs.cancel-run', { jobRunId: queued.id });
		behind(2);
		await settle();

		expect((await jobRun(queued.id)).status).toBe('cancelled');
		expect(fakes.pull).not.toHaveBeenCalled();
		expect(fakes.startSession).not.toHaveBeenCalled();
	});
});

describe('tracking', () => {
	it('follows the agent run through a question to failure', async () => {
		const queued = await runFixChecks('ws-a');
		const sessionId = await session(queued.id);

		agentEvent(sessionId, 'agent-run-1', {
			type: 'question.requested',
			sessionId,
			questionId: 'question-1',
			questions: [],
		});
		await until(queued.id, 'needs-you');

		await context.commands.handle({
			command: 'chat.answer-question',
			args: { sessionId, runId: 'agent-run-1', questionId: 'question-1', answers: [] },
		});
		await until(queued.id, 'running');

		agentEvent(sessionId, 'agent-run-1', { type: 'run.failed', error: PAUSED_FOR_EXIT_ERROR });
		await settle();
		expect((await jobRun(queued.id)).status).toBe('running');

		agentEvent(sessionId, 'agent-run-1', { type: 'run.failed', error: 'tests still fail' });
		expect(await until(queued.id, 'failed')).toMatchObject({ detail: 'tests still fail' });
	});

	it('marks the job cancelled when its agent run is cancelled', async () => {
		const queued = await runFixChecks('ws-a');
		const sessionId = await session(queued.id);

		agentEvent(sessionId, 'agent-run-1', { type: 'run.failed', error: 'cancelled' });

		await until(queued.id, 'cancelled');
	});

	it('opens a draft or queues the merge after a job succeeds, and records what went wrong', async () => {
		const drafting = await saveDefinition({ name: 'Draft it', output: 'draft' });
		const merging = await saveDefinition({ name: 'Merge it', output: 'merge' });
		fakes.queueMerge.mockRejectedValueOnce(new Error('GitHub said no'));
		const draft = await context.commands.call('jobs.run', {
			definitionId: drafting.id,
			workstreamId: 'ws-a',
		});
		const merge = await context.commands.call('jobs.run', {
			definitionId: merging.id,
			workstreamId: 'ws-b',
		});

		agentEvent(await session(draft.id), 'agent-run-1', { type: 'run.completed', summary: 'A.' });
		agentEvent(await session(merge.id), 'agent-run-2', { type: 'run.completed', summary: 'B.' });

		await vi.waitFor(() => expect(fakes.openDraft).toHaveBeenCalledWith({ workstreamId: 'ws-a' }));
		await vi.waitFor(() => expect(fakes.queueMerge).toHaveBeenCalledWith({ workstreamId: 'ws-b' }));
		await vi.waitFor(async () =>
			expect((await jobRun(merge.id)).detail).toBe(
				'B.\n\nCould not queue the merge: GitHub said no',
			),
		);
		expect(await jobRun(draft.id)).toMatchObject({ status: 'succeeded', detail: 'A.' });
	});

	it('cancels queued jobs without starting them and stops running ones', async () => {
		settings[JOBS_MAX_CONCURRENT_SETTING] = '1';
		const running = await runFixChecks('ws-a');
		const sessionId = await session(running.id);
		const queued = await runFixChecks('ws-b');

		expect(await context.commands.call('jobs.cancel-run', { jobRunId: queued.id })).toMatchObject({
			status: 'cancelled',
		});
		expect(await context.commands.call('jobs.cancel-run', { jobRunId: running.id })).toMatchObject({
			status: 'cancelled',
		});
		expect(fakes.cancelRun).toHaveBeenCalledWith({ sessionId, pendingRunId: 'agent-run-1' });

		agentEvent(sessionId, 'agent-run-1', { type: 'run.failed', error: 'cancelled' });
		await settle();
		expect(fakes.startSession).toHaveBeenCalledTimes(1);
		expect((await jobRun(running.id)).status).toBe('cancelled');
	});
});

describe('restart', () => {
	it('keeps tracking runs malini resumed and fails the ones it could not', async () => {
		jobs.dispose();
		const definition = await builtin('fix-checks');
		const left = (
			id: string,
			workstreamId: string,
			sessionId: string | null,
			status: JobRunStatus,
		): JobRunRecord => {
			const record: JobRunRecord = {
				id,
				definitionId: definition.id,
				title: definition.name,
				workstreamId,
				repositoryId: null,
				sessionId,
				agentRunId: sessionId === null ? null : `${id}-first-run`,
				origin: 'merge-queue',
				status,
				detail: null,
				chatSessionId: null,
				chatAfterRunId: null,
				createdAt: `2026-10-10T00:00:0${id.length}.000Z`,
				startedAt: status === 'queued' ? null : NOW,
				finishedAt: null,
			};
			insertJobRun(db, record, null);
			return record;
		};
		left('resumed', 'ws-a', 's-resumed', 'running');
		left('lost', 'ws-b', 's-lost', 'running');
		left('finished', 'ws-c', 's-finished', 'needs-you');
		left('never', 'ws-d', null, 'running');
		left('waiting-for-b', 'ws-b', null, 'queued');
		const envelope = (sessionId: string, runId: string, event: Record<string, unknown>) => {
			seq += 1;
			return { sessionId, runId, seq, event: { runId, ...event } };
		};
		sessionEvents.set('s-resumed', [
			envelope('s-resumed', 'r1', { type: 'run.started' }),
			envelope('s-resumed', 'r1', { type: 'run.failed', error: PAUSED_FOR_EXIT_ERROR }),
			envelope('s-resumed', 'r2', { type: 'user.message', text: 'Continue where you left off.' }),
		]);
		sessionEvents.set('s-lost', [
			envelope('s-lost', 'r3', { type: 'run.started' }),
			envelope('s-lost', 'r3', { type: 'run.failed', error: PAUSED_FOR_EXIT_ERROR }),
		]);
		sessionEvents.set('s-finished', [
			envelope('s-finished', 'r4', { type: 'run.started' }),
			envelope('s-finished', 'r4', { type: 'run.completed', summary: 'All green.' }),
		]);

		context = harness(db);
		jobs = registerJobs(context, { log: () => {} });
		jobs.start();

		expect(await until('lost', 'failed')).toMatchObject({
			detail: 'Interrupted when malini closed',
		});
		expect(await until('never', 'failed')).toMatchObject({
			detail: 'Interrupted when malini closed',
		});
		expect(await until('finished', 'succeeded')).toMatchObject({ detail: 'All green.' });
		await until('waiting-for-b', 'running');
		expect(await jobRun('resumed')).toMatchObject({ status: 'running', agentRunId: 'r2' });

		agentEvent('s-resumed', 'r2', { type: 'run.started', sessionId: 's-resumed' });
		agentEvent('s-resumed', 'r2', { type: 'run.completed', summary: 'Picked up where it left.' });
		await until('resumed', 'succeeded');
	});
});
