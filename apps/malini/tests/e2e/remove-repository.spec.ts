import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	fileExists,
	launchMalini,
	listProjects,
	openWorkstream,
	seedWorkstream,
} from './harness';

test('removing a repository from the sidebar deletes its workstreams and keeps their work', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const alpha = await createSourceRepo(app.root, 'alpha');
		const beta = await createSourceRepo(app.root, 'beta');
		const edited = await seedWorkstream(page, alpha, 'e2e-remove-alpha-edited', 'Alpha edits');
		await seedWorkstream(page, alpha, 'e2e-remove-alpha-clean', 'Alpha clean');
		await seedWorkstream(page, beta, 'e2e-remove-beta', 'Beta work');
		appendFileSync(join(edited.worktree, 'seed.txt'), 'unsaved edit\n');
		await openWorkstream(page, edited.workstreamId);

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const workstream = (name: string) =>
			sidebar.getByTestId('sidebar-workstream').filter({ hasText: name });
		await expect(workstream('Alpha clean')).toBeVisible({ timeout: 20_000 });
		await expect(workstream('Beta work')).toBeVisible();

		const menu = page.getByRole('menu', { name: 'Repository actions' });
		await sidebar.getByRole('link', { name: 'Open alpha' }).click({ button: 'right' });
		await expect(menu.getByRole('menuitem')).toHaveText(['Hide repository', 'Remove repository']);
		await menu.getByRole('menuitem', { name: 'Remove alpha' }).click();
		const confirm = menu.getByRole('menuitem', {
			name: 'Delete 2 workstreams and remove alpha',
		});
		await expect(confirm).toHaveText('Delete 2 workstreams and remove');
		await captureFlow(app, 'remove-repository-confirm');

		await confirm.click();
		await expect
			.poll(async () => (await listProjects(page)).map((project) => project.id), {
				timeout: 30_000,
			})
			.toEqual(['local__beta']);
		await expect(page).toHaveTitle('Malini · Repositories');
		await expect(sidebar.getByRole('link', { name: 'Open alpha' })).toHaveCount(0);
		await expect(workstream('Alpha edits')).toHaveCount(0);
		await expect(workstream('Alpha clean')).toHaveCount(0);
		await expect(sidebar.getByRole('link', { name: 'Open beta' })).toBeVisible();
		await expect(workstream('Beta work')).toBeVisible();

		const saved = execFileSync(
			'git',
			['show', 'refs/malini/archived/e2e-remove-alpha-edited:seed.txt'],
			{ cwd: edited.basePath, encoding: 'utf8' },
		);
		expect(saved).toBe('seed\nunsaved edit\n');
		expect(fileExists(join(edited.basePath, '.git'))).toBe(true);
		await captureFlow(app, 'remove-repository-result');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('the sidebar row actions are reachable from the keyboard', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const alpha = await createSourceRepo(app.root, 'alpha');
		await seedWorkstream(page, alpha, 'e2e-keys-alpha', 'Alpha keys');
		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const row = sidebar.getByTestId('sidebar-workstream').filter({ hasText: 'Alpha keys' });
		await expect(row).toBeVisible({ timeout: 20_000 });

		const repository = sidebar.getByRole('link', { name: 'Open alpha' });
		const menu = page.getByRole('menu', { name: 'Repository actions' });
		await repository.focus();
		await page.keyboard.press('Shift+F10');
		await expect(menu).toBeVisible();
		await page.keyboard.press('ArrowDown');
		await expect(menu.getByRole('menuitem', { name: 'Hide alpha' })).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(menu.getByRole('menuitem', { name: 'Remove alpha' })).toBeFocused();
		await captureFlow(app, 'sidebar-remove-focused-by-keyboard');
		await page.keyboard.press('Enter');
		const confirm = menu.getByRole('menuitem', { name: 'Delete 1 workstream and remove alpha' });
		await expect(confirm).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(repository).toBeFocused();

		await row.focus();
		await page.keyboard.press('Shift+Tab');
		await expect(sidebar.getByRole('button', { name: 'New workstream for alpha' })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(row).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(sidebar.getByRole('button', { name: 'Save Alpha keys for later' })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(sidebar.getByRole('button', { name: 'Archive Alpha keys' })).toBeFocused();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
