import { expect, test } from '@playwright/test';
import { captureFlow, expectCleanConsole, launchMalini, openWorkstream } from './harness';
import { openPullRequestDetail, seedWorkstreamOnFakeGithub } from './fake-github';

test('the pull request detail is a labelled dialog that Escape leaves', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = await seedWorkstreamOnFakeGithub(app, 'e2e-detail', {
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
		});
		await openWorkstream(page, 'e2e-detail');
		const disclosure = page.getByRole('button', { name: 'Pull request #7 detail' });
		await expect(disclosure).toHaveAttribute('aria-haspopup', 'dialog', { timeout: 30_000 });

		const detail = await openPullRequestDetail(page);

		await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
		await expect(detail).toBeFocused();
		await expect(page.getByRole('menu')).toHaveCount(0);
		await expect(page.getByRole('menuitem')).toHaveCount(0);
		await expect(detail.getByRole('button', { name: 'Open on GitHub' })).toBeVisible();
		await expect(detail.getByRole('button', { name: 'Refresh' })).toBeVisible();
		await page.keyboard.press('Tab');
		await expect(detail.getByRole('button', { name: 'Open on GitHub' })).toBeFocused();
		await captureFlow(app, 'pull-request-detail');

		await page.keyboard.press('Escape');

		await expect(detail).toHaveCount(0);
		await expect(disclosure).toBeFocused();
		await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the pull request detail names each check result in words and keeps its duration', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = await seedWorkstreamOnFakeGithub(app, 'e2e-detail-checks', {
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: [
				{
					name: 'check, lint, test',
					status: 'COMPLETED',
					conclusion: 'SUCCESS',
					startedAt: '2026-10-01T10:00:00Z',
					completedAt: '2026-10-01T10:08:03Z',
				},
				{
					name: 'e2e',
					status: 'COMPLETED',
					conclusion: 'TIMED_OUT',
					startedAt: '2026-10-01T10:00:00Z',
					completedAt: '2026-10-01T10:30:00Z',
				},
				{ name: 'deploy preview', status: 'IN_PROGRESS', conclusion: null },
			],
		});
		await openWorkstream(page, 'e2e-detail-checks');
		await expect(page.getByRole('button', { name: 'Pull request #7 detail' })).toBeVisible({
			timeout: 30_000,
		});

		const detail = await openPullRequestDetail(page);
		const checks = detail.getByRole('listitem');

		await expect(checks.filter({ hasText: 'check, lint, test' })).toHaveText(
			/check, lint, test\s*Passed · 8m 3s/u,
		);
		await expect(checks.filter({ hasText: 'e2e' })).toHaveText(/e2e\s*Timed out · 30m 0s/u);
		await expect(checks.filter({ hasText: 'deploy preview' })).toHaveText(
			/deploy preview\s*Running$/u,
		);
		await expect(detail).not.toContainText(/SUCCESS|TIMED|IN PROGRESS/u);
		await captureFlow(app, 'pull-request-detail-checks');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a pull request without checks says so on Merge and in its detail, never that checks passed', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = await seedWorkstreamOnFakeGithub(app, 'e2e-no-checks', {
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
		});
		await openWorkstream(page, 'e2e-no-checks');

		const merge = page.getByRole('button', { name: 'Merge pull request #7' });
		await expect(merge).toBeVisible({ timeout: 30_000 });
		await merge.hover();
		await expect(page.getByRole('tooltip')).toHaveText(
			'No checks configured. Squash and merge, after one confirming click. Escape cancels it',
		);

		const detail = await openPullRequestDetail(page);
		await expect(detail).toContainText('No checks configured');
		await expect(detail).not.toContainText('passed');
		await captureFlow(app, 'pull-request-no-checks');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
