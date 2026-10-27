import { expect, test } from '@playwright/test';
import {
	captureFlow,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	sendPrompt,
} from './harness';
import {
	expectMerged,
	queueMerge,
	seedWorkstreamOnFakeGithub,
	toastSaying,
	topBarStatus,
} from './fake-github';

const UNREACHABLE = "Couldn't reach github.com. Check your connection and try again.";

test('a queued merge that cannot reach github.com says so in its tooltip and retries the push until it lands', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini({ allowedDiagnostics: [/Couldn't reach github\.com/u] });
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-offline', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
		});
		await openWorkstream(page, 'e2e-offline');
		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		github.setOffline(true);

		await queueMerge(page);

		const queued = topBarStatus(page, 'Queued for merge · Retrying after an error');
		await expect(queued).toBeVisible({ timeout: 30_000 });
		await queued.hover({ force: true });
		const tooltip = page.getByRole('tooltip');
		await expect(tooltip).toHaveText(UNREACHABLE, { timeout: 30_000 });
		const shown = await tooltip.innerText();
		for (const leak of ['credential.helper', 'Some(', 'exit=', '-c ', '/var/folders', app.root]) {
			expect(shown, `the tooltip leaks "${leak}"`).not.toContain(leak);
		}
		await expect(toastSaying(page, 'Pull request action failed')).toHaveCount(0);
		await captureFlow(app, 'push-failure');
		await page.mouse.move(0, 0);

		github.setOffline(false);

		await expectMerged(page, 'e2e-offline');
		expect(github.pushedSubjects()[0]).toBe('Update a.txt');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Open draft without network says github.com is unreachable in its tooltip and opens the draft once it is back', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ allowedDiagnostics: [/Couldn't reach github\.com/u] });
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-offline-draft', null);
		await openWorkstream(page, 'e2e-offline-draft');
		await sendPrompt(page, 'EDIT:a.txt');
		await expectAssistantReply(page);
		github.setOffline(true);

		await page.getByRole('button', { name: 'Open a draft pull request' }).click();

		const opening = topBarStatus(page, 'Opening draft · Retrying after an error');
		await expect(opening).toBeVisible({ timeout: 30_000 });
		await opening.hover({ force: true });
		await expect(page.getByRole('tooltip')).toHaveText(UNREACHABLE, { timeout: 30_000 });
		await expect(toastSaying(page, 'Pull request action failed')).toHaveCount(0);
		await captureFlow(app, 'push-failure-draft');
		await page.mouse.move(0, 0);

		github.setOffline(false);

		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 90_000,
		});
		expect(github.pullRequest()).toMatchObject({ isDraft: true });
		expect(github.pushedSubjects()[0]).toBe('Update a.txt');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
