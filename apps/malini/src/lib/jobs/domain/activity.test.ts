import { describe, expect, it } from 'vitest';
import type {
	AgentActionRecord,
	ChatTurnRecord,
	JobRunRecord,
	ReconcilerCandidate,
	ReconcilerDecisionRecord,
} from '$contract/jobs';
import { activityEntries } from './activity';

function action(id: string, fields: Partial<AgentActionRecord>): AgentActionRecord {
	return {
		id,
		sessionId: 'chat-session',
		runId: 'turn-1',
		workstreamId: 'ws-1',
		tool: 'repositories_list',
		input: {},
		status: 'succeeded',
		approval: 'not-needed',
		output: '[]',
		startedAt: '2026-10-23T10:00:00.000Z',
		finishedAt: '2026-10-23T10:00:01.000Z',
		...fields,
	};
}

const turn: ChatTurnRecord = {
	runId: 'turn-1',
	sessionId: 'chat-session',
	workstreamId: 'ws-1',
	chatName: 'Ship it',
	prompt: 'Merge this workstream',
	status: 'succeeded',
	chainId: 'turn-1',
	causeEventId: null,
	startedAt: '2026-10-23T09:59:00.000Z',
	finishedAt: '2026-10-23T10:02:00.000Z',
};

const merge: JobRunRecord = {
	id: 'run-merge',
	definitionId: 'merge',
	title: 'Merge',
	workstreamId: 'ws-1',
	repositoryId: null,
	scope: null,
	sessionId: null,
	agentRunId: null,
	origin: 'manual',
	status: 'succeeded',
	detail: null,
	parentRunId: null,
	chatSessionId: 'chat-session',
	chatAfterRunId: 'turn-1',
	chainId: 'turn-1',
	requests: 1,
	createdAt: '2026-10-23T10:01:00.000Z',
	startedAt: '2026-10-23T10:03:00.000Z',
	finishedAt: '2026-10-23T10:04:00.000Z',
};

const fixChecks: JobRunRecord = {
	...merge,
	id: 'run-fix',
	definitionId: 'fix-checks',
	title: 'Fix checks',
	sessionId: 'job-session',
	chatSessionId: null,
	chatAfterRunId: null,
	finishedAt: '2026-10-23T09:00:00.000Z',
};

describe('activityEntries', () => {
	it('folds each call under the chat turn or job run that made it, and links a run to the call that started it', () => {
		const list = action('a-list', { startedAt: '2026-10-23T10:00:00.000Z' });
		const run = action('a-run', {
			tool: 'jobs_run',
			input: { job: 'Merge' },
			output: JSON.stringify({ id: 'run-merge', job: 'Merge', status: 'queued' }),
			startedAt: '2026-10-23T10:01:00.000Z',
		});
		const inJob = action('a-job', { sessionId: 'job-session', runId: 'job-turn' });
		const stray = action('a-stray', { sessionId: 'gone', runId: 'gone-turn' });

		const entries = activityEntries([merge, fixChecks], [turn], [run, inJob, list, stray]);

		expect(entries.map((entry) => [entry.kind, entry.id])).toEqual([
			['job', 'run-merge'],
			['chat', 'turn-1'],
			['call', 'a-stray'],
			['job', 'run-fix'],
		]);
		const [mergeEntry, turnEntry, , fixEntry] = entries;
		expect(mergeEntry?.kind === 'job' && mergeEntry.startedBy?.id).toBe('a-run');
		expect(mergeEntry?.kind === 'job' && mergeEntry.calls).toEqual([]);
		expect(turnEntry?.kind === 'chat' && turnEntry.calls.map(({ id }) => id)).toEqual([
			'a-list',
			'a-run',
		]);
		expect(fixEntry?.kind === 'job' && fixEntry.calls.map(({ id }) => id)).toEqual(['a-job']);
	});

	it('lists what the event reconciler did, never the times it did nothing or what it still asks you', () => {
		const candidates: ReconcilerCandidate[] = [
			{ kind: 'nothing', label: 'Do nothing' },
			{
				kind: 'wake-chat',
				label: 'Wake “Ship it” with this report',
				sessionId: 'chat-session',
				workstreamId: 'ws-1',
				from: 'ws-2',
				report: 'Done.',
			},
			{ kind: 'ask-you', label: 'Ask you', reason: 'It needs you.' },
		];
		const decision = (
			id: string,
			chosen: number,
			fields: Partial<ReconcilerDecisionRecord> = {},
		): ReconcilerDecisionRecord => ({
			id,
			eventId: 1,
			channel: 'chat:turn-finished',
			chainId: 'turn-1',
			workstreamId: 'ws-2',
			facts: [],
			candidates,
			pick: chosen,
			chosen,
			decidedBy: 'model',
			status: 'done',
			detail: null,
			jobRunId: null,
			createdAt: '2026-10-23T10:05:00.000Z',
			finishedAt: '2026-10-23T10:05:01.000Z',
			...fields,
		});

		const entries = activityEntries(
			[],
			[],
			[],
			[
				decision('woke', 1),
				decision('quiet', 0),
				decision('dismissed', 0, { decidedBy: 'you', status: 'dismissed' }),
				decision('failed', 0, { status: 'failed' }),
				decision('asking', 2, { status: 'asking', finishedAt: null }),
			],
		);

		expect(entries.map((entry) => entry.id)).toEqual(['woke', 'dismissed', 'failed']);
	});
});
