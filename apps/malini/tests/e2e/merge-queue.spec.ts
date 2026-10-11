import { expect, test } from '@playwright/test';
import {
	captureFlow,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	sendPrompt,
} from './harness';
import {
	expectMergedAndArchived,
	holdAgentRuns,
	openPullRequestDetail,
	queueMerge,
	workstreamName,
	seedWorkstreamOnFakeGithub,
	sidebarStatus,
	type FakeGithub,
} from './fake-github';

const PASSED = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const RUNNING = [{ name: 'test', status: 'IN_PROGRESS', conclusion: null }];
const FAILED = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];

test('Queue merge marks the draft ready, waits for the checks, merges and archives the workstream', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-queue-merge', null);
		await openWorkstream(page, 'e2e-queue-merge');
		await sendPrompt(page, 'EDIT:alpha.txt COMMIT=feat: add alpha');
		await expectAssistantReply(page);
		await page.getByRole('button', { name: 'Open a draft pull request' }).click();
		await expect(page.getByRole('button', { name: 'Queue merge for pull request #7' })).toBeEnabled(
			{ timeout: 30_000 },
		);
		github.setPullRequest({
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: RUNNING,
		});

		const name = await workstreamName(page, 'e2e-queue-merge');
		await queueMerge(page);

		const queued = page.getByRole('button', { name: 'Merge queued · Waiting for checks' });
		await expect(queued).toHaveText('Queued · Waiting for checks', { timeout: 30_000 });
		await expect(queued).toHaveAttribute('aria-busy', 'true');
		expect(github.pullRequest()).toMatchObject({ isDraft: false });
		const status = sidebarStatus(page, 'e2e-queue-merge');
		await expect(status).toHaveAttribute('data-workstream-pull-request-state', 'queued');
		await expect(status).toHaveAccessibleName(/ · Merge queued$/u);
		expect(mergeCalls(github)).toEqual([]);
		await captureFlow(app, 'merge-queue-waiting-for-checks');

		github.setPullRequest({ statusCheckRollup: PASSED });

		await expectMergedAndArchived(page, 'e2e-queue-merge', name);
		expect(mergeCalls(github)).toEqual([
			[
				'pr',
				'merge',
				'7',
				'--match-head-commit',
				github.pushedHead(),
				'--squash',
				'--subject',
				'feat: add alpha (#7)',
			],
		]);
		expect(github.pullRequest()).toMatchObject({ state: 'MERGED' });
		await captureFlow(app, 'merge-queue-merged');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a failing check starts a Fix checks job whose transcript opens from the Job center, then the queue merges the fix', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-fix-checks', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: FAILED,
			nextChecks: PASSED,
		});
		github.setPullRequest({ checksHead: github.pushedHead() });
		await openWorkstream(page, 'e2e-fix-checks');
		holdAgentRuns(app, true);

		await queueMerge(page);

		await expect(page.getByRole('button', { name: 'Merge queued · Fixing checks' })).toBeVisible({
			timeout: 30_000,
		});
		const pill = page.getByRole('button', { name: 'Jobs: 1 running' });
		await expect(pill).toBeVisible({ timeout: 30_000 });
		await pill.click();
		const jobs = page.getByRole('dialog', { name: 'Jobs' });
		const transcript = jobs.getByRole('link', {
			name: 'Open transcript: Fix checks · Pull request workstream, Running',
		});
		await expect(transcript).toBeVisible();
		await captureFlow(app, 'merge-queue-job-center');
		await transcript.click();

		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBeNull();
		const jobSession = currentSessionId(page);
		await expect(
			page.locator(`[data-testid="chat-message-viewport"][data-session-id="${jobSession}"]`),
		).toContainText("Fix the failing checks on this workstream's pull request.", {
			timeout: 20_000,
		});
		await expect(page.getByRole('tab', { name: /Job: Fix checks/u })).toHaveAttribute(
			'aria-current',
			'page',
		);

		holdAgentRuns(app, false);
		await expectAssistantReply(page);
		await captureFlow(app, 'merge-queue-job-transcript');

		await expectMergedAndArchived(page, 'e2e-fix-checks');
		expect(github.pushedSubjects()[0]).toBe('Fix failing checks');
		expect(mergeCalls(github)).toHaveLength(1);
		await page.getByRole('button', { name: 'Jobs: 1 finished recently' }).click();
		await expect(
			page
				.getByRole('dialog', { name: 'Jobs' })
				.getByRole('link', { name: /^Open transcript: Fix checks.*, Done$/u }),
		).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Cancel merge takes a confirming click and hands the pull request back to Queue merge', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-cancel-merge', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: RUNNING,
		});
		await openWorkstream(page, 'e2e-cancel-merge');
		await queueMerge(page);
		await expect(
			page.getByRole('button', { name: 'Merge queued · Waiting for checks' }),
		).toBeVisible({ timeout: 30_000 });

		const detail = await openPullRequestDetail(page);
		await detail.getByRole('button', { name: 'Cancel merge' }).click();
		const confirm = detail.getByRole('button', { name: 'Confirm cancel' });
		await expect(confirm).toBeVisible();
		await captureFlow(app, 'merge-queue-cancel-armed');
		await confirm.click();

		await expect(page.getByRole('button', { name: 'Queue merge for pull request #7' })).toBeEnabled(
			{ timeout: 30_000 },
		);
		await expect(sidebarStatus(page, 'e2e-cancel-merge')).not.toHaveAttribute(
			'data-workstream-pull-request-state',
			'queued',
		);
		github.setPullRequest({ statusCheckRollup: PASSED });
		expect(mergeCalls(github)).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

function mergeCalls(github: FakeGithub): string[][] {
	return github.calls().filter(([command, sub]) => command === 'pr' && sub === 'merge');
}
