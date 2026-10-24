import { describe, expect, it } from 'vitest';
import type { JobRunRecord } from '$contract/jobs';
import { jobRunTime } from './job-run-time';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');

function run(patch: Partial<JobRunRecord>): JobRunRecord {
	return {
		id: 'run-1',
		definitionId: 'job-1',
		title: 'Fix checks',
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
		createdAt: '2026-10-11T11:00:00.000Z',
		startedAt: null,
		finishedAt: null,
		...patch,
	};
}

function secondsBefore(seconds: number): string {
	return new Date(NOW - seconds * 1_000).toISOString();
}

describe('the time a job row shows', () => {
	it('counts up while the job runs', () => {
		expect(jobRunTime(run({ status: 'running', startedAt: secondsBefore(42) }), NOW)).toBe('42s');
		expect(jobRunTime(run({ status: 'running', startedAt: secondsBefore(130) }), NOW)).toBe(
			'2m 10s',
		);
		expect(jobRunTime(run({ status: 'running', startedAt: secondsBefore(3_900) }), NOW)).toBe(
			'1h 5m',
		);
	});

	it('says how long ago a finished job ended', () => {
		expect(jobRunTime(run({ status: 'succeeded', finishedAt: secondsBefore(10) }), NOW)).toBe(
			'just now',
		);
		expect(jobRunTime(run({ status: 'failed', finishedAt: secondsBefore(240) }), NOW)).toBe(
			'4m ago',
		);
		expect(jobRunTime(run({ status: 'cancelled', finishedAt: secondsBefore(7_300) }), NOW)).toBe(
			'2h ago',
		);
	});

	it('dates a queued job from when it was queued', () => {
		expect(jobRunTime(run({ status: 'queued', createdAt: secondsBefore(60) }), NOW)).toBe('1m ago');
	});

	it('never shows a negative time when the clock lags the event', () => {
		expect(jobRunTime(run({ status: 'running', startedAt: secondsBefore(-5) }), NOW)).toBe('0s');
		expect(jobRunTime(run({ status: 'succeeded', finishedAt: secondsBefore(-5) }), NOW)).toBe(
			'just now',
		);
	});
});
