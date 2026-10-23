import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	listProjects,
	seedWorkstream,
} from './harness';

test('a repository opens on its scratchpad, which keeps every idea and moves one into a new workstream', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const alpha = await createSourceRepo(app.root, 'alpha');
		await seedWorkstream(page, alpha, 'e2e-pad-alpha', 'Alpha work');
		await page.reload();

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const repository = sidebar.getByRole('link', { name: 'Open alpha' });
		await repository.click({ timeout: 20_000 });
		await expect(repository).toHaveAttribute('aria-current', 'page');
		const pad = page.getByRole('textbox', { name: 'Scratchpad for alpha' });
		await expect(pad).toBeFocused({ timeout: 20_000 });
		await expect(repository).toHaveAccessibleDescription('');

		await page.keyboard.type('# Ideas');
		await expect(repository).toHaveAccessibleDescription('1 idea in the scratchpad');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Say hello to the fake bridge');
		await page.keyboard.press('Enter');
		await page.keyboard.type('- Then say goodbye');
		await page.reload();
		await expect(pad.getByRole('heading', { name: 'Ideas' })).toBeVisible({ timeout: 20_000 });
		await expect(pad.getByRole('listitem')).toHaveText('Then say goodbye');
		await expect(repository).toHaveAccessibleDescription('1 idea in the scratchpad');
		await repository.hover();
		const card = page.getByTestId('sidebar-repository-card');
		await expect(card).toContainText('1 idea in the scratchpad');
		await expect(card).toContainText('Say hello to the fake bridge');
		await page.mouse.move(0, 0);
		await expect(card).toHaveCount(0);

		const workstreams = sidebar.getByTestId('sidebar-workstream');
		await pad.getByText('Say hello to the fake bridge').hover({ position: { x: 2, y: 8 } });
		const startButton = page.getByRole('button', { name: 'Move into a new workstream' });
		const target = await startButton.boundingBox();
		if (!target) throw new Error('the start button has no box');
		await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
			steps: 24,
		});
		await expect(startButton).toBeVisible();
		await startButton.click();
		await expect(pad.getByText('Say hello to the fake bridge')).toHaveCount(0);
		await expect(workstreams).toHaveCount(2);
		await expect(page).toHaveURL(/#\/repositories\//u);

		await pad.getByText('Then say goodbye').click();
		await page.keyboard.press('Meta+Enter');
		await expect(pad.getByRole('listitem')).toHaveCount(0);
		await expect(workstreams).toHaveCount(3);
		await page.keyboard.press('Meta+z');
		await expect(pad.getByRole('listitem')).toHaveText('Then say goodbye');
		await expect(workstreams).toHaveCount(3);
		await captureFlow(app, 'scratchpad-moved');

		await workstreams.filter({ hasNotText: 'Alpha work' }).first().click();
		await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 20_000 });
		await expectAssistantReply(page);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('removing the repository whose scratchpad is open goes back to the repository list', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const alpha = await createSourceRepo(app.root, 'alpha');
		await seedWorkstream(page, alpha, 'e2e-pad-remove', 'Alpha work');
		await page.reload();

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const repository = sidebar.getByRole('link', { name: 'Open alpha' });
		await repository.click({ timeout: 20_000 });
		await expect(page).toHaveTitle('Malini · alpha');

		const menu = page.getByRole('menu', { name: 'Repository actions' });
		await repository.click({ button: 'right' });
		await menu.getByRole('menuitem', { name: 'Remove alpha' }).click();
		await menu.getByRole('menuitem', { name: 'Delete 1 workstream and remove alpha' }).click();
		await expect(page).toHaveTitle('Malini · Repositories', { timeout: 30_000 });
		await expect(page.getByTestId('repository-page-missing')).toHaveCount(0);
		await expect.poll(() => listProjects(page), { timeout: 30_000 }).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
