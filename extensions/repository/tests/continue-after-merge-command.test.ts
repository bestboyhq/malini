import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createTestHost } from '@malini/extension-api/test';
import type { RepositoryViewState } from '../src/controller.js';
import extension from '../src/index.js';

const manifest: unknown = JSON.parse(await readFile('manifest.json', 'utf8'));

const CONTINUE_AFTER_MERGE = 'malini.repository.continue-after-merge';
const MERGED_HEAD = 'a'.repeat(40);

function hostOptions(pullRequestState: 'merged' | 'open') {
	return {
		manifest,
		fixtureRepository: {
			name: `continue-after-merge-${pullRequestState}`,
			branch: 'malini/workstream-1',
			baseBranch: 'main',
			files: { 'README.md': 'continue after merge' },
		},
		repository: {
			status: {
				branch: 'malini/workstream-1',
				baseBranch: 'main',
				dirtyPaths: ['src/next.ts'],
				ahead: 0,
				behind: 0,
			},
			pullRequest: {
				state: pullRequestState,
				number: 12,
				title: 'Ship the git actions',
				url: 'https://example.test/pull/12',
				baseBranch: 'main',
				headBranch: 'malini/workstream-1',
				headSha: MERGED_HEAD,
				checks: 'success',
			} as const,
		},
	};
}

test('continue restarts a merged workstream on its target branch from the merged head', async () => {
	const host = await createTestHost(hostOptions('merged'));
	try {
		await host.activate(extension);
		assert.equal(host.snapshot().commands.includes(CONTINUE_AFTER_MERGE), true);
		const refreshed = await host.invokeCommand<RepositoryViewState>('malini.repository.refresh');
		assert.equal(
			refreshed.context?.pullRequest?.state,
			'merged',
			'uncommitted edits after a merge must not hide the merged pull request',
		);

		const before = host.recording().length;
		await host.invokeCommand<RepositoryViewState>(CONTINUE_AFTER_MERGE);
		const restart = host
			.recording()
			.slice(before)
			.find(({ kind }) => kind === 'repository.restartOnBase');
		assert.deepEqual(restart?.payload, { baseBranch: 'main', mergedHeadSha: MERGED_HEAD });

		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('continue refuses a workstream whose pull request has not merged', async () => {
	const host = await createTestHost(hostOptions('open'));
	try {
		await host.activate(extension);
		await assert.rejects(
			host.invokeCommand<RepositoryViewState>(CONTINUE_AFTER_MERGE),
			/no merged pull request to continue from/u,
		);
		assert.equal(
			host.recording().some(({ kind }) => kind === 'repository.restartOnBase'),
			false,
		);
	} finally {
		await host.cleanup();
	}
});
