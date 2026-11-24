import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { WidgetBoard } from '../../src/contract/widgets';
import { seedWorkstreamOnFakeGithub } from './fake-github';
import {
	captureFlow,
	expectCleanConsole,
	git,
	invoke,
	launchMalini,
	openWorkstream,
} from './harness';

const WORKSTREAM = 'e2e-widgets';
const PULLS = 'repos/{owner}/{repo}/pulls';

function writeWidget(repo: string, id: string, widget: object): void {
	const folder = join(repo, '.malini', 'widgets');
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, `${id}.json`), JSON.stringify(widget));
}

async function order(page: Page): Promise<string[]> {
	const board = await invoke<WidgetBoard>(page, 'widgets.board', { workstreamId: WORKSTREAM });
	return board.placements.map(({ widgetId }) => widgetId);
}

async function still(
	locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
	await expect.poll(() => locator.evaluate((node) => node.getAnimations().length)).toBe(0);
	const box = await locator.boundingBox();
	if (box === null) throw new Error('the tile is not on screen');
	return box;
}

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
	const box = await still(locator);
	if (box === null) throw new Error('the tile is not on screen');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('shared widgets wait under the board, Add puts one first, drag and Alt+Arrow move it, the corner resizes it, Remove puts it back, and a change on main reaches it', async () => {
	test.setTimeout(150_000);
	const app = await launchMalini({ env: { MALINI_WIDGETS_CHECK_MS: '1000' } });
	try {
		const source = join(app.root, 'hutch');
		writeWidget(source, 'reviews', {
			title: 'Reviews',
			icon: 'pr-open',
			source: { github: PULLS, select: 'length' },
			author: 'aleksander',
		});
		writeWidget(source, 'launch', {
			title: 'Launch',
			icon: 'checklist',
			source: { command: `printf '{"value":12,"unit":"days"}'` },
		});
		let basePath = '';
		const { page, github } = await seedWorkstreamOnFakeGithub(
			app,
			WORKSTREAM,
			null,
			async (seeded) => {
				basePath = seeded.basePath;
			},
		);
		github.answerGet(PULLS, { value: 3, unit: 'open', caption: 'waiting for review' });
		await openWorkstream(page, WORKSTREAM);

		const board = page.getByRole('region', { name: 'Widgets' });
		await expect(board.getByRole('article', { name: /^Plan, / })).toBeVisible({ timeout: 20_000 });
		const shelf = board.getByRole('region', { name: 'In e2e/hutch' });
		await expect(shelf.getByRole('listitem')).toHaveText([/Launch/u, /Reviews/u]);
		await expect(shelf.getByRole('img', { name: 'Made by aleksander' })).toBeVisible();
		expect(await order(page)).toEqual(['plan']);
		await captureFlow(app, 'widgets-shelf');

		await shelf.getByRole('button', { name: 'Add Reviews' }).click();
		const reviews = board.getByRole('article', { name: 'Reviews, 2 by 1' });
		await expect(reviews).toContainText('3', { timeout: 20_000 });
		await shelf.getByRole('button', { name: 'Add Launch' }).click();
		const launch = board.getByRole('article', { name: 'Launch, 2 by 1' });
		await expect(launch).toContainText('12', { timeout: 20_000 });
		await expect(shelf).toHaveCount(0);
		await expect.poll(() => order(page)).toEqual(['launch', 'reviews', 'plan']);

		const to = await centre(board.locator('[data-widget-slot="launch"]'));
		const from = await centre(board.locator('[data-widget-slot="reviews"]'));
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(to.x, to.y, { steps: 12 });
		await expect(board.locator('[data-widget-landing]')).toBeVisible();
		await page.mouse.up();
		await expect(board.locator('[data-widget-landing]')).toHaveCount(0);
		await expect.poll(() => order(page)).toEqual(['reviews', 'launch', 'plan']);
		await expect(reviews).toContainText('3');

		await board.getByRole('button', { name: 'Options for Launch' }).focus();
		await page.keyboard.press('Alt+ArrowLeft');
		await expect.poll(() => order(page)).toEqual(['launch', 'reviews', 'plan']);
		await expect(board.getByRole('button', { name: 'Options for Launch' })).toBeFocused();

		const slot = board.locator('[data-widget-slot="launch"]');
		const tile = await still(slot);
		await slot.hover();
		const grip = await still(slot.locator('[data-widget-corner]'));
		const step = (tile.width + 8) / 2;
		const grab = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
		await page.mouse.move(grab.x, grab.y);
		await page.mouse.down();
		await page.mouse.move(grab.x - step, grab.y + step * 2, { steps: 8 });
		await page.mouse.up();
		await expect(board.getByRole('article', { name: 'Launch, 1 by 3' })).toContainText('12');
		await expect
			.poll(async () => {
				const resized = await invoke<WidgetBoard>(page, 'widgets.board', {
					workstreamId: WORKSTREAM,
				});
				return resized.placements[0];
			})
			.toEqual({ widgetId: 'launch', span: { columns: 1, rows: 3 } });
		await captureFlow(app, 'widgets-arranged');

		await board.getByRole('button', { name: 'Options for Reviews' }).click();
		const menu = page.getByRole('menu');
		await expect(menu).toContainText('Default for this repository · @aleksander');
		await expect(menu.getByRole('menuitem')).toHaveText(['Remove']);
		await menu.getByRole('menuitem', { name: 'Remove' }).click();
		await expect(shelf.getByRole('listitem')).toHaveText([/Reviews/u]);
		await expect.poll(() => order(page)).toEqual(['launch', 'plan']);

		writeWidget(source, 'reviews', {
			title: 'Reviews waiting',
			icon: 'pr-open',
			source: { github: PULLS, select: 'length' },
			author: 'aleksander',
		});
		await git(source, ['commit', '-qam', 'Rename the reviews widget']);
		await git(basePath, ['fetch', '-q', source, 'main:refs/remotes/origin/main']);
		await expect(shelf.getByRole('listitem')).toHaveText([/Reviews waiting/u], {
			timeout: 20_000,
		});
		await captureFlow(app, 'widgets-updated-from-main');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
