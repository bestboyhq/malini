import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	sendPrompt,
	type SeededWorkstream,
} from './harness';
import {
	holdAgentRuns,
	seedWorkstreamOnFakeGithub,
	sidebarStatus,
	topBarStatus,
	type FakeGithub,
} from './fake-github';

const FAILED = [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }];
const RUNNING = [{ name: 'test', status: 'IN_PROGRESS', conclusion: null }];
const PASSED = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const SOONER_THAN_THE_TOP_BAR_READS_AGAIN_MS = 8_000;

test('a check that fails on a draft starts Fix checks on its own, Malini pushes the fix, and the draft stays a draft once the check passes', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(
			app,
			'e2e-draft-fix-checks',
			null,
			commitWorkflow,
		);
		await openWorkstream(page, 'e2e-draft-fix-checks');
		await sendPrompt(page, 'EDIT:alpha.txt COMMIT=feat: add alpha');
		await expectAssistantReply(page);
		await page.getByRole('button', { name: 'Open a draft pull request' }).click();
		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 30_000,
		});
		holdAgentRuns(app, true);

		github.setPullRequest({
			statusCheckRollup: FAILED,
			checksHead: github.pushedHead(),
			nextChecks: RUNNING,
		});

		await expect(topBarStatus(page, /^Clearing blockers/u)).toBeVisible({ timeout: 60_000 });
		const automations = page.getByRole('list', { name: 'Automations', exact: true });
		await expect(
			automations.getByRole('link', { name: 'Fix checks, Running', exact: true }),
		).toBeVisible({ timeout: 30_000 });
		await captureFlow(app, 'draft-fix-checks-running');

		holdAgentRuns(app, false);
		await expect
			.poll(() => github.pushedSubjects()[0], { timeout: 60_000 })
			.toBe('Fix failing checks');
		const reads = pullRequestReads(github);
		await expect
			.poll(() => pullRequestReads(github), { timeout: 30_000 })
			.toBeGreaterThan(reads + 1);
		github.setPullRequest({ nextChecks: PASSED });

		await expect(automations).toHaveCount(0, { timeout: 60_000 });
		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 30_000,
		});
		await expect(sidebarStatus(page, 'e2e-draft-fix-checks')).toHaveAccessibleName(
			/ · Draft pull request$/u,
		);
		expect(github.pullRequest()).toMatchObject({ isDraft: true, state: 'OPEN' });
		expect(readiedOrMerged(github)).toEqual([]);
		await expect(topBarStatus(page, /^Ready to merge/u)).toBeVisible({
			timeout: SOONER_THAN_THE_TOP_BAR_READS_AGAIN_MS,
		});
		await captureFlow(app, 'draft-fix-checks-pushed');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the top bar shows the checks Malini reads on a draft before it reads them itself', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(
			app,
			'e2e-draft-checks-read',
			null,
			commitWorkflow,
		);
		await openWorkstream(page, 'e2e-draft-checks-read');
		await sendPrompt(page, 'EDIT:alpha.txt COMMIT=feat: add alpha');
		await expectAssistantReply(page);
		await page.getByRole('button', { name: 'Open a draft pull request' }).click();
		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeEnabled({
			timeout: 30_000,
		});

		github.setPullRequest({ statusCheckRollup: RUNNING });
		await expect(topBarStatus(page, /^Checks running/u)).toBeVisible({ timeout: 30_000 });
		github.setPullRequest({ statusCheckRollup: PASSED });

		await expect(topBarStatus(page, /^Ready to merge/u)).toBeVisible({
			timeout: SOONER_THAN_THE_TOP_BAR_READS_AGAIN_MS,
		});
		await captureFlow(app, 'draft-checks-read');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function commitWorkflow({ worktree }: SeededWorkstream): Promise<void> {
	mkdirSync(join(worktree, '.github', 'workflows'), { recursive: true });
	writeFileSync(join(worktree, '.github', 'workflows', 'ci.yml'), 'on: pull_request\n');
	git(worktree, 'add', '.github');
	git(worktree, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '-qm', 'ci');
}

function pullRequestReads(github: FakeGithub): number {
	return github
		.calls()
		.filter(([command, sub]) => command === 'pr' && (sub === 'view' || sub === 'list')).length;
}

function readiedOrMerged(github: FakeGithub): string[][] {
	return github
		.calls()
		.filter(([command, sub]) => command === 'pr' && (sub === 'ready' || sub === 'merge'));
}

function git(repo: string, ...args: string[]): string {
	return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}
