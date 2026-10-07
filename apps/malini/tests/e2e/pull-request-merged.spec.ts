import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { captureFlow, expectCleanConsole, launchMalini, openWorkstream } from './harness';
import { headOf, openPullRequestDetail, seedWorkstreamOnFakeGithub } from './fake-github';

test('a merged pull request stays merged in the top bar and the sidebar through new edits, and Continue moves the work onto the fresh base', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-merged', {
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
		});
		await openWorkstream(page, 'e2e-merged');
		await expect(page.getByRole('status').filter({ hasText: 'Checks passed' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(
			page.getByRole('button', { name: 'Open pull request #7 on GitHub' }),
		).toBeVisible();
		await expect(
			page.getByRole('status', { name: /^Workstream status: .*Ready to merge/u }),
		).toBeVisible();

		await page.getByRole('button', { name: 'Merge pull request #7' }).click();

		const merged = page
			.getByRole('navigation', { name: 'Global actions' })
			.getByRole('status')
			.filter({ hasText: 'Merged' });
		const continueOnBase = page.getByRole('button', { name: 'Continue on the latest main' });
		await expect(merged).toBeVisible({ timeout: 30_000 });
		await expect(continueOnBase).toBeEnabled();
		await expect(
			page.getByRole('button', { name: 'Archive this workstream, merged in #7' }),
		).toBeEnabled();
		await expect(page.getByRole('status', { name: /^Workstream status: .*Merged/u })).toBeVisible();
		await captureFlow(app, 'pull-request-merged');

		writeFileSync(join(worktree, 'next.txt'), 'work after the merge\n');
		const detail = await openPullRequestDetail(page);
		await detail.getByRole('button', { name: 'Refresh' }).click();
		await expect(merged).toBeVisible({ timeout: 30_000 });
		await expect(continueOnBase).toBeEnabled();
		await expect(page.getByRole('button', { name: /^Commit and push/u })).toHaveCount(0);

		await continueOnBase.click();

		await expect(page.getByRole('button', { name: 'Commit and push changes' })).toBeEnabled({
			timeout: 30_000,
		});
		await expect(merged).toHaveCount(0);
		await expect(page.getByRole('status', { name: /^Workstream status: .*Merged/u })).toHaveCount(
			0,
		);
		const mergeCommit = github.pullRequest()?.['mergeCommit'];
		expect(mergeCommit).toMatchObject({ oid: headOf(worktree) });
		expect(existsSync(join(worktree, 'next.txt'))).toBe(true);
		await captureFlow(app, 'pull-request-continued');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
