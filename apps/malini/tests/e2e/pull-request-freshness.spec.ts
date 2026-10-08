import { expect, test } from '@playwright/test';
import { captureFlow, expectCleanConsole, launchMalini, openWorkstream } from './harness';
import { commitByHand, openPullRequestDetail, seedWorkstreamOnFakeGithub } from './fake-github';

test('after a push the top bar and the sidebar wait for GitHub to report the pushed head', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-push-lag', {
			mergeable: 'CONFLICTING',
			mergeStateStatus: 'DIRTY',
		});
		await commitByHand(worktree, 'resolution.txt');
		await openWorkstream(page, 'e2e-push-lag');
		const push = page.getByRole('button', { name: 'Commit and push changes #7' });
		await expect(push).toBeEnabled({ timeout: 30_000 });

		await push.click();

		await expect(page.getByRole('status').filter({ hasText: 'Waiting for GitHub…' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: /Resolve merge conflicts/u })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Merge pull request/u })).toHaveCount(0);
		await expect(
			page.getByRole('status', { name: /^Workstream status: .*Pull request open/u }),
		).toBeVisible();
		await captureFlow(app, 'pull-request-checking');

		github.setPullRequest({
			headRefOid: github.pushedHead(),
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
		});
		const detail = await openPullRequestDetail(page);
		await detail.getByRole('button', { name: 'Refresh' }).click();

		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(
			page.getByRole('status', { name: /^Workstream status: .*Ready to merge/u }),
		).toBeVisible();
		await captureFlow(app, 'pull-request-reported');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
