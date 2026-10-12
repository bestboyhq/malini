import { expect, test } from '@playwright/test';
import { captureFlow, expectCleanConsole, launchMalini, openWorkstream } from './harness';
import {
	commitByHand,
	openPullRequestDetail,
	queueMerge,
	seedWorkstreamOnFakeGithub,
	sidebarStatus,
} from './fake-github';

test('after a push the top bar waits for GitHub to report the pushed head before it trusts the old mergeability', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-push-lag', {
			mergeable: 'CONFLICTING',
			mergeStateStatus: 'DIRTY',
		});
		await commitByHand(worktree, 'resolution.txt');
		await openWorkstream(page, 'e2e-push-lag');
		const headline = page.getByTestId('global-topbar-github-headline');

		await queueMerge(page);

		await expect(headline).toHaveText('Waiting for GitHub…', { timeout: 30_000 });
		await expect(
			page.getByRole('button', { name: 'Merge queued · Waiting for checks' }),
		).toBeVisible({ timeout: 30_000 });
		await expect(sidebarStatus(page, 'e2e-push-lag')).toHaveAttribute(
			'data-workstream-pull-request-state',
			'queued',
		);
		expect(github.calls().filter(([command, sub]) => command === 'pr' && sub === 'merge')).toEqual(
			[],
		);
		await captureFlow(app, 'pull-request-checking');

		github.setPullRequest({
			headRefOid: github.pushedHead(),
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: [{ name: 'test', status: 'IN_PROGRESS', conclusion: null }],
		});
		const detail = await openPullRequestDetail(page);
		await detail.getByRole('button', { name: 'Refresh' }).click();

		await expect(headline).toHaveText('1 check pending…', { timeout: 30_000 });
		await captureFlow(app, 'pull-request-reported');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
