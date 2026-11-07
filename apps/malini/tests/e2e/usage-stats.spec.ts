import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	passDefaults,
	seedWorkstream,
} from './harness';

const RUNS_CLAUDE_CODE =
	'Malini runs Claude Code with your Claude plan or another provider, and works in your GitHub repositories.';
const SHARES_USAGE_STATS = `${RUNS_CLAUDE_CODE} It shares usage stats, never your code or chats. Turn it off in Settings.`;

test('the first setup step says in its description that Malini shares usage stats, and no other step or line does', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const setup = app.page.getByTestId('onboarding');
		const next = setup.getByRole('button', { name: 'Continue' });
		const stats = setup.getByRole('paragraph').filter({ hasText: /usage stats/iu });
		await expect(
			setup.getByRole('list', { name: 'Setup progress' }).getByRole('listitem'),
		).toHaveCount(4);
		await expect(
			setup.getByRole('heading', { name: 'Connect Claude Code and GitHub' }),
		).toBeVisible({
			timeout: 20_000,
		});
		await expect(stats).toHaveText(SHARES_USAGE_STATS);
		await expect(next).toBeEnabled({ timeout: 20_000 });
		await captureFlow(app, 'onboarding-setup-usage-stats');

		await next.click();
		await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
		await expect(stats).toHaveCount(0);
		await next.click();
		await expect(setup.getByRole('heading', { name: 'Pick your defaults' })).toBeVisible();
		await expect(stats).toHaveCount(0);
		await passDefaults(app.page);
		await expect(
			setup.getByRole('heading', { name: 'Where did you hear about Malini?' }),
		).toBeVisible();
		await expect(stats).toHaveCount(0);
		await setup.getByRole('button', { name: 'Skip', exact: true }).click();
		await expect(app.page.getByRole('region', { name: 'Your repositories' })).toBeVisible({
			timeout: 20_000,
		});
		await expect(app.page.getByRole('paragraph').filter({ hasText: /usage stats/iu })).toHaveCount(
			0,
		);
		await expect(app.page.getByRole('heading', { name: /usage/iu })).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('setup says nothing about usage stats while the login shell sets DO_NOT_TRACK', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ shellProfile: 'DO_NOT_TRACK=1\nexport DO_NOT_TRACK\n' });
	try {
		const setup = app.page.getByTestId('onboarding');
		await expect(
			setup.getByRole('heading', { name: 'Connect Claude Code and GitHub' }),
		).toBeVisible({
			timeout: 20_000,
		});
		const description = setup.getByRole('paragraph').filter({ hasText: RUNS_CLAUDE_CODE });
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
