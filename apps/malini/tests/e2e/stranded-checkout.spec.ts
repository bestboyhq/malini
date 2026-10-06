import { appendFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	fileExists,
	launchMalini,
	seedWorkstream,
} from './harness';

test('a checkout moved back from the trash at boot shows its file changes after boot', async () => {
	test.setTimeout(120_000);
	const first = await launchMalini();
	let worktree: string;
	try {
		const source = await createSourceRepo(first.root);
		const seeded = await seedWorkstream(
			first.page,
			source,
			'e2e-stranded-ws',
			'Stranded workstream',
		);
		worktree = seeded.worktree;
		appendFileSync(join(worktree, 'seed.txt'), 'before the crash\n');
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}

	const trash = join(first.userDataDir, 'workstreams', '.trash');
	mkdirSync(trash, { recursive: true });
	renameSync(worktree, join(trash, `e2e-stranded-ws-${Date.now()}`));

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		await expect(page).toHaveTitle('malini · Repositories');
		const row = page.getByTestId('sidebar-workstream').filter({ hasText: 'Stranded workstream' });
		await expect(row).toBeVisible({ timeout: 20_000 });
		expect(fileExists(worktree)).toBe(true);
		const totals = row.getByTestId('sidebar-workstream-change-totals');
		await expect(totals).toHaveAccessibleName('1 additions, 0 deletions', { timeout: 20_000 });

		appendFileSync(join(worktree, 'seed.txt'), 'one\ntwo\nthree\n');

		await expect(totals).toHaveAccessibleName('4 additions, 0 deletions', { timeout: 10_000 });
		await captureFlow(app, 'stranded-checkout');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
