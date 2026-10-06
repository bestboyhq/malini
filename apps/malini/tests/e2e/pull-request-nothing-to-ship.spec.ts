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

		const nothingToShip = page.getByRole('button', {
			name: 'No changes to open a pull request for',
		});
		await expect(nothingToShip).toBeDisabled({ timeout: 30_000 });
		await expect(page.getByRole('button', { name: 'Create pull request' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Commit and push/u })).toHaveCount(0);
		await nothingToShip.hover();
		await expect(page.getByRole('tooltip')).toHaveText(
			'There is nothing to open a pull request for yet. Change a file in this workstream to publish it',
		);
		await captureFlow(app, 'pull-request-nothing-to-ship');
		await page.mouse.move(0, 0);

		writeFileSync(join(worktree, 'notes.txt'), 'the first change\n');

		await expect(page.getByRole('button', { name: 'Commit and push changes' })).toBeEnabled({
			timeout: 30_000,
		});
		await expect(nothingToShip).toHaveCount(0);
		expect(github.calls().filter(([command, sub]) => command === 'pr' && sub === 'create')).toEqual(
			[],
		);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a workstream reset to its base after its pull request merged offers no pull request', async () => {
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
			page.getByRole('button', { name: 'No changes to open a pull request for' }),
		).toBeDisabled({ timeout: 30_000 });
		await expect(page.getByRole('button', { name: /pull request$/u })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Commit and push/u })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
