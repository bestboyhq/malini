import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { KeyboardInputEvent, MouseInputEvent } from 'electron';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	showInspector,
} from './harness';

const GAME_PAGE = `<!doctype html><title>Game</title>
<style>
:root { color-scheme: light dark; font: 24px system-ui; }
html, body, canvas { margin: 0; width: 100%; height: 100%; display: block; }
p { position: fixed; inset: 45% 0 auto; margin: 0; text-align: center; pointer-events: none; }
</style>
<canvas></canvas><p>Click to play</p><script>
const canvas = document.querySelector('canvas');
const state = document.querySelector('p');
canvas.addEventListener('click', () =>
	canvas.requestPointerLock().catch((error) => {
		document.title = 'Refused: ' + error.name;
	}),
);
document.addEventListener('pointerlockchange', () => {
	document.title = document.pointerLockElement === canvas ? 'Locked' : 'Unlocked';
	state.textContent = document.pointerLockElement === canvas ? 'Cursor locked. Press Escape' : 'Cursor unlocked';
});
</script>`;

test.skip(
	process.env['MALINI_E2E_FOREGROUND'] !== '1',
	'Chromium locks the pointer only in the key window, and the background window never becomes key',
);

test('a game locks the cursor when you click it, and Escape unlocks it', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ env: { MALINI_BACKGROUND_WINDOW: '0' } });
	try {
		const { page, electronApp } = app;
		const seeded = await seedWorkstream(
			page,
			await createSourceRepo(app.root),
			'e2e-browser-pointer-lock-ws',
			'Browser pointer lock',
		);
		writeFileSync(join(seeded.worktree, 'game.html'), GAME_PAGE);
		await openWorkstream(page, seeded.workstreamId);
		await showInspector(page);
		const inspector = page.getByRole('region', { name: 'Inspector' });
		await expect(inspector.getByRole('tab', { name: 'Files' })).toBeVisible({ timeout: 20_000 });

		await page.getByRole('button', { name: 'Open inspector panel' }).click();
		await page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
		const address = page.getByRole('textbox', { name: 'Page address' }).last();
		await address.fill('./game.html');
		await address.press('Enter');
		await expect(inspector.getByRole('tab', { name: 'Game', exact: true })).toBeVisible();
		const send = (events: ReadonlyArray<MouseInputEvent | KeyboardInputEvent>) =>
			electronApp.evaluate(async ({ app, BrowserWindow, webContents }, events) => {
				const game = webContents
					.getAllWebContents()
					.find((contents) => contents.getURL().endsWith('/game.html'));
				if (!game) throw new Error('no game page');
				app.focus({ steal: true });
				BrowserWindow.getAllWindows()[0]?.focus();
				game.focus();
				for (const event of events) {
					game.sendInputEvent(event);
					await new Promise((resolve) => setTimeout(resolve, 20));
				}
			}, events);

		const point = { x: 40, y: 40 };
		await send([
			{ type: 'mouseMove', ...point },
			{ type: 'mouseDown', ...point, button: 'left', clickCount: 1 },
			{ type: 'mouseUp', ...point, button: 'left', clickCount: 1 },
		]);
		await expect(inspector.getByRole('tab', { name: 'Locked', exact: true })).toBeVisible();
		await captureFlow(app, 'browser-pointer-locked');

		await send([
			{ type: 'keyDown', keyCode: 'Escape' },
			{ type: 'keyUp', keyCode: 'Escape' },
		]);
		await expect(inspector.getByRole('tab', { name: 'Unlocked', exact: true })).toBeVisible();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
