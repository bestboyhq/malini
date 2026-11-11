import { execFileSync } from 'node:child_process';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectAssistantReply,
	expectCleanConsole,
	launchMalini,
	listProjects,
	seedWorkstream,
	type LaunchedApp,
} from './harness';

function holdCheckouts(app: LaunchedApp): string {
	const git = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
	const held = join(app.root, 'checkouts-held');
	const stub = join(app.bin, 'git');
	writeFileSync(
		stub,
		[
			'#!/bin/sh',
			'case "$*" in *"worktree add "*)',
			`\twhile [ -e '${held}' ]; do sleep 0.05; done ;;`,
			'esac',
			`exec '${git}' "$@"`,
			'',
		].join('\n'),
	);
	chmodSync(stub, 0o755);
	writeFileSync(held, '');
	return held;
}

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

test('an idea written as a heading moves into a new workstream with what sits under it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const alpha = await createSourceRepo(app.root, 'alpha');
		await seedWorkstream(page, alpha, 'e2e-pad-heading', 'Alpha work');
		await page.reload();

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const repository = sidebar.getByRole('link', { name: 'Open alpha' });
		await repository.click({ timeout: 20_000 });
		const pad = page.getByRole('textbox', { name: 'Scratchpad for alpha' });
		await expect(pad).toBeFocused({ timeout: 20_000 });

		await page.keyboard.type('# Say hello to the fake bridge');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Keep it short');
		await expect(repository).toHaveAccessibleDescription('1 idea in the scratchpad');

		await pad.getByRole('heading', { name: 'Say hello to the fake bridge' }).click();
		await page.keyboard.press('Meta+Enter');
		await expect(pad.getByRole('heading')).toHaveCount(0);
		await expect(pad.getByText('Keep it short')).toHaveCount(0);
		await expect(sidebar.getByTestId('sidebar-workstream')).toHaveCount(2);
		await expect(repository).toHaveAccessibleDescription('');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('two ideas moved while the first still sets up each start a workstream', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const alpha = await createSourceRepo(app.root, 'alpha');
		await seedWorkstream(page, alpha, 'e2e-pad-two', 'Alpha work');
		await page.reload();

		const sidebar = page.getByRole('navigation', { name: 'Connected repositories' });
		const repository = sidebar.getByRole('link', { name: 'Open alpha' });
		await repository.click({ timeout: 20_000 });
		const pad = page.getByRole('textbox', { name: 'Scratchpad for alpha' });
		await expect(pad).toBeFocused({ timeout: 20_000 });
		await page.keyboard.type('Say hello to the fake bridge');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Say goodbye to the fake bridge');
		await expect(repository).toHaveAccessibleDescription('2 ideas in the scratchpad');

		const held = holdCheckouts(app);
		const workstreams = sidebar.getByTestId('sidebar-workstream');
		await pad.getByText('Say hello to the fake bridge').click();
		await page.keyboard.press('Meta+Enter');
		await expect(pad.getByText('Say hello to the fake bridge')).toHaveCount(0);
		await expect(workstreams).toHaveCount(2);
		await pad.getByText('Say goodbye to the fake bridge').click();
		await page.keyboard.press('Meta+Enter');
		await expect(pad.getByText('Say goodbye to the fake bridge')).toHaveCount(0);
		await expect(workstreams).toHaveCount(3);
		await expect(repository).toHaveAccessibleDescription('');
		await expect(
			workstreams.getByRole('status', { name: 'Workstream status: Creating' }),
		).toHaveCount(2);

		rmSync(held);
		const started = await workstreams
			.filter({ hasNotText: 'Alpha work' })
			.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-workstream-id') ?? ''));
		expect(started).toHaveLength(2);
		for (const workstreamId of started) {
			await sidebar
				.locator(`[data-testid="sidebar-workstream"][data-workstream-id="${workstreamId}"]`)
				.click();
			await expect(page.getByTestId('transcript-pane')).toHaveAttribute(
				'data-presented-workstream-id',
				workstreamId,
				{ timeout: 20_000 },
			);
			await expectAssistantReply(page);
		}
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
