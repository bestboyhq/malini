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
const SERVICE_UNAVAILABLE =
	'HTTP 503: No server is currently available to service your request. Sorry about that. (https://api.github.com/graphql)\n';

test('the top bar says GitHub is down when GitHub answers 503, links its status page, and recovers on Retry', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-github-down', {});
		await recordBrowser(app);
		await openWorkstream(page, 'e2e-github-down');
		await expect(topBarStatus(page, OPEN)).toBeVisible({ timeout: 30_000 });

		github.answerWith(SERVICE_UNAVAILABLE);
		const detail = await openPullRequestDetail(page);
		await detail.getByRole('button', { name: 'Refresh' }).click();

		const down = topBarStatus(page, 'GitHub is down');
		await expect(down).toBeVisible({ timeout: 30_000 });
		await down.hover({ force: true });
		await expect(page.getByRole('tooltip')).toHaveText(
			"GitHub is down: it answered HTTP 503. Your connection works; the problem is on GitHub's side.",
		);
		await captureFlow(app, 'github-down');
		await page.mouse.move(0, 0);
		await page.getByRole('button', { name: 'Open GitHub Status' }).click();
		await expect.poll(() => openedUrls(app)).toEqual(['https://www.githubstatus.com']);

		github.answerWith(null);
		await page.getByRole('button', { name: 'Read the repository status again' }).click();
		await expect(topBarStatus(page, OPEN)).toBeVisible({ timeout: 30_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the top bar says Offline while this Mac is offline and reads GitHub again the moment it is back', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-offline-status', {});
		await openWorkstream(page, 'e2e-offline-status');
		await expect(topBarStatus(page, OPEN)).toBeVisible({ timeout: 30_000 });

		await page.context().setOffline(true);
		const offline = topBarStatus(page, 'Offline');
		await expect(offline).toBeVisible();
		await offline.hover({ force: true });
		await expect(page.getByRole('tooltip')).toHaveText(
			'This Mac is offline. Malini reads GitHub again as soon as it is back online.',
		);
		await captureFlow(app, 'offline-status');
		await page.mouse.move(0, 0);

		github.setPullRequest({
			statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
		});
		await page.context().setOffline(false);
		await expect(topBarStatus(page, 'Ready to merge')).toBeVisible({ timeout: 5_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
