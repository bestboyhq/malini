import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	sendPrompt,
} from './harness';
import { openPullRequestDetail, seedWorkstreamOnFakeGithub, type FakeGithub } from './fake-github';

test('every push retitles the pull request malini opened after the whole branch until the user edits it', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-title', null);
		await openWorkstream(page, 'e2e-title');

		await runAndPush(
			page,
			'EDIT:a.txt COMMIT=feat(git): add the first half',
			'Commit and push changes',
		);
		await expect
			.poll(() => github.pullRequest()?.title, { timeout: 30_000 })
			.toBe('feat(git): add the first half');

		await runAndPush(
			page,
			'EDIT:b.txt COMMIT=fix(git): add the second half PR=feat(git): add both halves',
		);
		await expect
			.poll(() => github.pullRequest()?.title, { timeout: 30_000 })
			.toBe('feat(git): add both halves');
		expect(github.pullRequest()?.body).toContain('feat(git): add both halves');
		expect(github.pushedSubjects()[0]).toBe('fix(git): add the second half');

		await runAndPush(page, 'EDIT:d.txt COMMIT=style(git): format the second half');
		await expect.poll(() => github.pullRequest()?.body, { timeout: 30_000 }).toContain('d.txt');
		expect(github.pushedSubjects()[0]).toBe('style(git): format the second half');
		expect(github.pullRequest()?.title).toBe('feat(git): add both halves');
		expect(github.pullRequest()?.body).toContain('feat(git): add both halves');

		github.setPullRequest({ title: 'Split the git work in two' });
		await runAndPush(
			page,
			'EDIT:c.txt COMMIT=fix(git): add the third half PR=feat(git): add all three halves',
		);
		await expect
			.poll(() => github.pullRequest()?.body, { timeout: 30_000 })
			.toContain('feat(git): add all three halves');
		expect(github.pullRequest()?.title).toBe('Split the git work in two');

		await mergeFromTheTopBar(page, github);
		await expect
			.poll(() => github.calls().find(([command, sub]) => command === 'pr' && sub === 'merge'), {
				timeout: 30_000,
			})
			.toEqual([
				'pr',
				'merge',
				'7',
				'--match-head-commit',
				github.pushedHead(),
				'--squash',
				'--subject',
				'Split the git work in two (#7)',
			]);
		await captureFlow(app, 'pull-request-title');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

async function runAndPush(
	page: Page,
	prompt: string,
	pushLabel = 'Commit and push changes #7',
): Promise<void> {
	const replies = await page.getByTestId('chat-message-bubble').count();
	await sendPrompt(page, prompt);
	await expect(page.getByTestId('chat-message-bubble')).toHaveCount(replies + 1, {
		timeout: 30_000,
	});
	await expectAssistantReply(page);
	const push = page.getByRole('button', { name: pushLabel, exact: true });
	await expect(push).toBeEnabled({ timeout: 30_000 });
	await push.click();
	await expect(push).toHaveCount(0, { timeout: 30_000 });
}

async function mergeFromTheTopBar(page: Page, github: FakeGithub): Promise<void> {
	github.setPullRequest({
		headRefOid: github.pushedHead(),
		mergeable: 'MERGEABLE',
		mergeStateStatus: 'CLEAN',
		statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
	});
	const detail = await openPullRequestDetail(page);
	await detail.getByRole('button', { name: 'Refresh' }).click();
	const merge = page.getByRole('button', { name: 'Merge pull request #7' });
	await expect(merge).toBeEnabled({ timeout: 30_000 });
	await merge.click();
	const confirm = page.getByRole('button', { name: 'Confirm merge' });
	await expect(confirm).toBeEnabled({ timeout: 30_000 });
	await confirm.click();
}
