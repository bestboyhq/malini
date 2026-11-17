import { expect, test } from '@playwright/test';
import {
	captureFlow,
	expectCleanConsole,
	launchMalini,
	openedUrls,
	openWorkstream,
	recordBrowser,
} from './harness';
import { openPullRequestDetail, seedWorkstreamOnFakeGithub, topBarStatus } from './fake-github';

const OPEN = 'Open · No checks configured';
const SOONER_THAN_THE_IDLE_POLL_BACKOFF_MS = 15_000;
const SERVICE_UNAVAILABLE =
	'HTTP 503: No server is currently available to service your request. Sorry about that. (https://api.github.com/graphql)\n';

test('the top bar says GitHub is down on every page while GitHub answers 503, links its status page, and Refresh clears it once GitHub answers', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-github-down', {});
		await recordBrowser(app);
		await openWorkstream(page, 'e2e-github-down');
		await expect(topBarStatus(page, OPEN)).toBeVisible({ timeout: 30_000 });

		github.answerWith(SERVICE_UNAVAILABLE);
		await (await openPullRequestDetail(page)).getByRole('button', { name: 'Refresh' }).click();

		await expect(topBarStatus(page, 'GitHub is down')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('button', { name: /remote status is stale/ })).toBeVisible();
		const detail = await openPullRequestDetail(page);
		await expect(detail.getByRole('button', { name: 'Refresh' })).toBeVisible();
		await captureFlow(app, 'github-down');
		await page.keyboard.press('Escape');
		await page.evaluate(() => (globalThis.location.hash = '#/'));
		await expect(topBarStatus(page, 'GitHub is down')).toBeVisible();
		await page.getByRole('button', { name: 'Open GitHub Status' }).click();
		await expect.poll(() => openedUrls(app)).toEqual(['https://www.githubstatus.com']);
		await page.evaluate(() => (globalThis.location.hash = '#/workstreams/e2e-github-down'));
		await expect(topBarStatus(page, 'GitHub is down')).toBeVisible();

		github.answerWith(null);
		await (await openPullRequestDetail(page)).getByRole('button', { name: 'Refresh' }).click();
		await expect(topBarStatus(page, OPEN)).toBeVisible({ timeout: 30_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the top bar says Offline on every page while this computer is offline and reads GitHub again the moment it is back', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-offline-status', {});
		await openWorkstream(page, 'e2e-offline-status');
		await expect(topBarStatus(page, OPEN)).toBeVisible({ timeout: 30_000 });

		await page.context().setOffline(true);
		await expect(topBarStatus(page, 'Offline')).toBeVisible();
		await captureFlow(app, 'offline-status');
		await page.evaluate(() => (globalThis.location.hash = '#/'));
		await expect(topBarStatus(page, 'Offline')).toBeVisible();
		await page.evaluate(() => (globalThis.location.hash = '#/workstreams/e2e-offline-status'));
		await expect(topBarStatus(page, 'Offline')).toBeVisible();

		github.setPullRequest({
			statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
		});
		await page.context().setOffline(false);
		await expect(topBarStatus(page, 'Ready to merge')).toBeVisible({
			timeout: SOONER_THAN_THE_IDLE_POLL_BACKOFF_MS,
		});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
