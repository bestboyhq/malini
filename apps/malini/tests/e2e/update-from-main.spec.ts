import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import type { JobDefinitionRecord, TimelineRecord } from '../../src/contract/jobs';
import {
	captureFlow,
	expectAssistantReply,
	expectCleanConsole,
	git,
	invoke,
	launchMalini,
	openWorkstream,
	sendPrompt,
	type LaunchedApp,
	type SeededWorkstream,
} from './harness';
import {
	expectMergedAndArchived,
	queueMerge,
	seedWorkstreamOnFakeGithub,
	topBarStatus,
	type PullRequestWorkstream,
} from './fake-github';

const execFileAsync = promisify(execFile);
const AUTHOR = ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e'];

test('a workstream behind main stays as it is until you merge it, then the merge updates it from main, Resolve conflicts takes the conflicts on its trigger without waking the chat there, and it pushes a two-parent merge', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await conflictingPullRequest(app, 'e2e-conflict');
		const branchHead = github.pushedHead();
		await openWorkstream(page, 'e2e-conflict');
		await sendPrompt(page, 'Look at the conflict file before we merge');
		await expectAssistantReply(page);
		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 30_000,
		});
		await expect(page.getByRole('status').filter({ hasText: 'Conflicts with main' })).toHaveCount(
			0,
		);
		await page.waitForTimeout(2_000);
		expect(await jobRuns(page)).toEqual([]);
		expect(await output(worktree, ['rev-parse', 'HEAD'])).toBe(branchHead);

		await queueMerge(page);

		await expectMergedAndArchived(page, 'e2e-conflict');
		const merge = github.pushedHead();
		const parents = (
			await output(github.remote, ['rev-list', '--parents', '-n', '1', merge])
		).split(' ');
		expect(parents).toEqual([
			merge,
			branchHead,
			await output(github.remote, ['rev-parse', 'main^']),
		]);
		expect(await output(github.remote, ['log', '-1', '--format=%s', merge])).toBe(
			"Merge remote-tracking branch 'origin/main' into malini/e2e-conflict",
		);
		expect(await output(github.remote, ['show', `${merge}:conflict.txt`])).toBe(
			'branch line\nmain line',
		);
		await expect(page.getByRole('region', { name: 'Jobs: 1 finished recently' })).toBeVisible();
		expect(await jobRuns(page)).toMatchObject([
			{
				title: 'Resolve conflicts',
				status: 'succeeded',
				origin: 'trigger',
				parentRunId: null,
			},
		]);
		expect(await invoke(page, 'jobs.list-decisions', undefined)).toEqual([]);
		const timeline = await invoke<TimelineRecord>(page, 'jobs.list-timeline', {
			since: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
		});
		const mergeClick = timeline.events.find(
			(event) =>
				event.channel === 'pull-requests:button-clicked' &&
				JSON.stringify(event.payload).includes('"button":"merge"'),
		);
		const conflict = timeline.events.find(
			(event) => event.channel === 'repositories:workstream-merge-conflicted',
		);
		expect(mergeClick?.cause).toBeNull();
		expect(conflict).toMatchObject({ cause: { kind: 'event' }, chainId: mergeClick?.chainId });
		expect(timeline.runs.find((run) => run.title === 'Resolve conflicts')).toMatchObject({
			chainId: mergeClick?.chainId,
			eventIds: [conflict?.id],
		});
		await captureFlow(app, 'update-from-main');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a merge behind main stops the background command its agent left running, then updates the branch and merges', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(
			app,
			'e2e-behind-background',
			{ liveHead: true, liveMergeable: true },
			async ({ basePath, worktree }: SeededWorkstream) => {
				await commitFile(worktree, 'branch.txt', 'branch line\n', 'branch change');
				await commitFile(basePath, 'main.txt', 'main line\n', 'main change');
			},
		);
		const branchHead = github.pushedHead();
		await openWorkstream(page, 'e2e-behind-background');
		await sendPrompt(page, 'BACKGROUND_COMMAND');
		const strip = page.getByRole('region', { name: '1 background command running' });
		await expect(strip).toContainText('Run the e2e suite', { timeout: 20_000 });

		await queueMerge(page);

		await expectMergedAndArchived(page, 'e2e-behind-background');
		const merge = github.pushedHead();
		expect(
			(await output(github.remote, ['rev-list', '--parents', '-n', '1', merge])).split(' '),
		).toEqual([merge, branchHead, await output(github.remote, ['rev-parse', 'main^'])]);
		await captureFlow(app, 'update-branch-stops-background-command');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('with Resolve conflicts off, Abort merge takes a confirming click in the bar, then returns the worktree to its last commit', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, worktree } = await conflictingPullRequest(app, 'e2e-abort-merge');
		await resolveConflictsOff(page);
		const head = await output(worktree, ['rev-parse', 'HEAD']);
		await git(worktree, [...AUTHOR, 'merge', 'main']).catch(() => undefined);
		expect(await output(worktree, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).not.toBe('');
		await openWorkstream(page, 'e2e-abort-merge');
		await expect(topBarStatus(page, 'Merge has conflicts')).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole('button', { name: 'Abort the merge in this workstream' }).click();
		const confirm = page.getByRole('button', { name: 'Confirm abort' });
		await expect(confirm).toBeVisible();
		await captureFlow(app, 'abort-merge-armed');
		await confirm.click();

		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 60_000,
		});
		expect(await output(worktree, ['rev-parse', 'HEAD'])).toBe(head);
		expect(await output(worktree, ['status', '--porcelain'])).toBe('');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a rebase stopped part-way needs you, and Abort rebase takes a confirming click before it returns the worktree to its last commit', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, worktree } = await conflictingPullRequest(app, 'e2e-abort-rebase');
		const head = await output(worktree, ['rev-parse', 'HEAD']);
		await git(worktree, [...AUTHOR, 'rebase', 'main']).catch(() => undefined);
		expect(await output(worktree, ['status'])).toContain('rebase');
		await openWorkstream(page, 'e2e-abort-rebase');
		await expect(topBarStatus(page, 'Rebase stopped part-way')).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole('button', { name: 'Abort the rebase in this workstream' }).click();
		const confirm = page.getByRole('button', { name: 'Confirm abort' });
		await expect(confirm).toBeVisible();
		expect(await output(worktree, ['status'])).toContain('rebase');
		await confirm.click();

		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 60_000,
		});
		expect(await output(worktree, ['rev-parse', 'HEAD'])).toBe(head);
		expect(await output(worktree, ['status', '--porcelain'])).toBe('');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function conflictingPullRequest(
	app: LaunchedApp,
	workstreamId: string,
): Promise<PullRequestWorkstream> {
	return seedWorkstreamOnFakeGithub(
		app,
		workstreamId,
		{ liveHead: true, liveMergeable: true },
		async ({ basePath, worktree }: SeededWorkstream) => {
			await commitFile(worktree, 'conflict.txt', 'branch line\n', 'branch change');
			await commitFile(basePath, 'conflict.txt', 'main line\n', 'main change');
		},
	);
}

async function resolveConflictsOff(page: Page): Promise<void> {
	const definitions = await invoke<JobDefinitionRecord[]>(page, 'jobs.list-definitions', undefined);
	const resolver = definitions.find((definition) => definition.builtin === 'resolve-conflicts');
	if (!resolver?.trigger) throw new Error('Resolve conflicts has no trigger');
	await invoke(page, 'jobs.save-definition', {
		...resolver,
		trigger: { ...resolver.trigger, mode: 'off' },
	});
}

async function commitFile(
	repo: string,
	file: string,
	contents: string,
	message: string,
): Promise<void> {
	writeFileSync(join(repo, file), contents);
	await git(repo, ['add', file]);
	await git(repo, [...AUTHOR, 'commit', '-qm', message]);
}

function jobRuns(
	page: Page,
): Promise<{ title: string; status: string; origin: string; parentRunId: string | null }[]> {
	return invoke(page, 'jobs.list-runs', undefined);
}

async function output(repo: string, args: readonly string[]): Promise<string> {
	return (await execFileAsync('git', [...args], { cwd: repo })).stdout.trim();
}
