import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { captureFlow, expectCleanConsole, git, launchMalini, openWorkstream } from './harness';
import { commitByHand, headOf, seedWorkstreamOnFakeGithub } from './fake-github';

test('a workstream equal to its base offers no pull request until a file changes', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(
			app,
			'e2e-nothing-to-ship',
			null,
		);
		await openWorkstream(page, 'e2e-nothing-to-ship');

		const repositoryDetail = page.getByRole('button', { name: 'Repository detail' });
		await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: 30_000 });
		await expect(repositoryDetail).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Create pull request' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Commit and push/u })).toHaveCount(0);
		await captureFlow(app, 'pull-request-nothing-to-ship');

		writeFileSync(join(worktree, 'notes.txt'), 'the first change\n');

		await expect(page.getByRole('button', { name: 'Commit and push changes' })).toBeEnabled({
			timeout: 30_000,
		});
		await expect(repositoryDetail).toBeVisible();
		expect(github.calls().filter(([command, sub]) => command === 'pr' && sub === 'create')).toEqual(
			[],
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a workstream reset to its base after its pull request merged stays merged and offers no new pull request', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(
			app,
			'e2e-merged-reset',
			null,
		);
		const base = headOf(worktree);
		await commitByHand(worktree, 'shipped.txt');
		github.setPullRequest({ state: 'MERGED', headRefOid: headOf(worktree) });
		await git(worktree, ['reset', '-q', '--hard', base]);
		await openWorkstream(page, 'e2e-merged-reset');

		await expect(
			page
				.getByRole('navigation', { name: 'Global actions' })
				.getByRole('status')
				.filter({ hasText: 'Merged' }),
		).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: /^Continue on the latest/u })).toBeEnabled();
		await expect(page.getByRole('button', { name: /pull request$/u })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Commit and push/u })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
