import { afterEach, describe, expect, it } from 'vitest';
import type { JobRunRecord, ReconcilerDecisionRecord } from '$contract/jobs';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { reconcilerDecisionsAggregate } from '$lib/jobs/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';
import { jobCenterEntriesQuery } from './job-center-entries.query.svelte';
import { jobRunsForDefinitionQuery } from './job-runs-for-definition.query.svelte';
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
		chainId: id,
		requests: 1,
		createdAt: '2026-10-11T11:00:00.000Z',
		startedAt: null,
		finishedAt: null,
		...patch,
	};
}

function decision(
	id: string,
	status: ReconcilerDecisionRecord['status'],
): ReconcilerDecisionRecord {
	return {
		id,
		eventId: 1,
		channel: 'chat:turn-finished',
		chainId: 'chain',
		workstreamId: 'ws-1',
		facts: [],
		candidates: [{ kind: 'nothing', label: 'Do nothing' }],
		pick: 0,
		chosen: 0,
		decidedBy: 'model',
		status,
		detail: null,
		jobRunId: null,
		subjectRunId: null,
		createdAt: '2026-10-11T11:00:00.000Z',
		finishedAt: null,
	};
}

function hoursBefore(hours: number): string {
	return new Date(NOW - hours * HOUR_MS).toISOString();
}

function ids(runs: readonly JobRunRecord[]): string[] {
	return runs.map((entry) => entry.id);
}

afterEach(() => {
	jobRunsAggregate.reset();
	reconcilerDecisionsAggregate.decisions = [];
});

describe('the jobs gutter', () => {
	it('holds the live runs and what the event reconciler asks, on the job it asks about', () => {
		jobRunsAggregate.runs = [
			run('failed', { status: 'failed', finishedAt: hoursBefore(1) }),
			run('running', { status: 'running' }),
		];
		reconcilerDecisionsAggregate.decisions = [
			{ ...decision('asking', 'asking'), subjectRunId: 'failed' },
			decision('done', 'done'),
		];

		expect(jobCenterEntriesQuery.data.map((entry) => [entry.key, entry.run?.id])).toEqual([
			['asking', 'failed'],
			['running', 'running'],
		]);
	});
});

describe("a fresh chat's jobs", () => {
	it('are the runs of its workstream the composer tray does not hold: finished in the last ten minutes', () => {
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

		expect(ids(workstreamJobRunsQuery.data('ws-1', NOW))).toEqual(['done']);
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

		expect(ids(jobRunsForDefinitionQuery.data('job-1'))).toEqual([]);
		expect(ids(jobRunsForDefinitionQuery.data('job-2'))).toEqual(['kept']);
	});
});
