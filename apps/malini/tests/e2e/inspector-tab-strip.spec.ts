import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	CONTEXT_ROOT,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

function panels(page: Page): Locator {
	return page.getByRole('tablist', { name: 'Inspector panels' });
}

function inspectorTab(page: Page, name: string): Locator {
	return page.getByRole('region', { name: 'Inspector' }).getByRole('tab', { name, exact: true });
}

async function expectPanels(page: Page, tabs: readonly string[]): Promise<void> {
	await expect(panels(page)).toMatchAriaSnapshot(
		[
			'- tablist "Inspector panels":',
			'  - /children: equal',
			...tabs.map((tab) => `  - ${tab}`),
		].join('\n'),
	);
	await expect(page.getByRole('button', { name: 'Open inspector panel' })).toBeVisible();
}

async function expectControlsItsPanel(page: Page, tab: Locator, name: string): Promise<Locator> {
	const panel = page.getByRole('tabpanel', { name, exact: true });
	await expect(panel).toBeVisible();
	await expect(tab).toHaveAttribute('aria-controls', (await panel.getAttribute('id')) ?? '');
	return panel;
}

test('the inspector strip is a tab list of tabs only, walked with the arrow keys, with its close and open buttons beside it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-inspector-tabs-ws', 'Inspector tabs');
		await openWorkstream(page, seeded.workstreamId);
		await expect(page.getByRole('treeitem', { name: 'Open seed.txt' })).toBeVisible({
			timeout: 20_000,
		});
		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await page.getByRole('menuitem', { name: 'Add extensions' }).click();
		const files = inspectorTab(page, 'Files');
		const extensions = inspectorTab(page, 'Extensions');
		await expect(extensions).toHaveAttribute('aria-selected', 'true');
		await page.mouse.move(0, 0);
		await captureFlow(app, 'inspector-tab-strip-1-files-extensions');

		await expectPanels(page, ['tab "Files"', 'tab "Extensions" [selected]']);
		await expectControlsItsPanel(page, extensions, 'Extensions');
		await expect(files).not.toHaveAttribute('aria-controls');
		writeFileSync(
			join(CONTEXT_ROOT, 'inspector-tab-strip-aria-snapshot.txt'),
			`${await panels(page).ariaSnapshot()}\n`,
		);

		const closeExtensions = page.getByRole('button', { name: 'Close Extensions', exact: true });
		await closeExtensions.focus();
		await page.keyboard.press('Shift+Tab');
		await expect(extensions).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(files).not.toBeFocused();
		await extensions.focus();
		await page.keyboard.press('Tab');
		await expect(closeExtensions).toBeFocused();

		await extensions.focus();
		await page.keyboard.press('ArrowRight');
		await expect(files).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(extensions).toBeFocused();
		await page.keyboard.press('Home');
		await expect(files).toBeFocused();
		await page.keyboard.press('End');
		await expect(extensions).toBeFocused();
		await expect(extensions).toHaveAttribute('aria-selected', 'true');

		await page.keyboard.press('Home');
		await page.keyboard.press('Enter');
		await expect(files).toHaveAttribute('aria-selected', 'true');
		const filesPanel = await expectControlsItsPanel(page, files, 'Files');
		await expect(filesPanel.getByRole('treeitem', { name: 'Open seed.txt' })).toBeVisible();
		await expect(page.getByRole('tabpanel', { name: 'Extensions', exact: true })).toHaveCount(0);

		await files.focus();
		await page.keyboard.press('End');
		await expect(extensions).toBeFocused();
		await page.keyboard.press('Space');
		await expect(extensions).toHaveAttribute('aria-selected', 'true');

		await extensions.focus();
		await page.keyboard.press('Tab');
		await expect(closeExtensions).toBeFocused();
		await page.keyboard.press('Enter');
		await expectPanels(page, ['tab "Files" [selected]']);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
