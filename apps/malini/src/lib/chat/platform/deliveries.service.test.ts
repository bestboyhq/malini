import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatDelivery } from '$contract/deliveries';
import { CHAT_DELIVERY_CHANGED_CHANNEL, type ChatTurnFinishedPayload } from '$contract/events';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { isRecord, run } from '$main/db/rows';
import { createEventBus, type EventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { upsertProject, upsertWorkstream } from '$shared/repositories/repositories.platform';
import { REPORTS_PREAMBLE } from '../domain/deliveries';
import { getDelivery } from './deliveries.repository';
import { ChatDeliveries } from './deliveries.service';
import { insertRun, type AgentRun } from './runs.repository';
import { archiveSession, insertSession, moveSessionStatus } from './sessions.repository';

const NOW = '2026-10-28T09:00:00.000Z';

let db: MaliniDatabase;
let events: EventBus;
let deliveries: ChatDeliveries;
let sent: Array<Record<string, unknown>>;
let attempts: number;
let busy: number;
let failure: string | null;
let landing: Promise<void>;
let logs: string[];
let changed: ChatDelivery[];

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	events = createEventBus({ forwardToWindows: false });
	const commands = new CommandRegistry();
	sent = [];
	attempts = 0;
	busy = 0;
	failure = null;
	landing = Promise.resolve();
	logs = [];
	changed = [];
	commands.define('chat.send-prompt', async (args: unknown) => {
		attempts += 1;
		await landing;
		if (busy > 0) {
			busy -= 1;
			throw new Error('`api-chat` already has an active run');
		}
		if (failure !== null) throw new Error(failure);
		if (!isRecord(args)) throw new Error('chat.send-prompt takes an object');
		sent.push(args);
		const runId = `delivered-run-${sent.length}`;
		insertRun(db, {
			id: runId,
			sessionId: String(args['sessionId']),
			prompt: String(args['prompt']),
			startedAt: NOW,
			completedAt: NOW,
			summary: null,
			error: null,
			...(typeof args['chainId'] === 'string' ? { chainId: args['chainId'] } : {}),
		});
		return runId;
	});
	events.subscribe(CHAT_DELIVERY_CHANGED_CHANNEL, ({ delivery }) => {
		changed.push(delivery);
	});
	seed();
	deliveries = new ChatDeliveries({ db, commands, events }, (line) => logs.push(line));
});

afterEach(async () => {
	await deliveries.stop();
	vi.useRealTimers();
	db.close();
});

function seed(): void {
	upsertProject(db, {
		id: 'project',
		name: 'project',
		repoPath: '/tmp/project',
		defaultBranch: 'main',
		createdAt: NOW,
	});
	workstream('starter', 'Ship the dashboard', null);
	workstream('api', 'Api analytics', 'starter');
	workstream('site', 'Site analytics', 'starter');
	chat('starter-chat', 'starter');
	chat('api-chat', 'api');
	chat('site-chat', 'site');
}

function workstream(id: string, name: string, startedBy: string | null): void {
	upsertWorkstream(db, {
		id,
		projectId: 'project',
		name,
		path: `/tmp/${id}`,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
		startedBy,
	});
}

function chat(id: string, workstreamId: string): void {
	insertSession(db, {
		id,
		workstreamId,
		provider: 'claude',
		model: null,
		providerSessionId: null,
		status: 'idle',
		startedAt: NOW,
	});
}

function turn(id: string, sessionId: string, fields: Partial<AgentRun> = {}): void {
	insertRun(db, {
		id,
		sessionId,
		prompt: 'Work on it',
		startedAt: NOW,
		completedAt: NOW,
		summary: null,
		error: null,
		...fields,
	});
	if (fields.completedAt === null) moveSessionStatus(db, sessionId, 'run.started');
}

function finishRuns(): void {
	run(db, 'UPDATE agent_runs SET completed_at = ? WHERE completed_at IS NULL', NOW);
}

function finished(
	runId: string,
	fields: Partial<ChatTurnFinishedPayload> = {},
): ChatTurnFinishedPayload {
	return {
		workstreamId: 'api',
		sessionId: 'api-chat',
		runId,
		status: 'succeeded',
		outcome: 'Added the analytics endpoint',
		needs: null,
		backgroundCommands: null,
		...fields,
	};
}

function prompt(sessionId: string, text: string): Parameters<ChatDeliveries['deliver']>[0] {
	return {
		sessionId,
		kind: 'prompt',
		prompt: text,
		fromSessionId: 'starter-chat',
		fromWorkstreamId: 'starter',
	};
}

function ask(sessionId: string, text: string): Parameters<ChatDeliveries['deliver']>[0] {
	return { ...prompt(sessionId, text), wake: true };
}

function summarize(runId: string, summary: string): void {
	run(db, 'UPDATE agent_runs SET summary = ? WHERE id = ?', summary, runId);
}

function status(id: string): string | undefined {
	return getDelivery(db, id)?.status;
}

describe('ChatDeliveries', () => {
	it('sends a prompt to an idle chat at once, with its sender, chain, cause and profile', async () => {
		const delivery = await deliveries.deliver({
			...prompt('api-chat', 'Use the EU region.'),
			chainId: 'starter-turn',
			causeEventId: 4,
			profile: { effort: 'high', mode: 'agent' },
		});

		expect(sent).toEqual([
			{
				sessionId: 'api-chat',
				prompt: 'Use the EU region.',
				automated: false,
				from: 'starter',
				chainId: 'starter-turn',
				causeEventId: 4,
				profile: { effort: 'high', mode: 'agent', access: 'auto' },
			},
		]);
		expect(delivery).toEqual({
			id: expect.any(String),
			sessionId: 'api-chat',
			fromSessionId: 'starter-chat',
			status: 'delivered',
			runId: 'delivered-run-1',
			detail: null,
			createdAt: expect.any(String),
			deliveredAt: expect.any(String),
		});
		expect(changed.map(({ id, status: state }) => [id, state])).toEqual([
			[delivery.id, 'waiting'],
			[delivery.id, 'delivered'],
		]);
	});

	it('waits while the chat works, then sends everything waiting as one prompt', async () => {
		turn('api-working', 'api-chat', { completedAt: null });
		const first = await deliveries.deliver(prompt('api-chat', 'First.'));
		const second = await deliveries.deliver(prompt('api-chat', 'Second.'));
		await deliveries.flush('api-chat');
		expect([first.status, second.status]).toEqual(['waiting', 'waiting']);
		expect(attempts).toBe(0);

		finishRuns();
		await deliveries.flush('api-chat');

		expect(sent).toEqual([
			{ sessionId: 'api-chat', prompt: 'First.\n\nSecond.', automated: false, from: 'starter' },
		]);
		expect([getDelivery(db, first.id), getDelivery(db, second.id)]).toEqual([
			expect.objectContaining({ status: 'delivered', runId: 'delivered-run-1' }),
			expect.objectContaining({ status: 'delivered', runId: 'delivered-run-1' }),
		]);
		expect(changed.map(({ id, status: state }) => [id, state])).toEqual([
			[first.id, 'waiting'],
			[second.id, 'waiting'],
			[first.id, 'delivered'],
			[second.id, 'delivered'],
		]);
	});

	it("uses the profile of the chat's latest run the user started when the delivery has none", async () => {
		turn('api-user', 'api-chat', {
			startedAt: '2026-10-28T08:00:00.000Z',
			profile: { effort: 'low', mode: 'plan', access: 'full' },
		});
		turn('api-auto', 'api-chat', {
			startedAt: '2026-10-28T08:10:00.000Z',
			automated: true,
			profile: { effort: 'max', mode: 'agent', access: 'auto' },
		});
		turn('api-undone', 'api-chat', {
			startedAt: '2026-10-28T08:20:00.000Z',
			profile: { effort: 'medium', mode: 'agent', access: 'sandboxed' },
		});
		run(db, 'UPDATE agent_runs SET obsoleted_at = ? WHERE id = ?', NOW, 'api-undone');

		await deliveries.deliver({
			...prompt('api-chat', 'Go on.'),
			profile: { effort: 'huge', mode: 'agent' },
		});
		await deliveries.deliver(prompt('site-chat', 'Start.'));

		expect(sent).toEqual([
			expect.objectContaining({
				sessionId: 'api-chat',
				profile: { effort: 'low', mode: 'plan', access: 'full' },
			}),
			{ sessionId: 'site-chat', prompt: 'Start.', automated: false, from: 'starter' },
		]);
	});

	it('tries again every three seconds while the chat says it already has an active run', async () => {
		vi.useFakeTimers();
		busy = 2;
		const delivery = await deliveries.deliver(prompt('api-chat', 'Retry me.'));
		expect(delivery.status).toBe('waiting');

		await vi.advanceTimersByTimeAsync(2_999);
		expect(attempts).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(attempts).toBe(2);
		expect(sent).toEqual([]);
		await vi.advanceTimersByTimeAsync(3_000);

		expect(attempts).toBe(3);
		expect(sent).toEqual([expect.objectContaining({ sessionId: 'api-chat', prompt: 'Retry me.' })]);
		expect(status(delivery.id)).toBe('delivered');
	});

	it("stops trying after twenty busy answers and leaves it for the chat's next turn", async () => {
		vi.useFakeTimers();
		busy = 100;
		const delivery = await deliveries.deliver(prompt('api-chat', 'Retry me.'));

		await vi.advanceTimersByTimeAsync(20 * 3_000);
		expect(attempts).toBe(21);
		expect(logs).toEqual([
			"agent: deliveries for `api-chat` wait for that chat's next turn to end",
		]);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(attempts).toBe(21);
		expect(status(delivery.id)).toBe('waiting');

		busy = 0;
		await deliveries.flush('api-chat');
		expect(status(delivery.id)).toBe('delivered');
	});

	it('counts busy answers again once a turn of that chat ran in between', async () => {
		vi.useFakeTimers();
		busy = 19;
		const delivery = await deliveries.deliver(prompt('api-chat', 'Retry me.'));
		await vi.advanceTimersByTimeAsync(18 * 3_000);
		expect(attempts).toBe(19);

		turn('api-working', 'api-chat', { completedAt: null });
		await vi.advanceTimersByTimeAsync(3_000);
		expect(attempts).toBe(19);
		finishRuns();
		busy = 19;
		await deliveries.flush('api-chat');
		await vi.advanceTimersByTimeAsync(19 * 3_000);

		expect(attempts).toBe(39);
		expect(status(delivery.id)).toBe('delivered');
	});

	it('fails the delivery with the reason when the prompt cannot be sent', async () => {
		failure = 'agent bridge is not running';
		const delivery = await deliveries.deliver(prompt('api-chat', 'Go.'));

		expect(delivery).toMatchObject({
			status: 'failed',
			runId: null,
			detail: 'Malini could not deliver it: agent bridge is not running',
			deliveredAt: null,
		});
		expect(changed.map(({ status: state }) => state)).toEqual(['waiting', 'failed']);
	});

	it('fails what waits for a chat that is archived', async () => {
		archiveSession(db, 'api-chat', NOW);
		const gone = await deliveries.deliver(prompt('api-chat', 'Go.'));
		expect(gone).toMatchObject({ status: 'failed', detail: 'That chat is gone.' });

		turn('site-working', 'site-chat', { completedAt: null });
		const waiting = await deliveries.deliver(prompt('site-chat', 'Go.'));
		finishRuns();
		archiveSession(db, 'site-chat', NOW);
		await deliveries.flushAll();

		expect(getDelivery(db, waiting.id)).toMatchObject({
			status: 'failed',
			detail: 'That chat is gone.',
		});
		expect(attempts).toBe(0);
	});

	it('holds a chat until it is released', async () => {
		deliveries.hold('api-chat');
		const delivery = await deliveries.deliver(prompt('api-chat', 'Your first prompt.'));
		await deliveries.flush('api-chat');
		await deliveries.flushAll();
		expect(delivery.status).toBe('waiting');
		expect(attempts).toBe(0);

		await deliveries.release('api-chat');

		expect(sent).toEqual([
			expect.objectContaining({ sessionId: 'api-chat', prompt: 'Your first prompt.' }),
		]);
		expect(status(delivery.id)).toBe('delivered');
	});

	it('flushes every chat that has something waiting, the one waiting longest first', async () => {
		vi.useFakeTimers({ now: new Date(NOW) });
		turn('api-working', 'api-chat', { completedAt: null });
		turn('site-working', 'site-chat', { completedAt: null });
		await deliveries.deliver(prompt('site-chat', 'For the site.'));
		vi.setSystemTime(new Date('2026-10-28T09:01:00.000Z'));
		await deliveries.deliver(prompt('api-chat', 'For the api.'));
		finishRuns();

		await deliveries.flushAll();

		expect(sent.map((args) => [args['sessionId'], args['prompt']])).toEqual([
			['site-chat', 'For the site.'],
			['api-chat', 'For the api.'],
		]);
	});

	it('reports nothing to the chat that started a workstream unless that chat asked', async () => {
		turn('api-turn', 'api-chat', { summary: 'Added it.\n\nOutcome: Added it\nNeeds: nothing' });
		await deliveries.turnFinished(finished('api-turn'), 7);
		const told = await deliveries.deliver(prompt('api-chat', 'Add analytics.'));
		await deliveries.turnFinished(finished('delivered-run-1', { status: 'failed' }), 8);

		expect(sent.map((args) => args['sessionId'])).toEqual(['api-chat']);
		expect(changed.map(({ id }) => id)).toEqual([told.id, told.id]);
	});

	it('reports the turn a prompt that asks to wake starts to the chat that sent it, once', async () => {
		await deliveries.deliver({ ...ask('api-chat', 'Add the endpoint.'), chainId: 'starter-turn' });
		summarize(
			'delivered-run-1',
			'Added the endpoint.\n\n![Chart](shots/chart.png)\n\nOutcome: Added the analytics endpoint\nNeeds: nothing',
		);

		await deliveries.turnFinished(finished('delivered-run-1'), 41);
		await deliveries.turnFinished(finished('delivered-run-1'), 42);
		turn('api-later', 'api-chat');
		await deliveries.turnFinished(finished('api-later'), 43);

		expect(sent.slice(1)).toEqual([
			{
				sessionId: 'starter-chat',
				prompt: [
					REPORTS_PREAMBLE,
					[
						'“Api analytics” (`api`), a workstream you started, finished a turn.',
						'Its checkout: /tmp/api',
						'Added the endpoint.',
						'',
						'![Chart](/tmp/api/shots/chart.png)',
						'',
						'Outcome: Added the analytics endpoint',
						'Needs: nothing',
					].join('\n'),
				].join('\n\n'),
				automated: true,
				from: 'api',
				chainId: 'starter-turn',
				causeEventId: 41,
				reports: [
					{
						workstreamId: 'api',
						runId: 'delivered-run-1',
						status: 'succeeded',
						outcome: 'Added the analytics endpoint',
						needs: null,
						media: [{ src: 'shots/chart.png', label: 'Chart' }],
					},
				],
			},
		]);
	});

	it('wakes the chat that started a workstream for the first prompt it held until setup ended', async () => {
		deliveries.hold('api-chat');
		await deliveries.deliver(ask('api-chat', 'Add analytics.'));
		await deliveries.release('api-chat');

		await deliveries.turnFinished(finished('delivered-run-1'), 5);

		expect(sent.map((args) => args['sessionId'])).toEqual(['api-chat', 'starter-chat']);
	});

	it('reports the outcome and needs of a failed turn that left no summary', async () => {
		await deliveries.deliver(ask('api-chat', 'Add analytics.'));

		await deliveries.turnFinished(
			finished('delivered-run-1', {
				status: 'failed',
				outcome: null,
				needs: 'Which Logdash project?',
			}),
			null,
		);

		expect(sent[1]?.['prompt']).toBe(
			[
				REPORTS_PREAMBLE,
				'“Api analytics” (`api`), a workstream you started, failed its turn.\nIts checkout: /tmp/api\nOutcome: none\nNeeds: Which Logdash project?',
			].join('\n\n'),
		);
		expect(sent[1]?.['reports']).toEqual([
			{
				workstreamId: 'api',
				runId: 'delivered-run-1',
				status: 'failed',
				outcome: null,
				needs: 'Which Logdash project?',
				media: [],
			},
		]);
		expect(sent[1]).not.toHaveProperty('causeEventId');
	});

	it('keeps the wake over an interrupted turn and reports the turn that resumes it', async () => {
		await deliveries.deliver(ask('api-chat', 'Add analytics.'));
		await deliveries.turnFinished(finished('delivered-run-1', { status: 'interrupted' }), 9);
		expect(sent).toHaveLength(1);

		turn('api-resumed', 'api-chat');
		await deliveries.turnFinished(finished('api-resumed'), 10);

		expect(sent.slice(1)).toEqual([
			expect.objectContaining({
				sessionId: 'starter-chat',
				reports: [expect.objectContaining({ runId: 'api-resumed' })],
			}),
		]);
	});

	it('drops the wake of a turn the user stopped', async () => {
		await deliveries.deliver(ask('api-chat', 'Add analytics.'));
		await deliveries.turnFinished(finished('delivered-run-1', { status: 'cancelled' }), 11);
		turn('api-again', 'api-chat');
		await deliveries.turnFinished(finished('api-again'), 12);

		expect(sent.map((args) => args['sessionId'])).toEqual(['api-chat']);
	});

	it('reports a turn that ended over a background command, then the turn that goes on, and hands the chat a prompt at once', async () => {
		await deliveries.deliver(ask('api-chat', 'Merge main in.'));
		run(db, 'UPDATE agent_runs SET completed_at = NULL WHERE id = ?', 'delivered-run-1');
		moveSessionStatus(db, 'api-chat', 'run.started');
		moveSessionStatus(db, 'api-chat', 'turn.ended');
		summarize('delivered-run-1', 'Waiting for the merge from main to land.');

		await deliveries.turnFinished(
			finished('delivered-run-1', { outcome: null, backgroundCommands: ['Wait for the merge'] }),
			41,
		);
		const followUp = await deliveries.deliver(prompt('api-chat', 'Also add the line second.'));
		expect(followUp.status).toBe('delivered');
		turn('api-goes-on', 'api-chat', {
			summary: 'Merged it.\n\nOutcome: The merge landed\nNeeds: nothing',
		});
		await deliveries.turnFinished(finished('api-goes-on', { outcome: 'The merge landed' }), 42);
		await deliveries.turnFinished(finished('delivered-run-2'), 43);

		const toStarter = sent.filter((args) => args['sessionId'] === 'starter-chat');
		expect(toStarter.map((args) => args['prompt'])).toEqual([
			[
				REPORTS_PREAMBLE,
				'“Api analytics” (`api`), a workstream you started, is waiting on its background command “Wait for the merge”, and reports again if it continues.\nIts checkout: /tmp/api\nWaiting for the merge from main to land.',
			].join('\n\n'),
			[
				REPORTS_PREAMBLE,
				'“Api analytics” (`api`), a workstream you started, finished a turn.\nIts checkout: /tmp/api\nMerged it.\n\nOutcome: The merge landed\nNeeds: nothing',
			].join('\n\n'),
		]);
		expect(toStarter.map((args) => args['reports'])).toEqual([
			[
				{
					workstreamId: 'api',
					runId: 'delivered-run-1',
					status: 'succeeded',
					outcome: null,
					needs: null,
					media: [],
					backgroundCommands: ['Wait for the merge'],
				},
			],
			[
				{
					workstreamId: 'api',
					runId: 'api-goes-on',
					status: 'succeeded',
					outcome: 'The merge landed',
					needs: null,
					media: [],
				},
			],
		]);
		expect(sent.filter((args) => args['sessionId'] === 'api-chat')).toEqual([
			expect.objectContaining({ prompt: 'Merge main in.', from: 'starter' }),
			expect.objectContaining({ prompt: 'Also add the line second.', from: 'starter' }),
		]);
		expect(status(followUp.id)).toBe('delivered');
	});

	it('answers a wake with the turn its prompt starts, never the turn that was busy when it came', async () => {
		turn('api-busy', 'api-chat', { completedAt: null });
		turn('site-busy', 'site-chat', { completedAt: null });
		await deliveries.deliver(ask('api-chat', 'Then add the endpoint.'));
		await deliveries.deliver(ask('site-chat', 'Then add the chart.'));
		finishRuns();

		await deliveries.turnFinished(finished('api-busy'), 20);
		await deliveries.flush('site-chat');
		await deliveries.turnFinished(
			finished('site-busy', { workstreamId: 'site', sessionId: 'site-chat' }),
			21,
		);
		expect(sent.map((args) => args['sessionId'])).toEqual(['api-chat', 'site-chat']);

		await deliveries.turnFinished(finished('delivered-run-1'), 22);
		await deliveries.turnFinished(
			finished('delivered-run-2', { workstreamId: 'site', sessionId: 'site-chat' }),
			23,
		);

		expect(sent.slice(2)).toEqual([
			expect.objectContaining({
				sessionId: 'starter-chat',
				reports: [expect.objectContaining({ workstreamId: 'api', runId: 'delivered-run-1' })],
			}),
			expect.objectContaining({
				sessionId: 'starter-chat',
				reports: [expect.objectContaining({ workstreamId: 'site', runId: 'delivered-run-2' })],
			}),
		]);
	});

	it('reports once to each chat that asked, and never to a chat that is gone or in the same workstream', async () => {
		chat('starter-other', 'starter');
		chat('api-other', 'api');
		turn('api-busy', 'api-chat', { completedAt: null });
		await deliveries.deliver(ask('api-chat', 'First.'));
		await deliveries.deliver(ask('api-chat', 'Second.'));
		await deliveries.deliver({
			...ask('api-chat', 'From a closed chat.'),
			fromSessionId: 'starter-other',
		});
		await deliveries.deliver({ ...ask('api-chat', 'From beside it.'), fromSessionId: 'api-other' });
		archiveSession(db, 'starter-other', NOW);
		finishRuns();
		await deliveries.flush('api-chat');

		await deliveries.turnFinished(finished('delivered-run-1'), 30);

		expect(sent.map((args) => args['sessionId'])).toEqual(['api-chat', 'starter-chat']);
	});

	it('sends nothing once stopped, and drops the retries it planned', async () => {
		vi.useFakeTimers();
		busy = 1;
		await deliveries.deliver(prompt('api-chat', 'Retry me.'));
		await deliveries.stop();
		await vi.advanceTimersByTimeAsync(3_000);
		const late = await deliveries.deliver(prompt('site-chat', 'Too late.'));
		await deliveries.flushAll();

		expect(attempts).toBe(1);
		expect(late.status).toBe('waiting');
	});

	it('lets the prompt it is sending land before it stops', async () => {
		let land = (): void => {};
		landing = new Promise((resolve) => {
			land = resolve;
		});
		const delivering = deliveries.deliver(prompt('api-chat', 'Go.'));
		const stopped = (async () => {
			await deliveries.stop();
			return status(changed[0]?.id ?? '');
		})();
		land();

		expect(await stopped).toBe('delivered');
		await delivering;
	});
});
