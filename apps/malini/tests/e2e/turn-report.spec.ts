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

const OUTCOME = 'The header stays pinned while the page scrolls.';
const STILL_PX = 1;
const SETTLE_MS = 900;

declare global {
	var reportMotion: { tops: number[][]; sampling: boolean };
}

async function reportTopsWhile(page: Page, act: () => Promise<void>): Promise<number[][]> {
	await page.locator('body').evaluate((body) => {
		const doc = body.ownerDocument;
		const state = { tops: [] as number[][], sampling: true };
		globalThis.reportMotion = state;
		const top = (selector: string): number =>
			doc.querySelector(selector)?.getBoundingClientRect().top ?? Number.NaN;
		const sample = (): void => {
			if (!state.sampling) return;
			state.tops.push([
				top('[data-testid="turn-report-outcome"]'),
				top('[aria-label="Report images"]'),
			]);
			doc.defaultView?.requestAnimationFrame(sample);
		};
		sample();
	});
	await act();
	await page.waitForTimeout(SETTLE_MS);
	return page.evaluate(() => {
		globalThis.reportMotion.sampling = false;
		return globalThis.reportMotion.tops;
	});
}

function expectStill(tops: readonly number[][], label: string): void {
	expect(tops.length, `${label}: frames sampled`).toBeGreaterThan(10);
	for (const [index, name] of ['outcome', 'thumbnails'].entries()) {
		const values = tops.map((frame) => frame[index] ?? Number.NaN);
		expect(
			Math.max(...values) - Math.min(...values),
			`${label}: px the ${name} moved`,
		).toBeLessThanOrEqual(STILL_PX);
	}
}

test('a turn that ends with a report shows it as a result card that asks the user, then stops asking once they move on', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(
			page,
			source,
			'e2e-turn-report-ws',
			'Turn report',
		);
		await openWorkstream(page, workstreamId);

		await sendPrompt(page, 'CHAT_TURN_REPORT');
		const card = page.getByRole('article', { name: 'Turn result' });
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card.getByRole('img', { name: 'Waiting on you' })).toBeVisible();
		await expect(card.getByTestId('turn-report-outcome')).toHaveText(OUTCOME);
		await expect(card.getByText('Your turn')).toBeVisible();
		await expect(card.getByRole('listitem')).toHaveText([
			'Approve the new shadow',
			'Merge the pull request',
		]);
		const lead = card.getByTestId('turn-report-lead');
		await expect(lead).toContainText('checked at 320 px and 1440 px.');
		await expect(card.getByTestId('turn-report-notes')).toBeHidden();
		await lead.click();
		await expect(card.getByTestId('turn-report-notes')).toContainText(
			'the header is position: sticky.',
		);
		await captureFlow(app, 'turn-report-card');

		await sendPrompt(page, 'CHAT_TURN_REPORT again');
		await expect(card).toHaveCount(2, { timeout: 30_000 });
		const first = card.first();
		await expect(first.getByRole('img', { name: 'Done' })).toBeVisible();
		await expect(first.getByText('You were asked')).toBeVisible();
		await expect(first.getByText('Your turn')).toHaveCount(0);
		const earlier = card.last().getByRole('list', { name: 'Earlier turns' });
		await expect(earlier).toContainText(OUTCOME);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('switching between report images of different heights moves nothing in the chat', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'report-images');
		const seeded = await seedWorkstream(page, source, 'e2e-report-images', 'Report images');
		mkdirSync(join(seeded.worktree, 'shots'), { recursive: true });
		copyFileSync(join(APP_ROOT, 'build/icon.png'), join(seeded.worktree, 'shots/tall.png'));
		copyFileSync(
			join(APP_ROOT, '../site/static/apple-touch-icon.png'),
			join(seeded.worktree, 'shots/short.png'),
		);
		await openWorkstream(page, seeded.workstreamId);
		for (let turn = 1; turn <= 4; turn += 1) {
			await sendPrompt(page, `Before the report ${turn}`);
			await expect(page.getByTestId('chat-message-bubble')).toHaveCount(turn, { timeout: 20_000 });
		}
		await sendPrompt(page, 'CHAT_TURN_REPORT SHOW_IMAGE:shots/tall.png SHOW_IMAGE:shots/short.png');
		const card = page.getByRole('article', { name: 'Turn result' });
		const thumbnails = card.getByRole('group', { name: 'Report images' });
		await expect(thumbnails).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('li[data-run-id]').last()).toHaveAttribute(
			'data-run-terminal',
			'completed',
		);
		await page.waitForTimeout(SETTLE_MS);
		const shown = (name: string) =>
			card.getByRole('button', { name: `Open image shots/${name} in gallery` });
		await expect(shown('tall.png')).toBeVisible();
		await expect(shown('short.png')).toBeHidden();

		const pick = async (name: string): Promise<number[][]> => {
			const thumbnail = thumbnails.getByRole('button', { name: `Show image shots/${name}` });
			const box = await thumbnail.boundingBox();
			if (!box) throw new Error(`the ${name} thumbnail is not on screen`);
			const tops = await reportTopsWhile(page, () =>
				page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
			);
			await expect(thumbnail).toHaveAttribute('aria-pressed', 'true');
			await expect(shown(name)).toBeVisible();
			return tops;
		};
		expectStill(await pick('short.png'), 'pinned to the end, to the short image');
		await expect(shown('tall.png')).toBeHidden();
		expectStill(await pick('tall.png'), 'pinned to the end, back to the tall image');

		const viewport = page.getByTestId('chat-message-viewport');
		const area = await viewport.boundingBox();
		if (!area) throw new Error('the transcript is not on screen');
		await page.mouse.move(area.x + area.width / 2, area.y + 120);
		await page.mouse.wheel(0, -400);
		await expect(viewport).toHaveAttribute('data-scroll-follow', 'reader');
		await page.mouse.wheel(0, 200);
		await page.waitForTimeout(SETTLE_MS);
		expectStill(await pick('short.png'), 'scrolled up and back down, to the short image');
		expectStill(await pick('tall.png'), 'scrolled up and back down, to the tall image');
		await pick('short.png');
		await captureFlow(app, 'turn-report-image-switch');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
