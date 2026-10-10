import { expect, test, type Page } from '@playwright/test';
import {
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
	var openMotion: { frames: Frame[]; sampling: boolean };
}

type Frame = Readonly<{ shown: boolean; latestRunBottom: number; motion: readonly string[] }>;

const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';
const STILL_PX = 1;
const SETTLE_MS = 1_200;

async function chatWithChanges(app: LaunchedApp, name: string): Promise<string> {
	const { page } = app;
	const slug = name.toLowerCase().replaceAll(' ', '-');
	const source = await createSourceRepo(app.root, slug);
	const { workstreamId } = await seedWorkstream(page, source, `e2e-${slug}`, name);
	await openWorkstream(page, workstreamId);
	await sendPrompt(page, 'EDIT:notes.txt');
	await expect(page.getByTestId('chat-changed-files-toggle')).toContainText(
		'1 file changed in this chat',
		{ timeout: 30_000 },
	);
	for (let turn = 2; turn <= 10; turn += 1) {
		await sendPrompt(page, `${name} turn ${turn}`);
		await expect(page.getByTestId('chat-message-bubble')).toHaveCount(turn, { timeout: 20_000 });
	}
	await expect(page.locator(LATEST_RUN)).toHaveAttribute('data-run-terminal', 'completed');
	const overflow = await page
		.getByTestId('chat-message-scroller')
		.evaluate((scroller) => scroller.scrollHeight - scroller.clientHeight);
	expect(overflow, 'the chat overflows the transcript').toBeGreaterThan(200);
	return workstreamId;
}

function workstreamLink(page: Page, workstreamId: string) {
	return page.locator(`a[data-navigation-workstream-id="${workstreamId}"]`).first();
}

async function switchAndSample(page: Page, workstreamId: string): Promise<Frame[]> {
	await page.locator('body').evaluate(
		(body, { workstreamId, latestRun }) => {
			const doc = body.ownerDocument;
			const frames: Frame[] = [];
			const state = { frames, sampling: true };
			globalThis.openMotion = state;
			const sample = (): void => {
				if (!state.sampling) return;
				const viewport = doc.querySelector('[data-testid="chat-message-viewport"]');
				const motion = (viewport?.getAnimations({ subtree: true }) ?? [])
					.filter((animation: { playState: string }) => animation.playState === 'running')
					.map((animation: { constructor: { name: string } }) => animation.constructor.name);
				for (const row of viewport?.querySelectorAll('[style*="translate"]') ?? []) {
					motion.push(`glide:${row.tagName.toLowerCase()}`);
				}
				state.frames.push({
					shown: decodeURIComponent(doc.location.hash).includes(workstreamId),
					latestRunBottom: doc.querySelector(latestRun)?.getBoundingClientRect().bottom ?? 0,
					motion,
				});
				doc.defaultView?.requestAnimationFrame(sample);
			};
			sample();
		},
		{ workstreamId, latestRun: LATEST_RUN },
	);
	await workstreamLink(page, workstreamId).click();
	await page.waitForTimeout(SETTLE_MS);
	return page.evaluate(() => {
		globalThis.openMotion.sampling = false;
		return globalThis.openMotion.frames;
	});
}

function expectStillAfterOpening(frames: readonly Frame[], label: string): void {
	const opened = frames.findIndex((frame) => frame.shown);
	expect(opened, `${label}: the chat opened`).toBeGreaterThanOrEqual(0);
	const after = frames.slice(opened);
	expect(after.length, `${label}: frames sampled after opening`).toBeGreaterThan(10);
	const bottoms = after.map((frame) => frame.latestRunBottom);
	expect(
		Math.round(Math.max(...bottoms) - Math.min(...bottoms)),
		`${label}: px the latest run moved after the chat opened`,
	).toBeLessThanOrEqual(STILL_PX);
	expect(
		after.flatMap((frame) => frame.motion),
		`${label}: motion in the transcript after the chat opened`,
	).toEqual([]);
}

test('switching between workstreams opens each chat still, with its changed files already in place', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const first = await chatWithChanges(app, 'Still A');
		const second = await chatWithChanges(app, 'Still B');
		await page.waitForTimeout(1_000);

		expectStillAfterOpening(await switchAndSample(page, first), 'first visit since the restart');
		expectStillAfterOpening(await switchAndSample(page, second), 'returning to B');
		expectStillAfterOpening(await switchAndSample(page, first), 'returning to A');
		await expect(page.getByTestId('chat-changed-files-toggle')).toContainText(
			'1 file changed in this chat',
		);
		await captureFlow(app, 'transcript-open-still');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
