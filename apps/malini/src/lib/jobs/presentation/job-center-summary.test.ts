import { describe, expect, it } from 'vitest';
import type { JobRunStatus, ReconcilerDecisionRecord } from '$contract/jobs';
import { jobCenterSummary, jobQuestionReason } from './job-center-summary';

function entry(status: JobRunStatus, channel: string | null = null) {
	const question: ReconcilerDecisionRecord | null =
		channel === null
			? null
			: {
					id: 'decision',
					eventId: 1,
					channel,
					chainId: 'chain',
					workstreamId: 'ws-1',
					facts: [],
					candidates: [],
					pick: null,
					chosen: 0,
					decidedBy: 'model',
					status: 'asking',
					detail: null,
					jobRunId: null,
					subjectRunId: 'run',
					createdAt: '2026-11-01T09:00:00.000Z',
					finishedAt: null,
				};
	return {
		key: 'entry',
		workstreamId: 'ws-1',
		question,
		run: {
			id: 'run',
			definitionId: 'job',
			title: 'Update from main',
			workstreamId: 'ws-1',
			repositoryId: null,
			scope: null,
			sessionId: null,
			agentRunId: null,
			origin: 'manual' as const,
			status,
			detail: null,
			parentRunId: null,
			chatSessionId: null,
			chatAfterRunId: null,
			chainId: 'chain',
			requests: 1,
			createdAt: '2026-11-01T09:00:00.000Z',
			startedAt: null,
			finishedAt: null,
		},
	};
}

describe('the jobs gutter summary', () => {
	it('counts what runs, waits in the queue and needs you', () => {
		expect(jobCenterSummary({ running: 2, queued: 1, needsYou: 1 })).toBe(
			'2 running, 1 queued, 1 needs you',
		);
		expect(jobCenterSummary({ running: 0, queued: 0, needsYou: 2 })).toBe('2 need you');
		expect(jobCenterSummary({ running: 0, queued: 0, needsYou: 0 })).toBe('ready when you are');
	});

	it('names why a job needs you in a few words', () => {
		expect(jobQuestionReason(entry('failed', 'jobs:run-finished'))).toBe('Failed');
		expect(jobQuestionReason(entry('succeeded', 'repositories:workstream-merge-conflicted'))).toBe(
			'Conflicts',
		);
		expect(jobQuestionReason(entry('waiting'))).toBe('Wants to run');
		expect(jobQuestionReason(entry('needs-you'))).toBe('Asks you');
	});
});
