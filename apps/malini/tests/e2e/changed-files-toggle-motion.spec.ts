import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	untilStill,
} from './harness';

declare global {
	var toggleMotion: { bottoms: number[]; sampling: boolean };
}

const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';
const STILL_PX = 1;

async function latestRunBottomsWhile(page: Page, act: () => Promise<void>): Promise<number[]> {
	await page.locator('body').evaluate((body, latestRun) => {
		const doc = body.ownerDocument;
		const state = { bottoms: [] as number[], sampling: true };
		globalThis.toggleMotion = state;
		const sample = (): void => {
			if (!state.sampling) return;
			state.bottoms.push(doc.querySelector(latestRun)?.getBoundingClientRect().bottom ?? 0);
			doc.defaultView?.requestAnimationFrame(sample);
		};
		sample();
	}, LATEST_RUN);
	await act();
	await untilStill(page);
	return page.evaluate(() => {
		globalThis.toggleMotion.sampling = false;
		return globalThis.toggleMotion.bottoms;
	});
}

function reversals(bottoms: readonly number[]): number {
	const steps = bottoms.slice(1).map((bottom, index) => bottom - (bottoms[index] ?? bottom));
	const directions = steps.filter((step) => step !== 0).map(Math.sign);
	return directions.slice(1).filter((direction, index) => direction !== directions[index]).length;
}

function expectStill(bottoms: readonly number[], label: string): void {
	expect(bottoms.length, `${label}: frames sampled`).toBeGreaterThan(10);
	expect(reversals(bottoms), `${label}: times the transcript changed direction`).toBe(0);
	expect(
		Math.max(...bottoms) - Math.min(...bottoms),
		`${label}: px the latest run moved`,
	).toBeLessThanOrEqual(STILL_PX);
}

test('folding the changed files open and shut leaves the transcript still at any zoom', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page, electronApp } = app;
		const source = await createSourceRepo(app.root, 'toggle-motion');
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-toggle-motion', 'Toggle');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'EDIT:notes.txt');
		const toggle = page.getByRole('button', { name: /^1 file changed in this chat/u });
		await expect(toggle).toBeVisible({ timeout: 30_000 });
		for (let turn = 2; turn <= 8; turn += 1) {
			await sendPrompt(page, `Toggle turn ${turn}`);
			await expect(page.getByTestId('chat-message-bubble')).toHaveCount(turn, { timeout: 20_000 });
		}
		await expect(page.locator(LATEST_RUN)).toHaveAttribute('data-run-terminal', 'completed');

		for (const zoom of [1, 0.9, 1.25]) {
			await electronApp.evaluate(
				({ BrowserWindow }, factor) =>
					BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(factor),
				zoom,
			);
			await untilStill(page);
			for (const expanded of ['true', 'false']) {
				const box = await toggle.boundingBox();
				if (!box) throw new Error('the changed files toggle is not on screen');
				const bottoms = await latestRunBottomsWhile(page, async () => {
					await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
					await expect(toggle).toHaveAttribute('aria-expanded', expanded);
				});
				expectStill(bottoms, `zoom ${zoom}, expanded ${expanded}`);
			}
		}
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await captureFlow(app, 'changed-files-toggle-still');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
