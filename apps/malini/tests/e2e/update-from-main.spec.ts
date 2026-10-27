import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	expectCleanConsole,
	git,
	invoke,
	launchMalini,
	openWorkstream,
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

test('a workstream behind main stays as it is until you merge it, then the merge updates it from main, hands the conflicts to Resolve conflicts and pushes a two-parent merge', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await conflictingPullRequest(app, 'e2e-conflict');
		const branchHead = github.pushedHead();
		await openWorkstream(page, 'e2e-conflict');
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
				origin: 'merge-queue',
				parentRunId: null,
			},
		]);
		await captureFlow(app, 'update-from-main');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Abort merge takes a confirming click in the bar, then returns the worktree to its last commit', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, worktree } = await conflictingPullRequest(app, 'e2e-abort-merge');
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
			await commitFile(worktree, 'branch line\n', 'branch change');
			await commitFile(basePath, 'main line\n', 'main change');
		},
	);
}

async function commitFile(repo: string, contents: string, message: string): Promise<void> {
	writeFileSync(join(repo, 'conflict.txt'), contents);
	await git(repo, ['add', 'conflict.txt']);
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
