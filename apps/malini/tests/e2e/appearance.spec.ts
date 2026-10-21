import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

test('appearance settings tune the greys and the theme, close back to the workstream, and survive a relaunch', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-appearance-ws',
			'Appearance workstream',
		);
		await openWorkstream(page, workstreamId);

		await page.getByTestId('sidebar-open-settings').click();
		const sections = page.getByRole('navigation', { name: 'Settings' });
		await expect(sections.getByRole('link', { name: 'Agent', exact: true })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await sections.getByRole('link', { name: 'Appearance' }).click();
		await expect(sections.getByRole('link', { name: 'Appearance' })).toHaveAttribute(
			'aria-current',
			'page',
		);

		const stone = page.getByRole('button', { name: 'Stone' });
		const slate = page.getByRole('button', { name: 'Slate' });
		await expect(stone).toHaveAttribute('aria-pressed', 'true');
		await slate.click();
		await expect(slate).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByRole('slider', { name: 'Tint wheel' })).toHaveAttribute(
			'aria-valuetext',
			'Hue 250°, chroma 0.0130',
		);

		const theme = page.getByRole('group', { name: 'Theme' });
		await theme.getByRole('button', { name: 'Light' }).click();
		await expect(theme.getByRole('button', { name: 'Light' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
		await expect(page).toHaveURL(new RegExp(`#/workstreams/${workstreamId}`, 'u'));

		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await page.getByTestId('sidebar-open-settings').click();
		await sections.getByRole('link', { name: 'Appearance' }).click();
		await expect(slate).toHaveAttribute('aria-pressed', 'true');

		const looks = page.getByRole('region', { name: 'History' }).getByRole('button');
		await expect(looks).toHaveCount(2);
		await expect(looks.first()).toHaveAttribute('aria-pressed', 'true');
		await looks.last().click();
		await expect(looks.last()).toHaveAttribute('aria-pressed', 'true');
		await expect(stone).toHaveAttribute('aria-pressed', 'true');

		await slate.click();
		await page.getByRole('button', { name: 'Reset to default' }).click();
		await expect(stone).toHaveAttribute('aria-pressed', 'true');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the theme the user picks reaches native pages and the agent, whatever the system uses', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-theme-ws', 'Theme');
		await openWorkstream(page, workstreamId);

		for (const [name, theme] of [
			['Dark', 'dark'],
			['Light', 'light'],
		] as const) {
			await page.getByTestId('sidebar-open-settings').click();
			await page
				.getByRole('navigation', { name: 'Settings' })
				.getByRole('link', { name: 'Appearance' })
				.click();
			await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name }).click();
			await expect
				.poll(() => app.electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
				.toBe(theme);
			await page.keyboard.press('Escape');
			await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();

			await sendPrompt(page, 'WHICH_THEME');
			await expect(page.getByText(`Theme: ${theme}`)).toBeVisible({ timeout: 30_000 });
		}

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
