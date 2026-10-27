import { expect, test } from '@playwright/test';
import { captureFlow, expectCleanConsole, launchMalini, openWorkstream } from './harness';
import {
	commitByHand,
	expectMerged,
	headOf,
	queueMerge,
	seedWorkstreamOnFakeGithub,
} from './fake-github';

test('Merge pushes commits that are already made as they are, then merges them', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(app, 'e2e-push-only', {
			liveHead: true,
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'CLEAN',
			statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
		});
		await commitByHand(worktree, 'by-hand.txt');
		const committed = headOf(worktree);
		await openWorkstream(page, 'e2e-push-only');

		await queueMerge(page);

		await expectMerged(page, 'e2e-push-only');
		expect(github.pushedHead()).toBe(committed);
		expect(github.pushedSubjects()).toEqual(['Commit by-hand.txt by hand', 'seed']);
		expect(github.calls().find(([command, sub]) => command === 'pr' && sub === 'merge')).toContain(
			committed,
		);
		await captureFlow(app, 'pull-request-pushed');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
