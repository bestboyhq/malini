import { expect, test } from '@playwright/test';
import {
	captureFlow,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
} from './harness';
import {
	headOf,
	openPullRequestDetail,
	reviewThread,
	seedWorkstreamOnFakeGithub,
} from './fake-github';

test('Commit and push replies to and resolves exactly the review threads the fix run addressed', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-threads', {
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			reviewThreads: [
				reviewThread(
					'PRRT_rename',
					'a.txt',
					'Rename this helper. EDIT:a.txt RESOLVE:PRRT_rename COMMIT=fix(review): rename the helper',
				),
				reviewThread('PRRT_tests', 'b.txt', 'Add a test for the empty case.'),
			],
		});
		await openWorkstream(page, 'e2e-threads');

		const fix = page.getByRole('button', { name: 'Resolve pull request review blockers #7' });
		await expect(fix).toBeEnabled({ timeout: 30_000 });
		await fix.click();
		await expectAssistantReply(page);

		const push = page.getByRole('button', { name: 'Commit and push changes #7', exact: true });
		await expect(push).toBeEnabled({ timeout: 30_000 });
		await push.click();

		await expect
			.poll(() => github.reviewThreads().map(({ id, isResolved }) => [id, isResolved]), {
				timeout: 30_000,
			})
			.toEqual([
				['PRRT_rename', true],
				['PRRT_tests', false],
			]);
		await expect(
			page.getByRole('status').filter({ hasText: 'Changes committed and pushed' }),
		).toHaveText('Changes committed and pushed · 1 review thread resolved', { timeout: 30_000 });
		const pushed = github.pushedHead();
		expect(github.pushedSubjects()[0]).toBe('fix(review): rename the helper');
		expect(github.reviewThreads().map(({ comments }) => comments.map(({ body }) => body))).toEqual([
			[
				'Rename this helper. EDIT:a.txt RESOLVE:PRRT_rename COMMIT=fix(review): rename the helper',
				`Addressed in ${pushed.slice(0, 7)}.`,
			],
			['Add a test for the empty case.'],
		]);
		expect(
			github
				.graphqlMutations()
				.map((args) => [
					args
						.find((arg) => arg.startsWith('query='))
						?.match(/^query=mutation[^{]*\{\s*(\w+)/u)?.[1],
					args.find((arg) => arg.startsWith('threadId=')),
				]),
		).toEqual([
			['addPullRequestReviewThreadReply', 'threadId=PRRT_rename'],
			['resolveReviewThread', 'threadId=PRRT_rename'],
		]);

		github.setPullRequest({ headRefOid: pushed });
		const detail = await openPullRequestDetail(page);
		await detail.getByRole('button', { name: 'Refresh' }).click();
		await expect(detail).toBeHidden();
		await expect(await openPullRequestDetail(page)).toContainText('1 unresolved thread', {
			timeout: 30_000,
		});
		await page.keyboard.press('Escape');
		await expect(
			page.getByRole('button', { name: 'Resolve pull request review blockers #7' }),
		).toBeEnabled({ timeout: 30_000 });
		await captureFlow(app, 'pull-request-review-threads');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a fix run that finds the review threads already addressed on GitHub resolves them without a push', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, github, worktree } = await seedWorkstreamOnFakeGithub(app, 'e2e-addressed', {
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			reviewThreads: [
				reviewThread('PRRT_rename', 'a.txt', 'Rename this helper. RESOLVE:PRRT_rename'),
				reviewThread('PRRT_tests', 'b.txt', 'Add a test for the empty case. RESOLVE:PRRT_tests'),
			],
		});
		const pushed = github.pushedHead();
		expect(headOf(worktree)).toBe(pushed);
		await openWorkstream(page, 'e2e-addressed');

		const fix = page.getByRole('button', { name: 'Resolve pull request review blockers #7' });
		await expect(fix).toBeEnabled({ timeout: 30_000 });
		await fix.click();
		await page.mouse.move(0, 0);
		await expectAssistantReply(page);

		await expect
			.poll(() => github.reviewThreads().map(({ id, isResolved }) => [id, isResolved]), {
				timeout: 30_000,
			})
			.toEqual([
				['PRRT_rename', true],
				['PRRT_tests', true],
			]);
		expect(github.reviewThreads().map(({ comments }) => comments.at(-1)?.body)).toEqual([
			`Already addressed in ${pushed.slice(0, 7)}.`,
			`Already addressed in ${pushed.slice(0, 7)}.`,
		]);
		await expect(fix).toHaveCount(0, { timeout: 30_000 });
		await expect(page.getByRole('button', { name: 'Merge pull request #7' })).toBeVisible();
		await expect(
			page.getByRole('status').filter({ hasText: 'review threads resolved' }),
		).toHaveText('2 review threads resolved · already addressed on GitHub');
		expect(github.pushedHead()).toBe(pushed);
		expect(headOf(worktree)).toBe(pushed);
		await captureFlow(app, 'pull-request-review-threads-already-addressed');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
