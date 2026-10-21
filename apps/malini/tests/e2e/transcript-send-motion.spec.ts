import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	APP_ROOT,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

declare global {
	var sendMotion: { frames: Frame[]; sampling: boolean };
}

type Frame = Readonly<{ runs: number; endTop: number }>;

const RUNS = '[data-testid="chat-message-list"] > li[data-run-id]';
const STILL_PX = 2;
const SETTLE_MS = 2_000;

async function startSampling(page: Page, previousRunId: string): Promise<void> {
	await page.locator('body').evaluate(
		(body, { runId, runs }) => {
			const doc = body.ownerDocument;
			const state = { frames: [] as Frame[], sampling: true };
			globalThis.sendMotion = state;
			const sample = (): void => {
				if (!state.sampling) return;
				const end = doc.querySelector(`li[data-run-id="${runId}"]`)?.lastElementChild;
				state.frames.push({
					runs: doc.querySelectorAll(runs).length,
					endTop: end?.getBoundingClientRect().top ?? Number.NaN,
				});
				doc.defaultView?.requestAnimationFrame(sample);
			};
			sample();
		},
		{ runId: previousRunId, runs: RUNS },
	);
}

async function stopSampling(page: Page): Promise<Frame[]> {
	return page.evaluate(() => {
		globalThis.sendMotion.sampling = false;
		return globalThis.sendMotion.frames;
	});
}

test('sending a prompt keeps the last report still until the chat glides up', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'send-motion');
		const seeded = await seedWorkstream(page, source, 'e2e-send-motion', 'Send motion');
		mkdirSync(join(seeded.worktree, 'shots'), { recursive: true });
		copyFileSync(join(APP_ROOT, 'build/icon.png'), join(seeded.worktree, 'shots/tall.png'));
		await openWorkstream(page, seeded.workstreamId);
		for (let turn = 1; turn <= 6; turn += 1) {
			const report = turn >= 4 ? ' CHAT_TURN_REPORT' : '';
			const image = turn === 6 ? ' SHOW_IMAGE:shots/tall.png' : '';
			await sendPrompt(page, `Send motion turn ${turn}${report}${image}`);
			await expect(page.locator(RUNS)).toHaveCount(turn, { timeout: 20_000 });
			await expect(page.locator(RUNS).last()).toHaveAttribute('data-run-terminal', 'completed');
		}
		await expect(
			page.locator(RUNS).last().getByRole('list', { name: 'Earlier turns' }).getByRole('listitem'),
		).toHaveCount(2);
		await page.waitForTimeout(1_000);
		const previousRunId = await page.locator(RUNS).last().getAttribute('data-run-id');
		if (!previousRunId) throw new Error('the report run has no id');

		await startSampling(page, previousRunId);
		await sendPrompt(page, 'Send motion turn 7 HANG');
		await expect(page.locator(RUNS)).toHaveCount(7, { timeout: 20_000 });
		await page.waitForTimeout(SETTLE_MS);
		const frames = await stopSampling(page);

		const sent = frames.findIndex((frame) => frame.runs === 7);
		const before = frames[sent - 1];
		const after = frames[sent];
		if (!before || !after) throw new Error('no frame caught the new prompt arriving');
		expect(
			Math.abs(after.endTop - before.endTop),
			'px the last report jumped as the new prompt arrived',
		).toBeLessThanOrEqual(STILL_PX);
		const settled = frames.slice(sent).map((frame) => frame.endTop);
		const climbs = settled.slice(1).map((top, index) => top - (settled[index] ?? top));
		expect(Math.max(0, ...climbs), 'px the last report moved down while gliding').toBeLessThan(1);

		await captureFlow(app, 'transcript-send-motion');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
