import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	type ExtensionPullRequestContext,
	type ExtensionRepositoryStatus,
	EXTENSION_EVENTS,
} from '@malini/extension-api';
import { createTestHost } from '@malini/extension-api/test';
import {
	RepositoryController,
	repositorySurfaceState,
	type RepositoryControllerHost,
	type RepositoryViewState,
} from '../src/controller.js';
import extension from '../src/index.js';

const manifest: unknown = JSON.parse(await readFile('manifest.json', 'utf8'));

async function conflictHost(status: Partial<ExtensionRepositoryStatus>) {
	return createTestHost({
		manifest,
		now: 1_000,
		fixtureRepository: {
			name: 'conflict-signal',
			branch: 'malini/ws-1',
			baseBranch: 'main',
			files: { 'shared.txt': 'ours\n' },
		},
		repository: { status },
	});
}

test('carries local conflict, merge progress and upstream state onto the surface', async () => {
	const host = await conflictHost({
		branch: 'malini/ws-1',
		baseBranch: 'main',
		dirtyPaths: ['shared.txt'],
		conflictedPaths: ['shared.txt'],
		hasUpstream: false,
		mergeInProgress: true,
	});
	try {
		await host.activate(extension);
		const state = await host.invokeCommand<RepositoryViewState>('malini.repository.status');
		assert.deepEqual(state.context?.conflictedPaths, ['shared.txt']);
		assert.equal(state.context?.mergeInProgress, true);
		assert.equal(state.context?.hasUpstream, false);

		const surface = repositorySurfaceState(state);
		assert.deepEqual(surface.conflictedPaths, ['shared.txt']);
		assert.equal(surface.mergeInProgress, true);
		assert.equal(surface.hasUpstream, false);
		assert.deepEqual(surface.dirtyPaths, ['shared.txt']);
	} finally {
		await host.cleanup();
	}
});

test('defaults an older host to no conflict and a tracked branch', async () => {
	const host = await conflictHost({ dirtyPaths: ['shared.txt'] });
	try {
		await host.activate(extension);
		const surface = repositorySurfaceState(
			await host.invokeCommand<RepositoryViewState>('malini.repository.status'),
		);
		assert.deepEqual(surface.conflictedPaths, []);
		assert.equal(surface.mergeInProgress, false);
		assert.equal(surface.hasUpstream, true);
	} finally {
		await host.cleanup();
	}
});

test('announces a detected conflict once per rising edge', async () => {
	const status: Partial<ExtensionRepositoryStatus> = {
		branch: 'malini/ws-1',
		baseBranch: 'main',
		dirtyPaths: [],
		conflictedPaths: [],
		mergeInProgress: false,
	};
	const host = await conflictHost(status);
	const announcements: unknown[] = [];
	try {
		await host.activate(extension);
		host.api.events.on(EXTENSION_EVENTS.repositoryConflictDetected, (payload) => {
			announcements.push(payload);
		});

		await host.invokeCommand('malini.repository.refresh');
		assert.deepEqual(announcements, [], 'a settled worktree announces nothing');

		status.dirtyPaths = ['shared.txt'];
		status.conflictedPaths = ['shared.txt'];
		status.mergeInProgress = true;
		await host.invokeCommand('malini.repository.refresh');
		assert.deepEqual(announcements, [
			{
				workstreamId: host.workstream.id,
				branch: 'malini/ws-1',
				conflictedPaths: ['shared.txt'],
			},
		]);

		await host.invokeCommand('malini.repository.refresh');
		await host.invokeCommand('malini.repository.refresh');
		assert.equal(announcements.length, 1, 'a level signal is not a new conflict');

		status.dirtyPaths = [];
		status.conflictedPaths = [];
		status.mergeInProgress = false;
		await host.invokeCommand('malini.repository.refresh');
		status.dirtyPaths = ['shared.txt'];
		status.conflictedPaths = ['shared.txt'];
		status.mergeInProgress = true;
		await host.invokeCommand('malini.repository.refresh');
		assert.equal(announcements.length, 2, 'resolving and re-conflicting is a second conflict');
	} finally {
		await host.cleanup();
	}
});

test('publishes state even when the host cannot carry the announcement', async () => {
	const api: RepositoryControllerHost = {
		workstream: {
			current: () => ({
				id: 'workstream-1',
				path: '/tmp/repository',
				repositoryPath: '/tmp/repository',
				branch: 'malini/ws-1',
				baseBranch: 'main',
			}),
			listFiles: async () => ['shared.txt'],
			readFile: async () => '',
		},
		repository: {
			refresh: async () => undefined,
			status: async () => ({
				branch: 'malini/ws-1',
				baseBranch: 'main',
				dirtyPaths: ['shared.txt'],
				conflictedPaths: ['shared.txt'],
				ahead: 0,
				behind: 0,
				hasUpstream: false,
				mergeInProgress: true,
			}),
			diff: async () => [],
			pullRequest: async () => notOpenPullRequest(),
			createPullRequest: async () => notOpenPullRequest(),
			commit: async () => 'commit-1',
			push: async () => 'origin',
			pullLatest: async () => 'main',
		},
		settings: { get: () => false },
		clock: { now: () => 1 },
	};

	const controller = new RepositoryController(api);
	const state = await controller.refreshLocal();
	assert.equal(state.context?.mergeInProgress, true);
	assert.deepEqual(repositorySurfaceState(state).conflictedPaths, ['shared.txt']);
});

function notOpenPullRequest(): ExtensionPullRequestContext {
	return {
		state: 'not_open',
		number: null,
		title: null,
		url: null,
		baseBranch: 'main',
		headBranch: 'malini/ws-1',
		headSha: null,
		checks: 'none',
	};
}
