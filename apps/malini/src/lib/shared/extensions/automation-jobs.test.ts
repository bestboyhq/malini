import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobRunRecord, JobRunStatus } from '$contract/jobs';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { createPlatformRoutineJobRunner } from './automation-jobs';

let fake: FakePlatform;

afterEach(() => setPlatformForTest(null));

function startedRun(): JobRunRecord {
	const call = fake.calls.find(({ command }) => command === 'jobs.run');
	if (!call) throw new Error('no job was started');
	return {
		id: 'fake-job-run-1',
		definitionId: 'fake-job-fix-checks',
		title: 'Fix checks',
		workstreamId: 'workstream-1',
		repositoryId: null,
		sessionId: null,
		agentRunId: null,
		origin: 'routine',
		status: 'queued',
		detail: null,
		createdAt: '2026-01-01T00:00:02.000Z',
		startedAt: null,
		finishedAt: null,
	};
}

function settle(status: JobRunStatus, detail: string | null = null): void {
	fake.emit('jobs:run-changed', { run: { ...startedRun(), status, detail } });
}

async function start(
	signal = new AbortController().signal,
): Promise<Readonly<{ run: Promise<void> }>> {
	fake = createFakePlatform();
	setPlatformForTest(fake);
	const run = createPlatformRoutineJobRunner().run('fake-job-fix-checks', 'workstream-1', signal);
	run.catch(() => {});
	await vi.waitFor(() => startedRun());
	return { run };
}

describe('the routine job runner', () => {
	it('starts the job for the routine and waits past needs-you until it succeeds', async () => {
		const { run } = await start();
		expect(fake.calls.find(({ command }) => command === 'jobs.run')?.args).toEqual({
			definitionId: 'fake-job-fix-checks',
			workstreamId: 'workstream-1',
			origin: 'routine',
		});
		let finished = false;
		void (async () => {
			await run;
			finished = true;
		})();
		settle('running');
		settle('needs-you');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(finished).toBe(false);

		settle('succeeded');
		await expect(run).resolves.toBeUndefined();
		expect(fake.listenerCount('jobs:run-changed')).toBe(0);
	});

	it('fails with the job outcome when the job fails or is cancelled', async () => {
		const { run: failed } = await start();
		settle('failed', 'the tests are still red');
		await expect(failed).rejects.toThrow('Job “Fix checks” failed: the tests are still red');

		const { run: cancelled } = await start();
		settle('cancelled');
		await expect(cancelled).rejects.toThrow('Job “Fix checks” was cancelled');
	});

	it('stops waiting when the routine is aborted', async () => {
		const controller = new AbortController();
		const { run } = await start(controller.signal);
		controller.abort(new Error('routine stopped'));
		await expect(run).rejects.toThrow('routine stopped');
		expect(fake.listenerCount('jobs:run-changed')).toBe(0);
	});
});
