import { expect, test } from '@playwright/test';
import { captureFlow, expectCleanConsole, launchMalini, openWorkstream } from './harness';
import {
	commitByHand,
	openPullRequestDetail,
	queueMerge,
	seedWorkstreamOnFakeGithub,
	sidebarStatus,
	topBarStatus,
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
		await queueMerge(page);

		await expect(topBarStatus(page, 'Queued for merge · Waiting for checks')).toBeVisible({
			timeout: 30_000,
		});
		await expect(topBarStatus(page, /Merge conflicts/u)).toHaveCount(0);
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

		await expect(topBarStatus(page, 'Queued for merge · Waiting for checks')).toBeVisible();
		const reported = await openPullRequestDetail(page);
		await expect(reported.getByRole('listitem').filter({ hasText: 'test' })).toHaveText(
			/test\s*Running$/u,
			{ timeout: 30_000 },
		);
		await captureFlow(app, 'pull-request-reported');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
