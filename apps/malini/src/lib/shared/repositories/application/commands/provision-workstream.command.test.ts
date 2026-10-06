import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { gate, interceptCommand } from '$shared/repositories/application/provisioning.testkit';
import { toast } from '$hyper-ui/components/toast';
import { workstreamNativeExistenceQuery } from '$shared/repositories/application/queries/workstream-native-existence.query.svelte';
import { workstreamReadyForPromptsQuery } from '$shared/repositories/application/queries/workstream-ready-for-prompts.query.svelte';
import { worktreePendingQuery } from '$shared/repositories/application/queries/worktree-pending.query.svelte';
import { planWorkstreamProvisioning } from '$shared/repositories/domain/provisioning';
import type { Project, Repository } from '$shared/repositories/domain/repository';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { provisioningRetryStore } from '$shared/repositories/infrastructure/stores/provisioning-retry.store.svelte';
import { abandonWorkstreamProvisioningCommand } from './abandon-workstream-provisioning.command';
import { provisionWorkstreamCommand } from './provision-workstream.command';
import { retryProvisioningCommand } from './retry-provisioning.command';

const WORKSTREAM_ID = '01JPROVISIONTESTA';

const repo: Repository = {
	id: 'repo-1',
	fullName: 'rabbits/hutch',
	defaultBranch: 'main',
	localPath: null,
	remoteUrl: 'https://github.com/rabbits/hutch.git',
	createdAt: '2026-01-01T00:00:00.000Z',
};

const clonedProject: Project = {
	id: 'local__rabbits__hutch',
	name: 'rabbits__hutch',
	repoPath: '/tmp/base/rabbits__hutch',
	defaultBranch: 'main',
	remoteUrl: 'https://github.com/rabbits/hutch.git',
};

let platform: FakePlatform;

beforeEach(async () => {
	platform = createFakePlatform({ projects: [], workstreams: [] });
	setPlatformForTest(platform);
	workstreamsAggregate.reset();
	workstreamProvisioning.reset();
	provisioningRetryStore.reset();
	await workstreamsAggregate.refresh();
});

afterEach(() => {
	vi.restoreAllMocks();
	setPlatformForTest(null);
	workstreamsAggregate.reset();
	workstreamProvisioning.reset();
	provisioningRetryStore.reset();
});

function clonedPlan() {
	return planWorkstreamProvisioning({
		repo,
		projects: [clonedProject],
		workstreamId: WORKSTREAM_ID,
	});
}

function stage(plan: ReturnType<typeof clonedPlan>): void {
	workstreamsAggregate.stagePendingWorkstream({
		id: plan.workstreamId,
		projectId: plan.projectId,
		name: plan.name,
		path: '',
		branch: plan.branch,
		baseBranch: plan.baseBranch,
		status: 'active',
		checkoutState: 'unobserved',
		checkoutIssue: null,
		resolvedPath: null,
	});
}

function failCreateWorkstreamOnce(message: string): void {
	let failNext = true;
	interceptCommand(platform, 'repositories.create-workstream', () => {
		if (!failNext) return;
		failNext = false;
		throw new Error(message);
	});
}

function commands(): string[] {
	return platform.calls
		.map(({ command }) => command)
		.filter(
			(command) =>
				command.startsWith('repositories.') &&
				command !== 'repositories.list-workstreams' &&
				command !== 'repositories.list-repositories',
		);
}

function ids(): string[] {
	return workstreamsAggregate.workstreams.map((entry) => entry.id);
}

describe('provisioning a workstream', () => {
	it('clones, reports clone progress for its own repository only, then settles the row', async () => {
		const clone = gate<void>();
		interceptCommand(platform, 'repositories.create-repository', () => clone.promise);
		const plan = planWorkstreamProvisioning({ repo, projects: [], workstreamId: WORKSTREAM_ID });
		stage(plan);

		provisionWorkstreamCommand(plan);

		await vi.waitFor(() =>
			expect(workstreamProvisioning.get(WORKSTREAM_ID)).toMatchObject({
				phase: 'cloning',
				failure: null,
			}),
		);
		platform.emit('repositories:clone-progress', {
			repo_id: 'rabbits__hutch',
			stage: 'fetch',
			fraction: 0.5,
		});
		expect(workstreamProvisioning.get(WORKSTREAM_ID)?.clonePercent).toBe(50);
		platform.emit('repositories:clone-progress', {
			repo_id: 'someone-elses__repo',
			stage: 'fetch',
			fraction: 0.9,
		});
		expect(workstreamProvisioning.get(WORKSTREAM_ID)?.clonePercent).toBe(50);

		clone.resolve();
		await vi.waitFor(() => expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull());
		expect(platform.listenerCount('repositories:clone-progress')).toBe(0);
		expect(workstreamsAggregate.workstreams.find((entry) => entry.id === WORKSTREAM_ID)).toEqual({
			id: WORKSTREAM_ID,
			projectId: 'local__rabbits__hutch',
			name: 'Copper Voyage',
			path: `/tmp/malini/workstreams/${WORKSTREAM_ID}`,
			branch: `malini/${WORKSTREAM_ID}`,
			baseBranch: 'main',
			status: 'active',
			checkoutState: 'unobserved',
			checkoutIssue: null,
			resolvedPath: null,
		});
	});

	it('skips the clone when the repository is already cloned', async () => {
		const plan = clonedPlan();
		expect(plan.projectRepoPath).toBe('/tmp/base/rabbits__hutch');

		provisionWorkstreamCommand(plan);

		await vi.waitFor(() => expect(ids()).toContain(WORKSTREAM_ID));
		expect(platform.calls.map(({ command }) => command)).not.toContain(
			'repositories.create-repository',
		);
		expect(platform.calls).toContainEqual({
			command: 'repositories.create-workstream',
			args: {
				projectId: clonedProject.id,
				projectRepoPath: '/tmp/base/rabbits__hutch',
				workstreamId: WORKSTREAM_ID,
				name: 'Copper Voyage',
				baseBranch: 'main',
			},
		});
	});

	it('hands over the checkout before the base sync, and finishes setup after it', async () => {
		const sync = gate<void>();
		interceptCommand(platform, 'repositories.sync-workstream-base', () => sync.promise);
		const plan = clonedPlan();
		stage(plan);

		provisionWorkstreamCommand(plan);

		await vi.waitFor(() =>
			expect(workstreamProvisioning.get(WORKSTREAM_ID)?.phase).toBe('syncing'),
		);
		expect(workstreamsAggregate.workstreams.find((entry) => entry.id === WORKSTREAM_ID)?.path).toBe(
			`/tmp/malini/workstreams/${WORKSTREAM_ID}`,
		);
		expect(worktreePendingQuery.data(WORKSTREAM_ID)).toBe(false);
		expect(workstreamReadyForPromptsQuery.data(WORKSTREAM_ID)).toBe(false);
		expect(commands()).not.toContain('repositories.provision-dependencies');

		sync.resolve();

		await vi.waitFor(() => expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull());
		expect(workstreamReadyForPromptsQuery.data(WORKSTREAM_ID)).toBe(true);
		expect(commands()).toEqual([
			'repositories.create-workstream',
			'repositories.sync-workstream-base',
			'repositories.provision-dependencies',
		]);
	});

	it('warns when the base cannot be synced, and still finishes setup', async () => {
		const warning = vi.spyOn(toast, 'warning');
		interceptCommand(platform, 'repositories.sync-workstream-base', () => {
			throw new Error('ssh: Could not resolve hostname github.com');
		});
		const plan = clonedPlan();
		stage(plan);

		provisionWorkstreamCommand(plan);

		await vi.waitFor(() => expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull());
		expect(warning).toHaveBeenCalledWith(
			'Copper Voyage starts from the last fetched main · ssh: Could not resolve hostname github.com',
			{ context: { workstream: WORKSTREAM_ID } },
		);
		expect(commands()).toContain('repositories.provision-dependencies');
	});

	it('says quietly when the workstream keeps its own commits on the base it started from', async () => {
		const info = vi.spyOn(toast, 'info');
		platform.define('repositories.sync-workstream-base', () => 'diverged');
		const plan = clonedPlan();
		stage(plan);

		provisionWorkstreamCommand(plan);

		await vi.waitFor(() => expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull());
		expect(info).toHaveBeenCalledWith(
			'Copper Voyage already has its own commits, so it stays on the main it started from',
			{ context: { workstream: WORKSTREAM_ID } },
		);
	});

	it('stays silent when the base was already current or was brought up to date', async () => {
		const info = vi.spyOn(toast, 'info');
		const warning = vi.spyOn(toast, 'warning');
		platform.define('repositories.sync-workstream-base', () => 'advanced');
		const plan = clonedPlan();
		stage(plan);

		provisionWorkstreamCommand(plan);

		await vi.waitFor(() => expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull());
		expect(info).not.toHaveBeenCalled();
		expect(warning).not.toHaveBeenCalled();
	});

	it('does not sync a base it has just cloned', async () => {
		const plan = planWorkstreamProvisioning({ repo, projects: [], workstreamId: WORKSTREAM_ID });
		stage(plan);

		provisionWorkstreamCommand(plan);

		await vi.waitFor(() => expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull());
		expect(commands()).not.toContain('repositories.sync-workstream-base');
	});

	it('keeps the row and states the real failure, then recovers on retry', async () => {
		failCreateWorkstreamOnce('fatal: could not add worktree');
		const plan = clonedPlan();
		stage(plan);

		provisionWorkstreamCommand(plan);

		await vi.waitFor(() =>
			expect(workstreamProvisioning.get(WORKSTREAM_ID)).toMatchObject({
				phase: 'worktree',
				failure: 'fatal: could not add worktree',
			}),
		);
		expect(ids()).toContain(WORKSTREAM_ID);

		retryProvisioningCommand(WORKSTREAM_ID);

		await vi.waitFor(() => expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull());
		expect(workstreamsAggregate.workstreams.find((entry) => entry.id === WORKSTREAM_ID)?.path).toBe(
			`/tmp/malini/workstreams/${WORKSTREAM_ID}`,
		);
	});

	it('removes the staged row when a failed attempt is abandoned, leaving nothing to retry', async () => {
		interceptCommand(platform, 'repositories.create-workstream', () => {
			throw new Error('fatal: could not add worktree');
		});
		const plan = clonedPlan();
		stage(plan);
		provisionWorkstreamCommand(plan);
		await vi.waitFor(() => expect(workstreamProvisioning.get(WORKSTREAM_ID)?.failure).toBeTruthy());

		abandonWorkstreamProvisioningCommand(WORKSTREAM_ID);
		retryProvisioningCommand(WORKSTREAM_ID);

		expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull();
		expect(ids()).not.toContain(WORKSTREAM_ID);
		expect(provisioningRetryStore.isRetrying(WORKSTREAM_ID)).toBe(false);
	});

	it('classifies a workstream by whether the control plane already owns it', async () => {
		const worktree = gate<void>();
		let failNext = true;
		interceptCommand(platform, 'repositories.create-workstream', async () => {
			await worktree.promise;
			if (!failNext) return;
			failNext = false;
			throw new Error('fatal: could not add worktree');
		});
		const existence = workstreamNativeExistenceQuery.data;
		expect(existence(WORKSTREAM_ID)).toBe('platform');

		provisionWorkstreamCommand(clonedPlan());
		await vi.waitFor(() =>
			expect(workstreamProvisioning.get(WORKSTREAM_ID)?.phase).toBe('worktree'),
		);
		expect(existence(WORKSTREAM_ID)).toBe('in-flight');

		worktree.resolve();
		await vi.waitFor(() => expect(existence(WORKSTREAM_ID)).toBe('absent'));

		retryProvisioningCommand(WORKSTREAM_ID);
		await vi.waitFor(() => expect(existence(WORKSTREAM_ID)).toBe('platform'));
	});

	it('keeps a staged row visible across a native inventory refresh', async () => {
		const worktree = gate<void>();
		interceptCommand(platform, 'repositories.create-workstream', () => worktree.promise);
		const plan = clonedPlan();
		stage(plan);
		provisionWorkstreamCommand(plan);

		await workstreamsAggregate.refresh();
		expect(ids()).toContain(WORKSTREAM_ID);

		worktree.resolve();
		await vi.waitFor(() => expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull());
		await workstreamsAggregate.refresh();
		expect(ids().filter((id) => id === WORKSTREAM_ID)).toHaveLength(1);
	});
});
