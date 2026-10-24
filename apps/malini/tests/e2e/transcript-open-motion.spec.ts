import { execFileSync } from 'node:child_process';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
	untilStill,
} from './harness';

type SampledAnimation = Readonly<{
	playState: string;
	transitionProperty?: string;
	constructor: Function;
}>;

type SampledElement = Readonly<{
	tagName: string;
	textContent: string | null;
	getAttribute(name: string): string | null;
	getBoundingClientRect(): { bottom: number; height: number };
	getAnimations(options: { subtree: boolean }): SampledAnimation[];
	querySelectorAll(selector: string): Iterable<SampledElement>;
}>;

declare global {
	var openMotion: { frames: Frame[]; sampling: boolean };
	var document: { querySelector(selector: string): SampledElement | null };
	var requestAnimationFrame: (callback: () => void) => number;
}

type Frame = Readonly<{
	shown: boolean;
	latestRunBottom: number;
	footerHeight: number;
	changedFiles: string;
	motion: readonly string[];
}>;

const LATEST_RUN = '[data-testid="chat-message-list"] > li[data-run-id]:last-child';
const STILL_PX = 1;
const MIN_FRAMES_AFTER_OPENING = 10;

async function overflowingChat(app: LaunchedApp, name: string, changes: boolean): Promise<string> {
	const { page } = app;
	const slug = name.toLowerCase().replaceAll(' ', '-');
	const source = await createSourceRepo(app.root, slug);
	const { workstreamId } = await seedWorkstream(page, source, `e2e-${slug}`, name);
	await openWorkstream(page, workstreamId);
	await sendPrompt(page, changes ? 'EDIT:notes.txt' : `${name} turn 1`);
	if (changes) {
		await expect(page.getByTestId('chat-changed-files-toggle')).toContainText(
			'1 file changed in this chat',
			{ timeout: 30_000 },
		);
	}
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

type SampleTarget = Readonly<{ workstreamId: string; latestRun: string }>;

function sampleOpening({ workstreamId, latestRun }: SampleTarget): void {
	const doc = globalThis.document;
	const nextFrame = (): void => {
		globalThis.requestAnimationFrame(() => setTimeout(sample));
	};
	const frames: Frame[] = [];
	const state = { frames, sampling: true };
	globalThis.openMotion = state;
	const sample = (): void => {
		if (!state.sampling) return;
		const viewport = doc.querySelector('[data-testid="chat-message-viewport"]');
		const footer = doc.querySelector('[data-testid="chat-footer-stack"]');
		const motion = [viewport, footer]
			.flatMap((element) => element?.getAnimations({ subtree: true }) ?? [])
			.filter((animation) => animation.playState === 'running')
			.filter((animation) => !animation.transitionProperty?.endsWith('color'))
			.map((animation) => animation.constructor.name);
		for (const row of viewport?.querySelectorAll('[style*="translate"]') ?? []) {
			motion.push(`glide:${row.tagName.toLowerCase()}`);
		}
		state.frames.push({
			shown:
				doc
					.querySelector('[data-testid="transcript-pane"]')
					?.getAttribute('data-presented-workstream-id') === workstreamId,
			latestRunBottom: doc.querySelector(latestRun)?.getBoundingClientRect().bottom ?? 0,
			footerHeight: footer?.getBoundingClientRect().height ?? 0,
			changedFiles:
				doc.querySelector('[data-testid="chat-changed-files-toggle"]')?.textContent?.trim() ?? '',
			motion,
		});
		nextFrame();
	};
	sample();
}

async function sampledFrames(page: Page): Promise<Frame[]> {
	await page.waitForFunction(
		() => globalThis.openMotion.frames.some((frame) => frame.shown && frame.latestRunBottom > 0),
		undefined,
		{ timeout: 20_000 },
	);
	await untilStill(page);
	await page.waitForFunction(
		(minimum) => {
			const { frames } = globalThis.openMotion;
			const drawn = frames.findIndex((frame) => frame.shown && frame.latestRunBottom > 0);
			return frames.length - drawn - 1 > minimum;
		},
		MIN_FRAMES_AFTER_OPENING,
		{ timeout: 20_000 },
	);
	return page.evaluate(() => {
		globalThis.openMotion.sampling = false;
		return globalThis.openMotion.frames;
	});
}

async function switchAndSample(page: Page, workstreamId: string): Promise<Frame[]> {
	await page.evaluate(sampleOpening, { workstreamId, latestRun: LATEST_RUN });
	await workstreamLink(page, workstreamId).click();
	return sampledFrames(page);
}

async function relaunchAndSample(page: Page, workstreamId: string): Promise<Frame[]> {
	await page.addInitScript(sampleOpening, { workstreamId, latestRun: LATEST_RUN });
	await page.reload();
	return sampledFrames(page);
}

function afterFirstDrawnFrame(frames: readonly Frame[]): readonly Frame[] {
	return frames.slice(frames.findIndex((frame) => frame.shown && frame.latestRunBottom > 0) + 1);
}

function expectStillAfterOpening(frames: readonly Frame[], label: string): void {
	const opened = frames.findIndex((frame) => frame.shown);
	expect(opened, `${label}: the chat opened`).toBeGreaterThanOrEqual(0);
	const after = frames.slice(opened);
	expect(after.length, `${label}: frames sampled after opening`).toBeGreaterThan(
		MIN_FRAMES_AFTER_OPENING,
	);
	const bottoms = after.map((frame) => frame.latestRunBottom);
	expect(
		Math.round(Math.max(...bottoms) - Math.min(...bottoms)),
		`${label}: px the latest run moved after the chat opened`,
	).toBeLessThanOrEqual(STILL_PX);
	const footers = after.map((frame) => frame.footerHeight);
	expect(
		Math.round(Math.max(...footers) - Math.min(...footers)),
		`${label}: px the composer tray changed height after the chat opened`,
	).toBeLessThanOrEqual(STILL_PX);
	expect(
		[...new Set(after.map((frame) => frame.changedFiles))],
		`${label}: what the changed files said after the chat opened`,
	).toHaveLength(1);
	expect(
		after.flatMap((frame) => frame.motion),
		`${label}: motion in the transcript or the composer tray after the chat opened`,
	).toEqual([]);
}

test('switching between workstreams opens each chat still, with its changed files already in place', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const first = await overflowingChat(app, 'Still A', true);
		const second = await overflowingChat(app, 'Still B', true);
		await untilStill(page);

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

test('switching to a workstream with a different composer tray shows that tray at once and opens still', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const withChanges = await overflowingChat(app, 'Tray A', true);
		const withoutChanges = await overflowingChat(app, 'Tray B', false);
		await untilStill(page);

		const changedFiles = page.getByTestId('chat-changed-files-toggle');
		expectStillAfterOpening(await switchAndSample(page, withChanges), 'to the chat with changes');
		await expect(changedFiles).toContainText('1 file changed in this chat');
		expectStillAfterOpening(await switchAndSample(page, withoutChanges), 'to the chat without');
		await expect(changedFiles).toHaveCount(0);
		expectStillAfterOpening(
			await switchAndSample(page, withChanges),
			'back to the chat with changes',
		);
		await expect(changedFiles).toContainText('1 file changed in this chat');
		await captureFlow(app, 'transcript-open-tray-still');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a chat opened right after launch shows its changed files and every turn in place from its first frame', async () => {
	test.setTimeout(300_000);
	const first = await launchMalini();
	const chats: string[] = [];
	try {
		for (const name of ['Launch A', 'Launch B', 'Launch C']) {
			chats.push(await overflowingChat(first, name, true));
		}
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}

	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		const [opened] = chats;
		if (!opened) throw new Error('no chat to open');
		const changedFiles = page.getByTestId('chat-changed-files-toggle');
		await expect(workstreamLink(page, opened)).toBeVisible({ timeout: 20_000 });
		expectStillAfterOpening(
			afterFirstDrawnFrame(await switchAndSample(page, opened)),
			'opened after launch',
		);
		await expect(changedFiles).toContainText('1 file changed in this chat');

		expectStillAfterOpening(
			afterFirstDrawnFrame(await relaunchAndSample(page, opened)),
			'restored at launch',
		);
		await expect(changedFiles).toContainText('1 file changed in this chat');
		await captureFlow(app, 'transcript-open-after-launch');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

function holdGit(bin: string, gate: string): () => void {
	const git = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
	const held = join(bin, 'git');
	writeFileSync(held, `#!/bin/sh\nwhile [ -e '${gate}' ]; do sleep 0.05; done\nexec '${git}' "$@"\n`);
	chmodSync(held, 0o755);
	writeFileSync(gate, '');
	return () => rmSync(gate, { force: true });
}

test('a chat opened after a restart shows its changed files without waiting for git', async () => {
	test.setTimeout(300_000);
	const first = await launchMalini();
	let target = '';
	try {
		const { page } = first;
		const source = await createSourceRepo(first.root, 'git-held');
		const seeded = await seedWorkstream(page, source, 'e2e-git-held', 'Git held');
		const other = await seedWorkstream(page, source, 'e2e-git-held-other', 'Git held other');
		target = seeded.workstreamId;
		await openWorkstream(page, target);
		await sendPrompt(page, 'EDIT:notes.txt');
		const changedFiles = page.getByTestId('chat-changed-files-toggle');
		await expect(changedFiles).toContainText('1 file changed in this chat', { timeout: 30_000 });
		for (let turn = 2; turn <= 10; turn += 1) {
			await sendPrompt(page, turn === 2 ? 'Git held turn 2 EDIT:notes.txt' : `Git held turn ${turn}`);
			await expect(page.getByTestId('chat-message-bubble')).toHaveCount(turn, { timeout: 20_000 });
		}
		await expect(page.locator(LATEST_RUN)).toHaveAttribute('data-run-terminal', 'completed');
		await expect(changedFiles).toContainText('+1');
		await expect(changedFiles).not.toContainText('−');
		await openWorkstream(page, other.workstreamId);
		await first.quit();
	} catch (error) {
		await first.close();
		throw error;
	}

	const releaseGit = holdGit(first.bin, join(first.root, 'git-held'));
	const app = await launchMalini({ profile: first.root });
	try {
		const { page } = app;
		await expect(workstreamLink(page, target)).toBeVisible({ timeout: 20_000 });
		await page.evaluate(sampleOpening, { workstreamId: target, latestRun: LATEST_RUN });
		await workstreamLink(page, target).click();
		await page.waitForFunction(
			() => globalThis.openMotion.frames.some((frame) => frame.shown && frame.latestRunBottom > 0),
			undefined,
			{ timeout: 20_000 },
		);
		const changedFiles = page.getByTestId('chat-changed-files-toggle');
		await expect(changedFiles).toContainText('1 file changed in this chat');
		await expect(changedFiles).toContainText('+1');
		await expect(changedFiles).not.toContainText('−');
		releaseGit();
		expectStillAfterOpening(afterFirstDrawnFrame(await sampledFrames(page)), 'git held');
		await captureFlow(app, 'transcript-open-git-held');

		expectCleanConsole(app);
	} finally {
		releaseGit();
		await app.close();
	}
});
