import { beforeEach, describe, expect, it } from 'vitest';
import {
	provisioningClonePercent,
	type WorkstreamProvisioningPlan,
} from '$shared/repositories/domain/provisioning';
import { WorkstreamProvisioningAggregate } from './workstream-provisioning.aggregate.svelte';

function plan(overrides: Partial<WorkstreamProvisioningPlan> = {}): WorkstreamProvisioningPlan {
	return {
		workstreamId: '01JWORKSTREAMA',
		projectId: 'local__rabbits__hutch',
		projectRepoPath: null,
		cloneProgressId: 'rabbits__hutch',
		repoUrl: 'https://github.com/rabbits/hutch.git',
		repositoryFullName: 'rabbits/hutch',
		name: 'Signal Arc',
		branch: 'malini/01JWORKSTREAMA',
		baseBranch: 'main',
		...overrides,
	};
}

describe('WorkstreamProvisioningAggregate', () => {
	let aggregate: WorkstreamProvisioningAggregate;

	beforeEach(() => {
		aggregate = new WorkstreamProvisioningAggregate();
	});

	it('walks preparing, cloning, and worktree while the worktree is still missing', () => {
		aggregate.begin(plan());

		expect(aggregate.get('01JWORKSTREAMA')?.phase).toBe('preparing');
		expect(aggregate.hasPendingWorktree('01JWORKSTREAMA')).toBe(true);
		expect(aggregate.isProvisioning('01JWORKSTREAMA')).toBe(true);
		expect(aggregate.isFailed('01JWORKSTREAMA')).toBe(false);

		aggregate.advance('01JWORKSTREAMA', 'cloning');
		aggregate.reportCloneProgress('01JWORKSTREAMA', 0.4237);
		expect(aggregate.get('01JWORKSTREAMA')).toMatchObject({
			phase: 'cloning',
			clonePercent: 42,
			failure: null,
		});

		aggregate.advance('01JWORKSTREAMA', 'worktree');
		expect(aggregate.get('01JWORKSTREAMA')?.phase).toBe('worktree');

		aggregate.settle('01JWORKSTREAMA');
		expect(aggregate.get('01JWORKSTREAMA')).toBeNull();
		expect(aggregate.hasPendingWorktree('01JWORKSTREAMA')).toBe(false);
		expect(aggregate.isProvisioning('01JWORKSTREAMA')).toBe(false);
	});

	it('has its worktree while it syncs the base, though setup is still running', () => {
		aggregate.begin(plan());
		aggregate.advance('01JWORKSTREAMA', 'worktree');
		expect(aggregate.hasPendingWorktree('01JWORKSTREAMA')).toBe(true);

		aggregate.advance('01JWORKSTREAMA', 'syncing');

		expect(aggregate.hasPendingWorktree('01JWORKSTREAMA')).toBe(false);
		expect(aggregate.isProvisioning('01JWORKSTREAMA')).toBe(true);
		expect(aggregate.get('01JWORKSTREAMA')?.phase).toBe('syncing');
	});

	it('keeps a failed attempt addressable so the destination can retry it', () => {
		aggregate.begin(plan());
		aggregate.advance('01JWORKSTREAMA', 'cloning');
		aggregate.fail('01JWORKSTREAMA', 'remote: Repository not found');

		expect(aggregate.get('01JWORKSTREAMA')).toMatchObject({
			phase: 'cloning',
			failure: 'remote: Repository not found',
		});
		expect(aggregate.hasPendingWorktree('01JWORKSTREAMA')).toBe(true);
		expect(aggregate.isProvisioning('01JWORKSTREAMA')).toBe(false);
		expect(aggregate.isFailed('01JWORKSTREAMA')).toBe(true);

		const startedAt = aggregate.get('01JWORKSTREAMA')?.startedAt;
		aggregate.begin(plan());
		expect(aggregate.get('01JWORKSTREAMA')).toMatchObject({
			phase: 'preparing',
			failure: null,
			clonePercent: null,
			startedAt,
		});
		expect(aggregate.isFailed('01JWORKSTREAMA')).toBe(false);
	});

	it('remembers a resolved base clone so a retry skips the clone phase', () => {
		aggregate.begin(plan());
		aggregate.resolveProjectRepoPath('01JWORKSTREAMA', '/tmp/base/hutch');

		expect(aggregate.get('01JWORKSTREAMA')?.plan.projectRepoPath).toBe('/tmp/base/hutch');
	});

	it('ignores transitions for an attempt that already settled', () => {
		aggregate.advance('01JWORKSTREAMA', 'cloning');
		aggregate.fail('01JWORKSTREAMA', 'nope');
		aggregate.reportCloneProgress('01JWORKSTREAMA', 0.5);

		expect(aggregate.get('01JWORKSTREAMA')).toBeNull();
	});

	it('treats a second unstarted attempt on the same repository as a double submit', () => {
		aggregate.begin(plan());
		expect(aggregate.hasUnstartedAttemptForProject('local__rabbits__hutch')).toBe(true);
		expect(aggregate.hasUnstartedAttemptForProject('local__other__repo')).toBe(false);

		aggregate.advance('01JWORKSTREAMA', 'cloning');
		expect(aggregate.hasUnstartedAttemptForProject('local__rabbits__hutch')).toBe(false);
	});

	it('discards an abandoned attempt and forgets every id on reset', () => {
		aggregate.begin(plan());
		aggregate.begin(plan({ workstreamId: '01JWORKSTREAMB' }));
		aggregate.discard('01JWORKSTREAMA');

		expect(aggregate.listPending().map((record) => record.plan.workstreamId)).toEqual([
			'01JWORKSTREAMB',
		]);

		aggregate.reset();
		expect(aggregate.listPending()).toEqual([]);
	});

	it('clamps clone fractions into whole percent', () => {
		expect(provisioningClonePercent(Number.NaN)).toBe(0);
		expect(provisioningClonePercent(-1)).toBe(0);
		expect(provisioningClonePercent(0.005)).toBe(1);
		expect(provisioningClonePercent(1.7)).toBe(100);
	});
});
