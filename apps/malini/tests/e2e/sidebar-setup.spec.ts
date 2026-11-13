import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	captureFlow,
	connectFolder,
	createSourceRepo,
	expectCleanConsole,
	GITHUB_REPOSITORIES_FIXTURE,
	launchMalini,
	passDefaults,
	seedWorkstream,
} from './harness';

const RECENT_REPOSITORIES = [
	'e2e-farm/barn',
	'e2e-farm/silo',
	'e2e-meadow/pond',
	'e2e-meadow/creek',
];

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
		writeFileSync(
			join(app.home, GITHUB_REPOSITORIES_FIXTURE),
			JSON.stringify(
				RECENT_REPOSITORIES.map((full_name, index) => ({
					full_name,
					clone_url: `https://github.com/${full_name}.git`,
					description: null,
					private: false,
					pushed_at: new Date(Date.now() - (index + 1) * 60 * 60_000).toISOString(),
				})),
			),
		);
		const setup = await reachSidebarStep(page);
		await expect(setup.getByText('Step 3 of 5')).toBeVisible();

		const where = setup.getByRole('group', { name: 'Repositories' });
		const shows = setup.getByRole('group', { name: 'What it shows' });
		const rows = setup.getByRole('group', { name: 'Row height' });
		const preview = setup.getByTestId('onboarding-sidebar-preview');
		await expect(where.getByRole('button', { name: 'Separate' })).toHaveAttribute(
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
		await expect(preview).toContainText('e2e-farm');
		await expect(preview).toContainText('e2e-meadow');
		await expect(setup.getByTestId('onboarding-sidebar-caption')).toHaveText(
			'Your recent repositories, with sample work.',
		);
		await captureFlow(app, 'setup-sidebar-recent-default');

		await where.getByRole('button', { name: 'Mixed' }).click();
		await shows.getByRole('button', { name: 'Only what needs me' }).click();
		await rows.getByRole('button', { name: 'Comfortable' }).click();
		await expect(shows.getByRole('button', { name: 'Only what needs me' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(preview).toContainText('Needs you');
		await expect(preview).toContainText('hidden');
		await expect(preview).toContainText('silo');
		await captureFlow(app, 'setup-sidebar-recent-needs-me');

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
		await captureFlow(app, 'sidebar-recent-needs-me-empty');

		await sidebar(page)
			.getByRole('button', { name: /Show all$/u })
			.click();
		await expect(quiet).toBeVisible();
		await expect(sidebar(page).getByText('Nothing needs you.')).toHaveCount(0);

		await page.getByRole('button', { name: 'Sidebar options' }).click();
		const panel = page.getByRole('group', { name: 'Sidebar options' });
		const option = (group: string, name: string): Locator =>
			panel
				.getByRole('group', { name: group, exact: true })
				.getByRole('button', { name, exact: true });
		await expect(option('Repositories', 'Mixed')).toHaveAttribute('aria-pressed', 'true');
		await expect(option('Show', 'Everything')).toHaveAttribute('aria-pressed', 'true');
		await expect(option('Row height', 'Comfortable')).toHaveAttribute('aria-pressed', 'true');
		await expect(panel.getByRole('button', { name: 'Advanced', exact: true })).toHaveAttribute(
			'aria-expanded',
			'false',
		);
		await captureFlow(app, 'sidebar-recent-arrange-show');
		await option('Show', 'Only what needs me').click();
		await expect(sidebar(page).getByText('Nothing needs you.')).toBeVisible();
		await expect(option('Show', 'Only what needs me')).toHaveAttribute('aria-pressed', 'true');
		await option('Row height', 'Compact').click();
		await expect(option('Row height', 'Compact')).toHaveAttribute('aria-pressed', 'true');
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
		await expect(setup.getByTestId('onboarding-sidebar-caption')).toHaveText(
			'Sample repositories and work.',
		);
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
