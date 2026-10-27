import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	currentSessionId,
	expectAssistantReply,
	expectCleanConsole,
	clickRevealedOnHover,
	invoke,
	launchMalini,
	openedUrls,
	openJobs,
	openWorkstream,
	recordBrowser,
	sendPrompt,
} from './harness';
import {
	archiveMerged,
	expectMerged,
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

test('Keep on a queued merge leaves the workstream open on Merged once it lands', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-merge-keep', null);
		await openWorkstream(page, 'e2e-merge-keep');
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
		const name = await workstreamName(page, 'e2e-merge-keep');
		await queueMerge(page);
		await expect(topBarStatus(page, 'Queued for merge · Waiting for checks')).toBeVisible({
			timeout: 30_000,
		});
		await captureFlow(app, 'merge-queue-keep-offered');

		await page.getByRole('button', { name: 'Keep this workstream after it merges' }).click();

		await expect(topBarStatus(page, 'Queued to merge and keep · Waiting for checks')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Keep this workstream after it merges' }),
		).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Cancel the queued merge' })).toBeEnabled();
		github.setPullRequest({ statusCheckRollup: PASSED });

		await expectMerged(page, 'e2e-merge-keep');
		expect(github.pullRequest()).toMatchObject({ state: 'MERGED' });
		await expect(sidebarStatus(page, 'e2e-merge-keep')).toHaveAttribute(
			'data-workstream-pull-request-state',
			'merged',
		);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'merge-queue-kept-merged');
		await archiveMerged(page, 'e2e-merge-keep', name);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a merged workstream a chat started opens its pull request from the number its row shows on hover', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		await invoke(app.page, 'repositories.create-lead', {
			scope: 'home',
			workstreamId: 'e2e-lead-ships',
			name: 'Ship hutch',
		});
		const { page, github } = await seedWorkstreamOnFakeGithub(
			app,
			'e2e-lead-merged',
			null,
			undefined,
			'e2e-lead-ships',
		);
		await openWorkstream(page, 'e2e-lead-merged');
		await sendPrompt(page, 'EDIT:alpha.txt COMMIT=feat: add alpha');
		await expectAssistantReply(page);
		await page.getByRole('button', { name: 'Open a draft pull request' }).click();
		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 30_000,
		});
		github.setPullRequest({
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: PASSED,
		});
		const name = await workstreamName(page, 'e2e-lead-merged');
		await queueMerge(page);
		await expectMergedAndArchived(page, 'e2e-lead-merged', name);

		await recordBrowser(app);
		await openWorkstream(page, 'e2e-lead-ships');
		const row = page
			.getByRole('list', { name: 'Workstreams' })
			.getByRole('listitem')
			.filter({ has: page.getByRole('group', { name: /^e2e\/hutch, .*, Merged #7, / }) });
		const openPullRequest = row.getByRole('button', { name: 'Open pull request #7 on GitHub' });
		await expect(row).toBeVisible({ timeout: 20_000 });
		const mergedAgo = row.getByText(/^(?:just now|\d+[mhd] ago)$/u);
		await page.mouse.move(0, 0);
		await expect(openPullRequest).toBeHidden();
		await expect(mergedAgo).toBeVisible();
		await clickRevealedOnHover(row, openPullRequest);
		await expect(mergedAgo).toBeHidden();
		await captureFlow(app, 'lead-workstream-pull-request-on-hover');
		await expect.poll(() => openedUrls(app)).toEqual(['https://github.com/e2e/hutch/pull/7']);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Draft all and Merge all on a chat ship the workstreams it started once their agents finish', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		await invoke(app.page, 'repositories.create-lead', {
			scope: 'home',
			workstreamId: 'e2e-lead-merges-all',
			name: 'Ship hutch',
		});
		const { page, github } = await seedWorkstreamOnFakeGithub(
			app,
			'e2e-lead-merges-child',
			null,
			undefined,
			'e2e-lead-merges-all',
		);
		await openWorkstream(page, 'e2e-lead-merges-all');
		await sendPrompt(page, 'Plan it');
		await expectAssistantReply(page);

		await openWorkstream(page, 'e2e-lead-merges-child');
		holdAgentRuns(app, true);
		await sendPrompt(page, 'EDIT:alpha.txt COMMIT=feat: add alpha');
		const name = await workstreamName(page, 'e2e-lead-merges-child');

		await openWorkstream(page, 'e2e-lead-merges-all');
		await expect(topBarStatus(page, /^0 of 1 merged · 1 working/u)).toBeVisible({
			timeout: 20_000,
		});
		const topBar = page.getByRole('navigation', { name: 'Global actions' });
		const draftAll = topBar.getByRole('button', {
			name: 'Open draft pull requests in 1 workstream',
		});
		const mergeAll = topBar.getByRole('button', { name: 'Merge 1 workstream' });
		await expect(draftAll).toBeEnabled();
		await expect(mergeAll).toBeEnabled();
		await captureFlow(app, 'lead-merge-all-offered');

		await draftAll.click();
		const tray = page.getByRole('region', { name: 'Jobs (1)', exact: true });
		const drafting = tray.getByRole('button', {
			name: `Open draft job in ${name}, Queued. The transcript opens once the job starts`,
		});
		await expect(drafting).toBeVisible({ timeout: 20_000 });
		await expect(mergeAll).toHaveCount(0);
		await expect(draftAll).toHaveCount(0);
		await page.waitForTimeout(2_000);
		await expect(drafting).toBeVisible();
		await captureFlow(app, 'lead-draft-all-queued');

		holdAgentRuns(app, false);
		await expect.poll(() => github.pullRequest(), { timeout: 60_000 }).not.toBeNull();
		expect(github.pullRequest()).toMatchObject({ isDraft: true, title: 'feat: add alpha' });

		await page
			.getByRole('navigation', { name: 'Connected repositories' })
			.getByTestId('sidebar-chat')
			.filter({ hasText: 'Ship hutch' })
			.hover();
		const card = page.getByTestId('sidebar-started-card');
		const mergeFromCard = card.getByRole('button', { name: 'Merge 1 workstream' });
		await expect(mergeFromCard).toBeVisible({ timeout: 30_000 });
		await expect(
			card.getByRole('button', { name: 'Open draft pull requests in 1 workstream' }),
		).toHaveCount(0);
		await captureFlow(app, 'lead-merge-all-card');
		github.setPullRequest({
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: PASSED,
		});
		await mergeFromCard.click();

		await expect(topBarStatus(page, /^1 of 1 merged/u)).toBeVisible({ timeout: 90_000 });
		expect(github.pullRequest()).toMatchObject({ state: 'MERGED', isDraft: false });
		await expect(mergeAll).toHaveCount(0);
		const jobs = await invoke<
			{ title: string; status: string; chatSessionId: string | null; origin: string }[]
		>(page, 'jobs.list-runs', undefined);
		const sessions = await invoke<{ id: string }[]>(page, 'chat.list-sessions', {
			workstreamId: 'e2e-lead-merges-all',
		});
		expect(
			jobs
				.filter(({ title }) => title === 'Open draft' || title === 'Merge')
				.map(({ title, status, chatSessionId, origin }) => [title, status, chatSessionId, origin])
				.sort(),
		).toEqual([
			['Merge', 'succeeded', sessions[0]?.id, 'merge-queue'],
			['Open draft', 'succeeded', sessions[0]?.id, 'merge-queue'],
		]);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'lead-merge-all-merged');

		await openJobs(page, '#/jobs/explorer');
		const explorer = page.getByTestId('automations-explorer');
		const map = explorer.getByRole('region', { name: 'System map' });
		const shipping = map.getByRole('button', { name: /^Shipping: \d+ started$/u });
		await expect(shipping).toBeVisible();
		await page.mouse.move(0, 0);
		await captureFlow(app, 'lead-ship-all-explorer');
		await map.getByRole('button', { name: 'Button clicked: 2 events' }).click();
		const clicks = explorer.getByRole('list', { name: 'Button clicked' });
		await expect(
			clicks.getByRole('button', { name: /^Button clicked: Draft all, Ship hutch, /u }),
		).toHaveCount(1);
		await expect(
			clicks.getByRole('button', { name: /^Button clicked: Merge all, Ship hutch, /u }),
		).toHaveCount(1);
		await shipping.click();
		const started = explorer
			.getByRole('list', { name: 'Shipping' })
			.getByRole('listitem')
			.filter({ hasText: 'Shipping heard button clicked' });
		await expect(started.getByRole('button', { name: /^Open draft, /u })).toHaveCount(1);
		await expect(started.getByRole('button', { name: /^Merge, /u })).toHaveCount(1);
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

test('a failing check starts a Fix checks job whose transcript opens from the Job center, the queue merges the fix, and the Explorer chains them from the read of GitHub', async () => {
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

		await openJobs(page, '#/jobs/explorer');
		const explorer = page.getByTestId('automations-explorer');
		await explorer
			.getByRole('region', { name: 'System map' })
			.getByRole('button', { name: /^Shipping: \d+ started$/u })
			.click();
		await explorer
			.getByRole('list', { name: 'Shipping' })
			.getByRole('button', { name: /^Fix checks, /u })
			.click();
		const chain = explorer.getByRole('list', { name: 'One chain' });
		await expect(
			chain.getByRole('button', { name: /^Pull request changed: #7, test failed, /u }),
		).toBeVisible();
		await expect(
			chain.getByRole('listitem').filter({ hasText: '#7 changed on GitHub' }),
		).toHaveCount(1);
		await expect(
			chain.getByRole('button', { name: /^Pull request changed: #7 merged, /u }),
		).toBeVisible();
		await captureFlow(app, 'merge-queue-explorer-chain');
		await explorer
			.getByRole('region', { name: 'System map' })
			.getByRole('button', { name: 'Button clicked: 1 event' })
			.click();
		await expect(
			explorer
				.getByRole('list', { name: 'Button clicked' })
				.getByRole('button', { name: /^Button clicked: Merge, Pull request workstream, /u }),
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
