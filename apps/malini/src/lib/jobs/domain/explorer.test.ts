import { describe, expect, it } from 'vitest';
import type {
	LoggedEventRecord,
	ReconcilerDecisionRecord,
	TimelineChatTurn,
	TimelineJobRun,
	TimelineRecord,
} from '$contract/jobs';
import {
	EVENT_ROWS,
	ROW_SOURCES,
	chainItems,
	eventRow,
	explorer,
	listed,
	through,
	workingAt,
	type Explorer,
	type Hop,
} from './explorer';
import { RECONCILER_RULES, RULE_EVENTS } from './reconciler';

const at = (minute: number): string => new Date(Date.UTC(2026, 9, 26, 9, minute)).toISOString();

function column(node: string): number {
	if (node.startsWith('event:')) return 1;
	if (node === 'reconciler') return 2;
	if (node.startsWith('rule:')) return 3;
	return node === 'chats' || node === 'jobs' ? 4 : 0;
}

function offRoute(map: Explorer): readonly Hop[] {
	return map.items
		.flatMap((item) => item.hops)
		.filter(
			([from, to]) =>
				from !== 'you' &&
				column(to) !== column(from) + 1 &&
				!(column(from) === 4 && column(to) === 4),
		);
}

function event(
	id: number,
	channel: string,
	minute: number,
	fields: Partial<LoggedEventRecord> = {},
): LoggedEventRecord {
	return {
		id,
		channel,
		payload: {},
		workstreamId: 'api',
		cause: null,
		chainId: 'chain',
		emittedAt: at(minute),
		...fields,
	};
}

function turn(
	runId: string,
	workstreamId: string,
	minute: number,
	fields: Partial<TimelineChatTurn> = {},
): TimelineChatTurn {
	return {
		runId,
		sessionId: `${workstreamId}-chat`,
		workstreamId,
		chatName: workstreamId,
		prompt: 'Work on it',
		status: 'succeeded',
		chainId: 'chain',
		causeEventId: null,
		startedAt: at(minute),
		finishedAt: at(minute + 2),
		from: null,
		resumed: false,
		...fields,
	};
}

function run(id: string, minute: number, fields: Partial<TimelineJobRun> = {}): TimelineJobRun {
	return {
		id,
		definitionId: 'job',
		title: id,
		workstreamId: 'api',
		repositoryId: null,
		scope: null,
		sessionId: null,
		agentRunId: null,
		origin: 'manual',
		status: 'succeeded',
		detail: null,
		parentRunId: null,
		chatSessionId: null,
		chatAfterRunId: null,
		chainId: 'chain',
		requests: 1,
		createdAt: at(minute),
		startedAt: at(minute),
		finishedAt: at(minute + 1),
		eventIds: [],
		...fields,
	};
}

const wake: ReconcilerDecisionRecord = {
	id: 'wake',
	eventId: 1,
	channel: 'chat:turn-finished',
	chainId: 'chain',
	workstreamId: 'api',
	facts: [],
	candidates: [
		{ kind: 'nothing', label: 'Do nothing' },
		{
			kind: 'wake-chat',
			label: 'Wake “Lead” with this report',
			sessionId: 'lead-chat',
			workstreamId: 'lead',
			from: 'api',
			report: 'Done',
		},
	],
	pick: 1,
	chosen: 1,
	decidedBy: 'model',
	status: 'done',
	detail: null,
	jobRunId: null,
	createdAt: at(13),
	finishedAt: at(13),
};

const RECORD: TimelineRecord = {
	since: at(0),
	until: at(60),
	events: [
		event(1, 'chat:turn-finished', 12, { cause: { kind: 'chat-turn', id: 'api-turn' } }),
		event(2, 'jobs:run-finished', 21, { cause: { kind: 'job-run', id: 'fix' } }),
		event(3, 'repositories:workstream-files-changed', 11, {
			cause: { kind: 'chat-turn', id: 'api-turn' },
		}),
		event(4, 'pull-requests:ship-changed', 30, {
			payload: { workstreamId: 'api', state: null, merged: { pullRequestNumber: 7 } },
			chainId: 'other',
		}),
	],
	channelCounts: {
		'chat:turn-finished': 5,
		'jobs:run-finished': 1,
		'repositories:workstream-files-changed': 9,
		'pull-requests:ship-changed': 1,
	},
	runs: [
		run('fix', 20, { origin: 'merge-queue', createdAt: at(15) }),
		run('announce', 22, { origin: 'trigger', eventIds: [2] }),
		run('notes', 23, { origin: 'then', parentRunId: 'fix', eventIds: [2] }),
		run('asked', 25, { chatAfterRunId: 'lead-wake' }),
		run('orphan', 40, { origin: 'then', parentRunId: 'gone', chainId: 'other' }),
		run('nightly', 45, { origin: 'schedule', chainId: 'nightly' }),
	],
	turns: [
		turn('lead-turn', 'lead', 5),
		turn('api-turn', 'api', 10, { from: 'lead' }),
		turn('lead-wake', 'lead', 14, { causeEventId: 1, from: 'api' }),
		turn('resumed', 'site', 50, { resumed: true, chainId: 'other', finishedAt: null }),
	],
	decisions: [wake],
	workstreams: [
		{ id: 'site', name: 'Site analytics', repository: 'solo/site', startedBy: null },
		{ id: 'api', name: 'Api analytics', repository: 'acme/api', startedBy: 'lead' },
		{ id: 'lead', name: 'Move apps to Logdash', repository: null, startedBy: null },
	],
};

describe('explorer', () => {
	it('links each thing to what caused it and drops causes outside the window', () => {
		const map = explorer(RECORD);
		const cause = (id: string): string | null | undefined => map.byId.get(id)?.cause;

		expect(cause('turn:api-turn')).toBe('turn:lead-turn');
		expect(cause('event:1')).toBe('turn:api-turn');
		expect(cause('decision:wake')).toBe('event:1');
		expect(cause('turn:lead-wake')).toBe('decision:wake');
		expect(cause('run:announce')).toBe('event:2');
		expect(cause('run:notes')).toBe('run:fix');
		expect(cause('run:asked')).toBe('turn:lead-wake');
		expect(cause('run:orphan')).toBeNull();
		expect(map.items.map((item) => item.at)).toEqual(
			[...map.items.map((item) => item.at)].sort((left, right) => left - right),
		);
	});

	it('routes every event through the Reconciler and its rules into work, never back', () => {
		const map = explorer(RECORD);
		const hops = (id: string): readonly (readonly [string, string])[] | undefined =>
			map.byId.get(id)?.hops;

		expect(hops('turn:lead-turn')).toEqual([['you', 'chats']]);
		expect(hops('turn:api-turn')).toEqual([['chats', 'chats']]);
		expect(hops('event:1')).toEqual([['event:turn-finished', 'reconciler']]);
		expect(hops('event:2')).toEqual([['event:job-finished', 'reconciler']]);
		expect(hops('event:3')).toEqual([['event:files-changed', 'reconciler']]);
		expect(hops('event:4')).toEqual([['event:other', 'reconciler']]);
		expect(hops('decision:wake')).toEqual([['reconciler', 'rule:model']]);
		expect(hops('turn:lead-wake')).toEqual([['rule:model', 'chats']]);
		expect(hops('run:announce')).toEqual([
			['reconciler', 'rule:triggers'],
			['rule:triggers', 'jobs'],
		]);
		expect(hops('run:notes')).toEqual([
			['reconciler', 'rule:thens'],
			['rule:thens', 'jobs'],
		]);
		expect(hops('run:orphan')).toEqual([['jobs', 'jobs']]);
		expect(hops('run:fix')).toEqual([
			['reconciler', 'rule:shipping'],
			['rule:shipping', 'jobs'],
		]);
		expect(hops('run:asked')).toEqual([['chats', 'jobs']]);
		expect(hops('turn:resumed')).toEqual([
			['reconciler', 'rule:resume'],
			['rule:resume', 'chats'],
		]);
		expect(hops('run:nightly')).toEqual([
			['reconciler', 'rule:schedules'],
			['rule:schedules', 'jobs'],
		]);
		expect(offRoute(map)).toEqual([]);
	});

	it('takes a Shipping run from the read of GitHub it heard, and logs the read for the work it is about', () => {
		const map = explorer({
			...RECORD,
			events: [
				event(5, 'pull-requests:pull-request-changed', 16, {
					cause: { kind: 'chat-turn', id: 'api-turn' },
					payload: { workstreamId: 'api', pullRequestNumber: 7, state: 'open', checks: 'failed' },
				}),
			],
			channelCounts: { 'pull-requests:pull-request-changed': 1 },
			runs: [run('fix', 20, { origin: 'merge-queue', eventIds: [5] })],
			decisions: [],
		});

		expect(map.byId.get('run:fix')).toMatchObject({
			cause: 'event:5',
			hops: [
				['reconciler', 'rule:shipping'],
				['rule:shipping', 'jobs'],
			],
		});
		expect(map.byId.get('event:5')).toMatchObject({
			cause: 'turn:api-turn',
			hops: [['event:pull-request-changed', 'reconciler']],
		});
		expect(listed(map, false).map((item) => item.id)).toContain('event:5');
	});

	it('counts every event of the window, each one through the reconciler, and what each part started', () => {
		const map = explorer(RECORD);

		expect(map.counts.get('event:turn-finished')).toBe(5);
		expect(map.counts.get('event:job-finished')).toBe(1);
		expect(map.counts.get('event:files-changed')).toBe(9);
		expect(map.counts.get('event:other')).toBe(1);
		expect(map.counts.get('reconciler')).toBe(16);
		expect(map.counts.get('chats')).toBe(4);
		expect(map.counts.get('jobs')).toBe(6);
		expect(map.counts.get('you')).toBe(1);
		expect(map.counts.get('rule:model')).toBe(1);
		expect(map.counts.get('rule:triggers')).toBe(1);
		expect(map.counts.get('rule:thens')).toBe(1);
		expect(map.counts.get('rule:shipping')).toBe(1);
		expect(map.counts.get('rule:resume')).toBe(1);
		expect(map.counts.get('rule:schedules')).toBe(1);
		expect(map.wires.get('event:turn-finished>reconciler')).toBe(1);
		expect(map.wires.get('reconciler>rule:thens')).toBe(1);
	});

	it('names what you click and open, the start of Malini and the times reached as the events their rules heard through the Reconciler', () => {
		const map = explorer({
			...RECORD,
			events: [
				event(6, 'app:started', 1, { workstreamId: null, chainId: 'boot' }),
				event(7, 'jobs:time-reached', 2, { workstreamId: null, chainId: 'nine' }),
				event(8, 'pull-requests:workstream-opened', 3),
				event(9, 'pull-requests:button-clicked', 4),
				event(10, 'jobs:time-reached', 6),
			],
			channelCounts: {
				'app:started': 1,
				'jobs:time-reached': 2,
				'pull-requests:workstream-opened': 1,
				'pull-requests:button-clicked': 1,
			},
			runs: [
				run('nine', 2, { origin: 'schedule', chainId: 'nine', eventIds: [7] }),
				run('update', 5, { origin: 'merge-queue', eventIds: [9] }),
				run('retry', 7, { origin: 'merge-queue', eventIds: [10] }),
			],
			turns: [turn('resumed', 'site', 1, { resumed: true, causeEventId: 6 })],
			decisions: [],
		});
		const shipping: readonly Hop[] = [
			['reconciler', 'rule:shipping'],
			['rule:shipping', 'jobs'],
		];

		expect(EVENT_ROWS.filter((row) => ROW_SOURCES[row] === 'you')).toEqual([
			'button-clicked',
			'workstream-opened',
		]);
		expect(map.byId.get('event:6')).toMatchObject({ row: 'malini-started' });
		expect(map.byId.get('event:7')).toMatchObject({ row: 'time-reached' });
		expect(map.byId.get('event:8')).toMatchObject({
			row: 'workstream-opened',
			hops: [['event:workstream-opened', 'reconciler']],
		});
		expect(map.byId.get('event:9')).toMatchObject({
			row: 'button-clicked',
			hops: [['event:button-clicked', 'reconciler']],
		});
		expect(map.byId.get('event:10')).toMatchObject({ row: 'time-reached' });
		expect(map.byId.get('turn:resumed')?.cause).toBe('event:6');
		expect(map.byId.get('run:nine')?.cause).toBe('event:7');
		expect(map.byId.get('run:update')).toMatchObject({ cause: 'event:9', hops: shipping });
		expect(map.byId.get('run:retry')).toMatchObject({ cause: 'event:10', hops: shipping });
		expect(listed(map, false).map((item) => item.id)).toEqual(
			expect.arrayContaining(['event:6', 'event:7', 'event:8', 'event:9', 'event:10']),
		);
		expect(map.counts.get('event:button-clicked')).toBe(1);
		expect(map.counts.get('event:workstream-opened')).toBe(1);
		expect(map.counts.get('reconciler')).toBe(5);
		expect(map.counts.get('rule:shipping')).toBe(2);
		expect(map.counts.get('you')).toBeUndefined();
		expect(offRoute(map)).toEqual([]);
		expect(chainItems(map, 'chain').map((item) => item.id)).toEqual([
			'event:6',
			'turn:resumed',
			'event:8',
			'event:9',
			'run:update',
			'event:10',
			'run:retry',
		]);
	});

	it('takes a Check compatibility run from the Malini updated its Compatibility rule heard', () => {
		const map = explorer({
			...RECORD,
			events: [event(11, 'app:updated', 3, { workstreamId: null, chainId: 'update' })],
			channelCounts: { 'app:updated': 1 },
			runs: [run('check', 4, { origin: 'compatibility', chainId: 'update', eventIds: [11] })],
			turns: [],
			decisions: [],
		});

		expect(map.byId.get('event:11')).toMatchObject({
			row: 'malini-updated',
			hops: [['event:malini-updated', 'reconciler']],
		});
		expect(map.byId.get('run:check')).toMatchObject({
			cause: 'event:11',
			hops: [
				['reconciler', 'rule:compatibility'],
				['rule:compatibility', 'jobs'],
			],
		});
		expect(map.counts.get('rule:compatibility')).toBe(1);
		expect(map.counts.get('rule:triggers')).toBeUndefined();
		expect(listed(map, false).map((item) => item.id)).toContain('event:11');
		expect(offRoute(map)).toEqual([]);
	});

	it('gives every event a rule hears a row of its own', () => {
		const heard = RECONCILER_RULES.flatMap((rule) => {
			const channels = RULE_EVENTS[rule];
			return channels === 'every' ? [] : channels;
		});

		expect(heard.filter((channel) => eventRow(channel) === 'other')).toEqual([]);
	});

	it('lists the facts unless asked for every event, and follows a chain or a part', () => {
		const map = explorer(RECORD);
		const ids = (items: readonly { id: string }[]): string[] => items.map((item) => item.id);

		expect(ids(listed(map, false))).not.toContain('event:2');
		expect(ids(listed(map, false))).not.toContain('event:3');
		expect(ids(listed(map, false))).toContain('event:4');
		expect(ids(listed(map, true))).toHaveLength(map.items.length);
		expect(ids(chainItems(map, 'other'))).toEqual(['event:4', 'run:orphan', 'turn:resumed']);
		expect(ids(through(map, 'rule:model'))).toEqual(['decision:wake', 'turn:lead-wake']);
		expect(ids(through(map, 'reconciler'))).toEqual([
			'event:3',
			'event:1',
			'decision:wake',
			'run:fix',
			'event:2',
			'run:announce',
			'run:notes',
			'event:4',
			'run:nightly',
			'turn:resumed',
		]);
	});

	it('knows what was working, and what waited, at any moment', () => {
		const map = explorer(RECORD);
		const minute = (value: number): number => Date.parse(at(value));

		expect(workingAt(map, minute(11)).turns.map((item) => item.runId)).toEqual(['api-turn']);
		expect(workingAt(map, minute(17)).waiting).toBe(1);
		expect(workingAt(map, minute(20.5)).runs.map((item) => item.id)).toEqual(['fix']);
		expect(workingAt(map, minute(59)).turns.map((item) => item.runId)).toEqual(['resumed']);
	});
});
