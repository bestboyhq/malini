import { expect, test } from '@playwright/test';
import { captureFlow, expectCleanConsole, launchMalini, openWorkstream } from './harness';
import { commitByHand, headOf, seedWorkstreamOnFakeGithub } from './fake-github';

test('pushing commits that are already made says Pushed', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-push-only', {
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
		});
		await commitByHand(worktree, 'by-hand.txt');
		await openWorkstream(page, 'e2e-push-only');

		const push = page.getByRole('button', { name: 'Commit and push changes #7' });
		await expect(push).toBeEnabled({ timeout: 30_000 });
		await push.click();

		await expect(page.getByRole('status').filter({ hasText: 'Pushed' })).toHaveText('Pushed', {
			timeout: 30_000,
		});
		expect(github.pushedHead()).toBe(headOf(worktree));
		await captureFlow(app, 'pull-request-pushed');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
