import { expect, test } from '@playwright/test';
import {
	captureFlow,
	connectFolder,
	createSourceRepo,
	expectCleanConsole,
	expectPicker,
	launchMalini,
	openRepositoriesPage,
	seedWorkstream,
} from './harness';

const RUNS_CLAUDE_CODE = 'Malini runs Claude Code and works in your GitHub repositories.';
const SHARES_USAGE_STATS = `${RUNS_CLAUDE_CODE} It shares usage stats, never your code or chats. Turn it off in Settings.`;

test('the first-run picker says in its description that Malini shares usage stats, and the Repositories page does not', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		await expectPicker(page);
		const stats = page.getByRole('paragraph').filter({ hasText: /usage stats/iu });
		await expect(stats).toHaveText(SHARES_USAGE_STATS);
		await captureFlow(app, 'first-run-usage-stats');

		await connectFolder(app, 'pasture');
		await openRepositoriesPage(page);
		await expect(page.getByTestId('repository-row').first()).toBeVisible({ timeout: 20_000 });
		await expect(stats).toHaveCount(0);
		await expect(page.getByRole('heading', { name: /usage/iu })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the first-run picker says nothing about usage stats while the login shell sets DO_NOT_TRACK', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ shellProfile: 'DO_NOT_TRACK=1\nexport DO_NOT_TRACK\n' });
	try {
		await expectPicker(app.page);
		const description = app.page.getByRole('paragraph').filter({ hasText: RUNS_CLAUDE_CODE });
		await app.page.waitForTimeout(1_000);
		await expect(description).toHaveText(RUNS_CLAUDE_CODE);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Settings → Privacy names the switch Share usage stats', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		await seedWorkstream(page, source, 'e2e-usage-stats-ws', 'Usage stats');
		await page.evaluate(() => {
			location.hash = '#/settings/privacy';
		});
		await page.reload();
		await expect(page.getByRole('switch', { name: 'Share usage stats' })).toHaveAttribute(
			'aria-checked',
			'true',
			{ timeout: 20_000 },
		);
		await captureFlow(app, 'settings-usage-stats-account');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
