import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createTestHost, type ExtensionTestHost } from '@malini/extension-api/test';
import extension from '../src/index.js';

const manifest: unknown = JSON.parse(await readFile('manifest.json', 'utf8'));

const CREATE = 'malini.repository.create-or-open-pull-request';
const COMMIT_AND_PUSH = 'malini.repository.commit-and-push';

async function hostWithGeneratedPullRequest(): Promise<ExtensionTestHost> {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'title-refresh',
			branch: 'malini/workstream-1',
			baseBranch: 'main',
			files: { 'README.md': 'title refresh' },
		},
		repository: {
			status: { branch: 'malini/workstream-1', baseBranch: 'main', dirtyPaths: ['src/a.ts'] },
			pullRequest: { state: 'not_open', number: 12, url: 'https://example.test/pull/12' },
			supportsPullRequestMutations: true,
		},
	});
	await host.activate(extension);
	await host.invokeCommand(CREATE, {
		context: { runSummaries: ['feat(git): add the first half'] },
	});
	return host;
}

function pushWithRun(host: ExtensionTestHost, summary: string): Promise<unknown> {
	return host.invokeCommand(COMMIT_AND_PUSH, { context: { runSummaries: [summary] } });
}

function metadataUpdates(host: ExtensionTestHost) {
	return host
		.recording()
		.filter(({ kind }) => kind === 'repository.updatePullRequestMetadata')
		.map(
			({ payload }) =>
				payload as {
					input: { title?: unknown; body?: unknown };
					result: { title: string | null; body: string | null };
				},
		);
}

async function pullRequestTitle(host: ExtensionTestHost): Promise<string | null> {
	return (await host.api.repository.pullRequest()).title;
}

test('each push retitles a pull request malini titled, after the latest run', async () => {
	const host = await hostWithGeneratedPullRequest();
	try {
		assert.equal(await pullRequestTitle(host), 'feat(git): add the first half');

		await pushWithRun(host, 'feat(git): add the second half');

		assert.equal(await pullRequestTitle(host), 'feat(git): add the second half');
		const [update] = metadataUpdates(host);
		assert.deepEqual(update?.input.title, {
			expected: 'feat(git): add the first half',
			next: 'feat(git): add the second half',
		});
		assert.match(update?.result.body ?? '', /feat\(git\): add the second half/u);
	} finally {
		await host.cleanup();
	}
});

test('a push retitles after the branch title the run reports, over its commit line', async () => {
	const host = await hostWithGeneratedPullRequest();
	try {
		await host.invokeCommand(COMMIT_AND_PUSH, {
			context: {
				runSummaries: ['fix(git): add the second half'],
				pullRequestTitle: 'feat(git): add both halves',
			},
		});

		assert.equal(await pullRequestTitle(host), 'feat(git): add both halves');
		const [update] = metadataUpdates(host);
		assert.match(update?.result.body ?? '', /## Summary\n\nfeat\(git\): add both halves\n/u);
		const commit = [...host.recording()].reverse().find(({ kind }) => kind === 'repository.commit');
		assert.equal((commit?.payload as { message: string }).message, 'fix(git): add the second half');
	} finally {
		await host.cleanup();
	}
});

test('a title the user edited on GitHub stays, while malini keeps the body current', async () => {
	const host = await hostWithGeneratedPullRequest();
	try {
		host.editPullRequestOnGithub({ title: 'Split the git work in two' });

		await pushWithRun(host, 'feat(git): add the second half');
		await pushWithRun(host, 'feat(git): add the third half');

		assert.equal(await pullRequestTitle(host), 'Split the git work in two');
		const [first, second] = metadataUpdates(host);
		assert.equal(first?.result.title, null);
		assert.match(first?.result.body ?? '', /second half/u);
		assert.equal(second?.input.title, undefined, 'a title the user owns is never offered again');
		assert.match(second?.result.body ?? '', /third half/u);
	} finally {
		await host.cleanup();
	}
});

test('a push without a run leaves the pull request text alone', async () => {
	const host = await hostWithGeneratedPullRequest();
	try {
		await host.invokeCommand(COMMIT_AND_PUSH, { context: { sessionTitle: 'Checkpoint' } });

		assert.deepEqual(metadataUpdates(host), []);
		assert.equal(await pullRequestTitle(host), 'feat(git): add the first half');
	} finally {
		await host.cleanup();
	}
});

test('a pull request malini did not open is never retitled', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: {
			name: 'title-foreign',
			branch: 'malini/workstream-1',
			baseBranch: 'main',
			files: { 'README.md': 'foreign' },
		},
		repository: {
			status: { branch: 'malini/workstream-1', baseBranch: 'main', dirtyPaths: ['src/a.ts'] },
			pullRequest: {
				state: 'open',
				number: 12,
				title: 'Opened by hand',
				url: 'https://example.test/pull/12',
				checks: 'success',
			},
			supportsPullRequestMutations: true,
		},
	});
	try {
		await host.activate(extension);

		await pushWithRun(host, 'feat(git): add the second half');

		assert.deepEqual(metadataUpdates(host), []);
		assert.equal(await pullRequestTitle(host), 'Opened by hand');
	} finally {
		await host.cleanup();
	}
});
