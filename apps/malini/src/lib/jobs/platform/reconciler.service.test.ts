import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	APP_STARTED_CHANNEL,
	CHAT_TURN_FINISHED_CHANNEL,
	JOBS_RUN_FINISHED_CHANNEL,
	PULL_REQUESTS_BUTTON_CLICKED_CHANNEL,
	PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL,
	REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL,
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
import type { ChatWake } from '../domain/reconciler';
import type { JobsPlatform } from '../jobs.platform';
import { getBuiltinJobDefinition } from './job-definitions.repository';
import { insertJobRun } from './job-runs.repository';
import { registerJobs, type JobsOptions } from './register';

const NOW = '2026-10-26T09:00:00.000Z';

const REPORT =
	'Publish docs, the job you ran in “Api analytics”, failed.\n\nThe docs host timed out';

let db: MaliniDatabase;
let context: MainContext;
let jobs: JobsPlatform;
let picks: number[];
let asked: string[];
let delivered: ChatWake[];
let undeliverable: string | null;
let notified: unknown[];

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	picks = [];
	asked = [];
	delivered = [];
	undeliverable = null;
	notified = [];
	seed();
	boot();
});

afterEach(() => {
	jobs.dispose();
	db.close();
});

function boot(rules: Pick<JobsOptions, 'shipping' | 'resume' | 'deliveries'> = {}): void {
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
	jobs = registerJobs(context, {
		log: () => {},
		choose: async (task) => {
			asked.push(task);
			const pick = picks.shift();
			if (pick === undefined) throw new Error('Claude Code is not installed');
			return pick;
		},
		deliver: async (wake) => {
			if (undeliverable !== null) throw new Error(undeliverable);
			delivered.push(wake);
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

function finish(sessionId: string, runId: string): void {
	context.events.emit(CHAT_TURN_FINISHED_CHANNEL, {
		workstreamId: sessionId.replace(/-chat$/u, ''),
		sessionId,
		runId,
		status: 'succeeded',
		outcome: 'Added the analytics endpoint',
		needs: null,
	});
}

function childTurn(id: string): string {
	turn(id, 'api-chat', 'lead-turn', NOW);
	return id;
}

async function publishDocs(): Promise<string> {
	const job = await context.commands.call('jobs.save-definition', {
		name: 'Publish docs',
		instructions: 'Publish the docs.',
		model: 'opus',
		effort: 'low',
		runsIn: 'workstream',
	});
	return job.id;
}

function finishJob(
	definitionId: string,
	id: string,
	fields: Partial<JobRunRecord> = {},
): JobRunRecord {
	const finished: JobRunRecord = {
		id,
		definitionId,
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
		...fields,
	};
	insertJobRun(db, finished, 'Version 2.1');
	context.events.emit(JOBS_RUN_FINISHED_CHANNEL, { run: finished });
	return finished;
}

function decisions(): Promise<ReconcilerDecisionRecord[]> {
	return context.commands.call('jobs.list-decisions', undefined);
}

async function decided(count: number): Promise<ReconcilerDecisionRecord[]> {
	await vi.waitFor(async () => expect(await decisions()).toHaveLength(count));
	await vi.waitFor(async () =>
		expect((await decisions()).every((decision) => decision.status !== 'pending')).toBe(true),
	);
	return decisions();
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

describe('the event reconciler', () => {
	it('wakes the chat that ran a job with its report, in the chain and for the event it heard, when the model picks it', async () => {
		picks.push(2);
		finishJob(await publishDocs(), 'publish-1');

		const [decision] = await decided(1);
		expect(asked[0]).toContain('Event: the job Publish docs in “Api analytics” failed.');
		expect(asked[0]).toContain(
			'Candidates:\n1. Do nothing\n2. Tell “Move apps to Logdash” that Publish docs failed\n3. Run Publish docs again\n4. Ask you',
		);
		expect(decision).toMatchObject({
			channel: JOBS_RUN_FINISHED_CHANNEL,
			chainId: 'lead-turn',
			workstreamId: 'api',
			pick: 1,
			chosen: 1,
			decidedBy: 'model',
			status: 'done',
		});
		expect(delivered).toEqual([
			{
				sessionId: 'lead-chat',
				prompt: REPORT,
				fromWorkstreamId: 'api',
				chainId: 'lead-turn',
				causeEventId: decision?.eventId,
			},
		]);
	});

	it('asks you when the model picks it, and carries out what you pick once', async () => {
		picks.push(4);
		finishJob(await publishDocs(), 'publish-1');
		const [asking] = await decided(1);
		expect(asking).toMatchObject({ status: 'asking', finishedAt: null });
		expect(asking?.candidates[3]).toEqual({
			kind: 'ask-you',
			label: 'Ask you',
			reason: 'Publish docs failed in Api analytics.',
		});
		await vi.waitFor(() =>
			expect(notified).toEqual([
				{
					options: {
						title: 'Malini asks you',
						body: 'Publish docs failed in Api analytics.',
						opens: { workstreamId: 'lead', sessionId: 'lead-chat' },
					},
				},
			]),
		);
		expect(delivered).toEqual([]);

		const done = await context.commands.call('jobs.decide', {
			decisionId: asking?.id ?? '',
			candidate: 1,
		});

		expect(done).toMatchObject({ status: 'done', decidedBy: 'you', chosen: 1 });
		expect(delivered).toEqual([
			{
				sessionId: 'lead-chat',
				prompt: REPORT,
				fromWorkstreamId: 'api',
				chainId: 'lead-turn',
				causeEventId: asking?.eventId,
			},
		]);
		await expect(
			context.commands.call('jobs.decide', { decisionId: asking?.id ?? '', candidate: 0 }),
		).rejects.toThrow('This was already decided.');
	});

	it('saves a wake failed, with why, when Malini cannot deliver it to the chat', async () => {
		undeliverable = 'That chat is gone.';
		picks.push(2);
		finishJob(await publishDocs(), 'publish-1');

		const [decision] = await decided(1);

		expect(decision).toMatchObject({
			chosen: 1,
			status: 'failed',
			detail: 'Malini could not wake the chat: That chat is gone.',
			finishedAt: expect.any(String),
		});
		expect(delivered).toEqual([]);
	});

	it('delivers a wake Malini quit in the middle of when it starts again, and fails any other decision it was carrying out', async () => {
		const definitionId = await publishDocs();
		picks.push(4, 4);
		finishJob(definitionId, 'publish-api');
		finishJob(definitionId, 'publish-site', { workstreamId: 'site' });
		const asking = await decided(2);
		const wake = asking.find((decision) => decision.workstreamId === 'api');
		const rerun = asking.find((decision) => decision.workstreamId === 'site');
		const pending = (id: string | undefined, chosen: number) =>
			run(
				db,
				"UPDATE reconciler_decisions SET status = 'pending', chosen = ?, decided_by = 'you' WHERE id = ?",
				chosen,
				id ?? '',
			);
		pending(wake?.id, 1);
		pending(rerun?.id, 2);
		jobs.dispose();

		boot();

		expect(await decided(2)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: wake?.id, status: 'done' }),
				expect.objectContaining({
					id: rerun?.id,
					status: 'failed',
					detail: 'Interrupted when Malini closed',
				}),
			]),
		);
		expect(delivered).toEqual([
			{
				sessionId: 'lead-chat',
				prompt: REPORT,
				fromWorkstreamId: 'api',
				chainId: 'lead-turn',
				causeEventId: wake?.eventId,
			},
		]);
	});

	it('asks you before waking a chat a fourth time about the same work in one chain, and still wakes it about other work', async () => {
		const definitionId = await publishDocs();
		for (const index of [1, 2, 3, 4]) {
			picks.push(2);
			finishJob(definitionId, `publish-${index}`);
			await vi.waitFor(async () => expect(await decisions()).toHaveLength(index));
		}
		const listed = await decided(4);

		expect(delivered).toHaveLength(3);
		expect(listed.filter((decision) => decision.status === 'asking')).toEqual([
			expect.objectContaining({
				decidedBy: 'rules',
				pick: 1,
				detail: expect.stringContaining('Malini already woke this chat 3 times about this work'),
			}),
		]);
		expect(asked.at(-1)).toContain('about this work 3 of 3 times in this chain of events');

		picks.push(2);
		finishJob(definitionId, 'publish-site', { workstreamId: 'site' });

		await vi.waitFor(() => expect(delivered).toHaveLength(4));
		expect(delivered.at(-1)).toMatchObject({ sessionId: 'lead-chat', fromWorkstreamId: 'site' });
	});

	it('wakes the chat that ran a job by its own rules when it cannot ask the model', async () => {
		finishJob(await publishDocs(), 'publish-1');

		const [decision] = await decided(1);

		expect(decision).toMatchObject({
			status: 'done',
			pick: null,
			chosen: 1,
			decidedBy: 'rules',
			detail: 'Malini could not ask the model: Claude Code is not installed',
		});
		expect(delivered).toEqual([
			expect.objectContaining({ sessionId: 'lead-chat', prompt: REPORT }),
		]);
	});

	it('makes no decision on a turn that ended in a started workstream, and never asks the model about it', async () => {
		const delivering: string[] = [];
		jobs.dispose();
		boot({
			deliveries: async ({ channel }) => {
				delivering.push(channel);
			},
		});

		finish('api-chat', childTurn('api-turn'));

		await vi.waitFor(() => expect(delivering).toEqual([CHAT_TURN_FINISHED_CHANNEL]));
		await settle();
		expect(asked).toEqual([]);
		expect(await decisions()).toEqual([]);
		expect(delivered).toEqual([]);
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
			deliveries: async ({ channel }) => {
				heard.push(`deliveries ${channel}`);
			},
		});

		context.events.emit(APP_STARTED_CHANNEL, { version: '0.0.0-test' });
		context.events.emit(PULL_REQUESTS_WORKSTREAM_OPENED_CHANNEL, { workstreamId: 'api' });
		context.events.emit(PULL_REQUESTS_BUTTON_CLICKED_CHANNEL, {
			workstreamId: 'api',
			button: 'merge',
			state: null,
		});
		finish('lead-chat', 'lead-turn');

		await vi.waitFor(() => expect(heard).toHaveLength(5));
		await settle();
		expect([...heard].sort()).toEqual([
			'deliveries chat:turn-finished',
			'resume app:started',
			'shipping app:started',
			'shipping chat:turn-finished',
			'shipping pull-requests:button-clicked',
		]);
	});

	it('stays out of a job run a trigger handles', async () => {
		await context.commands.call('jobs.save-definition', {
			name: 'Review the failure',
			instructions: 'Review it.',
			model: 'opus',
			effort: 'low',
			runsIn: 'workstream',
			trigger: { when: 'on jobs:run-finished where run.status is failed', mode: 'ask' },
		});
		finishJob(await publishDocs(), 'publish-1');

		await vi.waitFor(async () =>
			expect(await context.commands.call('jobs.list-runs', undefined)).toContainEqual(
				expect.objectContaining({ origin: 'trigger', status: 'waiting' }),
			),
		);
		await settle();
		expect(asked).toEqual([]);
		expect(await decisions()).toEqual([]);
	});

	it('offers to run a failed job again, in the chain of the run that failed, and waits for you', async () => {
		const definitionId = await publishDocs();
		picks.push(3);
		finishJob(definitionId, 'publish-1');

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
			definitionId,
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
		const shipped = (id: string, definitionId: string, chatSessionId: string | null) =>
			finishJob(definitionId, id, {
				title: id,
				origin: 'merge-queue',
				detail: 'This workstream has no changes to ship yet.',
				chatSessionId,
				chatAfterRunId: null,
			});
		picks.push(1);
		shipped('Fix checks', fixChecks.id, null);
		shipped('Merge', merge.id, 'lead-chat');

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

	it('tells the chat working in a conflicted workstream about its conflicts as its own news, not a report from another workstream', async () => {
		picks.push(3);
		context.events.emit(REPOSITORIES_WORKSTREAM_MERGE_CONFLICTED_CHANNEL, {
			workstreamId: 'api',
			baseBranch: 'main',
			conflictedPaths: ['src/shared.ts'],
		});

		const [decision] = await decided(1);

		expect(decision).toMatchObject({ chosen: 2, status: 'done' });
		expect(delivered).toEqual([
			{
				sessionId: 'api-chat',
				prompt: 'A merge in “Api analytics” stopped on conflicts in 1 file: src/shared.ts.',
				fromWorkstreamId: null,
				chainId: decision?.chainId,
				causeEventId: decision?.eventId,
			},
		]);
	});

	it('lays out the events, turns, decisions and workstreams of a time window for the timeline', async () => {
		childTurn('api-turn');
		picks.push(2);
		finishJob(await publishDocs(), 'publish-1');
		await decided(1);

		const timeline = await context.commands.call('jobs.list-timeline', {
			since: '2026-01-01T00:00:00.000Z',
		});

		expect(timeline.events).toContainEqual(
			expect.objectContaining({
				channel: JOBS_RUN_FINISHED_CHANNEL,
				workstreamId: 'api',
				cause: { kind: 'job-run', id: 'publish-1' },
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
