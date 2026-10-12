import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { captureFlow, expectCleanConsole, launchMalini, openWorkstream } from './harness';
import {
	WORKSTREAM_NAME,
	expectMergedAndArchived,
	queueMerge,
	reviewThread,
	seedWorkstreamOnFakeGithub,
	sidebarStatus,
	toastSaying,
	type FakeGithub,
	topBarStatus,
} from './fake-github';

const BOT = { author: 'coderabbitai[bot]', authorType: 'Bot' } as const;
const PASSED = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const BOT_THREAD = 'Rename this helper. EDIT:a.txt RESOLVE:PRRT_bot';
const HUMAN_THREAD = 'Add a test for the empty case. EDIT:b.txt RESOLVE:PRRT_human';

test('a queued merge has the agent address and resolve bot review threads and leaves human threads to you', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-threads', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'BLOCKED',
			statusCheckRollup: PASSED,
			reviewThreads: [
				reviewThread('PRRT_bot', 'a.txt', BOT_THREAD, BOT),
				reviewThread('PRRT_human', 'b.txt', HUMAN_THREAD),
			],
		});
		await openWorkstream(page, 'e2e-threads');

		await queueMerge(page);

		await expect(topBarStatus(page, 'Needs you · Reviewer needs a reply')).toBeVisible({
			timeout: 90_000,
		});
		await expect(page.getByRole('button', { name: 'Open the pull request on GitHub' })).toHaveText(
			'Open PR',
		);
		await expect(
			toastSaying(page, `${WORKSTREAM_NAME} needs you · Reviewer needs a reply`),
		).toBeVisible();
		const status = sidebarStatus(page, 'e2e-threads');
		await expect(status).toHaveAttribute('data-workstream-pull-request-state', 'needs-you');
		await expect(status).toHaveAccessibleName(/ · Needs you · Reviewer needs a reply$/u);
		await captureFlow(app, 'pull-request-review-threads');

		const pushed = github.pushedHead();
		expect(github.pushedSubjects()[0]).toBe('Address review feedback');
		expect(threadStates(github)).toEqual([
			['PRRT_bot', true],
			['PRRT_human', false],
		]);
		expect(github.reviewThreads().map(({ comments }) => comments.map(({ body }) => body))).toEqual([
			[BOT_THREAD, `Addressed in ${pushed.slice(0, 7)}.`],
			[HUMAN_THREAD],
		]);
		expect(mutatedThreads(github)).toEqual([
			['addPullRequestReviewThreadReply', 'threadId=PRRT_bot'],
			['resolveReviewThread', 'threadId=PRRT_bot'],
		]);
		expect(existsSync(join(worktree, 'a.txt'))).toBe(true);
		expect(existsSync(join(worktree, 'b.txt'))).toBe(false);
		expect(github.calls().filter(([command, sub]) => command === 'pr' && sub === 'merge')).toEqual(
			[],
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('bot review threads the branch already addresses are resolved without a push, then the queue merges', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-addressed', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: PASSED,
			reviewThreads: [
				reviewThread('PRRT_rename', 'a.txt', 'Rename this helper. RESOLVE:PRRT_rename', BOT),
				reviewThread('PRRT_tests', 'b.txt', 'Add a test. RESOLVE:PRRT_tests', BOT),
			],
		});
		const pushed = github.pushedHead();
		await openWorkstream(page, 'e2e-addressed');

		await queueMerge(page);

		await expectMergedAndArchived(page, 'e2e-addressed');
		expect(threadStates(github)).toEqual([
			['PRRT_rename', true],
			['PRRT_tests', true],
		]);
		expect(github.reviewThreads().map(({ comments }) => comments.at(-1)?.body)).toEqual([
			`Already addressed in ${pushed.slice(0, 7)}.`,
			`Already addressed in ${pushed.slice(0, 7)}.`,
		]);
		expect(github.pushedHead()).toBe(pushed);
		expect(github.calls().find(([command, sub]) => command === 'pr' && sub === 'merge')).toContain(
			pushed,
		);
		await captureFlow(app, 'pull-request-review-threads-already-addressed');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

function threadStates(github: FakeGithub): [string, boolean][] {
	return github.reviewThreads().map(({ id, isResolved }) => [id, isResolved]);
}

function mutatedThreads(github: FakeGithub): (string | undefined)[][] {
	return github
		.graphqlMutations()
		.map((args) => [
			args.find((arg) => arg.startsWith('query='))?.match(/^query=mutation[^{]*\{\s*(\w+)/u)?.[1],
			args.find((arg) => arg.startsWith('threadId=')),
		]);
}
