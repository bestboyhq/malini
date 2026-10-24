import { afterEach, describe, expect, it } from 'vitest';
import type { JobRunRecord } from '$contract/jobs';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { activeJobRunsQuery } from './active-job-runs.query.svelte';
import { jobRunsForDefinitionQuery } from './job-runs-for-definition.query.svelte';
import { needsYouJobCountQuery } from './needs-you-job-count.query.svelte';
import { recentFinishedJobRunsQuery } from './recent-finished-job-runs.query.svelte';
import { runningJobCountQuery } from './running-job-count.query.svelte';
import { waitingForYouJobCountQuery } from './waiting-for-you-job-count.query.svelte';
import { workstreamJobRunsQuery } from './workstream-job-runs.query.svelte';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1_000;

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
		createdAt: '2026-10-11T11:00:00.000Z',
		startedAt: null,
		finishedAt: null,
		...patch,
	};
}

function hoursBefore(hours: number): string {
	return new Date(NOW - hours * HOUR_MS).toISOString();
}

function ids(runs: readonly JobRunRecord[]): string[] {
	return runs.map((entry) => entry.id);
}

afterEach(() => jobRunsAggregate.reset());

describe('the jobs in progress', () => {
	it('put the ones that need you first, then running, then queued in queue order', () => {
		jobRunsAggregate.runs = [
			run('queued-late', { status: 'queued', createdAt: hoursBefore(1) }),
			run('running', { status: 'running', createdAt: hoursBefore(3) }),
			run('done', { status: 'succeeded', finishedAt: hoursBefore(1) }),
			run('queued-early', { status: 'queued', createdAt: hoursBefore(2) }),
			run('needs-you', { status: 'needs-you', createdAt: hoursBefore(4) }),
		];

		expect(ids(activeJobRunsQuery.data)).toEqual([
			'needs-you',
			'running',
			'queued-early',
			'queued-late',
		]);
		expect(runningJobCountQuery.data).toBe(1);
		expect(needsYouJobCountQuery.data).toBe(1);
	});

	it('leave out the runs that wait for your yes, which still count as waiting for you', () => {
		jobRunsAggregate.runs = [
			run('waiting', { status: 'waiting' }),
			run('needs-you', { status: 'needs-you' }),
			run('running', { status: 'running' }),
		];

		expect(ids(activeJobRunsQuery.data)).toEqual(['needs-you', 'running']);
		expect(runningJobCountQuery.data).toBe(1);
		expect(waitingForYouJobCountQuery.data).toBe(2);
	});
});

describe('the recently finished jobs', () => {
	it('are the last 24 hours of finished jobs, newest first', () => {
		jobRunsAggregate.runs = [
			run('yesterday', { status: 'succeeded', finishedAt: hoursBefore(25) }),
			run('older', { status: 'failed', finishedAt: hoursBefore(5) }),
			run('running', { status: 'running' }),
			run('newer', { status: 'cancelled', finishedAt: hoursBefore(1) }),
		];

		expect(ids(recentFinishedJobRunsQuery.data(NOW))).toEqual(['newer', 'older']);
	});

	it('stop at ten', () => {
		jobRunsAggregate.runs = Array.from({ length: 12 }, (_, index) =>
			run(`done-${index}`, { status: 'succeeded', finishedAt: hoursBefore(index + 1) }),
		);

		const recent = recentFinishedJobRunsQuery.data(NOW);
		expect(recent).toHaveLength(10);
		expect(recent[0]?.id).toBe('done-0');
		expect(recent.at(-1)?.id).toBe('done-9');
	});
});

describe("a fresh chat's jobs", () => {
	it('are the runs of its workstream the composer tray does not hold: finished in the last ten minutes, or waiting for your yes', () => {
		jobRunsAggregate.runs = [
			run('queued', { status: 'queued' }),
			run('running', { status: 'running' }),
			run('needs-you', { status: 'needs-you' }),
			run('waiting', { status: 'waiting', createdAt: hoursBefore(0.25) }),
			run('done', {
				status: 'succeeded',
				createdAt: hoursBefore(0.2),
				finishedAt: hoursBefore(0.1),
			}),
			run('stale', { status: 'failed', finishedAt: hoursBefore(1) }),
			run('elsewhere', { status: 'cancelled', workstreamId: 'ws-2', finishedAt: hoursBefore(0.1) }),
		];

		expect(ids(workstreamJobRunsQuery.data('ws-1', NOW))).toEqual(['done', 'waiting']);
	});
});

describe("a job's runs", () => {
	it('are newest first by when they last changed, matching the time each one shows', () => {
		jobRunsAggregate.runs = [
			run('long', {
				status: 'succeeded',
				createdAt: hoursBefore(3),
				finishedAt: hoursBefore(1),
			}),
			run('quick', {
				status: 'succeeded',
				createdAt: hoursBefore(2),
				finishedAt: hoursBefore(1.5),
			}),
			run('started', {
				status: 'running',
				createdAt: hoursBefore(4),
				startedAt: hoursBefore(0.5),
			}),
		];

		expect(ids(jobRunsForDefinitionQuery.data('job-1'))).toEqual(['started', 'long', 'quick']);
	});
});

describe('a deleted job', () => {
	it('takes its finished runs with it', () => {
		jobRunsAggregate.runs = [
			run('kept', { status: 'succeeded', finishedAt: hoursBefore(1), definitionId: 'job-2' }),
			run('gone', { status: 'succeeded', finishedAt: hoursBefore(1), definitionId: 'job-1' }),
		];

		jobRunsAggregate.forgetDefinition('job-1');

		expect(ids(recentFinishedJobRunsQuery.data(NOW))).toEqual(['kept']);
	});
});
