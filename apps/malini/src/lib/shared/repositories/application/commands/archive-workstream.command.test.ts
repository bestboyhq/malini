import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '$hyper-ui/components/toast';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { gate, interceptCommand } from '$shared/repositories/application/provisioning.testkit';
import {
	planWorkstreamProvisioning,
	type WorkstreamProvisioningPlan,
	type WorkstreamSetupOutcome,
} from '$shared/repositories/domain/provisioning';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { workstreamSetupEvents } from '$shared/repositories/infrastructure/services/workstream-setup-events.service';
import { archiveWorkstreamCommand } from './archive-workstream.command';
import { deleteWorkstreamCommand } from './delete-workstream.command';
import { provisionWorkstreamCommand } from './provision-workstream.command';
import { restoreWorkstreamCommand } from './restore-workstream.command';

const router = vi.hoisted(() => ({
	goto: vi.fn(async (_href: string) => undefined),
	params: { workstreamId: undefined as string | undefined },
}));

vi.mock('$shared/router/navigation', () => ({ goto: router.goto }));
vi.mock('$shared/router/state', () => ({
	page: {
		get params() {
			return router.params;
		},
	},
}));

let platform: FakePlatform;
const stopFollowing: Array<() => void> = [];
const announce = vi.fn((_action: 'archived' | 'deleted', _workstreamId: string) => undefined);

beforeEach(async () => {
	vi.useFakeTimers();
	router.goto.mockClear();
	router.params = { workstreamId: undefined };
	announce.mockClear();
	platform = createFakePlatform({
		projects: [{ id: 'project', name: 'hutch', repoPath: '/tmp/hutch', defaultBranch: 'main' }],
		workstreams: [fakeWorkstream('ws-a'), fakeWorkstream('ws-b')],
	});
	setPlatformForTest(platform);
	workstreamsAggregate.reset();
	workstreamProvisioning.reset();
	await workstreamsAggregate.refresh();
});

afterEach(async () => {
	for (const stop of stopFollowing.splice(0)) stop();
	await vi.runAllTimersAsync();
	vi.useRealTimers();
	vi.restoreAllMocks();
	setPlatformForTest(null);
	workstreamsAggregate.reset();
	workstreamProvisioning.reset();
});

function fakeWorkstream(id: string) {
	return {
		id,
		projectId: 'project',
		name: id,
		path: `/tmp/worktrees/${id}`,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active' as const,
	};
}

function workstream(id: string): Workstream {
	const found = workstreamsAggregate.workstreams.find((entry) => entry.id === id);
	if (!found) throw new Error(`missing workstream ${id}`);
	return found;
}

function ids(): string[] {
	return workstreamsAggregate.workstreams.map((entry) => entry.id);
}

function syncOutcomes(outcomes: readonly ('cancelled' | 'current')[]): {
	release: () => void;
	count: () => number;
} {
	const first = gate<void>();
	let calls = 0;
	platform.define('repositories.sync-workstream-base', async () => {
		calls += 1;
		if (calls === 1) await first.promise;
		return outcomes[Math.min(calls, outcomes.length) - 1] ?? 'current';
	});
	return { release: () => first.resolve(), count: () => calls };
}

function commandCalls(name: string): number {
	return platform.calls.filter(({ command }) => command === name).length;
}

function followSetupOutcomes(): WorkstreamSetupOutcome[] {
	const outcomes: WorkstreamSetupOutcome[] = [];
	const stop = workstreamSetupEvents.onSettled((outcome) => outcomes.push(outcome));
	stopFollowing.push(stop);
	return outcomes;
}

function stageClonedSetup(workstreamId: string): WorkstreamProvisioningPlan {
	const plan = planWorkstreamProvisioning({
		repo: {
			fullName: 'rabbits/hutch',
			defaultBranch: 'main',
			remoteUrl: 'https://github.com/rabbits/hutch.git',
			localPath: '/tmp/hutch',
		},
		projects: [
			{ id: 'local__rabbits__hutch', name: 'hutch', repoPath: '/tmp/hutch', defaultBranch: 'main' },
		],
		workstreamId,
	});
	workstreamsAggregate.stagePendingWorkstream({ ...workstream('ws-b'), id: workstreamId });
	return plan;
}

function archiveCalls(): number {
	return platform.calls.filter(({ command }) => command === 'repositories.archive-workstream')
		.length;
}

describe('archiving a workstream', () => {
	it('hides the row at once, archives and announces it without a toast', async () => {
		const info = vi.spyOn(toast, 'info');

		archiveWorkstreamCommand(workstream('ws-a'), announce);

		expect(ids()).toEqual(['ws-b']);
		await vi.advanceTimersByTimeAsync(0);
		expect(platform.calls).toContainEqual({
			command: 'repositories.archive-workstream',
			args: { workstreamId: 'ws-a' },
		});
		expect(announce).toHaveBeenCalledWith('archived', 'ws-a');
		await workstreamsAggregate.refresh();
		expect(ids()).toEqual(['ws-b']);
		expect(workstreamsAggregate.archived.map((entry) => entry.id)).toEqual(['ws-a']);
		expect(info).not.toHaveBeenCalled();
	});

	it('restores an archived workstream to the list, opens it and installs its dependencies', async () => {
		archiveWorkstreamCommand(workstream('ws-a'), announce);
		await vi.advanceTimersByTimeAsync(0);
		await workstreamsAggregate.refresh();

		restoreWorkstreamCommand('ws-a');
		await vi.advanceTimersByTimeAsync(0);

		expect(platform.calls).toContainEqual({
			command: 'repositories.restore-workstream',
			args: { workstreamId: 'ws-a' },
		});
		expect(ids()).toContain('ws-a');
		expect(workstreamsAggregate.archived).toEqual([]);
		expect(router.goto).toHaveBeenCalledWith('/workstreams/ws-a');
		expect(commandCalls('repositories.provision-dependencies')).toBe(1);
	});

	it('keeps a workstream archived and says why when it cannot be restored', async () => {
		const error = vi.spyOn(toast, 'error');
		platform.define('repositories.restore-workstream', () => {
			throw new Error('Its repository is no longer on this Mac');
		});
		archiveWorkstreamCommand(workstream('ws-a'), announce);
		await vi.advanceTimersByTimeAsync(0);
		await workstreamsAggregate.refresh();

		restoreWorkstreamCommand('ws-a');
		await vi.advanceTimersByTimeAsync(0);

		expect(error).toHaveBeenCalledWith(
			'Could not restore ws-a · Its repository is no longer on this Mac.',
			{ context: { workstream: 'ws-a' } },
		);
		expect(ids()).not.toContain('ws-a');
		expect(workstreamsAggregate.archived.map((entry) => entry.id)).toEqual(['ws-a']);
		expect(router.goto).not.toHaveBeenCalled();
	});

	it('brings the row back and says, in plain words and about that workstream, why the archive failed', async () => {
		const error = vi.spyOn(toast, 'error');
		platform.define('repositories.archive-workstream', () => {
			throw new Error(
				'Saving its local work failed (git refused an ignored path), so nothing was removed',
			);
		});

		archiveWorkstreamCommand(workstream('ws-a'), announce);
		await vi.advanceTimersByTimeAsync(0);

		expect(error).toHaveBeenCalledWith(
			'Could not archive ws-a · Saving its local work failed (git refused an ignored path), so nothing was removed.',
			{ context: { workstream: 'ws-a' } },
		);
		expect(ids()).toContain('ws-a');
		expect(announce).not.toHaveBeenCalled();
	});

	it('says why the archive failed when the platform reports the reason as plain text', async () => {
		const error = vi.spyOn(toast, 'error');
		const reason =
			'Its checkout could not be moved aside (permission denied), so nothing was removed';
		platform.define('repositories.archive-workstream', () => Promise.reject(reason));

		archiveWorkstreamCommand(workstream('ws-a'), announce);
		await vi.advanceTimersByTimeAsync(0);

		expect(error).toHaveBeenCalledWith(`Could not archive ws-a · ${reason}.`, {
			context: { workstream: 'ws-a' },
		});
		expect(ids()).toContain('ws-a');
	});

	it('names the workstream a failed delete kept, and says nothing was removed', async () => {
		const error = vi.spyOn(toast, 'error');
		platform.define('repositories.delete-workstream', () => {
			throw new Error('An agent is still running in it, so nothing was removed');
		});

		deleteWorkstreamCommand('ws-b');
		await vi.advanceTimersByTimeAsync(0);

		expect(error).toHaveBeenCalledWith(
			'Could not delete ws-b · An agent is still running in it, so nothing was removed.',
			{ context: { workstream: 'ws-b' } },
		);
		expect(ids()).toContain('ws-b');
	});

	it('says nothing when the archive saved work of its own', async () => {
		const info = vi.spyOn(toast, 'info');
		platform.define('repositories.archive-workstream', () => ({
			savedWork: { ref: 'refs/malini/archived/ws-a', uncommitted: true, commits: 2 },
		}));

		archiveWorkstreamCommand(workstream('ws-a'), announce);
		await vi.advanceTimersByTimeAsync(0);

		expect(info).not.toHaveBeenCalled();
	});

	it('answers a second request while the first is in flight by doing nothing', async () => {
		const first = workstream('ws-a');

		archiveWorkstreamCommand(first, announce);
		archiveWorkstreamCommand(first, announce);
		await vi.advanceTimersByTimeAsync(0);

		expect(archiveCalls()).toBe(1);
	});

	it('switches from the active workstream to the next one on the list', async () => {
		router.params = { workstreamId: 'ws-a' };

		archiveWorkstreamCommand(workstream('ws-a'), announce);
		await vi.advanceTimersByTimeAsync(0);

		expect(router.goto).toHaveBeenCalledWith('/workstreams/ws-b');
	});

	it('switches to the one above when the active workstream is last on the list', async () => {
		router.params = { workstreamId: 'ws-b' };

		archiveWorkstreamCommand(workstream('ws-b'), announce);
		await vi.advanceTimersByTimeAsync(0);

		expect(router.goto).toHaveBeenCalledWith('/workstreams/ws-a');
	});

	it('leaves the last workstream on the list for the repositories list', async () => {
		archiveWorkstreamCommand(workstream('ws-b'), announce);
		await vi.advanceTimersByTimeAsync(0);
		router.params = { workstreamId: 'ws-a' };

		archiveWorkstreamCommand(workstream('ws-a'), announce);
		await vi.advanceTimersByTimeAsync(0);

		expect(router.goto).toHaveBeenCalledWith('/');
	});

	it('stays put when archiving a workstream other than the active one', async () => {
		router.params = { workstreamId: 'ws-b' };

		archiveWorkstreamCommand(workstream('ws-a'), announce);
		await vi.advanceTimersByTimeAsync(0);

		expect(router.goto).not.toHaveBeenCalled();
	});

	it('discards a failed setup locally instead of asking the platform to archive it', async () => {
		interceptCommand(platform, 'repositories.create-workstream', () => {
			throw new Error('fatal: could not add worktree');
		});
		const plan = planWorkstreamProvisioning({
			repo: {
				fullName: 'rabbits/hutch',
				defaultBranch: 'main',
				remoteUrl: 'https://github.com/rabbits/hutch.git',
				localPath: '/tmp/hutch',
			},
			projects: [],
			workstreamId: 'ws-failed',
		});
		workstreamsAggregate.stagePendingWorkstream({ ...workstream('ws-b'), id: 'ws-failed' });
		provisionWorkstreamCommand(plan);
		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-failed')?.failure).toBeTruthy());
		const info = vi.spyOn(toast, 'info');

		archiveWorkstreamCommand(workstream('ws-failed'), announce);

		expect(workstreamProvisioning.get('ws-failed')).toBeNull();
		expect(ids()).not.toContain('ws-failed');
		await vi.advanceTimersByTimeAsync(0);
		expect(archiveCalls()).toBe(0);
		expect(info).not.toHaveBeenCalled();
	});

	it('archives a new workstream whose checkout exists while its base still syncs', async () => {
		const sync = gate<void>();
		interceptCommand(platform, 'repositories.sync-workstream-base', () => sync.promise);
		const plan = planWorkstreamProvisioning({
			repo: {
				fullName: 'rabbits/hutch',
				defaultBranch: 'main',
				remoteUrl: 'https://github.com/rabbits/hutch.git',
				localPath: '/tmp/hutch',
			},
			projects: [
				{
					id: 'local__rabbits__hutch',
					name: 'hutch',
					repoPath: '/tmp/hutch',
					defaultBranch: 'main',
				},
			],
			workstreamId: 'ws-new',
		});
		workstreamsAggregate.stagePendingWorkstream({ ...workstream('ws-b'), id: 'ws-new' });
		provisionWorkstreamCommand(plan);
		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-new')?.phase).toBe('syncing'));

		archiveWorkstreamCommand(workstream('ws-new'), announce);

		expect(ids()).not.toContain('ws-new');
		sync.resolve();
		await vi.advanceTimersByTimeAsync(0);
		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-new')).toBeNull());
		expect(archiveCalls()).toBe(1);
		expect(ids()).not.toContain('ws-new');
	});

	it('drops a setup archived during its base sync: no warning, no settle, no install', async () => {
		const warning = vi.spyOn(toast, 'warning');
		const outcomes = followSetupOutcomes();
		const sync = gate<void>();
		interceptCommand(platform, 'repositories.sync-workstream-base', async () => {
			await sync.promise;
			throw new Error('ssh: Could not resolve hostname github.com');
		});
		provisionWorkstreamCommand(stageClonedSetup('ws-new'));
		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-new')?.phase).toBe('syncing'));

		archiveWorkstreamCommand(workstream('ws-new'), announce);
		sync.resolve();
		await vi.advanceTimersByTimeAsync(0);

		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-new')).toBeNull());
		expect(archiveCalls()).toBe(1);
		expect(warning).not.toHaveBeenCalled();
		expect(commandCalls('repositories.provision-dependencies')).toBe(0);
		expect(outcomes).toEqual([{ workstreamId: 'ws-new', status: 'abandoned' }]);
	});

	it('drops a setup whose workstream is deleted during its base sync, never announcing ready', async () => {
		const outcomes = followSetupOutcomes();
		const syncs = syncOutcomes(['cancelled', 'current']);
		const deletion = gate<void>();
		interceptCommand(platform, 'repositories.delete-workstream', () => deletion.promise);
		provisionWorkstreamCommand(stageClonedSetup('ws-new'));
		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-new')?.phase).toBe('syncing'));

		deleteWorkstreamCommand('ws-new');
		syncs.release();
		await vi.advanceTimersByTimeAsync(0);
		expect(outcomes).toEqual([]);
		deletion.resolve();

		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-new')).toBeNull());
		expect(outcomes).toEqual([{ workstreamId: 'ws-new', status: 'abandoned' }]);
		expect(syncs.count()).toBe(1);
		expect(commandCalls('repositories.provision-dependencies')).toBe(0);
	});

	it('finishes the setup of a workstream whose archive failed during its base sync', async () => {
		const outcomes = followSetupOutcomes();
		const syncs = syncOutcomes(['cancelled', 'current']);
		const archiving = gate<void>();
		platform.define('repositories.archive-workstream', async () => {
			await archiving.promise;
			throw new Error('worktree is locked');
		});
		provisionWorkstreamCommand(stageClonedSetup('ws-new'));
		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-new')?.phase).toBe('syncing'));

		archiveWorkstreamCommand(workstream('ws-new'), announce);
		await vi.advanceTimersByTimeAsync(0);
		syncs.release();
		await vi.advanceTimersByTimeAsync(0);
		expect(outcomes).toEqual([]);
		archiving.resolve();

		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-new')).toBeNull());
		expect(outcomes).toEqual([{ workstreamId: 'ws-new', status: 'ready' }]);
		expect(syncs.count()).toBe(2);
		expect(ids()).toContain('ws-new');
		expect(commandCalls('repositories.provision-dependencies')).toBe(1);
	});

	it('refuses to archive a workstream whose worktree call is still running', async () => {
		const worktree = gate<void>();
		interceptCommand(platform, 'repositories.create-workstream', () => worktree.promise);
		const plan = planWorkstreamProvisioning({
			repo: {
				fullName: 'rabbits/hutch',
				defaultBranch: 'main',
				remoteUrl: 'https://github.com/rabbits/hutch.git',
				localPath: '/tmp/hutch',
			},
			projects: [
				{
					id: 'local__rabbits__hutch',
					name: 'hutch',
					repoPath: '/tmp/hutch',
					defaultBranch: 'main',
				},
			],
			workstreamId: 'ws-new',
		});
		workstreamsAggregate.stagePendingWorkstream({ ...workstream('ws-b'), id: 'ws-new' });
		provisionWorkstreamCommand(plan);
		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-new')?.phase).toBe('worktree'));

		const info = vi.spyOn(toast, 'info');

		archiveWorkstreamCommand(workstream('ws-new'), announce);

		expect(workstreamProvisioning.get('ws-new')).not.toBeNull();
		expect(ids()).toContain('ws-new');
		worktree.resolve();
		await vi.waitFor(() => expect(workstreamProvisioning.get('ws-new')).toBeNull());
		await vi.advanceTimersByTimeAsync(0);
		expect(archiveCalls()).toBe(0);
		expect(info).not.toHaveBeenCalled();
	});
});
