import { derivedCommitMessage } from '@malini-extension/repository';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamSnapshotsService } from './workstream-snapshots.service';
import { workstreamsService } from './workstreams.service';

let platform: FakePlatform;

beforeEach(() => {
	platform = createFakePlatform();
	setPlatformForTest(platform);
});

afterEach(() => {
	setPlatformForTest(null);
	workstreamSnapshotsService.clear();
});

describe('workstream platform reads', () => {
	it('asks for the diff of one path of one workstream', async () => {
		await workstreamsService.diff('workstream-1', 'src/a.ts');

		expect(platform.calls).toEqual([
			{
				command: 'repositories.workstream-diff',
				args: { workstreamId: 'workstream-1', path: 'src/a.ts' },
			},
		]);
	});

	it('asks for one atomic snapshot per workstream and base branch', async () => {
		await workstreamSnapshotsService.get({ workstreamId: 'workstream-1', baseBranch: 'main' });
		await workstreamSnapshotsService.get({ workstreamId: 'workstream-1', baseBranch: 'main' });

		expect(platform.calls).toEqual([
			{
				command: 'repositories.workstream-snapshot',
				args: { workstreamId: 'workstream-1', baseBranch: 'main' },
			},
		]);
	});

	it('creates a workstream in the local scope and reports where its checkout lives', async () => {
		await expect(
			workstreamsService.createWorkstream({
				projectId: 'local__rabbits__hutch',
				projectRepoPath: '/tmp/hutch',
				workstreamId: 'ws-1',
				name: 'Copper Voyage',
				baseBranch: 'main',
			}),
		).resolves.toEqual({
			id: 'ws-1',
			projectId: 'local__rabbits__hutch',
			name: 'Copper Voyage',
			branch: 'malini/ws-1',
			baseBranch: 'main',
			worktreePath: '/tmp/malini/workstreams/ws-1',
		});
	});

	it('commits a checkpoint named after the changed paths', async () => {
		platform.seed({
			workstreamStatuses: {
				'ws-1': { branch: 'malini/ws-1', dirtyPaths: ['src/a.ts'], ahead: 0, behind: 0 },
			},
		});

		const checkpoint = await workstreamsService.commitCheckpoint('ws-1');

		expect(checkpoint.sha).toMatch(/^fake-commit-/u);
		expect(platform.calls.at(-1)).toEqual({
			command: 'repositories.commit-workstream',
			args: { workstreamId: 'ws-1', message: checkpoint.message },
		});
		expect(checkpoint.message).toBe(derivedCommitMessage({ changedPaths: ['src/a.ts'] }));
	});

	it('surfaces a rejected read unchanged', async () => {
		platform.define('repositories.workstream-status', () => {
			throw new Error('workstream scope mismatch');
		});

		await expect(workstreamsService.gitStatus('w')).rejects.toThrow('workstream scope mismatch');
	});
});
