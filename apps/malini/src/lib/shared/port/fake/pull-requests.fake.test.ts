import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePlatform, type FakePlatform } from './create-fake-platform';

let fake: FakePlatform;
let repoId: string;

beforeEach(async () => {
	fake = createFakePlatform();
	const repo = await fake.invoke('repositories.connect', {
		source: { kind: 'clone-url', url: 'https://github.com/rabbits/hutch.git' },
	});
	repoId = repo.id;
});

describe('fake pull-request commands', () => {
	it('reports a branch without a pull request against the requested or default base', async () => {
		await expect(
			fake.invoke('pull-requests.status', { repoId, head: 'malini/ws-1' }),
		).resolves.toMatchObject({
			state: 'not_open',
			number: null,
			headRef: 'malini/ws-1',
			baseRef: 'main',
			checksState: 'none',
			checks: [],
		});
		await expect(
			fake.invoke('pull-requests.status', { repoId, head: 'malini/ws-1', base: 'develop' }),
		).resolves.toMatchObject({ baseRef: 'develop' });
	});

	it('refuses a repository it never connected', async () => {
		await expect(
			fake.invoke('pull-requests.status', { repoId: 'missing', head: 'malini/ws-1' }),
		).rejects.toThrow('Unknown repository: missing');
	});

	it('opens, readies, and merges a pull request the status then reports', async () => {
		const created = await fake.invoke('pull-requests.create', {
			repoId,
			head: 'malini/ws-1',
			title: 'Ship it',
			draft: true,
		});
		expect(created).toMatchObject({
			state: 'open',
			number: 100,
			url: 'https://github.com/rabbits/hutch/pull/100',
			title: 'Ship it',
			draft: true,
			baseRef: 'main',
			headSha: 'fake-head-sha',
		});
		await expect(
			fake.invoke('pull-requests.status', { repoId, head: 'malini/ws-1' }),
		).resolves.toMatchObject({ number: 100, draft: true });

		await expect(
			fake.invoke('pull-requests.mark-ready', { repoId, pullRequestNumber: 100 }),
		).resolves.toMatchObject({ draft: false });
		await expect(
			fake.invoke('pull-requests.merge', {
				repoId,
				pullRequestNumber: 100,
				expectedHeadSha: 'fake-head-sha',
			}),
		).resolves.toMatchObject({ state: 'merged', mergeable: null });
		await expect(
			fake.invoke('pull-requests.status', { repoId, head: 'malini/ws-1' }),
		).resolves.toMatchObject({ state: 'merged' });
	});

	it('refuses to merge a head that moved since it was read', async () => {
		await fake.invoke('pull-requests.create', { repoId, head: 'malini/ws-1', title: 'Ship it' });

		await expect(
			fake.invoke('pull-requests.merge', {
				repoId,
				pullRequestNumber: 100,
				expectedHeadSha: 'stale-sha',
			}),
		).rejects.toThrow('Pull request head moved since it was last read');
	});

	it('answers empty diagnostics and feedback for a known pull request only', async () => {
		await fake.invoke('pull-requests.create', { repoId, head: 'malini/ws-1', title: 'Ship it' });

		await expect(
			fake.invoke('pull-requests.check-diagnostics', { repoId, pullRequestNumber: 100 }),
		).resolves.toEqual({
			checkRuns: [],
			checkRunsComplete: true,
			commitStatuses: [],
			commitStatusesComplete: true,
			truncated: false,
		});
		await expect(
			fake.invoke('pull-requests.review-feedback', { repoId, pullRequestNumber: 100 }),
		).resolves.toEqual({
			unresolvedThreads: [],
			unresolvedThreadsComplete: true,
			requestedChangeReviews: [],
			requestedChangeReviewsComplete: true,
			truncated: false,
		});
		await expect(
			fake.invoke('pull-requests.review-feedback', { repoId, pullRequestNumber: 7 }),
		).rejects.toThrow(`Unknown pull request #7 for ${repoId}`);
	});

	it('forgets pull requests on reset', async () => {
		await fake.invoke('pull-requests.create', { repoId, head: 'malini/ws-1', title: 'Ship it' });

		fake.reset();

		await expect(
			fake.invoke('pull-requests.status', { repoId, head: 'malini/ws-1' }),
		).rejects.toThrow(`Unknown repository: ${repoId}`);
	});
});
