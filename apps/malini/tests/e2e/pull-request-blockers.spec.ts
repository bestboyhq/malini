import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	sendPrompt,
} from './harness';
import { holdAgentRuns, seedWorkstreamOnFakeGithub, topBarStatus } from './fake-github';

const PASSED = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const QUEUE_MERGE = 'Merge pull request #7';

test('a pull request closed on GitHub offers Reopen beside Archive, and Reopen opens it again', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-reopen', {
			state: 'CLOSED',
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: PASSED,
		});
		await openWorkstream(page, 'e2e-reopen');
		await expect(topBarStatus(page, 'Closed')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('button', { name: 'Archive this workstream' })).toBeVisible();
		await captureFlow(app, 'pull-request-reopen');

		await page.getByRole('button', { name: 'Reopen pull request #7' }).click();

		await expect(topBarStatus(page, 'Ready to merge')).toBeVisible({ timeout: 30_000 });
		expect(github.pullRequest()).toMatchObject({ state: 'OPEN' });
		expect(
			github.calls().filter(([command, sub]) => command === 'pr' && sub === 'reopen'),
		).toHaveLength(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('changes a reviewer requested are cleared on its own while you work, and pushed to the pull request', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-requested', null);
		await openWorkstream(page, 'e2e-requested');
		await sendPrompt(page, 'EDIT:alpha.txt COMMIT=feat: add alpha');
		await expectAssistantReply(page);
		await page.getByRole('button', { name: 'Open a draft pull request' }).click();
		await expect(page.getByRole('button', { name: QUEUE_MERGE })).toBeEnabled({ timeout: 30_000 });
		holdAgentRuns(app, true);
		github.setPullRequest({
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'BLOCKED',
			statusCheckRollup: PASSED,
			reviewDecision: 'CHANGES_REQUESTED',
			changeRequests: [
				{ id: 'PRR_alice', body: 'EDIT:beta.txt to cover the empty case.', author: 'alice' },
			],
		});

		await refreshPullRequest(page);

		await expect(topBarStatus(page, 'Clearing blockers')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('button', { name: QUEUE_MERGE })).toBeEnabled();
		await captureFlow(app, 'pull-request-clearing-blockers');
		holdAgentRuns(app, false);

		await expect
			.poll(() => github.pushedSubjects()[0], { timeout: 60_000 })
			.toBe('Address review feedback');
		expect(existsSync(join(worktree, 'beta.txt'))).toBe(true);
		await expect(topBarStatus(page, 'Clearing blockers')).toHaveCount(0, { timeout: 30_000 });
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function refreshPullRequest(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Pull request #7 detail' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Refresh' }).click();
}
