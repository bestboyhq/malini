import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	APP_STARTED_CHANNEL,
	CHAT_TURN_FINISHED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
	PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
	type ChatTurnFinishedPayload,
} from '$contract/events';
import type { JobRunRecord, ReconcilerDecisionRecord } from '$contract/jobs';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { insertRun } from '$lib/chat/platform/runs.repository';
import { insertSession } from '$lib/chat/platform/sessions.repository';
import { upsertProject, upsertWorkstream } from '$shared/repositories/repositories.platform';
import type { JobsPlatform } from '../jobs.platform';
import { getBuiltinJobDefinition } from './job-definitions.repository';
import { insertJobRun } from './job-runs.repository';
import { registerJobs, type JobsOptions } from './register';

const NOW = '2026-10-26T09:00:00.000Z';

let db: MaliniDatabase;
let context: MainContext;
let jobs: JobsPlatform;
let picks: number[];
let asked: string[];
let sent: Array<Readonly<Record<string, unknown>>>;
let busyWakes: number;
let notified: unknown[];

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	picks = [];
	asked = [];
	sent = [];
	busyWakes = 0;
	notified = [];
	seed();
	boot();
});

afterEach(() => {
	jobs.dispose();
	db.close();
});

function boot(rules: Pick<JobsOptions, 'shipping' | 'resume'> = {}): void {
	context = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/reconciler-test',
		resourcesRoot: '/tmp/reconciler-test',
		isDev: true,
		appVersion: '0.0.0-test',
	};
	context.commands.define('app.list-settings', () => ({}));
	context.commands.define('app.notification-permission-granted', () => true);
	context.commands.define('app.notify', (args: unknown) => {
		notified.push(args);
	});
	context.commands.define('chat.workstream-has-working-run', () => true);
	context.commands.define('chat.send-prompt', (args: unknown) => {
		if (busyWakes > 0) {
			busyWakes -= 1;
			throw new Error('Workstream `lead` already has an active run');
		}
		sent.push(Object(args));
		return `wake-${sent.length}`;
	});
	jobs = registerJobs(context, {
		log: () => {},
		choose: async (task) => {
			asked.push(task);
			const pick = picks.shift();
			if (pick === undefined) throw new Error('Claude Code is not installed');
			return pick;
		},
		...rules,
	});
	jobs.start();
}

function seed(): void {
	upsertProject(db, {
		id: 'project',
		name: 'project',
		repoPath: '/tmp/project',
		defaultBranch: 'main',
		createdAt: NOW,
	});
	const workstream = (id: string, startedBy: string | null) =>
		upsertWorkstream(db, {
			id,
			projectId: 'project',
			name: id === 'lead' ? 'Home' : id === 'api' ? 'Api analytics' : 'Site analytics',
			path: `/tmp/${id}`,
			branch: `malini/${id}`,
			baseBranch: 'main',
			status: 'active',
			createdAt: NOW,
			scope: id === 'lead' ? 'home' : null,
			startedBy,
		});
	workstream('lead', null);
	workstream('api', 'lead');
	workstream('site', 'lead');
	chat('lead-chat', 'lead', 'Move apps to Logdash');
	chat('api-chat', 'api', 'Api analytics');
	chat('site-chat', 'site', 'Site analytics');
	turn('lead-turn', 'lead-chat', null, NOW);
}

function chat(id: string, workstreamId: string, displayName: string): void {
	insertSession(
		db,
		{ id, workstreamId, model: null, providerSessionId: null, status: 'idle', startedAt: NOW },
		{ origin: 'user', displayName },
	);
}

function turn(
	id: string,
	sessionId: string,
	chainId: string | null,
	completedAt: string | null,
): void {
	insertRun(db, {
		id,
		sessionId,
		prompt: 'Work on it',
		startedAt: NOW,
		completedAt,
		summary: null,
		error: null,
		...(chainId === null ? {} : { chainId }),
	});
}

function finish(
	sessionId: string,
	runId: string,
	report: Partial<ChatTurnFinishedPayload> = {},
): void {
	const workstreamId = sessionId.replace(/-chat$/u, '');
	context.events.emit(CHAT_TURN_FINISHED_CHANNEL, {
		workstreamId,
		sessionId,
		runId,
		status: 'succeeded',
		outcome: 'Added the analytics endpoint',
		needs: null,
		...report,
	});
}

function childTurn(id: string, sessionId = 'api-chat'): string {
	turn(id, sessionId, 'lead-turn', NOW);
	return id;
}

function ownTurn(id: string): string {
	turn(id, 'api-chat', null, NOW);
	return id;
}

function decisions(): Promise<ReconcilerDecisionRecord[]> {
	return context.commands.call('jobs.list-decisions', undefined);
}

async function decided(count: number): Promise<ReconcilerDecisionRecord[]> {
	await vi.waitFor(async () => expect(await decisions()).toHaveLength(count));
	const listed = await decisions();
	await vi.waitFor(async () =>
		expect((await decisions()).every((decision) => decision.status !== 'pending')).toBe(true),
	);
	return listed;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

describe('the event reconciler', () => {
	it('wakes the chat that started the work with the report of its finished turn', async () => {
		picks.push(2);
		finish('api-chat', childTurn('api-turn'));

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(asked[0]).toContain('Event: the chat “Api analytics” finished a turn.');
		expect(asked[0]).toContain(
			'The lead chat “Move apps to Logdash” started it and set this turn going.',
		);
		expect(asked[0]).toContain('Candidates:\n1. Do nothing\n2. Wake “Move apps to Logdash”');
		expect(sent[0]).toMatchObject({
			sessionId: 'lead-chat',
			automated: true,
			chainId: 'lead-turn',
			from: 'api',
			causeEventId: expect.any(Number),
			prompt: expect.stringContaining('Outcome: Added the analytics endpoint'),
		});
		const [decision] = await decided(1);
		expect(decision).toMatchObject({
			channel: CHAT_TURN_FINISHED_CHANNEL,
			chainId: 'lead-turn',
			workstreamId: 'api',
			pick: 1,
			chosen: 1,
			decidedBy: 'model',
			status: 'done',
		});
	});

	it('holds a wake while that chat works, then sends every report waiting for it as one prompt', async () => {
		turn('lead-working', 'lead-chat', null, null);
		picks.push(2, 2);
		finish('api-chat', childTurn('api-turn'));
		await vi.waitFor(async () => expect(await decisions()).toHaveLength(1));
		finish('site-chat', childTurn('site-turn', 'site-chat'), { outcome: 'Added the site beacon' });
		await vi.waitFor(async () => expect(await decisions()).toHaveLength(2));
		await settle();
		expect(sent).toEqual([]);
		expect((await decisions()).map((decision) => decision.status)).toEqual(['pending', 'pending']);

		run(db, 'UPDATE agent_runs SET completed_at = ? WHERE id = ?', NOW, 'lead-working');
		finish('lead-chat', 'lead-working');

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]?.['prompt']).toEqual(expect.stringContaining('Added the analytics endpoint'));
		expect(sent[0]?.['prompt']).toEqual(expect.stringContaining('Added the site beacon'));
		expect((await decided(2)).map((decision) => decision.status)).toEqual(['done', 'done']);
	});

	it('asks you when the model picks it, and carries out what you pick once', async () => {
		picks.push(3);
		finish('api-chat', ownTurn('api-turn'), { needs: 'Which Logdash project?' });
		const [asking] = await decided(1);
		expect(asked[0]).toContain(
			'The lead chat “Move apps to Logdash” started it, but not this turn.',
		);
		expect(asking).toMatchObject({ status: 'asking', finishedAt: null });
		expect(asking?.candidates[2]).toEqual({
			kind: 'ask-you',
			label: 'Ask you',
			reason: '“Api analytics” needs you: Which Logdash project?',
		});
		expect(notified).toEqual([
			{
				options: {
					title: 'Malini asks you',
					body: '“Api analytics” needs you: Which Logdash project?',
					opens: { workstreamId: 'lead', sessionId: 'lead-chat' },
				},
			},
		]);

		const done = await context.commands.call('jobs.decide', {
			decisionId: asking?.id ?? '',
			candidate: 1,
		});

		expect(done).toMatchObject({ status: 'done', decidedBy: 'you', chosen: 1 });
		expect(sent).toHaveLength(1);
		await expect(
			context.commands.call('jobs.decide', { decisionId: asking?.id ?? '', candidate: 0 }),
		).rejects.toThrow('This was already decided.');
	});

	it('keeps a wake while that chat is still wrapping up its turn, and sends it once it can', async () => {
		busyWakes = 1;
		picks.push(2);
		finish('api-chat', childTurn('api-turn'));

		await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 8_000 });
		expect(busyWakes).toBe(0);
		expect((await decided(1)).map((decision) => decision.status)).toEqual(['done']);
	});

	it('settles a decision Malini quit in the middle of when it starts again', async () => {
		picks.push(3);
		finish('api-chat', ownTurn('api-turn'), { needs: 'Which Logdash project?' });
		const [asking] = await decided(1);
		run(
			db,
			"UPDATE reconciler_decisions SET status = 'pending', chosen = 0, decided_by = 'you' WHERE id = ?",
			asking?.id ?? '',
		);
		jobs.dispose();

		boot();

		expect(await decisions()).toEqual([
			expect.objectContaining({
				id: asking?.id,
				status: 'failed',
				detail: 'Interrupted when Malini closed',
			}),
		]);
	});

	it('asks you before waking a chat a fourth time about the same work in one chain', async () => {
		for (const index of [1, 2, 3, 4]) {
			picks.push(2);
			finish('api-chat', childTurn(`api-turn-${index}`));
			await vi.waitFor(async () => expect(await decisions()).toHaveLength(index));
		}
		const listed = await decided(4);

		expect(sent).toHaveLength(3);
		expect(listed[0]).toMatchObject({ status: 'asking', decidedBy: 'rules', pick: 1 });
		expect(listed[0]?.detail).toContain('Malini already woke this chat 3 times about this work');
		expect(asked.at(-1)).toContain('about this work 3 of 3 times in this chain of events');
	});

	it('wakes a chat about each piece of work it started, however many it started in one chain', async () => {
		picks.push(2, 2);
		finish('api-chat', childTurn('api-turn'));
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		finish('site-chat', childTurn('site-turn', 'site-chat'));

		await vi.waitFor(() => expect(sent).toHaveLength(2));
		expect(sent.map((prompt) => prompt['from'])).toEqual(['api', 'site']);
	});

	it('wakes the chat that started the work by its own rules when it cannot ask the model', async () => {
		finish('api-chat', childTurn('api-turn'));

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		const [decision] = await decided(1);
		expect(decision).toMatchObject({ status: 'done', pick: null, chosen: 1, decidedBy: 'rules' });
		expect(decision?.detail).toBe('Malini could not ask the model: Claude Code is not installed');
		expect(sent[0]).toMatchObject({
			sessionId: 'lead-chat',
			prompt: expect.stringContaining('Outcome: Added the analytics endpoint'),
		});
	});

	it('wakes the chat that set a turn going with what the turn needs or its failure, without the model, until the wakes run out', async () => {
		finish('api-chat', childTurn('api-turn-1'), { needs: 'Which Logdash project?' });
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toMatchObject({
			sessionId: 'lead-chat',
			chainId: 'lead-turn',
			from: 'api',
			prompt: expect.stringContaining('Needs: Which Logdash project?'),
		});
		const [needed] = await decided(1);
		expect(needed).toMatchObject({ status: 'done', pick: null, chosen: 1, decidedBy: 'rules' });
		expect(needed?.detail).toBe(
			'“Move apps to Logdash” set this turn going, so it hears what the turn needs before you do.',
		);

		finish('api-chat', childTurn('api-turn-2'), { status: 'failed', outcome: null });
		await vi.waitFor(() => expect(sent).toHaveLength(2));
		expect(sent[1]?.['prompt']).toEqual(expect.stringContaining('failed its turn'));
		finish('api-chat', childTurn('api-turn-3'), { needs: 'Which Logdash project?' });
		await vi.waitFor(() => expect(sent).toHaveLength(3));
		finish('api-chat', childTurn('api-turn-4'), { needs: 'Which Logdash project?' });
		const [fourth] = await decided(4);

		expect(asked).toEqual([]);
		expect(sent).toHaveLength(3);
		expect(fourth).toMatchObject({ status: 'asking', decidedBy: 'rules', pick: null });
		expect(fourth?.detail).toContain('Malini already woke this chat 3 times about this work');
	});

	it('hands each event only to the rules that hear it', async () => {
		const heard: string[] = [];
		jobs.dispose();
		boot({
			resume: async ({ channel }) => {
				heard.push(`resume ${channel}`);
			},
			shipping: async ({ channel }) => {
				heard.push(`shipping ${channel}`);
			},
		});

		context.events.emit(APP_STARTED_CHANNEL, { version: '0.0.0-test' });
		context.events.emit(PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL, { workstreamId: 'api' });
		finish('lead-chat', 'lead-turn');

		await vi.waitFor(() => expect(heard).toHaveLength(4));
		await settle();
		expect([...heard].sort()).toEqual([
			'resume app:started',
			'shipping app:started',
			'shipping chat:turn-finished',
			'shipping pull-requests:workstream-opened',
		]);
	});

	it('stays out of events a trigger handles', async () => {
		await context.commands.call('jobs.save-definition', {
			name: 'Review the site',
			instructions: 'Review it.',
			model: 'opus',
			effort: 'low',
			runsIn: 'workstream',
			trigger: { when: 'on chat:turn-finished where workstreamId is site', mode: 'ask' },
		});
		picks.push(2);
		finish('site-chat', childTurn('site-turn', 'site-chat'));
		await settle();

		expect(asked).toEqual([]);
		expect(await decisions()).toEqual([]);
	});

	it('offers to run a failed job again, in the chain of the run that failed, and waits for you', async () => {
		const job = await context.commands.call('jobs.save-definition', {
			name: 'Publish docs',
			instructions: 'Publish the docs.',
			model: 'opus',
			effort: 'low',
			runsIn: 'workstream',
		});
		const failed: JobRunRecord = {
			id: 'publish-1',
			definitionId: job.id,
			title: 'Publish docs',
			workstreamId: 'api',
			repositoryId: null,
			scope: null,
			sessionId: null,
			agentRunId: null,
			origin: 'manual',
			status: 'failed',
			detail: 'The docs host timed out',
			parentRunId: null,
			chatSessionId: 'lead-chat',
			chatAfterRunId: 'lead-turn',
			chainId: 'lead-turn',
			requests: 1,
			createdAt: NOW,
			startedAt: NOW,
			finishedAt: NOW,
		};
		insertJobRun(db, failed, 'Version 2.1');
		picks.push(3);
		context.events.emit(JOBS_RUN_FINISHED_CHANNEL, { run: failed });

		const [decision] = await decided(1);
		expect(decision?.candidates.map((candidate) => candidate.label)).toEqual([
			'Do nothing',
			'Tell “Move apps to Logdash” that Publish docs failed',
			'Run Publish docs again',
			'Ask you',
		]);
		const runs = await context.commands.call('jobs.list-runs', undefined);
		const again = runs.find((candidate) => candidate.id === decision?.jobRunId);
		expect(again).toMatchObject({
			definitionId: job.id,
			workstreamId: 'api',
			origin: 'reconciler',
			status: 'waiting',
			chainId: 'lead-turn',
		});
	});

	it('tells the chat that a Merge Shipping ran for it failed, and leaves Shipping its own fixes', async () => {
		const merge = getBuiltinJobDefinition(db, 'merge');
		const fixChecks = getBuiltinJobDefinition(db, 'fix-checks');
		if (!merge || !fixChecks) throw new Error('the built-in jobs are missing');
		const shipped = (id: string, definitionId: string, chatSessionId: string | null) => {
			const run: JobRunRecord = {
				id,
				definitionId,
				title: id,
				workstreamId: 'api',
				repositoryId: null,
				scope: null,
				sessionId: null,
				agentRunId: null,
				origin: 'merge-queue',
				status: 'failed',
				detail: 'This workstream has no changes to ship yet.',
				parentRunId: null,
				chatSessionId,
				chatAfterRunId: null,
				chainId: 'lead-turn',
				requests: 1,
				createdAt: NOW,
				startedAt: NOW,
				finishedAt: NOW,
			};
			insertJobRun(db, run, null);
			return run;
		};
		picks.push(1);
		context.events.emit(JOBS_RUN_FINISHED_CHANNEL, {
			run: shipped('Fix checks', fixChecks.id, null),
		});
		context.events.emit(JOBS_RUN_FINISHED_CHANNEL, {
			run: shipped('Merge', merge.id, 'lead-chat'),
		});

		const [decision] = await decided(1);
		expect(decision?.candidates.map((candidate) => candidate.label)).toEqual([
			'Do nothing',
			'Tell “Move apps to Logdash” that Merge failed',
			'Ask you',
		]);
		expect(decision?.facts).toContain('It ran 1 time in this chain of events.');
		await settle();
		expect(await decisions()).toHaveLength(1);
	});

	it('offers Resolve conflicts for a merge nobody in Malini was resolving', async () => {
		picks.push(2);
		context.events.emit(REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL, {
			workstreamId: 'api',
			baseBranch: 'main',
			conflictedPaths: ['src/shared.ts'],
		});

		const [decision] = await decided(1);
		expect(decision?.candidates.map((candidate) => candidate.label)).toEqual([
			'Do nothing',
			'Run Resolve conflicts',
			'Tell “Api analytics” about the conflicts',
			'Ask you',
		]);
		const runs = await context.commands.call('jobs.list-runs', undefined);
		expect(runs.find((candidate) => candidate.id === decision?.jobRunId)).toMatchObject({
			title: 'Resolve conflicts',
			origin: 'reconciler',
			status: 'queued',
		});
	});

	it('lays out the events, turns, decisions and workstreams of a time window for the timeline', async () => {
		picks.push(2);
		finish('api-chat', childTurn('api-turn'));
		await decided(1);

		const timeline = await context.commands.call('jobs.list-timeline', {
			since: '2026-01-01T00:00:00.000Z',
		});

		expect(timeline.events).toContainEqual(
			expect.objectContaining({
				channel: CHAT_TURN_FINISHED_CHANNEL,
				workstreamId: 'api',
				cause: { kind: 'chat-turn', id: 'api-turn' },
				chainId: 'lead-turn',
			}),
		);
		expect(timeline.decisions).toHaveLength(1);
		expect(timeline.turns.map((entry) => [entry.runId, entry.chainId])).toEqual(
			expect.arrayContaining([
				['lead-turn', 'lead-turn'],
				['api-turn', 'lead-turn'],
			]),
		);
		expect(timeline.workstreams).toEqual(
			expect.arrayContaining([
				{ id: 'api', name: 'Api analytics', repository: 'project', startedBy: 'lead' },
				{ id: 'lead', name: 'Home', repository: null, startedBy: null },
			]),
		);
	});
});
