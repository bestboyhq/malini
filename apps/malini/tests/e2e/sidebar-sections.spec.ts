import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

function section(page: Page, label: string) {
	return sidebar(page)
		.getByTestId('sidebar-section')
		.filter({ has: page.getByRole('button', { name: new RegExp(`^${label}, `, 'u') }) });
}

async function choose(page: Page, setting: string, choice: string): Promise<void> {
	const panel = page.getByRole('group', { name: 'Group and sort' });
	await panel.getByRole('button', { name: new RegExp(`^${setting}: `, 'u') }).click();
	const menu = page.getByRole('menu', { name: setting, exact: true });
	await menu.getByRole('menuitemradio', { name: choice }).click();
	await expect(panel.getByRole('button', { name: `${setting}: ${choice}` })).toBeVisible();
	await expect(menu).toHaveCount(0);
}

test('the sidebar groups by status or by day, sub-groups each section or lists it flat, and resets', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const api = await createSourceRepo(app.root, 'acme/api');
		const site = await createSourceRepo(app.root, 'solo/site');
		await seedWorkstream(page, `file://${api}`, 'e2e-sections-api', 'Api work');
		await seedWorkstream(page, `file://${api}`, 'e2e-sections-docs', 'Api docs');
		await seedWorkstream(page, `file://${site}`, 'e2e-sections-site', 'Site work');
		await openWorkstream(page, 'e2e-sections-site');
		await sendPrompt(page, 'HANG');

		const focus = page.getByRole('group', { name: 'Focus' });
		await focus.getByRole('button', { name: 'Group and sort' }).click();
		const panel = page.getByTestId('sidebar-arrange-panel');
		await expect(panel.getByRole('button', { name: 'Grouping: Organization' })).toBeVisible();
		const [nav, box] = await Promise.all([sidebar(page).boundingBox(), panel.boundingBox()]);
		if (!nav || !box) throw new Error('expected the sidebar and the panel on screen');
		expect(box.x).toBeGreaterThanOrEqual(nav.x + nav.width);
		await expect(panel.getByRole('button', { name: /^Sub-grouping: / })).toHaveCount(0);

		await choose(page, 'Grouping', 'Status');
		await expect(section(page, 'In progress')).toBeVisible({ timeout: 20_000 });
		await expect(
			sidebar(page).getByRole('button', { name: 'In progress, 1 workstream' }),
		).toBeVisible();
		await expect(sidebar(page).getByRole('button', { name: 'Idle, 2 workstreams' })).toBeVisible();
		await expect(sidebar(page).getByTestId('sidebar-owner-folder')).toHaveCount(0);
		await expect(
			section(page, 'In progress').getByRole('link', { name: 'Open solo/site' }),
		).toBeVisible();
		await expect(section(page, 'Idle').getByRole('link', { name: 'Open acme/api' })).toBeVisible();
		await expect(section(page, 'Idle').getByRole('link', { name: 'Open solo/site' })).toHaveCount(
			0,
		);
		await expect(panel).toContainText('Group by organization or repository to drag rows.');
		await captureFlow(app, 'sidebar-sections-status');

		await choose(page, 'Sub-grouping', 'Organization');
		await expect(section(page, 'Idle').getByTestId('sidebar-owner-folder')).toHaveText(/acme/u);
		await choose(page, 'Sub-grouping', 'No grouping');
		await expect(sidebar(page).getByTestId('sidebar-connected-repository')).toHaveCount(0);
		await expect(
			section(page, 'Idle')
				.getByTestId('sidebar-workstream')
				.filter({ hasText: 'Api docs' })
				.getByTestId('sidebar-row-repository'),
		).toHaveText('api');

		await choose(page, 'Grouping', 'Day');
		await choose(page, 'Ordering', 'Last active');
		const today = sidebar(page).getByRole('button', { name: 'Today, 3 workstreams' });
		await expect(today).toBeVisible();
		await expect(sidebar(page).getByTestId('sidebar-section')).toHaveCount(1);
		await captureFlow(app, 'sidebar-sections-day');
		await page.keyboard.press('Escape');
		await expect(panel).toHaveCount(0);
		await today.click();
		await expect(today).toHaveAttribute('aria-expanded', 'false');
		await expect(sidebar(page).getByText('Api docs')).toBeHidden();

		await page.reload();
		await expect(today).toHaveAttribute('aria-expanded', 'false', { timeout: 20_000 });
		await today.click();
		await expect(sidebar(page).getByText('Api docs')).toBeVisible();
		await focus.getByRole('button', { name: 'Group and sort' }).click();
		await expect(panel.getByRole('button', { name: 'Ordering: Last active' })).toBeVisible();
		await panel.getByRole('button', { name: 'Reset' }).click();
		await expect(panel.getByRole('button', { name: 'Grouping: Organization' })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Reset' })).toHaveCount(0);
		await expect(sidebar(page).getByRole('button', { name: 'acme, 1 repository' })).toBeVisible();
		await expect(sidebar(page).getByTestId('sidebar-section')).toHaveCount(0);

		await choose(page, 'Grouping', 'Day');
		await page.keyboard.press('Escape');
		await expect(
			sidebar(page).getByRole('button', { name: 'New chat', exact: true }),
		).toBeVisible();
		await focus.getByRole('button', { name: 'Pin an organization or repository' }).click();
		await page.getByRole('menuitemcheckbox', { name: 'acme', exact: true }).click();
		await page.getByRole('menuitemcheckbox', { name: 'api', exact: true }).click();
		await page.keyboard.press('Escape');
		await focus.getByRole('button', { name: 'acme', exact: true }).click();
		await expect(sidebar(page).getByRole('button', { name: 'New chat in acme' })).toBeVisible();
		await focus.getByRole('button', { name: 'api', exact: true }).click();
		await expect(sidebar(page).getByRole('button', { name: 'Today, 2 workstreams' })).toBeVisible();
		await sidebar(page).getByRole('button', { name: 'New chat in api' }).click();
		await expect(sidebar(page).getByRole('button', { name: 'Today, 3 workstreams' })).toBeVisible({
			timeout: 20_000,
		});
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
