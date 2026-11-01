import { describe, expect, it } from 'vitest';
import type { JobRunRecord, ReconcilerDecisionRecord } from '$contract/jobs';
import { jobCenterCounts, jobCenterEntries } from './job-center';

function run(id: string, patch: Partial<JobRunRecord>): JobRunRecord {
	return {
		id,
		definitionId: 'job-1',
		title: id,
		workstreamId: 'ws-1',
		repositoryId: null,
		scope: null,
		sessionId: null,
		agentRunId: null,
		origin: 'manual',
		status: 'queued',
		detail: null,
		parentRunId: null,
		chatSessionId: null,
		chatAfterRunId: null,
		chainId: id,
		requests: 1,
		createdAt: '2026-10-11T11:00:00.000Z',
		startedAt: null,
		finishedAt: null,
		...patch,
	};
}

function question(id: string, patch: Partial<ReconcilerDecisionRecord>): ReconcilerDecisionRecord {
	return {
		id,
		eventId: 1,
		channel: 'jobs:run-finished',
		chainId: 'chain',
		workstreamId: 'ws-2',
		facts: [],
		candidates: [{ kind: 'nothing', label: 'Do nothing' }],
		pick: null,
		chosen: 0,
		decidedBy: 'model',
		status: 'asking',
		detail: null,
		jobRunId: null,
		subjectRunId: null,
		createdAt: '2026-10-11T11:30:00.000Z',
		finishedAt: null,
		...patch,
	};
}

const at = (minute: number): string => `2026-10-11T11:${String(minute).padStart(2, '0')}:00.000Z`;

describe('the jobs gutter', () => {
	it('shows what asks you first, then what runs, then the queue, oldest first, and nothing that finished', () => {
		const entries = jobCenterEntries(
			[
				run('queued-late', { status: 'queued', createdAt: at(50) }),
				run('running', { status: 'running', createdAt: at(10) }),
				run('done', { status: 'succeeded', finishedAt: at(55) }),
				run('cancelled', { status: 'cancelled', finishedAt: at(56) }),
				run('queued-early', { status: 'queued', createdAt: at(40) }),
				run('needs-you', { status: 'needs-you', createdAt: at(30) }),
				run('waiting', { status: 'waiting', createdAt: at(5) }),
			],
			[question('dismissed', { status: 'dismissed' }), question('asking', { createdAt: at(20) })],
		);

		expect(entries.map((entry) => entry.key)).toEqual([
			'waiting',
			'asking',
			'needs-you',
			'running',
			'queued-early',
			'queued-late',
		]);
		expect(jobCenterCounts(entries)).toEqual({ running: 1, queued: 2, needsYou: 3 });
	});

	it('puts a question on the job it is about, finished or not, and shows that job once', () => {
		const failed = run('failed', { status: 'failed', workstreamId: 'ws-2' });
		const updating = run('updating', { status: 'running', workstreamId: 'ws-3' });
		const entries = jobCenterEntries(
			[failed, updating],
			[
				question('on-failed', { subjectRunId: 'failed' }),
				question('on-updating', { subjectRunId: 'updating', workstreamId: 'ws-3' }),
				question('on-a-merge', { subjectRunId: null, workstreamId: 'ws-4' }),
			],
		);

		expect(
			entries.map(({ key, run, question, workstreamId }) => [
				key,
				run?.id ?? null,
				question?.id ?? null,
				workstreamId,
			]),
		).toEqual([
			['on-failed', 'failed', 'on-failed', 'ws-2'],
			['on-updating', 'updating', 'on-updating', 'ws-3'],
			['on-a-merge', null, 'on-a-merge', 'ws-4'],
		]);
		expect(jobCenterCounts(entries)).toEqual({ running: 0, queued: 0, needsYou: 3 });
	});
});
