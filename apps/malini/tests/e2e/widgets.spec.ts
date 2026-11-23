import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { WidgetBoard } from '../../src/contract/widgets';
import { seedWorkstreamOnFakeGithub } from './fake-github';
import { captureFlow, expectCleanConsole, invoke, launchMalini, openWorkstream } from './harness';

const WORKSTREAM = 'e2e-widgets';
const PULLS = 'repos/{owner}/{repo}/pulls';

function daysCommand(days: number): string {
	return `printf '{"value":${days},"unit":"days"}'`;
}

function writeWidget(worktree: string, id: string, widget: object): void {
	const folder = join(worktree, '.malini', 'widgets');
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, `${id}.json`), JSON.stringify(widget));
}

function widgetsBoard(page: Page): Promise<WidgetBoard> {
	return invoke<WidgetBoard>(page, 'widgets.board', { workstreamId: WORKSTREAM });
}

test('widget files in the checkout wait as suggestions, Add puts them on the board where their sources run, the corner resizes them to any span and the menu removes them', async () => {
	test.setTimeout(150_000);
	const app = await launchMalini();
	try {
		const { page, worktree, github } = await seedWorkstreamOnFakeGithub(app, WORKSTREAM, null);
		github.answerGet(PULLS, { value: 3, unit: 'open', caption: 'waiting for review' });
		writeWidget(worktree, 'launch', {
			title: 'Launch',
			icon: 'checklist',
			source: { command: daysCommand(12) },
		});
		writeWidget(worktree, 'reviews', {
			title: 'Reviews',
			icon: 'pr-open',
			source: { github: PULLS, select: 'length' },
			size: 'medium',
		});
		await openWorkstream(page, WORKSTREAM);

		const board = page.getByRole('region', { name: 'Widgets' });
		await expect(board.getByRole('article', { name: 'Plan, Large' })).toBeVisible({
			timeout: 20_000,
		});
		const suggestions = board.getByRole('group', { name: /suggested widgets?$/u });
		await expect(suggestions).toHaveAccessibleName('2 suggested widgets');
		await expect(suggestions.getByRole('article', { name: 'Launch, Medium' })).not.toContainText(
			'12',
		);
		expect((await widgetsBoard(page)).readings.map(({ widgetId }) => widgetId)).not.toContain(
			'launch',
		);
		await captureFlow(app, 'widgets-suggestions');

		await suggestions.getByRole('button', { name: 'Add Launch' }).click();
		await expect(board.getByRole('article', { name: 'Launch, Small' })).toContainText('12', {
			timeout: 20_000,
		});
		await expect(suggestions).toHaveAccessibleName('1 suggested widget');
		await suggestions.getByRole('button', { name: 'Add Reviews' }).click();
		await expect(board.getByRole('article', { name: 'Reviews, Medium' })).toContainText('3', {
			timeout: 20_000,
		});
		await expect(suggestions).toHaveCount(0);
		await captureFlow(app, 'widgets-placed');

		writeWidget(worktree, 'launch', {
			title: 'Launch',
			icon: 'checklist',
			source: { command: daysCommand(13) },
		});
		const launch = board.getByRole('article', { name: 'Launch, Small' });
		const allow = board.getByRole('button', { name: 'Allow' });
		await expect(allow).toBeVisible({ timeout: 20_000 });
		await expect(launch).toContainText(daysCommand(13));
		await allow.click();
		await expect(launch).toContainText('13', { timeout: 20_000 });
		await expect(allow).toHaveCount(0);

		const cell = (await launch.boundingBox())?.width ?? 0;
		await board.getByRole('button', { name: 'Options for Launch' }).click();
		const menu = page.getByRole('menu');
		await expect(menu.getByRole('menuitemradio', { name: 'Small' })).toBeChecked();
		await menu.getByRole('menuitemradio', { name: 'Large' }).click();
		await expect(board.getByRole('article', { name: 'Launch, Large' })).toContainText('13');
		expect((await widgetsBoard(page)).placements).toContainEqual({
			widgetId: 'launch',
			span: { columns: 12, rows: 2 },
			approved: true,
		});

		const corner = board.locator('[data-widget-slot="launch"] [data-widget-corner]');
		await corner.hover();
		const large = await board.locator('[data-widget-slot="launch"]').boundingBox();
		const grip = await corner.boundingBox();
		if (large === null || grip === null) throw new Error('the Launch tile has no corner');
		const grab = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
		await page.mouse.down();
		await page.mouse.move(grab.x - (large.width - cell) / 2, grab.y + cell / 2, { steps: 4 });
		await page.mouse.move(grab.x - (large.width - cell), grab.y + cell + 8, { steps: 4 });
		await page.mouse.up();
		await expect(board.getByRole('article', { name: 'Launch, 1 by 3' })).toContainText('13');
		expect((await widgetsBoard(page)).placements).toContainEqual({
			widgetId: 'launch',
			span: { columns: 1, rows: 3 },
			approved: true,
		});
		await board.getByRole('button', { name: 'Options for Launch' }).click();
		await expect(menu.getByRole('menuitemradio', { checked: true })).toHaveCount(0);
		await page.keyboard.press('Escape');

		await board.getByRole('button', { name: 'Options for Reviews' }).click();
		await expect(menu.getByRole('menuitem', { name: 'Refresh now' })).toBeVisible();
		await menu.getByRole('menuitem', { name: 'Remove' }).click();
		await expect(suggestions).toHaveAccessibleName('1 suggested widget');
		await expect(board.getByRole('article', { name: 'Reviews, Medium' })).toHaveCount(1);
		await expect(suggestions.getByRole('article', { name: 'Reviews, Medium' })).toBeVisible();
		expect((await widgetsBoard(page)).placements.map(({ widgetId }) => widgetId)).toEqual([
			'plan',
			'launch',
		]);

		writeWidget(worktree, 'coffee', {
			title: 'Coffee',
			icon: 'trend-up',
			source: { command: `printf '{"value":4,"unit":"cups"}'` },
		});
		await expect(suggestions).toHaveAccessibleName('2 suggested widgets', { timeout: 20_000 });
		await expect(suggestions.getByRole('article', { name: 'Coffee, Medium' })).toBeVisible();
		await suggestions.getByRole('button', { name: 'Hide Coffee' }).click();
		await expect(suggestions).toHaveAccessibleName('1 suggested widget');
		expect((await widgetsBoard(page)).hidden).toContain('coffee');
		await captureFlow(app, 'widgets-menu-done');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
