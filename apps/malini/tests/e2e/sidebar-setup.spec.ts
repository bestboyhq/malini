import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	connectFolder,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	passDefaults,
	seedWorkstream,
} from './harness';

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

async function reachSidebarStep(page: Page) {
	const setup = page.getByTestId('onboarding');
	await setup.getByRole('button', { name: 'Continue' }).click();
	await expect(setup.getByRole('heading', { name: 'Hear your afternoon' })).toBeVisible();
	await setup.getByRole('button', { name: 'Continue' }).click();
	await expect(setup.getByRole('heading', { name: 'Set up your sidebar' })).toBeVisible();
	return setup;
}

test('setup asks how you want your sidebar, and the sidebar opens that way', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = await reachSidebarStep(page);
		await expect(setup.getByText('Step 3 of 5')).toBeVisible();

		const where = setup.getByRole('group', { name: 'Where you work' });
		const shows = setup.getByRole('group', { name: 'What it shows' });
		const rows = setup.getByRole('group', { name: 'Row height' });
		const preview = setup.getByTestId('onboarding-sidebar-preview');
		await expect(where.getByRole('button', { name: 'Many repositories' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(shows.getByRole('button', { name: 'Everything' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(rows.getByRole('button', { name: 'Compact' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(preview).not.toContainText('hidden');
		await captureFlow(app, 'setup-sidebar-default');

		await where.getByRole('button', { name: 'One project' }).click();
		await shows.getByRole('button', { name: 'Only what needs me' }).click();
		await rows.getByRole('button', { name: 'Comfortable' }).click();
		await expect(shows.getByRole('button', { name: 'Only what needs me' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(preview).toContainText('Needs you');
		await expect(preview).toContainText('hidden');
		await captureFlow(app, 'setup-sidebar-needs-me');

		await setup.getByRole('button', { name: 'Continue' }).click();
		await passDefaults(page);
		await setup.getByRole('button', { name: 'Skip', exact: true }).click();
		await expect(page.getByTestId('first-repository-picker')).toBeVisible({ timeout: 20_000 });

		await connectFolder(app, 'pasture');
		const source = await createSourceRepo(app.root, 'meadow');
		await seedWorkstream(page, source, 'e2e-setup-sidebar', 'Quiet work');
		await page.reload();

		const quiet = sidebar(page).getByTestId('sidebar-workstream').filter({ hasText: 'Quiet work' });
		await expect(sidebar(page).getByText('Nothing needs you.')).toBeVisible({ timeout: 20_000 });
		await expect(quiet).toHaveCount(0);
		await captureFlow(app, 'sidebar-needs-me-empty');

		await sidebar(page)
			.getByRole('button', { name: /Show all$/u })
			.click();
		await expect(quiet).toBeVisible();
		await expect(sidebar(page).getByText('Nothing needs you.')).toHaveCount(0);

		await page.getByRole('button', { name: 'Group and sort' }).click();
		const panel = page.getByRole('group', { name: 'Group and sort' });
		await expect(panel.getByRole('button', { name: 'Show: Everything' })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Grouping: Status' })).toBeVisible();
		await captureFlow(app, 'sidebar-arrange-show');
		await panel.getByRole('button', { name: 'Show: Everything' }).click();
		await page
			.getByRole('menu', { name: 'Show' })
			.getByRole('menuitemradio', { name: 'Attention' })
			.click();
		await expect(sidebar(page).getByText('Nothing needs you.')).toBeVisible();
		await page.keyboard.press('Escape');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('skipping the sidebar step keeps the default sidebar', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const setup = await reachSidebarStep(page);
		await setup
			.getByRole('group', { name: 'What it shows' })
			.getByRole('button', { name: 'Only what needs me' })
			.click();
		await setup.getByRole('button', { name: 'Skip', exact: true }).click();
		await passDefaults(page);
		await setup.getByRole('button', { name: 'Skip', exact: true }).click();
		await expect(page.getByTestId('first-repository-picker')).toBeVisible({ timeout: 20_000 });

		await connectFolder(app, 'pasture');
		const source = await createSourceRepo(app.root, 'meadow');
		await seedWorkstream(page, source, 'e2e-skip-sidebar', 'Loud work');
		await page.reload();

		await expect(
			sidebar(page).getByTestId('sidebar-workstream').filter({ hasText: 'Loud work' }),
		).toBeVisible({ timeout: 20_000 });
		await expect(sidebar(page).getByText('Nothing needs you.')).toHaveCount(0);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
