import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	seedWorkstream,
} from './harness';

function sidebar(page: Page) {
	return page.getByRole('navigation', { name: 'Connected repositories' });
}

function repositoryRow(page: Page, fullName: string) {
	return sidebar(page).locator(
		`[data-testid="sidebar-connected-repository"][data-full-name="${fullName}"]`,
	);
}

function ownerFolder(page: Page) {
	return sidebar(page).getByRole('button', { name: 'acme, 2 repositories' });
}

async function listedRows(page: Page): Promise<(string | null)[]> {
	return sidebar(page)
		.locator('[data-testid="sidebar-owner-folder"], [data-testid="sidebar-connected-repository"]')
		.evaluateAll((rows) =>
			rows.map((row) => row.getAttribute('data-owner') ?? row.getAttribute('data-full-name')),
		);
}

async function sidebarDensity(page: Page, density: 'Comfortable' | 'Compact') {
	await page.getByRole('link', { name: 'Open settings' }).click({ force: true });
	await page
		.getByRole('navigation', { name: 'Settings' })
		.getByRole('link', { name: 'Appearance' })
		.click();
	return page.getByRole('group', { name: 'Sidebar density' }).getByRole('button', {
		name: density,
	});
}

test('an owner with several repositories folds into a folder, and a lone workstream shares its repository line', async () => {
	test.setTimeout(180_000);
	const first = await launchMalini();
	let order: (string | null)[] = [];
	try {
		const { page } = first;
		const api = await createSourceRepo(first.root, 'acme/api');
		const web = await createSourceRepo(first.root, 'acme/web');
		const site = await createSourceRepo(first.root, 'solo/site');
		await seedWorkstream(page, `file://${api}`, 'e2e-fold-api', 'Api work');
		await seedWorkstream(page, `file://${web}`, 'e2e-fold-web1', 'Web one');
		await seedWorkstream(page, `file://${web}`, 'e2e-fold-web2', 'Web two');
		await seedWorkstream(page, `file://${site}`, 'e2e-fold-site', 'Site work');
		await page.reload();

		await expect(ownerFolder(page)).toHaveAttribute('aria-expanded', 'true', { timeout: 20_000 });
		await expect
			.poll(() => listedRows(page))
			.toEqual(['solo/site', 'acme', 'acme/web', 'acme/api']);
		await expect(repositoryRow(page, 'acme/web').getByTestId('sidebar-workstream')).toHaveCount(0);
		const siteWork = repositoryRow(page, 'solo/site').getByTestId('sidebar-workstream');
		await expect(siteWork).toHaveText('Site work');
		await expect(repositoryRow(page, 'acme/api').getByTestId('sidebar-workstream')).toHaveText(
			'Api work',
		);

		await siteWork.click();
		await expect(siteWork).toHaveAttribute('aria-current', 'page');
		const openSite = sidebar(page).getByRole('link', { name: 'Open solo/site' });
		await openSite.click();
		await expect(openSite).toHaveAttribute('aria-current', 'page');
		await expect(siteWork).not.toHaveAttribute('aria-current', 'page');

		await ownerFolder(page).click();
		await expect(ownerFolder(page)).toHaveAttribute('aria-expanded', 'false');
		await expect(repositoryRow(page, 'acme/api')).toBeHidden();
		await ownerFolder(page).focus();
		await page.keyboard.press('Alt+ArrowUp');
		await expect
			.poll(() => listedRows(page))
			.toEqual(['acme', 'acme/web', 'acme/api', 'solo/site']);
		await expect(ownerFolder(page)).toBeFocused();
		order = await listedRows(page);

		await page.getByRole('link', { name: 'Connect repository' }).click({ force: true });
		const list = page.getByTestId('repository-list');
		const section = list.getByRole('button', { name: 'acme, 2 repositories' });
		const webRow = list.locator('[data-testid="repository-row"][data-full-name="acme/web"]');
		await expect(section).toHaveAttribute('aria-expanded', 'false', { timeout: 20_000 });
		await expect(webRow).toBeHidden();
		await section.click();
		await expect(section).toHaveAttribute('aria-expanded', 'true');
		await expect(webRow.getByText('web', { exact: true })).toBeVisible();
		await expect(ownerFolder(page)).toHaveAttribute('aria-expanded', 'true');
		await captureFlow(first, 'repositories-owner-sections');
		await section.click();
		await expect(ownerFolder(page)).toHaveAttribute('aria-expanded', 'false');

		const search = page.getByRole('searchbox', { name: 'Search repositories' });
		await search.fill('acme');
		await expect(section).toHaveAttribute('aria-expanded', 'true');
		await expect(section).toBeDisabled();
		await expect(webRow).toBeVisible();
		await search.fill('web');
		await expect(list.getByTestId('repository-row')).toHaveCount(1);
		await expect(section).toHaveCount(0);
		await expect(webRow.getByText('acme/web', { exact: true })).toBeVisible();
		await search.fill('');
		await expect(section).toHaveAttribute('aria-expanded', 'false');

		const compact = await sidebarDensity(page, 'Compact');
		await compact.click();
		await expect(compact).toHaveAttribute('aria-pressed', 'true');
		await page.keyboard.press('Escape');
		expectCleanConsole(first);
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		await expect(ownerFolder(page)).toHaveAttribute('aria-expanded', 'false', {
			timeout: 20_000,
		});
		await expect.poll(() => listedRows(page)).toEqual(order);
		await expect(repositoryRow(page, 'acme/web')).toBeHidden();

		await ownerFolder(page).click();
		await expect(repositoryRow(page, 'acme/web')).toBeVisible();
		await captureFlow(app, 'sidebar-compact-folder');

		const compact = await sidebarDensity(page, 'Compact');
		await expect(compact).toHaveAttribute('aria-pressed', 'true');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
