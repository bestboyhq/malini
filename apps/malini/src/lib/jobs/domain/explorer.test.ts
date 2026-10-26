import { describe, expect, it } from 'vitest';
import type {
	LoggedEventRecord,
	ReconcilerDecisionRecord,
	TimelineChatTurn,
	TimelineJobRun,
	TimelineRecord,
} from '$contract/jobs';
import { chainItems, explorer, listed, through, workingAt } from './explorer';

const at = (minute: number): string => new Date(Date.UTC(2026, 9, 26, 9, minute)).toISOString();

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
		event(2, 'jobs:run-changed', 21, { cause: { kind: 'job-run', id: 'fix' } }),
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
		'jobs:run-changed': 1,
		'repositories:workstream-files-changed': 9,
		'pull-requests:ship-changed': 1,
	},
	runs: [
		run('fix', 20, { origin: 'merge-queue', createdAt: at(15) }),
		run('announce', 22, { origin: 'trigger', eventIds: [2] }),
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
		expect(cause('run:asked')).toBe('turn:lead-wake');
		expect(cause('run:orphan')).toBeNull();
		expect(map.items.map((item) => item.at)).toEqual(
			[...map.items.map((item) => item.at)].sort((left, right) => left - right),
		);
	});

	it('routes each thing from its source through the parts of Malini it passed, never back', () => {
		const map = explorer(RECORD);
		const hops = (id: string): readonly (readonly [string, string])[] | undefined =>
			map.byId.get(id)?.hops;

		expect(hops('turn:lead-turn')).toEqual([['you', 'chats']]);
		expect(hops('turn:api-turn')).toEqual([['chats', 'chats']]);
		expect(hops('event:1')).toEqual([['agents', 'event:turn-ended']]);
		expect(hops('event:2')).toEqual([['agents', 'event:job-run']]);
		expect(hops('event:3')).toEqual([['git', 'event:other']]);
		expect(hops('event:4')).toEqual([['github', 'event:pull-request']]);
		expect(hops('decision:wake')).toEqual([['event:turn-ended', 'listener:reconciler']]);
		expect(hops('turn:lead-wake')).toEqual([['listener:reconciler', 'chats']]);
		expect(hops('run:announce')).toEqual([
			['event:job-run', 'listener:triggers'],
			['listener:triggers', 'jobs'],
		]);
		expect(hops('run:fix')).toEqual([
			['github', 'listener:merge-queue'],
			['listener:merge-queue', 'jobs'],
		]);
		expect(hops('run:asked')).toEqual([['chats', 'jobs']]);
		expect(hops('turn:resumed')).toEqual([
			['malini', 'listener:resume'],
			['listener:resume', 'chats'],
		]);
		expect(hops('run:nightly')).toEqual([
			['clock', 'listener:schedules'],
			['listener:schedules', 'jobs'],
		]);
		const column = (node: string): number => {
			if (node.startsWith('event:')) return 1;
			if (node.startsWith('listener:')) return 2;
			return node === 'chats' || node === 'jobs' ? 3 : 0;
		};
		expect(
			map.items.flatMap((item) => item.hops).filter(([from, to]) => column(from) > column(to)),
		).toEqual([]);
	});

	it('takes a merge queue run from the read of GitHub that caused it, and the read from the work it is about', () => {
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
				['event:pull-request', 'listener:merge-queue'],
				['listener:merge-queue', 'jobs'],
			],
		});
		expect(map.byId.get('event:5')).toMatchObject({
			cause: 'turn:api-turn',
			hops: [['github', 'event:pull-request']],
		});
		expect(listed(map, false).map((item) => item.id)).toContain('event:5');
	});

	it('counts every event of the window, and what each part started', () => {
		const map = explorer(RECORD);

		expect(map.counts.get('event:turn-ended')).toBe(5);
		expect(map.counts.get('event:other')).toBe(9);
		expect(map.counts.get('agents')).toBe(6);
		expect(map.counts.get('git')).toBe(9);
		expect(map.counts.get('github')).toBe(1);
		expect(map.counts.get('chats')).toBe(4);
		expect(map.counts.get('jobs')).toBe(5);
		expect(map.counts.get('you')).toBe(1);
		expect(map.counts.get('clock')).toBe(1);
		expect(map.counts.get('listener:reconciler')).toBe(1);
		expect(map.counts.get('listener:merge-queue')).toBe(1);
		expect(map.counts.get('listener:resume')).toBe(1);
		expect(map.wires.get('agents>event:turn-ended')).toBe(1);
		expect(map.wires.get('listener:thens>jobs')).toBe(1);
	});

	it('lists the facts unless asked for every event, and follows a chain or a part', () => {
		const map = explorer(RECORD);
		const ids = (items: readonly { id: string }[]): string[] => items.map((item) => item.id);

		expect(ids(listed(map, false))).not.toContain('event:2');
		expect(ids(listed(map, false))).not.toContain('event:3');
		expect(ids(listed(map, false))).toContain('event:4');
		expect(ids(listed(map, true))).toHaveLength(map.items.length);
		expect(ids(chainItems(map, 'other'))).toEqual(['event:4', 'run:orphan', 'turn:resumed']);
		expect(ids(through(map, 'listener:reconciler'))).toEqual(['decision:wake', 'turn:lead-wake']);
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
