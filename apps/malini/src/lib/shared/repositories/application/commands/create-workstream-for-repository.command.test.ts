import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { gate, interceptCommand } from '$shared/repositories/application/provisioning.testkit';
import type { Repository } from '$shared/repositories/domain/repository';
import { generatedWorkstreamName } from '$shared/repositories/domain/workstream-names';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { createWorkstreamForRepositoryCommand } from './create-workstream-for-repository.command';

const WORKSTREAM_ID = '01JCREATEFORREPOA';

const navigation = vi.hoisted(() => ({ goto: vi.fn(async (_href: string) => undefined) }));
const identity = vi.hoisted(() => ({ nextWorkstreamId: vi.fn(() => '') }));

vi.mock('$shared/router/navigation', () => navigation);

vi.mock(import('$shared/repositories/domain/project-identity'), async (importOriginal) => ({
	...(await importOriginal()),
	nextWorkstreamId: identity.nextWorkstreamId,
}));

const repo: Repository = {
	id: 'repo-1',
	fullName: 'rabbits/hutch',
	defaultBranch: 'main',
	localPath: null,
	remoteUrl: 'https://github.com/rabbits/hutch.git',
	createdAt: '2026-01-01T00:00:00.000Z',
};

let platform: FakePlatform;

beforeEach(async () => {
	navigation.goto.mockClear();
	identity.nextWorkstreamId.mockReset().mockReturnValue(WORKSTREAM_ID);
	platform = createFakePlatform({ projects: [], workstreams: [] });
	setPlatformForTest(platform);
	workstreamsAggregate.reset();
	workstreamProvisioning.reset();
	await workstreamsAggregate.refresh();
});

afterEach(() => {
	setPlatformForTest(null);
	workstreamsAggregate.reset();
	workstreamProvisioning.reset();
});

describe('creating a workstream for a repository', () => {
	it('names the new workstream apart from a workstream that already has its generated name', async () => {
		const existingName = generatedWorkstreamName(WORKSTREAM_ID);
		platform = createFakePlatform({
			projects: [],
			workstreams: [
				{
					id: '01JEXISTINGNAMEA',
					projectId: 'project-other',
					name: existingName,
					path: '/tmp/existing',
					branch: 'malini/existing',
					baseBranch: 'main',
					status: 'active',
				},
			],
		});
		setPlatformForTest(platform);
		await workstreamsAggregate.refresh();

		createWorkstreamForRepositoryCommand(repo);

		const created = workstreamsAggregate.workstreams.find((entry) => entry.id === WORKSTREAM_ID);
		expect(created?.name).toBeTruthy();
		expect(created?.name).not.toBe(existingName);
	});

	it('shows and navigates to the staged workstream before any scaffolding is awaited', async () => {
		const order: string[] = [];
		const clone = gate<void>();
		const worktree = gate<void>();
		navigation.goto.mockImplementation(async (href) => {
			order.push(`navigate:${href}`);
		});
		interceptCommand(platform, 'repositories.create-repository', async () => {
			order.push('clone');
			await clone.promise;
		});
		interceptCommand(platform, 'repositories.create-workstream', async () => {
			order.push('worktree');
			await worktree.promise;
		});

		createWorkstreamForRepositoryCommand(repo);

		expect(workstreamsAggregate.workstreams.map((entry) => entry.id)).toContain(WORKSTREAM_ID);
		expect(workstreamProvisioning.get(WORKSTREAM_ID)?.phase).toBe('preparing');
		await vi.waitFor(() =>
			expect(order).toEqual([`navigate:/workstreams/${WORKSTREAM_ID}`, 'clone']),
		);

		clone.resolve();
		await vi.waitFor(() => expect(order.at(-1)).toBe('worktree'));
		expect(workstreamProvisioning.get(WORKSTREAM_ID)?.phase).toBe('worktree');

		worktree.resolve();
		await vi.waitFor(() => expect(workstreamProvisioning.get(WORKSTREAM_ID)).toBeNull());
	});

	it('ignores a second request while the first attempt for the repository has not started', () => {
		identity.nextWorkstreamId
			.mockReturnValueOnce('01JFIRSTATTEMPTA')
			.mockReturnValueOnce('01JSECONDATTEMPT');

		createWorkstreamForRepositoryCommand(repo);
		createWorkstreamForRepositoryCommand(repo);

		expect(Object.keys(workstreamProvisioning.records)).toEqual(['01JFIRSTATTEMPTA']);
	});
});
