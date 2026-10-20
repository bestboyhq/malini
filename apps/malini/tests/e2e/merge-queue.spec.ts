import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	invoke,
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
	toastSaying,
	topBarStatus,
	type FakeGithub,
	WORKSTREAM_NAME,
} from './fake-github';

const PASSED = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const RUNNING = [{ name: 'test', status: 'IN_PROGRESS', conclusion: null }];
const FAILED = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];

test('Merge marks the draft ready, waits for the checks, merges and archives the workstream', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-queue-merge', null);
		await openWorkstream(page, 'e2e-queue-merge');
		await sendPrompt(page, 'EDIT:alpha.txt COMMIT=feat: add alpha');
		await expectAssistantReply(page);
		await page.getByRole('button', { name: 'Open a draft pull request' }).click();
		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 30_000,
		});
		github.setPullRequest({
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: RUNNING,
		});

		const name = await workstreamName(page, 'e2e-queue-merge');
		await queueMerge(page);

		await expect(topBarStatus(page, 'Queued for merge · Waiting for checks')).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: 'Cancel the queued merge' })).toBeEnabled();
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

test('a command the agent left running in the background does not hold the merge, and archiving stops it', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-merge-dev-server', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: PASSED,
		});
		await openWorkstream(page, 'e2e-merge-dev-server');
		await sendPrompt(page, 'BACKGROUND_COMMAND');
		await expect(page.getByRole('region', { name: '1 background command running' })).toBeVisible({
			timeout: 20_000,
		});
		await captureFlow(app, 'merge-queue-background-command');

		const name = await workstreamName(page, 'e2e-merge-dev-server');
		await queueMerge(page);

		await expectMergedAndArchived(page, 'e2e-merge-dev-server', name);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'merge-queue-background-command-merged');
		expect(mergeCalls(github)).toHaveLength(1);
		expect(
			await invoke(page, 'chat.workstream-has-open-run', { workstreamId: 'e2e-merge-dev-server' }),
		).toBe(false);
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

		await expect(topBarStatus(page, 'Queued for merge · Clearing blockers')).toBeVisible({
			timeout: 30_000,
		});
		const jobs = page.getByRole('region', { name: 'Jobs: 1 running' });
		await expect(jobs).toBeVisible({ timeout: 30_000 });
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
		const finishedJobs = page.getByRole('region', { name: 'Jobs: 1 finished recently' });
		await finishedJobs.getByRole('button', { name: 'Recent 1' }).click();
		await expect(
			finishedJobs.getByRole('link', { name: /^Open transcript: Fix checks.*, Done$/u }),
		).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Cancel takes a confirming click in the bar and hands the pull request back to Merge', async () => {
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
		await expect(topBarStatus(page, 'Queued for merge · Waiting for checks')).toBeVisible({
			timeout: 30_000,
		});

		const cancel = page.getByRole('button', { name: 'Cancel the queued merge' });
		const confirm = page.getByRole('button', { name: 'Confirm cancel' });
		await cancel.click();
		await expect(confirm).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(confirm).toHaveCount(0);
		await expect(cancel).toBeVisible();
		await expect(topBarStatus(page, 'Queued for merge · Waiting for checks')).toBeVisible();

		await cancel.click();
		await expect(confirm).toBeVisible();
		await captureFlow(app, 'merge-queue-cancel-armed');
		await confirm.click();

		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 30_000,
		});
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

test('a merge GitHub blocks needs you once in a toast, and Retry in the detail queues it again', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-merge-blocked', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'BLOCKED',
			statusCheckRollup: PASSED,
		});
		await openWorkstream(page, 'e2e-merge-blocked');
		await queueMerge(page);

		await expect(topBarStatus(page, /GitHub blocks the merge/u)).toBeVisible({ timeout: 30_000 });
		const toast = toastSaying(page, `${WORKSTREAM_NAME} needs you · GitHub blocks the merge`);
		await expect(toast).toHaveCount(1, { timeout: 30_000 });
		await captureFlow(app, 'merge-queue-needs-you');
		await page.evaluate(() => {
			location.hash = '#/';
		});
		await expect(page.getByTestId('transcript-pane')).toHaveCount(0);
		await toast.getByRole('button', { name: 'Open' }).click();
		await expect(toast).toHaveCount(0);
		await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 20_000 });
		expect(new URL(page.url()).hash).toMatch(/^#\/workstreams\/e2e-merge-blocked\b/u);

		github.setPullRequest({ mergeStateStatus: 'CLEAN' });
		const detail = await openPullRequestDetail(page);
		await detail.getByRole('button', { name: 'Retry', exact: true }).click();

		await expectMergedAndArchived(page, 'e2e-merge-blocked');
		expect(mergeCalls(github)).toHaveLength(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a Fix checks job that keeps failing gives up, says so once, and Open job shows its transcript', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-fix-gave-up', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: FAILED,
			nextChecks: FAILED,
		});
		github.setPullRequest({ checksHead: github.pushedHead() });
		await openWorkstream(page, 'e2e-fix-gave-up');
		await queueMerge(page);

		await expect(topBarStatus(page, /Fix gave up/u)).toBeVisible({ timeout: 120_000 });
		await expect(toastSaying(page, `${WORKSTREAM_NAME} needs you · Fix gave up`)).toHaveCount(1);
		await expect(page.getByTestId('sidebar-open-jobs')).not.toHaveAttribute('aria-describedby');
		expect(mergeCalls(github)).toEqual([]);

		await page.getByRole('button', { name: 'Open the transcript of the job that stopped' }).click();
		await expect(page.getByRole('tab', { name: /Job: Fix checks/u })).toHaveAttribute(
			'aria-current',
			'page',
			{ timeout: 20_000 },
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a pull request merged on GitHub offers Continue, which starts over on the latest main and drafts the next change', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(
			app,
			'e2e-merged-continue',
			null,
		);
		await openWorkstream(page, 'e2e-merged-continue');
		await sendPrompt(page, 'EDIT:alpha.txt COMMIT=feat: add alpha');
		await expectAssistantReply(page);
		await page.getByRole('button', { name: 'Open a draft pull request' }).click();
		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 30_000,
		});

		github.setPullRequest({ state: 'MERGED' });
		await expect(topBarStatus(page, 'Merged')).toBeVisible({ timeout: 45_000 });
		await page.getByRole('button', { name: 'Continue on top of the latest main' }).click();

		await expect(topBarStatus(page, 'Build something great')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('button', { name: 'Archive this workstream' })).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Continue on top of the latest main' }),
		).toHaveCount(0);

		writeFileSync(join(worktree, 'beta.txt'), 'the next change\n');
		await expect(page.getByRole('button', { name: 'Open a draft pull request' })).toBeEnabled({
			timeout: 30_000,
		});
		await expect(topBarStatus(page, '1 file changed')).toBeVisible();
		await captureFlow(app, 'merge-queue-continue-next-change');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

function mergeCalls(github: FakeGithub): string[][] {
	return github.calls().filter(([command, sub]) => command === 'pr' && sub === 'merge');
}
