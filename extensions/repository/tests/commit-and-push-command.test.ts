import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createTestHost } from '@malini/extension-api/test';
import type { RepositoryViewState } from '../src/controller.js';
import extension from '../src/index.js';
import {
	automatedPullRequestMetadata,
	derivedCommitMessage,
} from '../src/pull-request-metadata.js';

const manifest: unknown = JSON.parse(await readFile('manifest.json', 'utf8'));

const COMMIT_AND_PUSH = 'malini.repository.commit-and-push';

function dirtyHostOptions(pullRequestState: 'open' | 'not_open') {
	return {
		manifest,
		fixtureRepository: {
			name: `commit-and-push-${pullRequestState}`,
			branch: 'malini/workstream-1',
			baseBranch: 'main',
			files: { 'README.md': 'commit and push' },
		},
		repository: {
			status: {
				branch: 'malini/workstream-1',
				baseBranch: 'main',
				dirtyPaths: ['src/index.ts'],
				ahead: 0,
				behind: 0,
			},
			pullRequest:
				pullRequestState === 'open'
					? ({
							state: 'open',
							number: 12,
							title: 'Ship the git actions',
							url: 'https://example.test/pull/12',
							baseBranch: 'main',
							headBranch: 'malini/workstream-1',
							checks: 'success',
						} as const)
					: ({ state: 'not_open' } as const),
		},
	};
}

test('one named command commits and pushes, and creates no pull request', async () => {
	const host = await createTestHost(dirtyHostOptions('open'));
	try {
		await host.activate(extension);
		assert.equal(
			host.snapshot().commands.includes(COMMIT_AND_PUSH),
			true,
			'commit and push must be a declared, registered command of its own',
		);

		const before = host.recording().length;
		await host.invokeCommand<RepositoryViewState>(COMMIT_AND_PUSH, {
			context: {
				sessionTitle: 'Name the git action on the bar',
				runSummaries: ['Registered commit and push as its own bar command.'],
			},
		});
		const mutations = host
			.recording()
			.slice(before)
			.filter(({ kind }) => kind.startsWith('repository.'))
			.filter(({ kind }) => kind !== 'repository.status' && kind !== 'repository.pullRequest')
			.filter(({ kind }) => kind !== 'repository.refresh' && kind !== 'repository.diff');
		assert.deepEqual(
			mutations.map(({ kind }) => kind),
			['repository.commit', 'repository.push'],
		);
		assert.equal(
			(mutations[0]?.payload as { message: string }).message,
			'Registered commit and push as its own bar command',
			'the commit message must be the derived one, never a hardcoded literal',
		);

		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('commit and push names the run its subject comes from, and the subject to use once that run is committed', async () => {
	const host = await createTestHost(dirtyHostOptions('open'));
	try {
		await host.activate(extension);
		const before = host.recording().length;
		await host.invokeCommand<RepositoryViewState>(COMMIT_AND_PUSH, {
			context: {
				lastUserIntent: 'Fix the failing checks on pull request #12.',
				runSummaries: ['fix(git): refuse commits that would add more than 2000 files'],
				latestRunId: 'run-7',
			},
		});
		const commit = host
			.recording()
			.slice(before)
			.find(({ kind }) => kind === 'repository.commit');
		assert.deepEqual(commit?.payload, {
			message: 'fix(git): refuse commits that would add more than 2000 files',
			run: {
				id: 'run-7',
				messageIfAlreadyCommitted: 'Fix the failing checks on pull request #12',
			},
		});
	} finally {
		await host.cleanup();
	}
});

test('commit and push never invents a pull request when none exists', async () => {
	const host = await createTestHost(dirtyHostOptions('not_open'));
	try {
		await host.activate(extension);
		const before = host.recording().length;
		await host.invokeCommand<RepositoryViewState>(COMMIT_AND_PUSH, {
			context: { sessionTitle: 'Local checkpoint' },
		});
		const kinds = host
			.recording()
			.slice(before)
			.map(({ kind }) => kind);
		assert.equal(kinds.includes('repository.commit'), true);
		assert.equal(kinds.includes('repository.push'), true);
		assert.equal(
			kinds.includes('repository.createPullRequest'),
			false,
			'a command named commit-and-push must not open a pull request as a side effect',
		);
	} finally {
		await host.cleanup();
	}
});

test('commit and push rejects pull request only input', async () => {
	const host = await createTestHost(dirtyHostOptions('open'));
	try {
		await host.activate(extension);
		await assert.rejects(
			host.invokeCommand(COMMIT_AND_PUSH, { draft: true }),
			/does not create a pull request/u,
		);
	} finally {
		await host.cleanup();
	}
});

test('every commit message comes from one derivation', () => {
	const input = {
		branch: 'malini/workstream-1',
		baseBranch: 'main',
		changedPaths: ['src/index.ts'],
		context: { sessionTitle: 'One derivation' },
	} as const;
	assert.equal(
		derivedCommitMessage({
			changedPaths: input.changedPaths,
			context: input.context,
		}),
		automatedPullRequestMetadata(input).commitMessage,
	);
	assert.equal(
		derivedCommitMessage({ changedPaths: [] }),
		automatedPullRequestMetadata({
			branch: 'malini/workstream-1',
			baseBranch: 'main',
			changedPaths: [],
		}).commitMessage,
	);
});
