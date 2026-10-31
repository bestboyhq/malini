import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import type { JobBuiltin, JobDefinitionRecord, TimelineRecord } from '../../src/contract/jobs';
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
const TEN_LINES = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n';
const AUTHOR = ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e'];

test('with Update from main off, a workstream that conflicts with main stays as it is until you merge it, then the merge updates it from main, Resolve conflicts takes the conflicts on its trigger without waking the chat there, and it pushes a two-parent merge', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		await jobOff(app.page, 'update-from-main');
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

test('a draft that main starts to conflict with gets main merged in, the conflict resolved and the merge pushed, before anyone merges, without waking its chat', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ env: { MALINI_BASE_FETCH_MS: '1000' } });
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-overlap', null);
		await openWorkstream(page, 'e2e-overlap');
		await sendPrompt(page, 'EDIT:conflict.txt COMMIT=feat: add the conflict file');
		await expectAssistantReply(page);
		const draft = page.getByRole('button', { name: 'Open a draft pull request' });
		await expect(draft).toHaveText('Draft', { timeout: 30_000 });
		await draft.click();
		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 30_000,
		});
		const branchHead = await output(worktree, ['rev-parse', 'HEAD']);
		expect(github.pushedHead()).toBe(branchHead);

		const mainHead = await commitToMain(app, github.remote, 'conflict.txt', 'main line\n');

		await expect
			.poll(
				async () =>
					(await jobRuns(page)).map(({ title, status, origin }) => [title, status, origin]),
				{ timeout: 60_000 },
			)
			.toEqual([
				['Resolve conflicts', 'succeeded', 'trigger'],
				['Update from main', 'succeeded', 'trigger'],
			]);
		await expect
			.poll(() => output(worktree, ['rev-list', '--parents', '-n', '1', 'HEAD']), {
				timeout: 30_000,
			})
			.toMatch(new RegExp(`^[0-9a-f]{40} ${branchHead} ${mainHead}$`, 'u'));
		const merge = await output(worktree, ['rev-parse', 'HEAD']);
		expect(await output(worktree, ['show', 'HEAD:conflict.txt'])).toMatch(
			/^agent edit \S+\nmain line$/u,
		);
		await expect.poll(() => github.pushedHead(), { timeout: 30_000 }).toBe(merge);
		expect(await output(worktree, ['status', '--porcelain'])).toBe('');
		expect(await invoke(page, 'jobs.list-decisions', undefined)).toEqual([]);

		const timeline = await invoke<TimelineRecord>(page, 'jobs.list-timeline', {
			since: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
		});
		const overlaps = timeline.events.filter(
			(event) => event.channel === 'repositories:workstream-base-overlapped',
		);
		expect(overlaps.map((event) => event.payload)).toEqual([
			{
				workstreamId: 'e2e-overlap',
				baseBranch: 'main',
				head: branchHead,
				baseHead: mainHead,
				behind: 1,
				conflicts: true,
				conflictedPaths: ['conflict.txt'],
				overlappingPaths: ['conflict.txt'],
			},
		]);
		expect(timeline.runs.find((run) => run.title === 'Update from main')).toMatchObject({
			eventIds: [overlaps[0]?.id],
		});
		await captureFlow(app, 'base-overlap-resolved');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('main changing only files a workstream left alone leaves it as it is, and main changing a file it changed merges main in without an agent', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ env: { MALINI_BASE_FETCH_MS: '1000' } });
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(
			app,
			'e2e-overlap-clean',
			null,
			async ({ basePath, worktree }: SeededWorkstream) => {
				await commitFile(worktree, 'lines.txt', TEN_LINES, 'add lines');
				await git(basePath, ['merge', '-q', '--ff-only', 'malini/e2e-overlap-clean']);
				await commitFile(worktree, 'lines.txt', TEN_LINES.replace('1\n', 'one\n'), 'line one');
				await commitFile(basePath, 'other.txt', 'main line\n', 'main changes another file');
			},
		);
		const branchHead = await output(worktree, ['rev-parse', 'HEAD']);
		await expect
			.poll(() => output(worktree, ['rev-parse', 'origin/main']), { timeout: 30_000 })
			.toBe(await output(github.remote, ['rev-parse', 'main']));
		await page.waitForTimeout(3_000);
		expect(await jobRuns(page)).toEqual([]);
		expect(await output(worktree, ['rev-parse', 'HEAD'])).toBe(branchHead);

		const mainHead = await commitToMain(
			app,
			github.remote,
			'lines.txt',
			TEN_LINES.replace('10\n', 'ten\n'),
		);

		await expect
			.poll(
				async () =>
					(await jobRuns(page)).map(({ title, status, origin, detail }) => [
						title,
						status,
						origin,
						detail,
					]),
				{ timeout: 60_000 },
			)
			.toEqual([['Update from main', 'succeeded', 'trigger', 'Merged 2 commits from main']]);
		expect(
			(await output(worktree, ['rev-list', '--parents', '-n', '1', 'HEAD'])).split(' ').slice(1),
		).toEqual([branchHead, mainHead]);
		expect(await output(worktree, ['show', 'HEAD:lines.txt'])).toBe(
			TEN_LINES.replace('1\n', 'one\n').replace('10\n', 'ten\n').trim(),
		);
		const timeline = await invoke<TimelineRecord>(page, 'jobs.list-timeline', {
			since: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
		});
		expect(
			timeline.events
				.filter((event) => event.channel === 'repositories:workstream-base-overlapped')
				.map((event) => event.payload),
		).toEqual([
			{
				workstreamId: 'e2e-overlap-clean',
				baseBranch: 'main',
				head: branchHead,
				baseHead: mainHead,
				behind: 2,
				conflicts: false,
				conflictedPaths: [],
				overlappingPaths: ['lines.txt'],
			},
		]);
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
		await jobOff(page, 'resolve-conflicts');
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

async function jobOff(page: Page, builtin: JobBuiltin): Promise<void> {
	const definitions = await invoke<JobDefinitionRecord[]>(page, 'jobs.list-definitions', undefined);
	const job = definitions.find((definition) => definition.builtin === builtin);
	if (!job?.trigger) throw new Error(`${builtin} has no trigger`);
	await invoke(page, 'jobs.save-definition', { ...job, trigger: { ...job.trigger, mode: 'off' } });
}

async function commitToMain(
	app: LaunchedApp,
	remote: string,
	file: string,
	contents: string,
): Promise<string> {
	const mover = join(app.root, 'main-mover');
	await execFileAsync('git', ['clone', '-q', remote, mover]);
	await commitFile(mover, file, contents, `main changes ${file}`);
	await git(mover, ['push', '-q', 'origin', 'main']);
	return output(remote, ['rev-parse', 'main']);
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

function jobRuns(page: Page): Promise<
	{
		title: string;
		status: string;
		origin: string;
		parentRunId: string | null;
		detail: string | null;
	}[]
> {
	return invoke(page, 'jobs.list-runs', undefined);
}

async function output(repo: string, args: readonly string[]): Promise<string> {
	return (await execFileAsync('git', [...args], { cwd: repo })).stdout.trim();
}
