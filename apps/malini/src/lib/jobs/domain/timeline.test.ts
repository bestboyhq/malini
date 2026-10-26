import { describe, expect, it } from 'vitest';
import type {
	LoggedEventRecord,
	ReconcilerDecisionRecord,
	TimelineChatTurn,
	TimelineJobRun,
	TimelineRecord,
} from '$contract/jobs';
import { chainItemIds, timelineLayout, timelineShare } from './timeline';

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
		origin: 'trigger',
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
	],
	runs: [run('fix', 20), run('announce', 22, { eventIds: [2] })],
	turns: [
		turn('lead-turn', 'lead', 5),
		turn('api-turn', 'api', 10, { from: 'lead' }),
		turn('lead-wake', 'lead', 14, { causeEventId: 1, from: 'api' }),
	],
	decisions: [wake],
	workstreams: [
		{ id: 'site', name: 'Site analytics', repository: 'solo/site', startedBy: 'lead' },
		{ id: 'api', name: 'Api analytics', repository: 'acme/api', startedBy: 'lead' },
		{ id: 'lead', name: 'Move apps to Logdash', repository: null, startedBy: null },
	],
};

describe('timelineLayout', () => {
	it('gives each workstream with work a lane, under the one that started it', () => {
		const layout = timelineLayout(RECORD, { everyEvent: false });

		expect(layout.lanes.map((lane) => [lane.id, lane.depth])).toEqual([
			['lead', 0],
			['api', 1],
		]);
		expect(layout.lanes[1]?.items.map((item) => item.id)).toEqual([
			'turn:api-turn',
			'event:1',
			'decision:wake',
			'run:fix',
			'run:announce',
		]);
	});

	it('links each thing to what caused it, passing over the events it leaves out', () => {
		const layout = timelineLayout(RECORD, { everyEvent: false });
		const causes = (id: string): readonly string[] | undefined => layout.items.get(id)?.causes;

		expect(causes('turn:api-turn')).toEqual(['turn:lead-turn']);
		expect(causes('event:1')).toEqual(['turn:api-turn']);
		expect(causes('decision:wake')).toEqual(['event:1']);
		expect(causes('turn:lead-wake')).toEqual(['decision:wake']);
		expect(causes('run:announce')).toEqual(['run:fix']);
		expect(layout.effects.get('turn:api-turn')).toEqual(['event:1']);
		expect(layout.items.has('event:2')).toBe(false);
	});

	it('shows every event when asked, each linked to the run behind it', () => {
		const layout = timelineLayout(RECORD, { everyEvent: true });

		expect(layout.items.get('run:announce')?.causes).toEqual(['event:2']);
		expect(layout.items.get('event:3')?.causes).toEqual(['turn:api-turn']);
	});

	it('finds the chain of a thing and places a moment along the window', () => {
		const layout = timelineLayout(RECORD, { everyEvent: false });

		expect(chainItemIds(layout, 'event:1').size).toBe(layout.items.size);
		expect(chainItemIds(layout, 'event:404').size).toBe(0);
		expect(timelineShare(layout, Date.parse(at(30)))).toBe(0.5);
		expect(timelineShare(layout, Date.parse(at(90)))).toBe(1);
	});
});
