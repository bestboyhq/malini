import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
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
const KEEP_EXPLAINER = 'Skip archiving after the merge';
const FAILED = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];
const FLAKY_JOB = 'e2e on macOS 3/5';
const WORKERS_BUILDS = 85455;
const SILENT_APP = 29110;
const WORKERS_BUILD_PASSED = {
	name: 'Workers Builds: hutch',
	status: 'COMPLETED',
	conclusion: 'SUCCESS',
};

function checkSuite(app: number, status: string, runs: number) {
	const minuteAgo = new Date(Date.now() - 60_000).toISOString();
	return {
		app: { id: app },
		status,
		latest_check_runs_count: runs,
		created_at: minuteAgo,
		updated_at: minuteAgo,
	};
}

function actionsJob(conclusion: string | null, completedAt: string | null = null) {
	return [
		{
			name: FLAKY_JOB,
			status: conclusion === null ? 'IN_PROGRESS' : 'COMPLETED',
			conclusion,
			detailsUrl: 'https://github.com/e2e/hutch/actions/runs/41/job/410',
			completedAt,
		},
	];
}

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

		await page.getByRole('button', { name: 'Keep this workstream after it merges' }).hover();
		await expect(page.getByRole('tooltip')).toHaveText(KEEP_EXPLAINER);
		await captureFlow(app, 'merge-queue-keep-tooltip');
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

		const leadRow = page.getByTestId('sidebar-chat').filter({ hasText: 'Ship hutch' });
		await expect(leadRow.getByTestId('sidebar-progress')).toHaveAccessibleName(/^1 workstream/u);
		await clickRevealedOnHover(
			row,
			row.getByRole('button', { name: `Clear ${name} from Started here` }),
		);
		await expect(row).toHaveCount(0);
		await expect(leadRow.getByTestId('sidebar-progress')).toHaveCount(0);
		await page.reload();
		await expect(leadRow).toBeVisible({ timeout: 20_000 });
		await expect(
			page.getByTestId('sidebar-archived-workstream').filter({ hasText: name }),
		).toBeVisible();
		await expect(leadRow.getByTestId('sidebar-progress')).toHaveCount(0);
		await expect(page.getByRole('list', { name: 'Workstreams' })).toHaveCount(0);
		await expect(page.getByTestId('global-topbar-github-headline')).toHaveAccessibleName(
			/^All merged/u,
		);
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
		await expect(page.getByTestId('lead-timeline')).toContainText('Hello from the fake bridge', {
			timeout: 30_000,
		});

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

test('the queue waits for a Workers build that has not posted its check yet, and merges once it passes', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-merge-workers-build', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: PASSED,
			checkSuites: [checkSuite(WORKERS_BUILDS, 'queued', 0), checkSuite(SILENT_APP, 'queued', 0)],
			reportingApps: [WORKERS_BUILDS],
		});
		await openWorkstream(page, 'e2e-merge-workers-build');
		const name = await workstreamName(page, 'e2e-merge-workers-build');
		await queueMerge(page);

		await expect(topBarStatus(page, 'Queued for merge · Waiting for checks')).toBeVisible({
			timeout: 30_000,
		});
		const reads = checkSuiteReads(github);
		await expect
			.poll(() => checkSuiteReads(github), { timeout: 30_000 })
			.toBeGreaterThan(reads + 2);
		expect(mergeCalls(github)).toEqual([]);
		await captureFlow(app, 'merge-queue-waiting-for-workers-build');

		github.setPullRequest({
			statusCheckRollup: [...PASSED, WORKERS_BUILD_PASSED],
			checkSuites: [
				checkSuite(WORKERS_BUILDS, 'completed', 1),
				checkSuite(SILENT_APP, 'queued', 0),
			],
		});

		await expectMergedAndArchived(page, 'e2e-merge-workers-build', name);
		expect(mergeCalls(github)).toHaveLength(1);
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

		await expect(topBarStatus(page, 'Queued for merge · Fixing test')).toBeVisible({
			timeout: 30_000,
		});
		expect(rerunCalls(github)).toEqual([]);
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
		await expect(page.getByRole('list', { name: 'Jobs in progress' })).toHaveCount(0);

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

test('a failing GitHub Actions job is re-run once, and the queue merges when the re-run passes, with no agent', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-rerun-passes', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: actionsJob('FAILURE', '2026-10-30T14:23:21Z'),
			rerunChecks: actionsJob(null),
		});
		github.setPullRequest({ checksHead: github.pushedHead() });
		await openWorkstream(page, 'e2e-rerun-passes');

		await queueMerge(page);

		await expect(topBarStatus(page, `Queued for merge · Re-running ${FLAKY_JOB}`)).toBeVisible({
			timeout: 30_000,
		});
		expect(rerunCalls(github)).toEqual([
			['api', '-X', 'POST', 'repos/e2e/hutch/actions/runs/41/rerun-failed-jobs'],
		]);
		await captureFlow(app, 'merge-queue-rerunning-checks');

		github.setPullRequest({ statusCheckRollup: actionsJob('SUCCESS', '2026-10-30T14:46:10Z') });
		await expectMergedAndArchived(page, 'e2e-rerun-passes');
		expect(rerunCalls(github)).toHaveLength(1);
		expect(await fixChecksRuns(app.page)).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a re-run that fails again starts Fix checks, which hears the failure repeats, and the queue merges its fix', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-rerun-fails', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: actionsJob('FAILURE', '2026-10-30T14:23:21Z'),
			rerunChecks: actionsJob('FAILURE'),
			nextChecks: actionsJob('SUCCESS', '2026-10-30T15:02:00Z'),
		});
		github.setPullRequest({ checksHead: github.pushedHead() });
		await openWorkstream(page, 'e2e-rerun-fails');
		holdAgentRuns(app, true);

		await queueMerge(page);

		await expect(topBarStatus(page, `Queued for merge · Fixing ${FLAKY_JOB}`)).toBeVisible({
			timeout: 30_000,
		});
		expect(rerunCalls(github)).toHaveLength(1);
		await captureFlow(app, 'merge-queue-fixing-after-rerun');
		await page
			.getByRole('region', { name: 'Jobs: 1 running' })
			.getByRole('link', { name: 'Open transcript: Fix checks · Pull request workstream, Running' })
			.click();
		await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBeNull();
		await expect(
			page.locator(
				`[data-testid="chat-message-viewport"][data-session-id="${currentSessionId(page)}"]`,
			),
		).toContainText('Malini already re-ran these checks once and they failed again', {
			timeout: 20_000,
		});

		holdAgentRuns(app, false);
		await expectAssistantReply(page);
		await expectMergedAndArchived(page, 'e2e-rerun-fails');
		expect(rerunCalls(github)).toHaveLength(1);
		expect(await fixChecksRuns(app.page)).toHaveLength(1);
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

test('a merge GitHub blocks needs you once in a toast, offers no blind Retry, and picks up on its own once GitHub unblocks it', async () => {
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

		const detail = await openPullRequestDetail(page);
		await expect(detail.getByRole('button', { name: 'Cancel merge' })).toBeVisible();
		await expect(detail.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
		github.setPullRequest({ mergeStateStatus: 'CLEAN' });

		await expectMergedAndArchived(page, 'e2e-merge-blocked');
		expect(mergeCalls(github)).toHaveLength(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a Fix checks job that keeps failing gives up, says so once, and Retry merge in the transcript Open job shows queues it again', async () => {
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
		await expect(page.getByRole('region', { name: /^Jobs: .*needs? you/u })).toHaveCount(0);
		expect(mergeCalls(github)).toEqual([]);

		await page.getByRole('button', { name: 'Open the transcript of the job that stopped' }).click();
		await expect(page.getByRole('tab', { name: /Job: Fix checks/u })).toHaveAttribute(
			'aria-current',
			'page',
			{ timeout: 20_000 },
		);
		const stopped = page.getByRole('region', { name: 'Merge stopped on this job' });
		await expect(stopped).toContainText('Malini tried 3 times');
		await captureFlow(app, 'merge-queue-retry-merge-in-job');

		github.setPullRequest({
			checksHead: github.pushedHead(),
			statusCheckRollup: FAILED,
			nextChecks: PASSED,
		});
		await stopped.getByRole('button', { name: 'Retry merge' }).click();
		await expect(stopped).toHaveCount(0, { timeout: 20_000 });

		await expectMergedAndArchived(page, 'e2e-fix-gave-up');
		expect(mergeCalls(github)).toHaveLength(1);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a prompt in a workstream whose pull request merged on GitHub first starts it over on the latest main, and keeps the prompt when it cannot', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ allowedDiagnostics: [/Couldn't reach github\.com/u] });
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
		await expect(page.getByRole('button', { name: /^Continue/u })).toHaveCount(0);

		github.setOffline(true);
		await sendPrompt(page, 'EDIT:beta.txt COMMIT=feat: add beta');
		await expect(toastSaying(page, 'Continue failed')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('chat-composer-input')).toContainText(
			'EDIT:beta.txt COMMIT=feat: add beta',
		);
		await expect(topBarStatus(page, 'Merged')).toBeVisible();
		expect(existsSync(join(worktree, 'beta.txt'))).toBe(false);

		github.setOffline(false);
		await page.getByTestId('chat-composer-submit').click();
		await expect(topBarStatus(page, '1 file changed')).toBeVisible({ timeout: 60_000 });
		expect(readFileSync(join(worktree, 'beta.txt'), 'utf8')).not.toBe('');
		await expect
			.poll(() =>
				execFileSync('git', ['-C', worktree, 'log', '-1', '--format=%s'], {
					encoding: 'utf8',
				}).trim(),
			)
			.toBe('feat: add beta');
		expect(revParse(worktree, 'HEAD^')).toBe(revParse(github.remote, 'refs/heads/main'));
		const branch = revParse(worktree, '--abbrev-ref', 'HEAD');
		expect(() => revParse(github.remote, '--verify', `refs/heads/${branch}`)).toThrow();
		await expect(page.getByRole('button', { name: 'Open a draft pull request' })).toBeEnabled();
		await captureFlow(app, 'merge-queue-continue-next-change');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

function rerunCalls(github: FakeGithub): string[][] {
	return github
		.calls()
		.filter((args) => args[0] === 'api' && args.some((arg) => arg.endsWith('/rerun-failed-jobs')));
}

async function fixChecksRuns(page: Page): Promise<{ title: string }[]> {
	const runs = await invoke<{ title: string }[]>(page, 'jobs.list-runs', undefined);
	return runs.filter((run) => run.title === 'Fix checks');
}

function checkSuiteReads(github: FakeGithub): number {
	return github
		.calls()
		.filter(([command, sub]) => command === 'api' && sub?.includes('/check-suites')).length;
}

function mergeCalls(github: FakeGithub): string[][] {
	return github.calls().filter(([command, sub]) => command === 'pr' && sub === 'merge');
}

function revParse(repo: string, ...args: string[]): string {
	return execFileSync('git', ['-C', repo, 'rev-parse', ...args], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	}).trim();
}
