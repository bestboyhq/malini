import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	sendPrompt,
} from './harness';
import {
	expectMergedAndArchived,
	queueMerge,
	workstreamName,
	seedWorkstreamOnFakeGithub,
	type FakeGithub,
} from './fake-github';

test('every idle push retitles the draft malini opened after the whole branch until the user edits it', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-title', null);
		await openWorkstream(page, 'e2e-title');

		await run(page, 'EDIT:a.txt COMMIT=feat(git): add the first half');
		await page.getByRole('button', { name: 'Open a draft pull request' }).click();
		await expect
			.poll(() => github.pullRequest()?.title, { timeout: 30_000 })
			.toBe('feat(git): add the first half');

		await run(
			page,
			'EDIT:b.txt COMMIT=fix(git): add the second half PR=feat(git): add both halves',
		);
		await expectPushed(github, 'fix(git): add the second half');
		await expect
			.poll(() => github.pullRequest()?.title, { timeout: 30_000 })
			.toBe('feat(git): add both halves');
		expect(github.pullRequest()?.body).toContain('feat(git): add both halves');

		await run(page, 'EDIT:d.txt COMMIT=style(git): format the second half');
		await expectPushed(github, 'style(git): format the second half');
		await expect.poll(() => github.pullRequest()?.body, { timeout: 30_000 }).toContain('d.txt');
		expect(github.pullRequest()?.title).toBe('feat(git): add both halves');
		expect(github.pullRequest()?.body).toContain('feat(git): add both halves');

		github.setPullRequest({ title: 'Split the git work in two' });
		await run(
			page,
			'EDIT:c.txt COMMIT=fix(git): add the third half PR=feat(git): add all three halves',
		);
		await expectPushed(github, 'fix(git): add the third half');
		await expect
			.poll(() => github.pullRequest()?.body, { timeout: 30_000 })
			.toContain('feat(git): add all three halves');
		expect(github.pullRequest()?.title).toBe('Split the git work in two');

		github.setPullRequest({
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
		});
		const name = await workstreamName(page, 'e2e-title');
		await queueMerge(page);
		await expectMergedAndArchived(page, 'e2e-title', name);
		expect(github.calls().find(([command, sub]) => command === 'pr' && sub === 'merge')).toEqual([
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

async function run(page: Page, prompt: string): Promise<void> {
	const replies = await page.getByTestId('chat-message-bubble').count();
	await sendPrompt(page, prompt);
	await expect(page.getByTestId('chat-message-bubble')).toHaveCount(replies + 1, {
		timeout: 30_000,
	});
	await expectAssistantReply(page);
}

async function expectPushed(github: FakeGithub, subject: string): Promise<void> {
	await expect.poll(() => github.pushedSubjects()[0], { timeout: 30_000 }).toBe(subject);
}
