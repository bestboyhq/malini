import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	seedWorkstream,
} from './harness';

const FINE_PRINT = 'Malini shares usage stats, never your code or chats. Settings turns them off.';

test('every setup step says under its buttons that Malini shares usage stats, and adds no step for it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const setup = app.page.getByTestId('onboarding');
		const line = setup.getByText(FINE_PRINT);
		const next = setup.getByRole('button', { name: 'Continue' });
		await expect(
			setup.getByRole('list', { name: 'Setup progress' }).getByRole('listitem'),
		).toHaveCount(5);
		await expect(
			setup.getByRole('heading', { name: 'Connect Claude Code and GitHub' }),
		).toBeVisible({
			timeout: 20_000,
		});
		await expect(next).toBeEnabled({ timeout: 20_000 });
		await expect(line).toBeVisible();
		await captureFlow(app, 'onboarding-usage-stats');

		for (const heading of ['Meet your jobs', 'Hear your afternoon']) {
			await next.click();
			await expect(setup.getByRole('heading', { name: heading })).toBeVisible();
			await expect(line).toBeVisible();
		}
		await next.click();
		await expect(
			setup.getByRole('heading', { name: 'Where did you hear about Malini?' }),
		).toBeVisible();
		await expect(line).toBeVisible();
		await setup.getByRole('button', { name: 'Skip', exact: true }).click();
		await expect(setup.getByRole('heading', { name: 'Open your first repository' })).toBeVisible();
		await expect(line).toBeVisible();
		await expect(setup.getByRole('heading', { name: /usage/iu })).toHaveCount(0);
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
		await app.page.waitForTimeout(1_000);
		await expect(setup.getByText(FINE_PRINT)).toHaveCount(0);
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
