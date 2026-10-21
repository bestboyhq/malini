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
	type LaunchedApp,
} from './harness';

declare global {
	var imageMotion: { frames: Frame[]; sampling: boolean };
}

type Frame = Readonly<{
	shown: boolean;
	latestRunTop: number;
	latestRunBottom: number;
	images: Readonly<Record<string, number>>;
}>;

const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';
const STILL_PX = 1;
const SETTLE_MS = 1_500;

async function chatWithImages(app: LaunchedApp, name: string, images: boolean): Promise<string> {
	const { page } = app;
	const slug = name.toLowerCase().replaceAll(' ', '-');
	const source = await createSourceRepo(app.root, slug);
	const seeded = await seedWorkstream(page, source, `e2e-${slug}`, name);
	mkdirSync(join(seeded.worktree, 'shots'), { recursive: true });
	copyFileSync(join(APP_ROOT, 'build/icon.png'), join(seeded.worktree, 'shots/tall.png'));
	copyFileSync(
		join(APP_ROOT, '../site/static/apple-touch-icon.png'),
		join(seeded.worktree, 'shots/short.png'),
	);
	await openWorkstream(page, seeded.workstreamId);
	const prompts = Array.from({ length: 10 }, (_, index) => `${name} turn ${index + 1}`);
	if (images) {
		prompts[1] = `${name} turn 2 SHOW_IMAGE:shots/tall.png`;
		prompts[8] = `${name} turn 9 SHOW_IMAGE:shots/short.png`;
		prompts[9] = `${name} CHAT_TURN_REPORT SHOW_IMAGE:shots/tall.png SHOW_IMAGE:shots/short.png`;
	}
	for (const [index, prompt] of prompts.entries()) {
		await sendPrompt(page, prompt);
		await expect(page.locator('[data-testid="chat-message-list"] > li[data-run-id]')).toHaveCount(
			index + 1,
			{ timeout: 20_000 },
		);
		await expect(page.locator(LATEST_RUN)).toHaveAttribute('data-run-terminal', 'completed');
	}
	return seeded.workstreamId;
}

async function startSampling(page: Page, workstreamId: string): Promise<void> {
	await page.locator('body').evaluate(
		(body, { workstreamId, latestRun }) => {
			const doc = body.ownerDocument;
			const frames: Frame[] = [];
			const state = { frames, sampling: true };
			globalThis.imageMotion = state;
			const sample = (): void => {
				if (!state.sampling) return;
				const viewport = doc.querySelector('[data-testid="chat-message-viewport"]');
				const run = doc.querySelector(latestRun)?.getBoundingClientRect();
				const images: Record<string, number> = {};
				for (const row of viewport?.querySelectorAll('li[data-run-id]') ?? []) {
					for (const [index, image] of [...row.querySelectorAll('img')].entries()) {
						const key = `${row.getAttribute('data-run-id')}:${index}`;
						images[key] = image.getBoundingClientRect().height;
					}
				}
				state.frames.push({
					shown:
						doc
							.querySelector('[data-testid="transcript-pane"]')
							?.getAttribute('data-presented-workstream-id') === workstreamId,
					latestRunTop: run?.top ?? 0,
					latestRunBottom: run?.bottom ?? 0,
					images,
				});
				doc.defaultView?.requestAnimationFrame(() => doc.defaultView?.setTimeout(sample));
			};
			sample();
		},
		{ workstreamId, latestRun: LATEST_RUN },
	);
}

async function stopSampling(page: Page): Promise<Frame[]> {
	return page.evaluate(() => {
		globalThis.imageMotion.sampling = false;
		return globalThis.imageMotion.frames;
	});
}

function workstreamLink(page: Page, workstreamId: string) {
	return page.locator(`a[data-navigation-workstream-id="${workstreamId}"]`).first();
}

function expectImagesKeepTheirHeight(frames: readonly Frame[], label: string): void {
	const heights = new Map<string, Set<number>>();
	for (const frame of frames) {
		for (const [key, height] of Object.entries(frame.images)) {
			heights.set(key, (heights.get(key) ?? new Set()).add(Math.round(height)));
		}
	}
	expect(heights.size, `${label}: images sampled`).toBeGreaterThan(0);
	for (const [key, seen] of heights) {
		expect([...seen], `${label}: heights image ${key} took`).toHaveLength(1);
	}
}

function expectStillAfterOpening(frames: readonly Frame[], label: string): void {
	const opened = frames.findIndex((frame) => frame.shown);
	expect(opened, `${label}: the chat opened`).toBeGreaterThanOrEqual(0);
	const after = frames.slice(opened);
	expect(after.length, `${label}: frames sampled after opening`).toBeGreaterThan(10);
	for (const edge of ['latestRunTop', 'latestRunBottom'] as const) {
		const values = after.map((frame) => frame[edge]);
		expect(
			Math.round(Math.max(...values) - Math.min(...values)),
			`${label}: px the ${edge} moved after the chat opened`,
		).toBeLessThanOrEqual(STILL_PX);
	}
	expectImagesKeepTheirHeight(after, label);
}

test('a chat with images opens still, its images framed at their final size before they load', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const withImages = await chatWithImages(app, 'Images A', true);
		const without = await chatWithImages(app, 'Images B', false);
		await page.waitForTimeout(1_000);

		for (const [target, label] of [
			[withImages, 'first visit since the restart'],
			[without, 'to the chat without images'],
			[withImages, 'back to the chat with images'],
		] as const) {
			await startSampling(page, target);
			await workstreamLink(page, target).click();
			await page.waitForTimeout(SETTLE_MS);
			const frames = await stopSampling(page);
			if (target === withImages) expectStillAfterOpening(frames, label);
		}

		await captureFlow(app, 'transcript-images-still');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
